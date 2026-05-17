import type {VaultDirEntry, VaultFilesystem} from './vaultFilesystem';
import {normalizeVaultSlashesUri} from './stringScanners';
import {filterVaultTreeDirEntries, isEligibleVaultMarkdownFileName, SubtreeMarkdownPresenceCache} from './vaultVisibility';

export type VaultSubtreeMarkdownOptions = {
  signal?: AbortSignal;
  subtreeCache?: SubtreeMarkdownPresenceCache;
  /**
   * When set, uses this listing for `directoryUri` instead of `listFiles` + {@link filterVaultTreeDirEntries}
   * (caller must apply the same filter).
   */
  knownFilteredEntries?: readonly VaultDirEntry[];
};

/**
 * Whether `directoryUri`'s subtree contains at least one eligible vault markdown file, using the same
 * directory filtering rules as the vault tree. Optionally fills `subtreeCache` keys for visited dirs.
 */
export async function vaultSubtreeHasEligibleMarkdown(
  fs: VaultFilesystem,
  directoryUri: string,
  options?: VaultSubtreeMarkdownOptions,
): Promise<boolean> {
  const cache = options?.subtreeCache;
  const normRoot = normalizeVaultSlashesUri(directoryUri);
  const rootPrefiltered = options?.knownFilteredEntries;

  async function compute(
    dir: string,
    prefiltered: readonly VaultDirEntry[] | undefined,
  ): Promise<boolean> {
    const cached = cache?.get(dir);
    if (cached !== undefined) {
      return cached;
    }
    options?.signal?.throwIfAborted();
    const filtered =
      prefiltered ?? filterVaultTreeDirEntries(await fs.listFiles(dir));
    for (const entry of filtered) {
      if (entry.type === 'directory') {
        const sub = await compute(normalizeVaultSlashesUri(entry.uri), undefined);
        if (sub) {
          cache?.set(dir, true);
          return true;
        }
        continue;
      }
      if (isEligibleVaultMarkdownFileName(entry.name)) {
        cache?.set(dir, true);
        return true;
      }
    }
    cache?.set(dir, false);
    return false;
  }

  return compute(normRoot, rootPrefiltered);
}
