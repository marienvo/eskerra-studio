import type {VaultFilesystem, VaultDirEntry} from '@eskerra/core';
import {
  getAutosyncBackupRootUri,
  splitYamlFrontmatter,
  trimTrailingSlashes,
} from '@eskerra/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import {normalizeVaultMarkdownDiskRead} from '../hooks/inboxNoteBodyCache';
import {
  applyHunkToText,
  buildDiffSegments,
  computeOtherHunkRange,
  removeConflictBackupWarningLine,
  type DiffSegment,
} from '../lib/buildMarkdownLineDiff';
import {splitLines} from '../lib/lineLcs';

export type MergePanelSource =
  | {kind: 'backup'; backupUri: string}
  | {kind: 'disk'; diskMarkdown: string};

type BackupMergePanelProps = {
  vaultRoot: string;
  fs: VaultFilesystem;
  source: MergePanelSource;
  currentBody: string;
  onClose: () => void;
  onApplyOther: () => void | Promise<void>;
  onApplyMergedBody: (body: string) => void | Promise<void>;
  onKeepLocal?: () => void;
  busy: boolean;
};

async function hasAnyFiles(fs: VaultFilesystem, dirUri: string): Promise<boolean> {
  let entries: VaultDirEntry[];
  try {
    entries = await fs.listFiles(dirUri);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.type === 'directory') {
      if (await hasAnyFiles(fs, entry.uri)) return true;
    } else {
      return true;
    }
  }
  return false;
}

function pathRelativeToVault(vaultRoot: string, fileUri: string): string {
  const r = trimTrailingSlashes(vaultRoot.replace(/\\/g, '/'));
  const f = fileUri.replace(/\\/g, '/');
  if (f.startsWith(`${r}/`)) {
    return f.slice(r.length + 1);
  }
  return f;
}

function hunkLabelForDiffSides(
  otherLines: readonly string[],
  currentLines: readonly string[],
): string {
  const isAddition = otherLines.length > 0 && currentLines.length === 0;
  const isDeletion = otherLines.length === 0 && currentLines.length > 0;
  if (isAddition) {
    return 'Addition';
  }
  if (isDeletion) {
    return 'Deletion';
  }
  return 'Change';
}

type BackupMergeDiffSegmentsProps = {
  segments: readonly DiffSegment[];
  leftText: string | null;
  loadErr: string | null;
  hunkCount: number;
  hunkEls: MutableRefObject<Record<number, HTMLDivElement | null>>;
  focusedHunkIdx: number;
  canAccept: boolean;
  handleAcceptLeft: (hunkIdx: number) => void;
  handleAcceptRight: (hunkIdx: number) => void;
};

function BackupMergeContextBlock({
  seg,
}: {
  seg: {kind: 'context'; lines: string[]};
}) {
  const isEllipsis = seg.lines.length === 1 && seg.lines[0]!.startsWith('…');
  if (isEllipsis) {
    return (
      <div className="backup-merge-panel__context-ellipsis">
        {seg.lines[0]}
      </div>
    );
  }
  return (
    <div className="backup-merge-panel__context">
      <pre className="backup-merge-panel__context-col">
        {seg.lines.map((line, j) => (
          <div key={j} className="backup-merge-panel__context-line">{line}</div>
        ))}
      </pre>
      <pre className="backup-merge-panel__context-col">
        {seg.lines.map((line, j) => (
          <div key={j} className="backup-merge-panel__context-line">{line}</div>
        ))}
      </pre>
    </div>
  );
}

function hunkLayoutIndexBySegmentIndex(segments: readonly DiffSegment[]): number[] {
  let next = 0;
  return segments.map(seg => (seg.kind === 'hunk' ? next++ : -1));
}

function BackupMergeDiffSegments({
  segments,
  leftText,
  loadErr,
  hunkCount,
  hunkEls,
  focusedHunkIdx,
  canAccept,
  handleAcceptLeft,
  handleAcceptRight,
}: BackupMergeDiffSegmentsProps) {
  const hunkIndexAtSegI = useMemo(
    () => hunkLayoutIndexBySegmentIndex(segments),
    [segments],
  );
  return (
    <>
      {leftText == null && loadErr == null ? (
        <p className="muted backup-merge-panel__loading">Loading…</p>
      ) : null}
      {segments.map((seg, i) => {
        if (seg.kind === 'context') {
          return <BackupMergeContextBlock key={i} seg={seg} />;
        }
        const hunkLayoutIdx = hunkIndexAtSegI[i]!;
        const otherLines = seg.rightLines;
        const currentLines = seg.leftLines;
        const hunkLabel = hunkLabelForDiffSides(otherLines, currentLines);
        const isFocused = hunkLayoutIdx === focusedHunkIdx;
        return (
          <div
            key={i}
            ref={el => {
              if (el) {
                hunkEls.current[hunkLayoutIdx] = el;
              } else {
                delete hunkEls.current[hunkLayoutIdx];
              }
            }}
            className={
              isFocused
                ? 'backup-merge-panel__hunk backup-merge-panel__hunk--focused'
                : 'backup-merge-panel__hunk'
            }
          >
            <div className="backup-merge-panel__hunk-header">
              <span className="backup-merge-panel__hunk-label muted">{hunkLabel}</span>
              <button
                type="button"
                className="backup-merge-panel__hunk-accept"
                disabled={!canAccept}
                onClick={() => handleAcceptLeft(seg.index)}
                title="Accept left — use this version from backup/disk"
              >
                ← Accept left
              </button>
              <button
                type="button"
                className="backup-merge-panel__hunk-accept"
                disabled={!canAccept}
                onClick={() => handleAcceptRight(seg.index)}
                title="Accept right — keep your current version"
              >
                Accept right →
              </button>
            </div>
            <div className="backup-merge-panel__hunk-cols">
              <pre className="backup-merge-panel__hunk-pre backup-merge-panel__hunk-pre--left">
                {otherLines.length === 0 ? (
                  <div className="backup-merge-panel__hunk-empty">(empty)</div>
                ) : (
                  otherLines.map((line, j) => (
                    <div key={j} className="backup-merge-panel__line backup-merge-panel__line--ins">
                      {line}
                    </div>
                  ))
                )}
              </pre>
              <pre className="backup-merge-panel__hunk-pre backup-merge-panel__hunk-pre--right">
                {currentLines.length === 0 ? (
                  <div className="backup-merge-panel__hunk-empty">(empty)</div>
                ) : (
                  currentLines.map((line, j) => (
                    <div key={j} className="backup-merge-panel__line backup-merge-panel__line--del">
                      {line}
                    </div>
                  ))
                )}
              </pre>
            </div>
          </div>
        );
      })}
      {leftText != null && hunkCount === 0 ? (
        <p className="muted backup-merge-panel__no-diff">
          No differences — both sides are identical.
        </p>
      ) : null}
    </>
  );
}

function useBackupMergePanelModel({
  vaultRoot,
  fs,
  source,
  currentBody,
  onClose,
  onApplyMergedBody,
  busy,
}: BackupMergePanelProps) {
  const [loadedText, setLoadedText] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // rightText = working copy of the current note (target being built)
  // leftText  = working copy of the other side (backup or disk), can be modified by accept-right
  const [rightText, setRightText] = useState(currentBody);
  const [leftText, setLeftText] = useState<string | null>(null);

  const [focusedHunkIdx, setFocusedHunkIdx] = useState(0);
  const hunkEls = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      setRightText(currentBody);
      setFocusedHunkIdx(0);
    });
    return () => {
      cancelled = true;
    };
  }, [currentBody]);

  useEffect(() => {
    if (source.kind !== 'backup') {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await fs.readFile(source.backupUri, {encoding: 'utf8'});
        if (cancelled) return;
        const {body} = splitYamlFrontmatter(raw);
        setLoadedText(normalizeVaultMarkdownDiskRead(body));
        setLoadErr(null);
      } catch (e) {
        if (cancelled) return;
        setLoadErr(e instanceof Error ? e.message : String(e));
        setLoadedText(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fs, source]);

  const otherText = useMemo(() => {
    if (source.kind === 'disk') {
      const {body} = splitYamlFrontmatter(source.diskMarkdown);
      return normalizeVaultMarkdownDiskRead(body);
    }
    return loadedText;
  }, [source, loadedText]);

  // Sync leftText when otherText becomes available or changes (new backup loaded / source changed)
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      setLeftText(otherText);
      setFocusedHunkIdx(0);
    });
    return () => {
      cancelled = true;
    };
  }, [otherText]);

  const {segments, hunks} = useMemo(
    () =>
      leftText != null
        ? buildDiffSegments(rightText, leftText)
        : {segments: [], hunks: []},
    [rightText, leftText],
  );

  const hunkCount = hunks.length;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      setFocusedHunkIdx(prev => (hunkCount === 0 ? 0 : Math.min(prev, hunkCount - 1)));
    });
    return () => {
      cancelled = true;
    };
  }, [hunkCount]);

  const scrollToHunk = useCallback((idx: number) => {
    hunkEls.current[idx]?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }, []);

  const goPrev = useCallback(() => {
    setFocusedHunkIdx(prev => {
      const next = Math.max(0, prev - 1);
      scrollToHunk(next);
      return next;
    });
  }, [scrollToHunk]);

  const goNext = useCallback(() => {
    setFocusedHunkIdx(prev => {
      const next = Math.min(hunkCount - 1, prev + 1);
      scrollToHunk(next);
      return next;
    });
  }, [hunkCount, scrollToHunk]);

  const canApplyToEditor = leftText != null && !loadErr && !busy;
  const canAccept = !busy && leftText != null;

  const title = source.kind === 'disk' ? 'Compare with disk version' : 'Merge with backup';
  const applyAllLabel = source.kind === 'disk' ? 'Use disk version' : 'Use entire backup file';
  const otherColLabel = source.kind === 'disk' ? 'Disk version' : 'Backup';

  const subLabel = useMemo(() => {
    if (source.kind === 'backup') {
      const rel = pathRelativeToVault(vaultRoot, source.backupUri) || source.backupUri;
      return (
        <>
          Backup (left): <span className="backup-merge-panel__path">{rel}</span>
          {' — '}your note (right).
        </>
      );
    }
    return 'Disk version (left) vs. your note (right). Accept changes per block or use one side entirely.';
  }, [source, vaultRoot]);

  async function handleDeleteBackup() {
    if (source.kind !== 'backup') return;
    try {
      setDeleteErr(null);
      setDeleteBusy(true);
      await fs.unlink(source.backupUri);
      const root = getAutosyncBackupRootUri(source.backupUri);
      if (root) {
        const empty = !(await hasAnyFiles(fs, root));
        if (empty) {
          await fs.removeTree(root);
        }
      }
      const cleaned = removeConflictBackupWarningLine(rightText);
      if (cleaned !== rightText) {
        await onApplyMergedBody(cleaned);
      } else {
        onClose();
      }
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  function handleAcceptLeft(hunkIdx: number) {
    const hunk = hunks[hunkIdx];
    if (!hunk) return;
    // Take left side into right: apply hunk to rightText
    setRightText(prev => applyHunkToText(prev, hunk));
  }

  function handleAcceptRight(hunkIdx: number) {
    const hunk = hunks[hunkIdx];
    if (!hunk) return;
    // Take right side into left: apply inverse hunk to leftText
    const rightLines = splitLines(rightText).slice(hunk.start, hunk.end);
    const {start: oStart, end: oEnd} = computeOtherHunkRange(hunks, hunkIdx);
    setLeftText(prev => (prev != null ? applyHunkToText(prev, {start: oStart, end: oEnd, lines: rightLines}) : prev));
  }

  return {
    subLabel,
    title,
    hunkCount,
    focusedHunkIdx,
    goPrev,
    goNext,
    canApplyToEditor,
    canAccept,
    applyAllLabel,
    otherColLabel,
    hunkEls,
    segments,
    leftText,
    loadErr,
    handleDeleteBackup,
    handleAcceptLeft,
    handleAcceptRight,
    rightText,
    deleteErr,
    deleteBusy,
  };
}

export function BackupMergePanel(mergePanelProps: BackupMergePanelProps) {
  const {busy, onClose, onKeepLocal, onApplyMergedBody, onApplyOther, source} =
    mergePanelProps;
  const v = useBackupMergePanelModel(mergePanelProps);
  const {
    title,
    hunkCount,
    focusedHunkIdx,
    goPrev,
    goNext,
    subLabel,
    canApplyToEditor,
    applyAllLabel,
    otherColLabel,
    deleteErr,
    deleteBusy,
    handleDeleteBackup,
    segments,
    leftText,
    loadErr,
    hunkEls,
    canAccept,
    handleAcceptLeft,
    handleAcceptRight,
    rightText,
  } = v;

  return (
    <div
      className="backup-merge-panel"
      data-app-surface="capture"
      role="region"
      aria-label="Compare note versions"
      onKeyDown={e => {
        if (e.key === 'j' || (e.key === 'ArrowDown' && e.altKey)) {
          e.preventDefault();
          goNext();
        } else if (e.key === 'k' || (e.key === 'ArrowUp' && e.altKey)) {
          e.preventDefault();
          goPrev();
        }
      }}
    >
      <div className="backup-merge-panel__header">
        <div className="backup-merge-panel__header-top">
          <h2 className="backup-merge-panel__title">{title}</h2>
          {hunkCount > 0 ? (
            <div className="backup-merge-panel__hunk-nav">
              <span className="backup-merge-panel__hunk-count muted">
                {hunkCount} {hunkCount === 1 ? 'change' : 'changes'}
              </span>
              <button
                type="button"
                className="ghost backup-merge-panel__hunk-nav-btn"
                disabled={hunkCount === 0 || focusedHunkIdx === 0}
                onClick={goPrev}
                title="Previous change (k)"
                aria-label="Previous change"
              >
                ↑
              </button>
              <button
                type="button"
                className="ghost backup-merge-panel__hunk-nav-btn"
                disabled={hunkCount === 0 || focusedHunkIdx >= hunkCount - 1}
                onClick={goNext}
                title="Next change (j)"
                aria-label="Next change"
              >
                ↓
              </button>
            </div>
          ) : null}
        </div>
        <p className="backup-merge-panel__sub muted">{subLabel}</p>
        <div className="backup-merge-panel__header-actions">
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => {
              onClose();
            }}
          >
            Close
          </button>
          {onKeepLocal != null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onKeepLocal();
              }}
            >
              Keep my edits
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canApplyToEditor}
            onClick={() => {
              void onApplyMergedBody(rightText);
            }}
          >
            Apply to editor{hunkCount === 0 && leftText != null ? ' (identical)' : ''}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canApplyToEditor}
            onClick={() => {
              void onApplyOther();
            }}
          >
            {applyAllLabel}
          </button>
        </div>
      </div>
      {source.kind === 'backup' ? (
        <div className="backup-merge-panel__delete-row">
          <button
            type="button"
            className="ghost backup-merge-panel__delete-btn"
            disabled={busy || deleteBusy}
            onClick={() => { void handleDeleteBackup(); }}
          >
            {deleteBusy ? 'Deleting…' : 'Delete backup'}
          </button>
          {deleteErr != null ? (
            <span className="backup-merge-panel__err" role="alert">{deleteErr}</span>
          ) : null}
        </div>
      ) : null}
      {loadErr != null ? (
        <p className="backup-merge-panel__err" role="alert">
          {loadErr}
        </p>
      ) : null}
      <div className="backup-merge-panel__diff-view">
        <div className="backup-merge-panel__diff-col-labels">
          <span>{otherColLabel}</span>
          <span>Current</span>
        </div>
        <div className="backup-merge-panel__diff-body">
          <BackupMergeDiffSegments
            segments={segments}
            leftText={leftText}
            loadErr={loadErr}
            hunkCount={hunkCount}
            hunkEls={hunkEls}
            focusedHunkIdx={focusedHunkIdx}
            canAccept={canAccept}
            handleAcceptLeft={handleAcceptLeft}
            handleAcceptRight={handleAcceptRight}
          />
        </div>
      </div>
      {hunkCount > 0 ? (
        <div className="backup-merge-panel__footer-hint muted">
          j / Alt+↓ next change &nbsp;·&nbsp; k / Alt+↑ previous change
        </div>
      ) : null}
    </div>
  );
}
