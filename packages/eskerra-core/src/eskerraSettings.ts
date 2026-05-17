import type {FrontmatterPropertyType} from './markdown/frontmatterTypes';
import {parseThemePreference} from './themePreference';
import type {ThemePreference} from './themePreference';
import {stripSuffixCaseInsensitive, stripTrailingSlashes, trimAsciiWhitespace} from './stringScanners';

const FM_PROPERTY_TYPES: ReadonlySet<FrontmatterPropertyType> = new Set([
  'text',
  'number',
  'checkbox',
  'date',
  'datetime',
  'timestamp',
  'url',
  'list',
  'tags',
  'object',
]);

/** R2 bucket jurisdiction; EU/FedRAMP buckets must use the matching S3 API hostname. */
export type R2Jurisdiction = 'default' | 'eu' | 'fedramp';

export type EskerraR2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** When set, `endpoint` host is rewritten for S3 requests (e.g. `.eu.r2.cloudflarestorage.com`). */
  jurisdiction?: R2Jurisdiction;
};

/** Shared vault JSON: optional R2 only. Display name lives in `settings-local.json`. */
export type EskerraSettings = {
  r2?: EskerraR2Config;
  /**
   * Theme selection when R2 is not configured (same shape as R2 `theme-preference.json`).
   * Omitted from disk when R2 playlist sync is active (preference lives in the bucket).
   */
  themePreference?: ThemePreference;
  /** Optional per-property type overrides for vault frontmatter (desktop Properties UI). */
  frontmatterProperties?: Record<string, {type: FrontmatterPropertyType}>;
  /** Hostnames for which rich link snippet cards are suppressed. */
  linkSnippetBlockedDomains?: string[];
};

function parseR2Block(value: unknown): EskerraR2Config {
  if (typeof value !== 'object' || value === null) {
    throw new Error('settings-shared.json has an invalid structure.');
  }

  const o = value as Record<string, unknown>;
  if (
    typeof o.endpoint !== 'string' ||
    typeof o.bucket !== 'string' ||
    typeof o.accessKeyId !== 'string' ||
    typeof o.secretAccessKey !== 'string'
  ) {
    throw new Error('settings-shared.json has an invalid structure.');
  }

  let jurisdiction: R2Jurisdiction | undefined;
  if (o.jurisdiction !== undefined) {
    if (o.jurisdiction !== 'default' && o.jurisdiction !== 'eu' && o.jurisdiction !== 'fedramp') {
      throw new Error('settings-shared.json has an invalid structure.');
    }
    jurisdiction = o.jurisdiction;
  }

  const out: EskerraR2Config = {
    endpoint: o.endpoint,
    bucket: o.bucket,
    accessKeyId: o.accessKeyId,
    secretAccessKey: o.secretAccessKey,
  };
  if (jurisdiction !== undefined && jurisdiction !== 'default') {
    out.jurisdiction = jurisdiction;
  }
  return out;
}

/**
 * Returns the S3 API base URL for this config. Rewrites the default R2 hostname when
 * `jurisdiction` is `eu` or `fedramp` (required by Cloudflare for jurisdictional buckets).
 */
export function effectiveR2Endpoint(config: EskerraR2Config): string {
  const trimmed = stripTrailingSlashes(trimAsciiWhitespace(config.endpoint));
  const jur = config.jurisdiction ?? 'default';
  if (jur === 'default') {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const host = url.hostname;
  if (jur === 'eu') {
    if (host.endsWith('.eu.r2.cloudflarestorage.com')) {
      return trimmed;
    }
    if (
      host.endsWith('.r2.cloudflarestorage.com') &&
      !host.includes('.fedramp.') &&
      !host.includes('.eu.')
    ) {
      const account = stripSuffixCaseInsensitive(host, '.r2.cloudflarestorage.com');
      if (account != null && !account.includes('.')) {
        url.hostname = `${account}.eu.r2.cloudflarestorage.com`;
        return stripTrailingSlashes(url.href);
      }
    }
    return trimmed;
  }

  if (jur === 'fedramp') {
    if (host.endsWith('.fedramp.r2.cloudflarestorage.com')) {
      return trimmed;
    }
    if (
      host.endsWith('.r2.cloudflarestorage.com') &&
      !host.includes('.fedramp.') &&
      !host.includes('.eu.')
    ) {
      const account = stripSuffixCaseInsensitive(host, '.r2.cloudflarestorage.com');
      if (account != null && !account.includes('.')) {
        url.hostname = `${account}.fedramp.r2.cloudflarestorage.com`;
        return stripTrailingSlashes(url.href);
      }
    }
    return trimmed;
  }

  return trimmed;
}

/**
 * Base URL for path-style S3 calls (`/<bucket>/<objectKey>`). Cloudflare's dashboard copies
 * `https://<account>.(eu.)r2.../<bucket>`; we must not duplicate the bucket segment when building
 * object URLs.
 */
export function r2S3AccountBaseUrl(config: EskerraR2Config): string {
  const merged = stripTrailingSlashes(trimAsciiWhitespace(effectiveR2Endpoint(config)));
  let url: URL;
  try {
    url = new URL(merged);
  } catch {
    return merged;
  }
  const path = stripTrailingSlashes(url.pathname) || '';
  const bucket = config.bucket.trim();
  if (path === '' || path === `/${bucket}`) {
    return url.origin;
  }
  return merged;
}

export const defaultEskerraSettings: EskerraSettings = {
  r2: {
    endpoint: 'https://00000000000000000000000000000000.r2.cloudflarestorage.com',
    bucket: 'mock-bucket',
    accessKeyId: 'mock_access_key_id',
    secretAccessKey: 'mock_secret_access_key',
  },
};

export function serializeEskerraSettings(settings: EskerraSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export type R2FormFields = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  jurisdiction?: R2Jurisdiction;
};

/**
 * Builds shared vault settings from R2 form fields. R2 is optional: if any field is non-empty,
 * all four must be non-empty after trim.
 *
 * When `previousShared` is passed and includes `themePreference`, it is copied into the result so
 * saving the R2 form does not drop theme state before the desktop app migrates it to R2.
 */
export function buildEskerraSettingsFromForm(
  r2: R2FormFields,
  previousShared?: EskerraSettings,
):
  | {ok: true; settings: EskerraSettings}
  | {ok: false; message: string} {
  const e = r2.endpoint.trim();
  const b = r2.bucket.trim();
  const k = r2.accessKeyId.trim();
  const s = r2.secretAccessKey.trim();
  const anyNonEmpty = Boolean(e || b || k || s);
  const allNonEmpty = Boolean(e && b && k && s);

  if (anyNonEmpty && !allNonEmpty) {
    return {
      ok: false,
      message: 'Complete all Cloudflare R2 fields or clear them all.',
    };
  }

  const settings: EskerraSettings = {};
  if (allNonEmpty) {
    const j = r2.jurisdiction ?? 'default';
    const block: EskerraR2Config = {endpoint: e, bucket: b, accessKeyId: k, secretAccessKey: s};
    if (j !== 'default') {
      block.jurisdiction = j;
    }
    settings.r2 = block;
  }

  if (previousShared?.themePreference) {
    settings.themePreference = previousShared.themePreference;
  }

  if (previousShared?.frontmatterProperties) {
    settings.frontmatterProperties = previousShared.frontmatterProperties;
  }

  if (previousShared?.linkSnippetBlockedDomains?.length) {
    settings.linkSnippetBlockedDomains = previousShared.linkSnippetBlockedDomains;
  }

  return {ok: true, settings};
}

function parseFrontmatterPropertiesBlock(
  raw: unknown,
): Record<string, {type: FrontmatterPropertyType}> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const out: Record<string, {type: FrontmatterPropertyType}> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const t = (entry as {type?: unknown}).type;
    if (typeof t !== 'string' || !FM_PROPERTY_TYPES.has(t as FrontmatterPropertyType)) {
      continue;
    }
    out[key] = {type: t as FrontmatterPropertyType};
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parses shared settings. Legacy `displayName` in JSON is ignored (migrate to local via storage layer).
 */
export function parseEskerraSettings(rawSettings: string): EskerraSettings {
  const parsed = JSON.parse(rawSettings) as Record<string, unknown>;

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('settings-shared.json has an invalid structure.');
  }

  const out: EskerraSettings = {};

  if (parsed.r2 !== undefined) {
    out.r2 = parseR2Block(parsed.r2);
  }

  if (parsed.themePreference !== undefined) {
    const tp = parseThemePreference(parsed.themePreference);
    if (!tp) {
      throw new Error('settings-shared.json has an invalid themePreference.');
    }
    out.themePreference = tp;
  }

  if (parsed.frontmatterProperties !== undefined) {
    const fm = parseFrontmatterPropertiesBlock(parsed.frontmatterProperties);
    if (fm) {
      out.frontmatterProperties = fm;
    }
  }

  if (Array.isArray(parsed.linkSnippetBlockedDomains)) {
    const domains = parsed.linkSnippetBlockedDomains.filter(
      (d): d is string => typeof d === 'string' && d.length > 0,
    );
    if (domains.length > 0) {
      out.linkSnippetBlockedDomains = domains;
    }
  }

  return out;
}
