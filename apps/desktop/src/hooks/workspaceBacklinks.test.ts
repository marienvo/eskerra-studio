import {describe, expect, it} from 'vitest';

import type {VaultFilesystem} from '@eskerra/core';

import {computeSelectedNoteBacklinkUris} from './workspaceBacklinks';

function memoryFs(files: Record<string, string>): VaultFilesystem {
  return {
    async exists(uri) {
      return Object.prototype.hasOwnProperty.call(files, uri);
    },
    async mkdir() {
      return undefined;
    },
    async readFile(uri) {
      const value = files[uri];
      if (value == null) {
        throw new Error(`missing ${uri}`);
      }
      return value;
    },
    async writeFile(uri, content) {
      files[uri] = content;
    },
    async unlink(uri) {
      delete files[uri];
    },
    async removeTree() {
      return undefined;
    },
    async renameFile(fromUri, toUri) {
      files[toUri] = files[fromUri] ?? '';
      delete files[fromUri];
    },
    async listFiles() {
      return [];
    },
  };
}

const refs = [
  {name: 'A.md', uri: '/vault/Inbox/A.md', lastModified: null},
  {name: 'B.md', uri: '/vault/Inbox/B.md', lastModified: null},
  {name: 'C.md', uri: '/vault/Inbox/C.md', lastModified: null},
];

describe('workspaceBacklinks', () => {
  it('computes wiki and relative markdown referrers from disk bodies', async () => {
    const result = await computeSelectedNoteBacklinkUris({
      fs: memoryFs({
        '/vault/Inbox/A.md': 'wiki [[B]]',
        '/vault/Inbox/B.md': '',
        '/vault/Inbox/C.md': 'relative [b](B.md)',
      }),
      vaultRoot: '/vault',
      targetUri: '/vault/Inbox/B.md',
      refs,
      diskBodyCache: {},
      inboxContentByUri: {},
      activeUri: null,
      activeBody: '',
    });
    expect(result.uris).toEqual(['/vault/Inbox/A.md', '/vault/Inbox/C.md']);
    expect(result.pruned).toEqual({
      '/vault/Inbox/A.md': 'wiki [[B]]',
      '/vault/Inbox/B.md': '',
      '/vault/Inbox/C.md': 'relative [b](B.md)',
    });
  });

  it('lets active body and inbox cache override disk bodies', async () => {
    const result = await computeSelectedNoteBacklinkUris({
      fs: memoryFs({
        '/vault/Inbox/A.md': 'stale',
        '/vault/Inbox/B.md': '',
        '/vault/Inbox/C.md': 'stale',
      }),
      vaultRoot: '/vault',
      targetUri: '/vault/Inbox/B.md',
      refs,
      diskBodyCache: {'/vault/Inbox/A.md': 'cached [[B]]'},
      inboxContentByUri: {'/vault/Inbox/A.md': 'inbox [[B]]'},
      activeUri: '/vault/Inbox/C.md',
      activeBody: 'live [[B]]',
    });
    expect(result.uris).toEqual(['/vault/Inbox/A.md', '/vault/Inbox/C.md']);
    expect(result.pruned['/vault/Inbox/A.md']).toBe('inbox [[B]]');
    expect(result.pruned['/vault/Inbox/C.md']).toBe('live [[B]]');
  });

  it('prunes bodies to current refs and treats unreadable refs as empty', async () => {
    const result = await computeSelectedNoteBacklinkUris({
      fs: memoryFs({
        '/vault/Inbox/A.md': '[[B]]',
        '/vault/Inbox/B.md': '',
      }),
      vaultRoot: '/vault',
      targetUri: '/vault/Inbox/B.md',
      refs,
      diskBodyCache: {
        '/vault/Inbox/Removed.md': '[[B]]',
      },
      inboxContentByUri: {},
      activeUri: null,
      activeBody: '',
    });
    expect(result.uris).toEqual(['/vault/Inbox/A.md']);
    expect(Object.keys(result.pruned).sort()).toEqual(refs.map(r => r.uri).sort());
    expect(result.pruned['/vault/Inbox/C.md']).toBe('');
  });
});
