import type {VaultMarkdownRef} from '@eskerra/core';

import {buildVaultTabLinkDerivedData} from './vaultTabLinkDerived';

export function buildVaultTabEditorAndComposeLinkDerivedData(args: {
  vaultRoot: string;
  vaultMarkdownRefs: readonly VaultMarkdownRef[];
  selectedUri: string | null;
  showTodayHubCanvas: boolean;
}) {
  const {
    vaultRoot,
    vaultMarkdownRefs,
    selectedUri,
    showTodayHubCanvas,
  } = args;
  return {
    mainEditor: buildVaultTabLinkDerivedData({
      vaultRoot,
      vaultMarkdownRefs,
      composingNewEntry: false,
      selectedUri,
      showTodayHubCanvas,
    }),
    composeDialog: buildVaultTabLinkDerivedData({
      vaultRoot,
      vaultMarkdownRefs,
      composingNewEntry: true,
      selectedUri,
      showTodayHubCanvas,
    }),
  };
}
