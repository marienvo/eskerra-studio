import {AwsClient} from 'aws4fetch';

import {r2S3AccountBaseUrl, type EskerraR2Config} from './eskerraSettings';
import {normalizePlaylistEntryForSync, serializePlaylistEntry, type PlaylistEntry} from './playlist';
import {extractXmlSimpleTagText, stripTrailingSlashes} from './stringScanners';
import {PLAYLIST_FILE_NAME} from './vaultLayout';

/** Cloudflare R2 S3 API uses the `auto` region for SigV4. */
const R2_SIGNING_REGION = 'auto';
const S3_SERVICE = 's3';

/** Executes the signed request (default: `fetch`). Desktop can substitute native HTTP to avoid WebView CORS. */
export type R2SignedRequestTransport = (signedRequest: Request) => Promise<Response>;

export type R2PlaylistObjectOptions = {
  transport?: R2SignedRequestTransport;
};

export function buildR2ObjectUrl(config: EskerraR2Config, objectKey: string): string {
  const base = stripTrailingSlashes(r2S3AccountBaseUrl(config));
  const encodedKey = encodeURIComponent(objectKey).replace(/%2F/g, '/');
  return `${base}/${config.bucket}/${encodedKey}`;
}

function createR2Client(config: EskerraR2Config): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: S3_SERVICE,
    region: R2_SIGNING_REGION,
  });
}

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

async function signedRequest(
  client: AwsClient,
  input: string,
  init: RequestInit | undefined,
  transport: R2SignedRequestTransport | undefined,
): Promise<Response> {
  // Presigned query signing keeps credentials off the Authorization header. Some runtimes
  // alter or drop that header (Tauri/WebView, React Native fetch) → R2 SignatureDoesNotMatch.
  const signInit = {...(init ?? {}), aws: {signQuery: true}};
  const signed = await client.sign(input, signInit as RequestInit);
  const exec = transport ?? ((r: Request) => fetch(r));
  return exec(signed);
}

/** Signed GET/PUT/DELETE for an object key in the configured bucket (used by playlist helpers). */
export async function r2SignedObjectRequest(
  config: EskerraR2Config,
  objectKey: string,
  init: RequestInit | undefined,
  transport?: R2SignedRequestTransport,
): Promise<Response> {
  const url = buildR2ObjectUrl(config, objectKey);
  const client = createR2Client(config);
  return signedRequest(client, url, init, transport);
}

export async function getR2PlaylistObject(
  config: EskerraR2Config,
  options?: R2PlaylistObjectOptions,
): Promise<PlaylistEntry | null> {
  const res = await r2SignedObjectRequest(config, PLAYLIST_FILE_NAME, {method: 'GET'}, options?.transport);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const errText = await res.text();
    const errCode = parseR2XmlErrorCode(errText);
    const hint = r2DeniedHint(errCode, 'read');
    const codePart = errCode ? ` (${errCode})` : '';
    throw new Error(
      `R2 GET ${PLAYLIST_FILE_NAME} failed: HTTP ${res.status}${codePart}` + (hint ? `. ${hint}` : ''),
    );
  }
  const raw = await res.text();
  if (!raw.trim()) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  const entry = normalizePlaylistEntryForSync(parsed);
  if (!entry) {
    throw new Error('R2 playlist.json has an invalid structure.');
  }
  return entry;
}

export async function putR2PlaylistObject(
  config: EskerraR2Config,
  entry: PlaylistEntry,
  options?: R2PlaylistObjectOptions,
): Promise<void> {
  const body = serializePlaylistEntry(entry);
  const res = await r2SignedObjectRequest(
    config,
    PLAYLIST_FILE_NAME,
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
      `R2 PUT ${PLAYLIST_FILE_NAME} failed: HTTP ${res.status}${codePart}` + (hint ? `. ${hint}` : ''),
    );
  }
}

export async function deleteR2PlaylistObject(
  config: EskerraR2Config,
  options?: R2PlaylistObjectOptions,
): Promise<void> {
  const res = await r2SignedObjectRequest(config, PLAYLIST_FILE_NAME, {method: 'DELETE'}, options?.transport);
  if (res.status === 404) {
    return;
  }
  if (!res.ok) {
    const errText = await res.text();
    const errCode = parseR2XmlErrorCode(errText);
    const hint = r2DeniedHint(errCode, 'delete');
    const codePart = errCode ? ` (${errCode})` : '';
    throw new Error(
      `R2 DELETE ${PLAYLIST_FILE_NAME} failed: HTTP ${res.status}${codePart}` + (hint ? `. ${hint}` : ''),
    );
  }
}
