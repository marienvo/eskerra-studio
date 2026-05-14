/**
 * Merge persisted disk-read bodies with inbox-opened content for vault-wide backlink scans.
 * Inbox entries win so unsaved editor text and freshly loaded notes override stale cache.
 */
export function mergeVaultBacklinkBodySeed(
  diskCache: Readonly<Record<string, string>>,
  inboxContentByUri: Readonly<Record<string, string>>,
): Record<string, string> {
  return {...diskCache, ...inboxContentByUri};
}
