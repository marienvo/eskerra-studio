import type {EskerraR2Config} from './eskerraSettings';
import {r2SignedObjectRequest, type R2PlaylistObjectOptions} from './r2PlaylistObject';
import {extractXmlSimpleTagText} from './stringScanners';
import {parseThemePreferenceOrThrow, serializeThemePreference, type ThemePreference} from './themePreference';
import {THEME_PREFERENCE_FILE_NAME} from './vaultLayout';

function parseR2XmlErrorCode(errText: string): string {
  return extractXmlSimpleTagText(errText, 'Code');
}

function r2DeniedHint(errCode: string, verb: 'read' | 'write' | 'delete'): string {
  if (errCode !== 'AccessDenied') {
    return '';
  }
  const eu =
    ' EU data location buckets need jurisdiction "EU" in settings (or the .eu.r2.cloudflarestorage.com endpoint).';
  if (verb === 'read') {
    return (
      'Grant Object Read on the R2 S3 API token for this bucket (Cloudflare: R2 → Manage R2 API Tokens).' +
      eu
    );
  }
  if (verb === 'write') {
    return 'Grant Object Write on the R2 S3 API token for this bucket.' + eu;
  }
  return 'Grant Object Delete on the R2 S3 API token for this bucket.' + eu;
}

export async function getR2ThemePreferenceObject(
  config: EskerraR2Config,
  options?: R2PlaylistObjectOptions,
): Promise<ThemePreference | null> {
  const res = await r2SignedObjectRequest(
    config,
    THEME_PREFERENCE_FILE_NAME,
    {method: 'GET'},
    options?.transport,
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const errText = await res.text();
    const errCode = parseR2XmlErrorCode(errText);
    const hint = r2DeniedHint(errCode, 'read');
    const codePart = errCode ? ` (${errCode})` : '';
    throw new Error(
      `R2 GET ${THEME_PREFERENCE_FILE_NAME} failed: HTTP ${res.status}${codePart}` +
        (hint ? `. ${hint}` : ''),
    );
  }
  const raw = await res.text();
  if (!raw.trim()) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  return parseThemePreferenceOrThrow(parsed);
}

export async function putR2ThemePreferenceObject(
  config: EskerraR2Config,
  preference: ThemePreference,
  options?: R2PlaylistObjectOptions,
): Promise<void> {
  const body = serializeThemePreference(preference);
  const res = await r2SignedObjectRequest(
    config,
    THEME_PREFERENCE_FILE_NAME,
    {
      method: 'PUT',
      body,
      headers: {'Content-Type': 'application/json'},
    },
    options?.transport,
  );
  if (!res.ok) {
    const errText = await res.text();
    const errCode = parseR2XmlErrorCode(errText);
    const hint = r2DeniedHint(errCode, 'write');
    const codePart = errCode ? ` (${errCode})` : '';
    throw new Error(
      `R2 PUT ${THEME_PREFERENCE_FILE_NAME} failed: HTTP ${res.status}${codePart}` +
        (hint ? `. ${hint}` : ''),
    );
  }
}

export async function deleteR2ThemePreferenceObject(
  config: EskerraR2Config,
  options?: R2PlaylistObjectOptions,
): Promise<void> {
  const res = await r2SignedObjectRequest(
    config,
    THEME_PREFERENCE_FILE_NAME,
    {method: 'DELETE'},
    options?.transport,
  );
  if (res.status === 404) {
    return;
  }
  if (!res.ok) {
    const errText = await res.text();
    const errCode = parseR2XmlErrorCode(errText);
    const hint = r2DeniedHint(errCode, 'delete');
    const codePart = errCode ? ` (${errCode})` : '';
    throw new Error(
      `R2 DELETE ${THEME_PREFERENCE_FILE_NAME} failed: HTTP ${res.status}${codePart}` +
        (hint ? `. ${hint}` : ''),
    );
  }
}
