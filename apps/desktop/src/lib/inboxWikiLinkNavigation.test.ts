import {describe, expect, it} from 'vitest';

import type {VaultDirEntry, VaultFilesystem} from '@eskerra/core';

import {
  inboxRelativeMarkdownLinkHrefIsResolved,
  inboxWikiLinkTargetIsResolved,
  openOrCreateInboxWikiLinkTarget,
  openOrCreateVaultRelativeMarkdownLink,
  openOrCreateVaultWikiPathMarkdownLink,
} from './inboxWikiLinkNavigation';

function memoryVaultDirEntriesForPrefix(
  dirs: Set<string>,
  base: string,
  prefix: string,
): VaultDirEntry[] {
  const out: VaultDirEntry[] = [];
  for (const d of dirs) {
    if (d.startsWith(prefix) && d !== base) {
      const rest = d.slice(prefix.length);
      if (rest && !rest.includes('/')) {
        out.push({
          name: rest,
          uri: d,
          type: 'directory',
          lastModified: null,
        });
      }
    }
  }
  return out;
}

function memoryVaultFileEntriesForPrefix(
  files: Map<string, string>,
  base: string,
  prefix: string,
): VaultDirEntry[] {
  const out: VaultDirEntry[] = [];
  for (const [uri] of files) {
    if (uri.startsWith(prefix) && uri !== base) {
      const rest = uri.slice(prefix.length);
      if (rest && !rest.includes('/')) {
        out.push({
          name: rest,
          uri,
          type: 'file',
          lastModified: null,
        });
      }
    }
  }
  return out;
}

function createMemoryVaultFs(
  seed: Array<[string, 'dir' | string]>,
): {fs: VaultFilesystem; writes: Array<{uri: string; content: string}>} {
  const dirs = new Set<string>();
  const files = new Map<string, string>();
  const writes: Array<{uri: string; content: string}> = [];

  for (const [path, val] of seed) {
    if (val === 'dir') {
      dirs.add(path);
    } else {
      files.set(path, val);
    }
  }

  const listFiles = async (directoryUri: string): Promise<VaultDirEntry[]> => {
    const base = directoryUri.replace(/\/$/, '');
    const prefix = `${base}/`;
    return [
      ...memoryVaultDirEntriesForPrefix(dirs, base, prefix),
      ...memoryVaultFileEntriesForPrefix(files, base, prefix),
    ];
  };

  const fs: VaultFilesystem = {
    exists: async uri => dirs.has(uri) || files.has(uri),
    mkdir: async uri => {
      dirs.add(uri.replace(/\/$/, ''));
    },
    readFile: async uri => {
      const body = files.get(uri);
      if (body === undefined) {
        throw new Error(`missing: ${uri}`);
      }
      return body;
    },
    writeFile: async (uri, content, _opts) => {
      files.set(uri, content);
      writes.push({uri, content});
    },
    unlink: async uri => {
      files.delete(uri);
    },
    removeTree: async () => {},
    renameFile: async (fromUri, toUri) => {
      const value = files.get(fromUri);
      if (value === undefined) {
        throw new Error(`missing: ${fromUri}`);
      }
      files.delete(fromUri);
      files.set(toUri, value);
    },
    listFiles,
  };

  return {fs, writes};
}

describe('inboxWikiLinkTargetIsResolved', () => {
  const noteUri = '/vault/Inbox/alpha-note.md';

  it('is true when target matches a single inbox note', () => {
    expect(
      inboxWikiLinkTargetIsResolved(
        [{name: 'alpha-note.md', uri: noteUri}],
        'alpha-note',
      ),
    ).toBe(true);
  });

  it('is false when target would create a note', () => {
    expect(inboxWikiLinkTargetIsResolved([], 'brand new page')).toBe(false);
  });

  it('is false when multiple notes share the same stem', () => {
    expect(
      inboxWikiLinkTargetIsResolved(
        [
          {name: 'dup.md', uri: '/a/dup.md'},
          {name: 'dup.md', uri: '/b/dup.md'},
        ],
        'dup',
      ),
    ).toBe(false);
  });

  it('is false for path-like targets', () => {
    expect(inboxWikiLinkTargetIsResolved([], 'foo/bar')).toBe(false);
  });

  it('is true for path-shaped .md wiki when href resolves under the vault', () => {
    expect(
      inboxWikiLinkTargetIsResolved(
        [{name: 'Missing.md', uri: '/vault/General/Missing.md'}],
        '_autosync-backup-nuc/General/b.md',
        {
          vaultRoot: '/vault',
          sourceMarkdownUriOrDir: '/vault/General/Missing.md',
        },
      ),
    ).toBe(true);
  });

  it('is false when path wiki href does not resolve (e.g. hard-excluded directory)', () => {
    expect(
      inboxWikiLinkTargetIsResolved(
        [{name: 'Missing.md', uri: '/vault/General/Missing.md'}],
        '../Assets/nope.md',
        {
          vaultRoot: '/vault',
          sourceMarkdownUriOrDir: '/vault/General/Missing.md',
        },
      ),
    ).toBe(false);
  });

  it('is false for empty target', () => {
    expect(inboxWikiLinkTargetIsResolved([], '  ')).toBe(false);
  });

  it('is true for display form when target matches one note', () => {
    expect(
      inboxWikiLinkTargetIsResolved(
        [{name: 'alpha-note.md', uri: noteUri}],
        'alpha-note|Label',
      ),
    ).toBe(true);
  });

  it('is true when target is a browser-openable wiki URL', () => {
    expect(
      inboxWikiLinkTargetIsResolved(
        [],
        'https://example.com/path|Site',
      ),
    ).toBe(true);
  });
});

describe('openOrCreateInboxWikiLinkTarget', () => {
  const vaultRoot = '/vault';

  it('returns open when target matches a single inbox note', async () => {
    const noteUri = `${vaultRoot}/Inbox/alpha-note.md`;
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
      [noteUri, '# Alpha\n'],
    ]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: 'alpha-note',
      notes: [{name: 'alpha-note.md', uri: noteUri}],
      vaultRoot,
      fs,
    });
    expect(result).toEqual({kind: 'open', uri: noteUri});
  });

  it('returns open with canonical inner when match only differs by casing', async () => {
    const noteUri = `${vaultRoot}/Inbox/Alpha Note.md`;
    const {fs, writes} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
      [noteUri, '# Alpha\n'],
    ]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: 'alpha note',
      notes: [{name: 'Alpha Note.md', uri: noteUri}],
      vaultRoot,
      fs,
    });
    expect(result).toEqual({
      kind: 'open',
      uri: noteUri,
      canonicalInner: 'Alpha Note',
    });
    expect(writes).toEqual([]);
  });

  it('creates beside the active note when activeMarkdownUri is set', async () => {
    const activeUri = `${vaultRoot}/Proj/current.md`;
    const {fs, writes} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
      [`${vaultRoot}/Proj`, 'dir'],
      [activeUri, '# Cur\n'],
    ]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: 'side page',
      notes: [{name: 'current', uri: activeUri}],
      vaultRoot,
      fs,
      activeMarkdownUri: activeUri,
    });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') {
      return;
    }
    expect(result.uri).toBe(`${vaultRoot}/Proj/side page.md`);
    expect(writes.some(w => w.uri === result.uri)).toBe(true);
  });

  it('creates under newNoteParentDirectory when set, overriding active note parent', async () => {
    const activeUri = `${vaultRoot}/Daily/2026-04-06.md`;
    const generalDir = `${vaultRoot}/General`;
    const {fs, writes} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [generalDir, 'dir'],
      [`${vaultRoot}/Daily`, 'dir'],
      [activeUri, '# Week\n'],
    ]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: 'linked from hub',
      notes: [{name: '2026-04-06.md', uri: activeUri}],
      vaultRoot,
      fs,
      activeMarkdownUri: activeUri,
      newNoteParentDirectory: generalDir,
    });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') {
      return;
    }
    expect(result.uri).toBe(`${generalDir}/linked from hub.md`);
    expect(writes.some(w => w.uri === result.uri)).toBe(true);
  });

  it('creates a new inbox note when target does not exist', async () => {
    const {fs, writes} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
    ]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: 'brand new page',
      notes: [],
      vaultRoot,
      fs,
    });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') {
      return;
    }
    expect(result.uri).toBe(`${vaultRoot}/Inbox/brand new page.md`);
    expect(writes.some(w => w.uri === result.uri)).toBe(true);
  });

  it('strips filesystem-dangerous characters when creating files', async () => {
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
    ]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: 'Hello: World',
      notes: [],
      vaultRoot,
      fs,
    });
    expect(result).toEqual({
      kind: 'created',
      uri: `${vaultRoot}/Inbox/Hello World.md`,
      canonicalInner: 'Hello World',
    });
  });

  it('returns canonicalInner when apostrophe is stripped from created file name', async () => {
    const {fs, writes} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
    ]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: "John's notes",
      notes: [],
      vaultRoot,
      fs,
    });
    expect(result).toEqual({
      kind: 'created',
      uri: `${vaultRoot}/Inbox/Johns notes.md`,
      canonicalInner: 'Johns notes',
    });
    expect(writes.some(w => w.uri === `${vaultRoot}/Inbox/Johns notes.md`)).toBe(true);
  });

  it('returns canonicalInner when curly apostrophe (U+2019) is stripped from created file name', async () => {
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
    ]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: 'John’s notes',
      notes: [],
      vaultRoot,
      fs,
    });
    expect(result).toEqual({
      kind: 'created',
      uri: `${vaultRoot}/Inbox/Johns notes.md`,
      canonicalInner: 'Johns notes',
    });
  });

  it('preserves display text in canonicalInner when apostrophe is stripped', async () => {
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
    ]);
    // Display text ("John's") is used as the note title; apostrophe stripped → Johns.md
    // canonicalInner: target becomes sanitized stem; display text preserved as-is
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: "John's notes|John's",
      notes: [],
      vaultRoot,
      fs,
    });
    expect(result).toEqual({
      kind: 'created',
      uri: `${vaultRoot}/Inbox/Johns.md`,
      canonicalInner: "Johns|John's",
    });
  });

  it('omits canonicalInner when file name matches the original inner', async () => {
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
    ]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: 'clean name',
      notes: [],
      vaultRoot,
      fs,
    });
    expect(result).toEqual({kind: 'created', uri: `${vaultRoot}/Inbox/clean name.md`});
  });

  it('returns ambiguous when multiple note refs share the same stem', async () => {
    const noteA = `${vaultRoot}/Inbox/dup.md`;
    const noteB = `${vaultRoot}/Inbox/legacy/dup.md`;
    const {fs} = createMemoryVaultFs([[vaultRoot, 'dir']]);
    const rows = [
      {name: 'dup.md', uri: noteA},
      {name: 'dup.md', uri: noteB},
    ] as const;
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: 'dup',
      notes: rows,
      vaultRoot,
      fs,
    });
    expect(result).toEqual({
      kind: 'ambiguous',
      targetStem: 'dup',
      title: 'dup',
      notes: rows,
    });
  });

  it('returns unsupported for path-like targets', async () => {
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
    ]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: 'foo/bar',
      notes: [],
      vaultRoot,
      fs,
    });
    expect(result).toEqual({
      kind: 'unsupported',
      reason: 'path_not_supported',
    });
  });

  it('returns unsupported for empty target', async () => {
    const {fs} = createMemoryVaultFs([[vaultRoot, 'dir']]);
    const result = await openOrCreateInboxWikiLinkTarget({
      inner: '  ',
      notes: [],
      vaultRoot,
      fs,
    });
    expect(result).toEqual({kind: 'unsupported', reason: 'empty_target'});
  });
});

describe('openOrCreateVaultRelativeMarkdownLink', () => {
  const vaultRoot = '/vault';

  it('opens an existing target', async () => {
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/Inbox/a.md`, '# A'],
      [`${vaultRoot}/Inbox/b.md`, '# B'],
    ]);
    const notes = [
      {name: 'a.md', uri: `${vaultRoot}/Inbox/a.md`},
      {name: 'b.md', uri: `${vaultRoot}/Inbox/b.md`},
    ];
    const result = await openOrCreateVaultRelativeMarkdownLink({
      href: './b.md',
      notes,
      vaultRoot,
      fs,
      sourceMarkdownUriOrDir: `${vaultRoot}/Inbox/a.md`,
    });
    expect(result).toEqual({kind: 'open', uri: `${vaultRoot}/Inbox/b.md`});
  });

  it('creates a missing relative target under a General directory source', async () => {
    const generalDir = `${vaultRoot}/General`;
    const {fs, writes} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [generalDir, 'dir'],
      [`${vaultRoot}/Daily`, 'dir'],
      [`${vaultRoot}/Daily/Today.md`, '# Hub\n'],
    ]);
    const notes = [{name: 'Today.md', uri: `${vaultRoot}/Daily/Today.md`}];
    const result = await openOrCreateVaultRelativeMarkdownLink({
      href: './from hub context.md',
      notes,
      vaultRoot,
      fs,
      sourceMarkdownUriOrDir: generalDir,
    });
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') {
      return;
    }
    expect(result.uri).toBe(`${generalDir}/from hub context.md`);
    expect(writes.some(w => w.uri === result.uri)).toBe(true);
  });

  it('returns unsupported for https links', async () => {
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
    ]);
    const result = await openOrCreateVaultRelativeMarkdownLink({
      href: 'https://ex/x.md',
      notes: [],
      vaultRoot,
      fs,
      sourceMarkdownUriOrDir: `${vaultRoot}/Inbox`,
    });
    expect(result).toEqual({kind: 'unsupported'});
  });

  it('opens vault-root backup path when wiki path targets _autosync at vault root (not under General)', async () => {
    const backup = `${vaultRoot}/_autosync-backup-nuc/General/b.md`;
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
      [`${vaultRoot}/General/here.md`, '# H'],
      [`${vaultRoot}/_autosync-backup-nuc`, 'dir'],
      [`${vaultRoot}/_autosync-backup-nuc/General`, 'dir'],
      [backup, '# Backup'],
    ]);
    const notes = [{name: 'here.md', uri: `${vaultRoot}/General/here.md`}];
    const result = await openOrCreateVaultWikiPathMarkdownLink({
      inner: '_autosync-backup-nuc/General/b.md',
      notes,
      vaultRoot,
      fs,
      fallbackSourceMarkdownUriOrDir: `${vaultRoot}/General/here.md`,
    });
    expect(result).toEqual({kind: 'open', uri: backup});
  });

  it('opens vault-root wiki path without an explicit .md extension', async () => {
    const readme = `${vaultRoot}/folder/README.md`;
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
      [`${vaultRoot}/General/here.md`, '# H'],
      [`${vaultRoot}/folder`, 'dir'],
      [readme, '# Readme'],
    ]);
    const notes = [{name: 'here.md', uri: `${vaultRoot}/General/here.md`}];
    const result = await openOrCreateVaultWikiPathMarkdownLink({
      inner: 'folder/README',
      notes,
      vaultRoot,
      fs,
      fallbackSourceMarkdownUriOrDir: `${vaultRoot}/General/here.md`,
    });
    expect(result).toEqual({kind: 'open', uri: readme});
  });

  it('opens General-nested backup when the file exists only under General (fallback resolution)', async () => {
    const nested = `${vaultRoot}/General/_autosync-backup-nuc/General/b.md`;
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
      [`${vaultRoot}/General/here.md`, '# H'],
      [`${vaultRoot}/General/_autosync-backup-nuc`, 'dir'],
      [`${vaultRoot}/General/_autosync-backup-nuc/General`, 'dir'],
      [nested, '# Backup'],
    ]);
    const notes = [{name: 'here.md', uri: `${vaultRoot}/General/here.md`}];
    const result = await openOrCreateVaultWikiPathMarkdownLink({
      inner: '_autosync-backup-nuc/General/b.md',
      notes,
      vaultRoot,
      fs,
      fallbackSourceMarkdownUriOrDir: `${vaultRoot}/General/here.md`,
    });
    expect(result).toEqual({kind: 'open', uri: nested});
  });

  it('returns cannot_create_parent when the file is missing under a dot-prefixed folder', async () => {
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
      [`${vaultRoot}/General/here.md`, '# H'],
      [`${vaultRoot}/General/.backup`, 'dir'],
      [`${vaultRoot}/General/.backup/sub`, 'dir'],
    ]);
    const notes = [{name: 'here.md', uri: `${vaultRoot}/General/here.md`}];
    const result = await openOrCreateVaultRelativeMarkdownLink({
      href: '.backup/sub/missing.md',
      notes,
      vaultRoot,
      fs,
      sourceMarkdownUriOrDir: `${vaultRoot}/General/here.md`,
    });
    expect(result).toEqual({
      kind: 'cannot_create_parent',
      resolvedUri: `${vaultRoot}/General/.backup/sub/missing.md`,
    });
  });

  it('opens when only an NFD filename variant exists on disk', async () => {
    const nfdUri = `${vaultRoot}/Inbox/u\u0308.md`;
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/Inbox`, 'dir'],
      [`${vaultRoot}/Inbox/a.md`, '# A'],
      [nfdUri, '# NFD'],
    ]);
    const notes = [
      {name: 'a.md', uri: `${vaultRoot}/Inbox/a.md`},
      {name: 'b.md', uri: `${vaultRoot}/Inbox/b.md`},
    ];
    const result = await openOrCreateVaultRelativeMarkdownLink({
      href: `./${'\u00fc'}.md`,
      notes,
      vaultRoot,
      fs,
      sourceMarkdownUriOrDir: `${vaultRoot}/Inbox/a.md`,
    });
    expect(result).toEqual({kind: 'open', uri: nfdUri});
  });

  it('opens backup-style file when list-dir matches unique suffix --YYYYMMDD-HHMMSS.md', async () => {
    const parent = `${vaultRoot}/General/_backup/General`;
    const onDisk = `${parent}/Real Name--20260422-174503.md`;
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
      [`${vaultRoot}/General/here.md`, '#'],
      [`${vaultRoot}/General/_backup`, 'dir'],
      [parent, 'dir'],
      [onDisk, '#'],
    ]);
    const notes = [{name: 'here.md', uri: `${vaultRoot}/General/here.md`}];
    const result = await openOrCreateVaultWikiPathMarkdownLink({
      inner: '_backup/General/Wrong Name--20260422-174503.md',
      notes,
      vaultRoot,
      fs,
      fallbackSourceMarkdownUriOrDir: `${vaultRoot}/General/here.md`,
    });
    expect(result).toEqual({kind: 'open', uri: onDisk});
  });

  it('opens when rough basename matches one file (emoji glyph differs)', async () => {
    const parent = `${vaultRoot}/General/_backup/General`;
    const onDisk = `${parent}/\uD83D\uDC4DOnly--20260422-174503.md`;
    const {fs} = createMemoryVaultFs([
      [vaultRoot, 'dir'],
      [`${vaultRoot}/General`, 'dir'],
      [`${vaultRoot}/General/here.md`, '#'],
      [`${vaultRoot}/General/_backup`, 'dir'],
      [parent, 'dir'],
      [onDisk, '#'],
    ]);
    const notes = [{name: 'here.md', uri: `${vaultRoot}/General/here.md`}];
    const result = await openOrCreateVaultWikiPathMarkdownLink({
      inner: '_backup/General/\uD83D\uDC49\uFE0FOnly--20260422-174503.md',
      notes,
      vaultRoot,
      fs,
      fallbackSourceMarkdownUriOrDir: `${vaultRoot}/General/here.md`,
    });
    expect(result).toEqual({kind: 'open', uri: onDisk});
  });
});

describe('inboxRelativeMarkdownLinkHrefIsResolved', () => {
  const vaultRoot = '/vault';
  const notes = [
    {name: 'a.md', uri: `${vaultRoot}/Inbox/a.md`},
    {name: 'b.md', uri: `${vaultRoot}/Inbox/b.md`},
  ];

  it('is true when href resolves to an indexed note', () => {
    expect(
      inboxRelativeMarkdownLinkHrefIsResolved(
        notes,
        `${vaultRoot}/Inbox/a.md`,
        vaultRoot,
        './b.md',
      ),
    ).toBe(true);
  });

  it('is false for missing targets', () => {
    expect(
      inboxRelativeMarkdownLinkHrefIsResolved(
        notes,
        `${vaultRoot}/Inbox/a.md`,
        vaultRoot,
        './nope.md',
      ),
    ).toBe(false);
  });
});
