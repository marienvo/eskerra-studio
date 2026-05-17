import type {VaultDirEntry} from './vaultFilesystem';
import {isSyncConflictFileName, MARKDOWN_EXTENSION} from './vaultLayout';
import {stripTrailingSlashes, trimAndUnixSlashes} from './stringScanners';

/** Directory names excluded from the vault tree (product layout; Linux: case-sensitive). */
export const VAULT_TREE_HARD_EXCLUDED_DIRECTORY_NAMES = [
  'Assets',
  'Excalidraw',
  'Scripts',
  'Templates',
] as const;

const HARD_EXCLUDED_SET = new Set<string>(VAULT_TREE_HARD_EXCLUDED_DIRECTORY_NAMES);

/** Dot-prefixed only (hidden / tooling); underscore-prefixed dirs like `_autosync-backup-*` stay visible and navigable. */
export function isVaultTreeIgnoredEntryName(name: string): boolean {
  return name.startsWith('.');
}

export function isVaultTreeHardExcludedDirectoryName(name: string): boolean {
  return HARD_EXCLUDED_SET.has(name);
}

export function isEligibleVaultMarkdownFileName(fileName: string): boolean {
  if (!fileName.endsWith(MARKDOWN_EXTENSION)) {
    return false;
  }
  if (isSyncConflictFileName(fileName)) {
    return false;
  }
  if (isVaultTreeIgnoredEntryName(fileName)) {
    return false;
  }
  return true;
}

/** Applies tree listing rules: drop ignored names and hard-excluded directories (non-recursive). */
export function filterVaultTreeDirEntries(entries: readonly VaultDirEntry[]): VaultDirEntry[] {
  return entries.filter(entry => {
    if (isVaultTreeIgnoredEntryName(entry.name)) {
      return false;
    }
    if (
      entry.type === 'directory' &&
      isVaultTreeHardExcludedDirectoryName(entry.name)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Whether a child folder row should be hidden when it is non-empty after filters but has no eligible
 * markdown anywhere underneath.
 */
export function shouldPruneVaultTreeSubdirectory(options: {
  filteredChildEntries: readonly VaultDirEntry[];
  subtreeHasEligibleMarkdown: boolean;
}): boolean {
  if (options.filteredChildEntries.length === 0) {
    return false;
  }
  return !options.subtreeHasEligibleMarkdown;
}

export type VaultPathKindForInvalidation = 'file' | 'directory';

function normalizeVaultPathSlashes(uri: string): string {
  return trimAndUnixSlashes(uri);
}

/** Parent path using forward slashes (sufficient for vault URI strings on desktop and SAF). */
export function vaultPathDirname(uri: string): string {
  const norm = stripTrailingSlashes(normalizeVaultPathSlashes(uri));
  const i = norm.lastIndexOf('/');
  if (i < 0) {
    return norm;
  }
  if (i === 0) {
    return '/';
  }
  return norm.slice(0, i);
}

/**
 * Directory URIs that must drop any memoized `subtreeHasVisibleMarkdown` (or equivalent) when a path
 * under the vault changes. Includes every ancestor up to and including `vaultRootUri`.
 */
export function vaultAncestorDirectoryUrisForSubtreeCacheInvalidation(
  vaultRootUri: string,
  pathUri: string,
  kind: VaultPathKindForInvalidation,
): string[] {
  const root = stripTrailingSlashes(normalizeVaultPathSlashes(vaultRootUri));
  const full = normalizeVaultPathSlashes(pathUri);
  if (full !== root && !full.startsWith(`${root}/`)) {
    return [];
  }
  let startDir =
    kind === 'file' ? vaultPathDirname(full) : stripTrailingSlashes(full);
  if (startDir.length < root.length) {
    return [];
  }
  const out: string[] = [];
  let current: string | null = startDir;
  while (current != null && current.length >= root.length) {
    out.push(current);
    if (current === root) {
      break;
    }
    const next = vaultPathDirname(current);
    current = next.length < root.length ? null : next;
  }
  return out;
}

/**
 * Memo store for subtree markdown presence. Invalidation removes a directory key and optionally
 * clears everything (for example on external `vault-files-changed` without path detail).
 */
export class SubtreeMarkdownPresenceCache {
  private readonly cache = new Map<string, boolean>();

  get(dirUri: string): boolean | undefined {
    return this.cache.get(stripTrailingSlashes(normalizeVaultPathSlashes(dirUri)));
  }

  set(dirUri: string, value: boolean): void {
    const key = stripTrailingSlashes(normalizeVaultPathSlashes(dirUri));
    this.cache.set(key, value);
  }

  invalidatePaths(dirUris: readonly string[]): void {
    for (const raw of dirUris) {
      const key = stripTrailingSlashes(normalizeVaultPathSlashes(raw));
      this.cache.delete(key);
    }
  }

  invalidateForMutation(
    vaultRootUri: string,
    mutatedPathUri: string,
    kind: VaultPathKindForInvalidation,
  ): void {
    this.invalidatePaths(
      vaultAncestorDirectoryUrisForSubtreeCacheInvalidation(
        vaultRootUri,
        mutatedPathUri,
        kind,
      ),
    );
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
