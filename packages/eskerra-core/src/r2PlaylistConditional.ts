import {normalizePlaylistEntryForSync, type PlaylistEntry} from './playlist';
import {r2SignedObjectRequest, type R2SignedRequestTransport} from './r2PlaylistObject';
import type {EskerraR2Config} from './eskerraSettings';
import {extractXmlSimpleTagText} from './stringScanners';
import {PLAYLIST_FILE_NAME} from './vaultLayout';

export type FetchR2PlaylistConditionalOptions = {
  etag?: string | null;
  signal?: AbortSignal;
  transport?: R2SignedRequestTransport;
};

export type R2PlaylistConditionalResult =
  | {kind: 'not_modified'}
  | {kind: 'updated'; entry: PlaylistEntry; etag: string | null}
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
 * GET `playlist.json` with optional `If-None-Match`. Uses the same signing/transport path as
 * {@link getR2PlaylistObject} (including Tauri presigned GET with conditional headers).
 */
export async function fetchR2PlaylistConditional(
  config: EskerraR2Config,
  options?: FetchR2PlaylistConditionalOptions,
): Promise<R2PlaylistConditionalResult> {
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

  const res = await r2SignedObjectRequest(config, PLAYLIST_FILE_NAME, init, options?.transport);

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
      `R2 GET ${PLAYLIST_FILE_NAME} failed: HTTP ${res.status}${codePart}` + (hint ? `. ${hint}` : ''),
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
    throw new Error('R2 playlist.json is not valid JSON.');
  }

  const entry = normalizePlaylistEntryForSync(parsed);
  if (!entry) {
    throw new Error('R2 playlist.json has an invalid structure.');
  }

  const etag = res.headers.get('etag');
  return {kind: 'updated', entry, etag};
}
