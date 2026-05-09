import {describe, expect, it} from 'vitest';

import {collectVaultMarkdownRefs, type VaultReadOptions, type VaultWriteOptions} from '@eskerra/core';

import {createDesktopTestVaultFilesystem} from './desktopVaultFilesystem';

describe('createDesktopTestVaultFilesystem', () => {
  it('listFiles returns immediate children only (files and directories)', async () => {
    const {fs} = createDesktopTestVaultFilesystem({
      dirs: ['/vault', '/vault/Inbox', '/vault/Inbox/Nested'],
      files: {
        '/vault/root.md': 'r',
        '/vault/Inbox/a.md': 'a',
        '/vault/Inbox/Nested/deep.md': 'd',
      },
    });

    const root = await fs.listFiles('/vault');
    const names = root.map(e => e.name).sort();
    expect(names).toEqual(['Inbox', 'root.md']);

    const inbox = await fs.listFiles('/vault/Inbox');
    const inboxNames = inbox.map(e => e.name).sort();
    expect(inboxNames).toEqual(['Nested', 'a.md']);
  });

  it('listFiles handles the root directory', async () => {
    const {fs} = createDesktopTestVaultFilesystem({
      dirs: ['/Inbox', '/Inbox/Nested', '/Projects'],
      files: {
        '/root.md': 'root',
        '/Inbox/a.md': 'a',
        '/Inbox/Nested/deep.md': 'd',
      },
    });

    const root = await fs.listFiles('/');
    const names = root.map(e => e.name).sort();
    expect(names).toEqual(['Inbox', 'Projects', 'root.md']);
  });

  it('read/write roundtrip for utf8', async () => {
    const {fs} = createDesktopTestVaultFilesystem({dirs: ['/vault', '/vault/Inbox']});
    await fs.writeFile('/vault/Inbox/hello.md', 'hello body', {encoding: 'utf8'});
    const body = await fs.readFile('/vault/Inbox/hello.md', {encoding: 'utf8'});
    expect(body).toBe('hello body');
  });

  it('rejects readFile and writeFile when encoding is not utf8', async () => {
    const {fs} = createDesktopTestVaultFilesystem({
      files: {'/vault/x.md': 'x'},
    });
    await expect(
      fs.readFile('/vault/x.md', {encoding: 'utf16le' as unknown as VaultReadOptions['encoding']}),
    ).rejects.toThrow('Only utf8 is supported');
    await expect(
      fs.writeFile('/vault/y.md', 'y', {
        encoding: 'utf16le' as unknown as VaultWriteOptions['encoding'],
      }),
    ).rejects.toThrow('Only utf8 is supported');
  });

  it('mkdir creates directories and exists reports them', async () => {
    const {fs, writeLog} = createDesktopTestVaultFilesystem({dirs: ['/vault']});
    await fs.mkdir('/vault/NewDir');
    expect(await fs.exists('/vault/NewDir')).toBe(true);
    expect(writeLog.some(e => e.op === 'mkdir' && e.uri === '/vault/NewDir')).toBe(true);
  });

  it('renameFile moves a single file path', async () => {
    const {fs} = createDesktopTestVaultFilesystem({
      dirs: ['/vault/Inbox'],
      files: {'/vault/Inbox/old.md': 'content'},
    });
    await fs.renameFile('/vault/Inbox/old.md', '/vault/Inbox/new.md');
    expect(await fs.exists('/vault/Inbox/old.md')).toBe(false);
    expect(await fs.readFile('/vault/Inbox/new.md', {encoding: 'utf8'})).toBe('content');
  });

  it('renameFile moves a directory tree (dirs + nested files)', async () => {
    const {fs} = createDesktopTestVaultFilesystem({
      dirs: ['/vault', '/vault/tree', '/vault/tree/sub'],
      files: {
        '/vault/tree/a.md': 'a',
        '/vault/tree/sub/b.md': 'b',
      },
    });
    await fs.renameFile('/vault/tree', '/vault/treeRenamed');
    expect(await fs.exists('/vault/tree')).toBe(false);
    expect(await fs.readFile('/vault/treeRenamed/a.md', {encoding: 'utf8'})).toBe('a');
    expect(await fs.readFile('/vault/treeRenamed/sub/b.md', {encoding: 'utf8'})).toBe('b');
  });

  it('removeTree removes nested files and directories', async () => {
    const {fs} = createDesktopTestVaultFilesystem({
      dirs: ['/vault', '/vault/tree', '/vault/tree/sub'],
      files: {
        '/vault/tree/a.md': 'a',
        '/vault/tree/sub/b.md': 'b',
      },
    });
    await fs.removeTree('/vault/tree');
    expect(await fs.exists('/vault/tree')).toBe(false);
    expect(await fs.exists('/vault/tree/sub')).toBe(false);
    expect(await fs.exists('/vault/tree/a.md')).toBe(false);
    expect(await fs.exists('/vault/tree/sub/b.md')).toBe(false);
    expect(await fs.exists('/vault')).toBe(true);
  });

  it('collectVaultMarkdownRefs works against a seeded fake layout', async () => {
    const {fs} = createDesktopTestVaultFilesystem({
      dirs: ['/vault', '/vault/Inbox', '/vault/Proj'],
      files: {
        '/vault/root.md': 'root',
        '/vault/Inbox/a.md': 'a',
        '/vault/Proj/p.md': 'p',
      },
    });

    const refs = await collectVaultMarkdownRefs('/vault', fs);
    const uris = refs.map(r => r.uri).sort();
    expect(uris).toEqual(['/vault/Inbox/a.md', '/vault/Proj/p.md', '/vault/root.md']);
    expect(refs.find(r => r.uri === '/vault/Inbox/a.md')?.name).toBe('a');
  });

  it('collectVaultMarkdownRefs works from root', async () => {
    const {fs} = createDesktopTestVaultFilesystem({
      dirs: ['/Inbox', '/Inbox/Nested', '/Proj'],
      files: {
        '/root.md': 'root',
        '/Inbox/a.md': 'a',
        '/Inbox/Nested/deep.md': 'd',
        '/Proj/p.md': 'p',
      },
    });

    const refs = await collectVaultMarkdownRefs('/', fs);
    const uris = refs.map(r => r.uri).sort();
    expect(uris).toEqual(['/Inbox/Nested/deep.md', '/Inbox/a.md', '/Proj/p.md', '/root.md']);
  });

  it('writeLog records mutating operations but not reads', async () => {
    const {fs, writeLog} = createDesktopTestVaultFilesystem({dirs: ['/vault']});
    await fs.writeFile('/vault/x.md', '1', {encoding: 'utf8'});
    await fs.readFile('/vault/x.md', {encoding: 'utf8'});
    await fs.unlink('/vault/x.md');
    expect(writeLog.map(e => e.op)).toEqual(['writeFile', 'unlink']);
  });
});
