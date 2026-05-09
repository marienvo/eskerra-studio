/**
 * In-memory {@link VaultFilesystem} for desktop Vitest integration tests.
 * Not imported by production code paths.
 */

import type {
  VaultDirEntry,
  VaultFilesystem,
  VaultReadOptions,
  VaultWriteOptions,
} from '@eskerra/core';
import {vaultPathDirname} from '@eskerra/core';

export type DesktopVaultFsWriteLogEntry = {
  op: 'writeFile' | 'mkdir' | 'unlink' | 'renameFile' | 'removeTree';
  uri: string;
  /** For example rename destination or removeTree root. */
  detail?: string;
};

export type CreateDesktopTestVaultFilesystemOptions = {
  /** Directory URIs that exist before any API calls (no writeLog entries). */
  dirs?: readonly string[];
  /** File path → UTF-8 body seeded before any API calls (no writeLog entries). */
  files?: Readonly<Record<string, string>>;
};

export type CreateDesktopTestVaultFilesystemResult = {
  fs: VaultFilesystem;
  /** Append-only log of mutating operations (reads are not logged). */
  writeLog: DesktopVaultFsWriteLogEntry[];
};

function stripTrailingSlashes(uri: string): string {
  let out = uri;
  while (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
}

function normalizeVaultUri(uri: string): string {
  const trimmed = uri.trim().replace(/\\/g, '/');
  if (trimmed === '') {
    return '/';
  }
  const noTrail = stripTrailingSlashes(trimmed);
  return noTrail === '' ? '/' : noTrail;
}

function ensureParentDirectories(dirs: Set<string>, fileUri: string): void {
  let parent = vaultPathDirname(normalizeVaultUri(fileUri));
  const seen = new Set<string>();
  while (parent !== '/' && parent.length > 0 && !seen.has(parent)) {
    seen.add(parent);
    dirs.add(parent);
    const next = vaultPathDirname(parent);
    if (next === parent) {
      break;
    }
    parent = next;
  }
  if (normalizeVaultUri(fileUri).startsWith('/')) {
    dirs.add('/');
  }
}

function isImmediateChildOfDirectory(
  childUri: string,
  directoryUri: string,
): {name: string} | null {
  const child = normalizeVaultUri(childUri);
  const base = normalizeVaultUri(directoryUri);
  const prefix = base === '/' ? '/' : `${base}/`;
  if (!child.startsWith(prefix)) {
    return null;
  }
  const rest = child.slice(prefix.length);
  if (!rest || rest.includes('/')) {
    return null;
  }
  return {name: rest};
}

function renameSingleFileInFakeVault(
  files: Map<string, string>,
  dirs: Set<string>,
  from: string,
  to: string,
): void {
  const body = files.get(from);
  if (body === undefined) {
    throw new Error(`renameFile: not found ${from}`);
  }
  ensureParentDirectories(dirs, to);
  dirs.delete(to);
  files.delete(from);
  files.set(to, body);
}

function renameDirectoryTreeInFakeVault(
  files: Map<string, string>,
  dirs: Set<string>,
  from: string,
  to: string,
): void {
  const fromPrefix = `${from}/`;
  const movedPairs: Array<{oldUri: string; body: string}> = [];
  for (const [k, v] of files.entries()) {
    if (k.startsWith(fromPrefix)) {
      movedPairs.push({oldUri: k, body: v});
    }
  }
  for (const {oldUri} of movedPairs) {
    files.delete(oldUri);
  }
  for (const {oldUri, body} of movedPairs) {
    const dest = oldUri === from ? to : `${to}${oldUri.slice(from.length)}`;
    ensureParentDirectories(dirs, dest);
    dirs.delete(dest);
    files.set(dest, body);
  }

  const movedDirs = [...dirs].filter(
    d => d === from || d.startsWith(fromPrefix),
  );
  movedDirs.sort((a, b) => b.length - a.length);
  for (const d of movedDirs) {
    dirs.delete(d);
  }
  for (const d of movedDirs) {
    const dest = d === from ? to : `${to}${d.slice(from.length)}`;
    dirs.add(dest);
  }
}

/**
 * Creates a tree-aware in-memory vault filesystem with immediate-children-only
 * {@link VaultFilesystem.listFiles} behavior matching POSIX-style vault URIs.
 */
export function createDesktopTestVaultFilesystem(
  initial?: CreateDesktopTestVaultFilesystemOptions,
): CreateDesktopTestVaultFilesystemResult {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const writeLog: DesktopVaultFsWriteLogEntry[] = [];
  let writeSeq = 0;

  for (const d of initial?.dirs ?? []) {
    dirs.add(normalizeVaultUri(d));
  }
  for (const [rawUri, body] of Object.entries(initial?.files ?? {})) {
    const uri = normalizeVaultUri(rawUri);
    ensureParentDirectories(dirs, uri);
    files.set(uri, body);
  }

  const pushLog = (entry: DesktopVaultFsWriteLogEntry): void => {
    writeLog.push(entry);
  };

  const fs: VaultFilesystem = {
    async exists(uri: string): Promise<boolean> {
      const n = normalizeVaultUri(uri);
      return files.has(n) || dirs.has(n);
    },

    async mkdir(uri: string): Promise<void> {
      const n = normalizeVaultUri(uri);
      let parent = vaultPathDirname(n);
      const seen = new Set<string>();
      while (parent !== '/' && parent.length > 0 && !seen.has(parent)) {
        seen.add(parent);
        dirs.add(parent);
        const next = vaultPathDirname(parent);
        if (next === parent) {
          break;
        }
        parent = next;
      }
      if (n.startsWith('/')) {
        dirs.add('/');
      }
      dirs.add(n);
      pushLog({op: 'mkdir', uri: n});
    },

    async readFile(uri: string, options: VaultReadOptions): Promise<string> {
      if (options.encoding !== 'utf8') {
        throw new Error('Only utf8 is supported');
      }
      const n = normalizeVaultUri(uri);
      if (dirs.has(n)) {
        throw new Error(`readFile: is a directory ${n}`);
      }
      const body = files.get(n);
      if (body === undefined) {
        throw new Error(`readFile: not found ${n}`);
      }
      return body;
    },

    async writeFile(
      uri: string,
      content: string,
      options: VaultWriteOptions,
    ): Promise<void> {
      if (options.encoding !== 'utf8') {
        throw new Error('Only utf8 is supported');
      }
      const n = normalizeVaultUri(uri);
      ensureParentDirectories(dirs, n);
      dirs.delete(n);
      files.set(n, content);
      writeSeq += 1;
      pushLog({op: 'writeFile', uri: n, detail: String(writeSeq)});
    },

    async unlink(uri: string): Promise<void> {
      const n = normalizeVaultUri(uri);
      if (dirs.has(n)) {
        throw new Error(`unlink: is a directory ${n}`);
      }
      if (!files.delete(n)) {
        throw new Error(`unlink: not found ${n}`);
      }
      pushLog({op: 'unlink', uri: n});
    },

    async removeTree(directoryUri: string): Promise<void> {
      const root = normalizeVaultUri(directoryUri);
      const prefix = root === '/' ? '/' : `${root}/`;

      const fileKeys = [...files.keys()].filter(
        k => k === root || k.startsWith(prefix),
      );
      for (const k of fileKeys) {
        files.delete(k);
      }

      const dirKeys = [...dirs].filter(
        d => d === root || d.startsWith(prefix),
      );
      dirKeys.sort((a, b) => b.length - a.length);
      for (const d of dirKeys) {
        dirs.delete(d);
      }

      pushLog({op: 'removeTree', uri: root});
    },

    async renameFile(fromUri: string, toUri: string): Promise<void> {
      const from = normalizeVaultUri(fromUri);
      const to = normalizeVaultUri(toUri);

      const fromIsDir = dirs.has(from);
      const fromIsFile = files.has(from);
      if (!fromIsDir && !fromIsFile) {
        throw new Error(`renameFile: not found ${from}`);
      }
      if (fromIsDir && fromIsFile) {
        throw new Error(`renameFile: path is both file and directory ${from}`);
      }

      if (fromIsFile && !fromIsDir) {
        renameSingleFileInFakeVault(files, dirs, from, to);
        pushLog({op: 'renameFile', uri: from, detail: to});
        return;
      }

      renameDirectoryTreeInFakeVault(files, dirs, from, to);
      pushLog({op: 'renameFile', uri: from, detail: to});
    },

    async listFiles(directoryUri: string): Promise<VaultDirEntry[]> {
      const base = normalizeVaultUri(directoryUri);
      const out: VaultDirEntry[] = [];
      const namesSeen = new Set<string>();

      for (const d of dirs) {
        const hit = isImmediateChildOfDirectory(d, base);
        if (hit && !namesSeen.has(hit.name)) {
          namesSeen.add(hit.name);
          out.push({
            name: hit.name,
            uri: d,
            type: 'directory',
            lastModified: null,
          });
        }
      }

      for (const path of files.keys()) {
        const hit = isImmediateChildOfDirectory(path, base);
        if (hit && !namesSeen.has(hit.name)) {
          namesSeen.add(hit.name);
          out.push({
            name: hit.name,
            uri: path,
            type: 'file',
            lastModified: null,
          });
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
    },
  };

  return {fs, writeLog};
}
