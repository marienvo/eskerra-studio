/**
 * Shell-owned adapter: **inbox attachment import only** (clipboard, drag/drop, vault bytes).
 * Do not add unrelated concerns here—keep ownership narrow so this file does not become a
 * general desktop integration dumping ground.
 */

import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {readImage, readText} from '@tauri-apps/plugin-clipboard-manager';

import {
  absoluteImagePathsFromClipboardUriList,
  filterClipboardImageCandidateFiles,
  snapshotClipboardImagePayload,
  extractClipboardImageUrlsFromHtml,
  dotExtensionForClipboardBytes,
  collectClipboardImageFilesFromFileList,
} from './clipboard/clipboardImageFiles';
import {rgbaImageToPngBytes} from './clipboard/clipboardImagePng';
import {
  extensionFromFileNameOrMime,
  saveVaultImageBytes,
  vaultImportFilesIntoAttachments,
} from './desktopVaultAttachments';

export function isNoteAttachmentImageFilePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.svg')
  );
}

export type NativeClipboardPasteResult =
  | {kind: 'images'; paths: string[]}
  | {kind: 'text'; text: string}
  | {kind: 'fail'; message: string};

export type NoteInboxAttachmentHost = {
  readonly isVaultImageImportAvailable: boolean;

  importPastedImages(dataTransfer: DataTransfer, vaultRoot: string): Promise<string[]>;

  readNativeClipboardPaste(vaultRoot: string): Promise<NativeClipboardPasteResult>;

  importDroppedFiles(files: FileList, vaultRoot: string): Promise<string[]>;

  /** OS absolute paths; Rust import command maps into the current vault. */
  importDroppedAbsolutePaths(paths: string[]): Promise<string[]>;

  /**
   * Tauri window file-drop events (paths from the OS). No-op unsubscribe when not in Tauri.
   */
  subscribeWindowFileDragDrop(handlers: {
    onDragHover: () => void;
    onDragLeave: () => void;
    onDropPaths: (paths: string[]) => void;
  }): Promise<() => void>;
};

async function saveFetchedImageUrlToVault(
  vaultRoot: string,
  url: string,
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not read pasted image (${res.status})`);
  }
  const blob = await res.blob();
  const buf = new Uint8Array(await blob.arrayBuffer());
  const ext = dotExtensionForClipboardBytes(buf, blob.type, 'paste');
  return saveVaultImageBytes({
    vaultRoot,
    bytes: buf,
    suggestedBaseName: 'paste',
    extensionWithDot: ext,
  });
}

async function importPastedImagesTauri(
  dataTransfer: DataTransfer,
  vaultRoot: string,
): Promise<string[]> {
  const relPaths: string[] = [];

  const snapshot = snapshotClipboardImagePayload(dataTransfer);
  const {html, candidateFiles} = snapshot;

  const files = await filterClipboardImageCandidateFiles(candidateFiles);
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer());
    const ext =
      extensionFromFileNameOrMime(f.name, f.type) ??
      dotExtensionForClipboardBytes(buf, f.type, f.name || 'paste');
    relPaths.push(
      await saveVaultImageBytes({
        vaultRoot,
        bytes: buf,
        suggestedBaseName: f.name || 'paste',
        extensionWithDot: ext,
      }),
    );
  }

  if (relPaths.length === 0) {
    const {blobUrls, dataImageUrls} = extractClipboardImageUrlsFromHtml(html);
    for (const url of blobUrls) {
      relPaths.push(await saveFetchedImageUrlToVault(vaultRoot, url));
    }
    for (const url of dataImageUrls) {
      relPaths.push(await saveFetchedImageUrlToVault(vaultRoot, url));
    }
  }

  if (relPaths.length === 0) {
    try {
      const image = await readImage();
      const png = await rgbaImageToPngBytes(image);
      relPaths.push(
        await saveVaultImageBytes({
          vaultRoot,
          bytes: png,
          suggestedBaseName: 'paste',
          extensionWithDot: '.png',
        }),
      );
    } catch {
      /* no raster image on native clipboard */
    }
  }

  if (relPaths.length === 0) {
    const fromUris = absoluteImagePathsFromClipboardUriList(dataTransfer);
    if (fromUris.length > 0) {
      relPaths.push(...(await vaultImportFilesIntoAttachments(fromUris)));
    }
  }

  return relPaths;
}

async function readNativeClipboardPasteTauri(
  vaultRoot: string,
): Promise<NativeClipboardPasteResult> {
  try {
    const nativeImage = await readImage();
    try {
      const png = await rgbaImageToPngBytes(nativeImage);
      const relPath = await saveVaultImageBytes({
        vaultRoot,
        bytes: png,
        suggestedBaseName: 'paste',
        extensionWithDot: '.png',
      });
      return {kind: 'images', paths: [relPath]};
    } catch (pipeErr) {
      return {
        kind: 'fail',
        message:
          pipeErr instanceof Error ? pipeErr.message : String(pipeErr),
      };
    }
  } catch (readImgErr) {
    try {
      const text = await readText();
      if (text.length > 0) {
        return {kind: 'text', text};
      }
      return {
        kind: 'fail',
        message:
          readImgErr instanceof Error ? readImgErr.message : String(readImgErr),
      };
    } catch {
      return {kind: 'fail', message: 'Could not read clipboard content.'};
    }
  }
}

function createStubHost(): NoteInboxAttachmentHost {
  const none = async () => [];
  return {
    isVaultImageImportAvailable: false,
    importPastedImages: none,
    readNativeClipboardPaste: async () => ({
      kind: 'fail',
      message:
        'Vault image clipboard is unavailable outside the Eskerra desktop app.',
    }),
    importDroppedFiles: none,
    importDroppedAbsolutePaths: none,
    subscribeWindowFileDragDrop: async () => () => {},
  };
}

function createTauriHost(): NoteInboxAttachmentHost {
  return {
    isVaultImageImportAvailable: true,

    importPastedImages: (dt, vaultRoot) => importPastedImagesTauri(dt, vaultRoot),

    readNativeClipboardPaste: vaultRoot => readNativeClipboardPasteTauri(vaultRoot),

    importDroppedFiles: async (files, vaultRoot) => {
      const collected = await collectClipboardImageFilesFromFileList(files);
      if (collected.length === 0) {
        return [];
      }
      const markdownPaths: string[] = [];
      for (const f of collected) {
        const buf = new Uint8Array(await f.arrayBuffer());
        const ext =
          extensionFromFileNameOrMime(f.name, f.type) ??
          dotExtensionForClipboardBytes(buf, f.type, f.name || 'drop');
        markdownPaths.push(
          await saveVaultImageBytes({
            vaultRoot,
            bytes: buf,
            suggestedBaseName: f.name || 'drop',
            extensionWithDot: ext,
          }),
        );
      }
      return markdownPaths;
    },

    importDroppedAbsolutePaths: paths => {
      if (paths.length === 0) {
        return Promise.resolve([]);
      }
      return vaultImportFilesIntoAttachments(paths);
    },

    subscribeWindowFileDragDrop: async handlers => {
      return getCurrentWindow().onDragDropEvent(event => {
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          handlers.onDragHover();
        } else if (payload.type === 'leave') {
          handlers.onDragLeave();
        } else if (payload.type === 'drop') {
          handlers.onDragLeave();
          const paths = payload.paths.filter(isNoteAttachmentImageFilePath);
          if (paths.length > 0) {
            handlers.onDropPaths(paths);
          }
        }
      });
    },
  };
}

/**
 * Factory for the inbox editor. Outside Tauri, returns a stub (no vault image import).
 */
export function createNoteInboxAttachmentHost(): NoteInboxAttachmentHost {
  return isTauri() ? createTauriHost() : createStubHost();
}
