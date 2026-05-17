import {stemFromMarkdownFileName} from './inboxMarkdown';
import type {VaultFilesystem} from './vaultFilesystem';
import {normalizeVaultBaseUri} from './vaultLayout';
import {normalizeVaultSlashesUri} from './stringScanners';
import {filterVaultTreeDirEntries, isEligibleVaultMarkdownFileName} from './vaultVisibility';

export type VaultMarkdownRef = {
  name: string;
  uri: string;
};

export type CollectVaultMarkdownRefsOptions = {
  signal?: AbortSignal;
};

/**
 * Vault-wide eligible `.md` paths for async wiki index (`{ name, uri }[]`). Walks the vault using the
 * same directory filtering rules as the vault tree (dot-prefixed ignored names, hard-excluded dirs). Does not
 * block callers; run in the background with `AbortSignal` per vault session.
 */
export async function collectVaultMarkdownRefs(
  vaultRootUri: string,
  fs: VaultFilesystem,
  options?: CollectVaultMarkdownRefsOptions,
): Promise<VaultMarkdownRef[]> {
  const signal = options?.signal;
  const base = normalizeVaultSlashesUri(normalizeVaultBaseUri(vaultRootUri));
  const out: VaultMarkdownRef[] = [];
  const stack: string[] = [base];

  while (stack.length > 0) {
    signal?.throwIfAborted();
    const dirUri = stack.pop()!;
    signal?.throwIfAborted();
    const rows = await fs.listFiles(dirUri);
    signal?.throwIfAborted();
    const filtered = filterVaultTreeDirEntries(rows);
    for (const entry of filtered) {
      signal?.throwIfAborted();
      if (entry.type === 'directory') {
        stack.push(entry.uri);
        continue;
      }
      if (isEligibleVaultMarkdownFileName(entry.name)) {
        out.push({
          name: stemFromMarkdownFileName(entry.name),
          uri: entry.uri,
        });
      }
    }
  }

  out.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) {
      return byName;
    }
    return a.uri.localeCompare(b.uri);
  });

  return out;
}
