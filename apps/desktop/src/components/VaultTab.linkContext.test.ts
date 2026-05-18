import {describe, expect, it} from 'vitest';

import {buildVaultTabEditorAndComposeLinkDerivedData} from './vaultTabLinkContexts';

const refs = [
  {name: 'Target.md', uri: '/vault/Inbox/Target.md'},
  {name: 'Daily.md', uri: '/vault/General/Daily.md'},
] as const;

describe('buildVaultTabEditorAndComposeLinkDerivedData', () => {
  it('keeps compose dialog link resolution anchored to Inbox', () => {
    const derived = buildVaultTabEditorAndComposeLinkDerivedData({
      vaultRoot: '/vault',
      vaultMarkdownRefs: refs,
      selectedUri: '/vault/General/Daily.md',
      showTodayHubCanvas: true,
    });

    expect(derived.mainEditor.relativeMarkdownSourceUriOrDir).toBe('/vault/General');
    expect(derived.composeDialog.relativeMarkdownSourceUriOrDir).toBe('/vault/Inbox');
    expect(derived.mainEditor.relativeMarkdownLinkHrefIsResolved('Target.md')).toBe(false);
    expect(derived.composeDialog.relativeMarkdownLinkHrefIsResolved('Target.md')).toBe(true);
  });
});
