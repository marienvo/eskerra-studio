import type {EskerraR2Config} from './eskerraSettings';
import {r2SignedObjectRequest, type R2SignedRequestTransport} from './r2PlaylistObject';
import {extractXmlSimpleTagText} from './stringScanners';
import {parseThemePreferenceOrThrow, type ThemePreference} from './themePreference';
import {THEME_PREFERENCE_FILE_NAME} from './vaultLayout';

export type FetchR2ThemePreferenceConditionalOptions = {
  etag?: string | null;
  signal?: AbortSignal;
  transport?: R2SignedRequestTransport;
};

export type R2ThemePreferenceConditionalResult =
  | {kind: 'not_modified'}
  | {kind: 'updated'; preference: ThemePreference; etag: string | null}
  | {kind: 'missing'};

function parseR2XmlErrorCode(errText: string): string {
  return extractXmlSimpleTagText(errText, 'Code');
}

function r2ReadDeniedHint(errCode: string): string {
  if (errCode !== 'AccessDenied') {
    return '';
  }
  return (
    'Grant Object Read on the R2 S3 API token for this bucket (Cloudflare: R2 → Manage R2 API Tokens).' +
    ' EU data location buckets need jurisdiction "EU" in settings (or the .eu.r2.cloudflarestorage.com endpoint).'
  );
}

/**
 * GET `theme-preference.json` with optional `If-None-Match`.
 */
export async function fetchR2ThemePreferenceConditional(
  config: EskerraR2Config,
  options?: FetchR2ThemePreferenceConditionalOptions,
): Promise<R2ThemePreferenceConditionalResult> {
  const headers = new Headers();
  const prior = options?.etag?.trim();
  if (prior) {
    headers.set('If-None-Match', prior);
  }

  const init: RequestInit = {
    method: 'GET',
    headers,
    signal: options?.signal,
  };

  const res = await r2SignedObjectRequest(
    config,
    THEME_PREFERENCE_FILE_NAME,
    init,
    options?.transport,
  );

  if (res.status === 304) {
    return {kind: 'not_modified'};
  }
  if (res.status === 404) {
    return {kind: 'missing'};
  }
  if (!res.ok) {
    const errText = await res.text();
    const errCode = parseR2XmlErrorCode(errText);
    const hint = r2ReadDeniedHint(errCode);
    const codePart = errCode ? ` (${errCode})` : '';
    throw new Error(
      `R2 GET ${THEME_PREFERENCE_FILE_NAME} failed: HTTP ${res.status}${codePart}` +
        (hint ? `. ${hint}` : ''),
    );
  }

  const raw = await res.text();
  if (!raw.trim()) {
    return {kind: 'missing'};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`R2 ${THEME_PREFERENCE_FILE_NAME} is not valid JSON.`);
  }

  const preference = parseThemePreferenceOrThrow(parsed);
  const etag = res.headers.get('etag');
  return {kind: 'updated', preference, etag};
}
