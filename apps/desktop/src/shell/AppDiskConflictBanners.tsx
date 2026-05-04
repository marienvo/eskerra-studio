import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';

export type AppDiskConflictBannersProps = {
  err: string | null;
  diskConflict: unknown;
  diskConflictSoft: {uri: string} | null;
  selectedUri: string | null;
  enterDiskConflictMergeView: () => void;
  resolveDiskConflictReloadFromDisk: () => void;
  resolveDiskConflictKeepLocal: () => void;
  elevateDiskConflictSoftToBlocking: () => void;
  dismissDiskConflictSoft: () => void;
};

export function AppDiskConflictBanners({
  err,
  diskConflict,
  diskConflictSoft,
  selectedUri,
  enterDiskConflictMergeView,
  resolveDiskConflictReloadFromDisk,
  resolveDiskConflictKeepLocal,
  elevateDiskConflictSoftToBlocking,
  dismissDiskConflictSoft,
}: AppDiskConflictBannersProps) {
  return (
    <>
      {!err && diskConflict ? (
        <div className="conflict-banner" role="alert">
          <span>
            This note was changed on disk while you have unsaved edits. Saving is paused until you
            choose.
          </span>
          <span className="conflict-banner__actions">
            <button
              type="button"
              onClick={() => enterDiskConflictMergeView()}
            >
              Compare / merge…
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => resolveDiskConflictReloadFromDisk()}
            >
              Reload from disk
            </button>
            <button type="button" onClick={() => resolveDiskConflictKeepLocal()}>
              Keep my edits
            </button>
          </span>
        </div>
      ) : null}
      {!err &&
      !diskConflict &&
      diskConflictSoft &&
      selectedUri != null &&
      normalizeEditorDocUri(diskConflictSoft.uri) === normalizeEditorDocUri(selectedUri) ? (
        <div className="info-banner info-banner--inline-actions" aria-live="polite">
          <span>
            A version on disk differs from your unsaved draft. Your edits stay primary until you
            save. Open full resolve only if you need to reconcile with disk.
          </span>
          <span className="conflict-banner__actions">
            <button
              type="button"
              onClick={() => enterDiskConflictMergeView()}
            >
              Compare / merge…
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => elevateDiskConflictSoftToBlocking()}
            >
              Resolve with disk…
            </button>
            <button type="button" onClick={() => dismissDiskConflictSoft()}>
              Dismiss
            </button>
          </span>
        </div>
      ) : null}
    </>
  );
}
