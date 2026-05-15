import {load} from '@tauri-apps/plugin-store';
import {useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction} from 'react';

import {ensureDeviceInstanceId, SubtreeMarkdownPresenceCache, type EskerraSettings, type VaultFilesystem} from '@eskerra/core';

import {
  bootstrapVaultLayout,
  readVaultLocalSettings,
  readVaultSettings,
  writeVaultLocalSettings,
} from '../lib/vaultBootstrap';
import {getVaultSession, setVaultSession, startVaultWatch} from '../lib/tauriVault';
import {vaultFrontmatterIndexSchedule} from '../lib/tauriVaultFrontmatter';
import {vaultSearchIndexSchedule} from '../lib/tauriVaultSearch';
import {captureObservabilityMessage} from '../observability/captureObservabilityMessage';
import {fingerprintUtf16ForDebug} from './workspaceFsWatchReconcile';
import {normalizeVaultWatchErrorReason} from './workspaceVaultWatchEffects';

const STORE_PATH = 'eskerra-desktop.json';
const STORE_KEY_VAULT = 'vaultRoot';

type UseVaultBootstrapOptions = {
  fs: VaultFilesystem;
  inboxRestoreEnabled: boolean;
  flushInboxSaveRef: RefObject<() => Promise<void>>;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  resetRenameMaintenanceStateRef: RefObject<() => void>;
  clearBacklinkDiskBodyCacheRef: RefObject<() => void>;
  refreshNotes: (root: string) => Promise<void>;
  resetWorkspaceStateRef: RefObject<() => void>;
  setInboxShellRestored: Dispatch<SetStateAction<boolean>>;
};

export type UseVaultBootstrapResult = {
  vaultRoot: string | null;
  vaultSettings: EskerraSettings | null;
  setVaultSettings: Dispatch<SetStateAction<EskerraSettings | null>>;
  settingsName: string;
  deviceInstanceId: string;
  initialVaultHydrateAttemptDone: boolean;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  err: string | null;
  setErr: Dispatch<SetStateAction<string | null>>;
  hydrateVault: (root: string) => Promise<void>;
};

export function useVaultBootstrap(options: UseVaultBootstrapOptions): UseVaultBootstrapResult {
  const {
    fs,
    inboxRestoreEnabled,
    flushInboxSaveRef,
    subtreeMarkdownCache,
    resetRenameMaintenanceStateRef,
    clearBacklinkDiskBodyCacheRef,
    refreshNotes,
    resetWorkspaceStateRef,
    setInboxShellRestored,
  } = options;

  const [vaultRoot, setVaultRoot] = useState<string | null>(null);
  const [vaultSettings, setVaultSettings] = useState<EskerraSettings | null>(null);
  const [settingsName, setSettingsName] = useState('Eskerra');
  const [deviceInstanceId, setDeviceInstanceId] = useState('');
  const [initialVaultHydrateAttemptDone, setInitialVaultHydrateAttemptDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hydrateVault = useCallback(
    async (root: string) => {
      await flushInboxSaveRef.current?.();
      setBusy(true);
      setErr(null);
      resetRenameMaintenanceStateRef.current?.();
      subtreeMarkdownCache.invalidateAll();
      clearBacklinkDiskBodyCacheRef.current?.();
      setVaultSettings(null);
      setInboxShellRestored(!inboxRestoreEnabled);
      try {
        await setVaultSession(root);
        await bootstrapVaultLayout(root, fs);
        const shared = await readVaultSettings(root, fs);
        setVaultSettings(shared);
        let local = await readVaultLocalSettings(root, fs);
        const ensuredLocal = ensureDeviceInstanceId(local);
        if (ensuredLocal.changed) {
          local = ensuredLocal.settings;
          await writeVaultLocalSettings(root, fs, local);
        }
        setDeviceInstanceId(local.deviceInstanceId);
        const label = local.displayName.trim();
        setSettingsName(label !== '' ? label : 'Eskerra');
        await refreshNotes(root);
        resetWorkspaceStateRef.current?.();
        setVaultRoot(root);
        const store = await load(STORE_PATH);
        await store.set(STORE_KEY_VAULT, root);
        await store.save();
        try {
          await startVaultWatch();
        } catch (watchError) {
          const reason =
            watchError instanceof Error ? watchError.message : String(watchError);
          const normalizedReason = normalizeVaultWatchErrorReason(reason);
          captureObservabilityMessage({
            message: 'eskerra.desktop.vault_watch_start_failed',
            level: 'warning',
            extra: {
              reason,
              normalizedReason,
              vaultRootHash: fingerprintUtf16ForDebug(root),
            },
            tags: {
              obs_surface: 'vault_watch',
              watch_session_id: 'start',
              vault_root_hash: fingerprintUtf16ForDebug(root),
              backend: 'startup',
              reason: normalizedReason,
            },
            fingerprint: [
              'eskerra.desktop',
              'vault_watch_start_failed',
              normalizedReason,
            ],
          });
          throw watchError;
        }
        queueMicrotask(() => {
          vaultSearchIndexSchedule().catch(() => undefined);
          vaultFrontmatterIndexSchedule().catch(() => undefined);
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      clearBacklinkDiskBodyCacheRef,
      fs,
      flushInboxSaveRef,
      inboxRestoreEnabled,
      refreshNotes,
      resetRenameMaintenanceStateRef,
      resetWorkspaceStateRef,
      setInboxShellRestored,
      subtreeMarkdownCache,
    ],
  );

  const hydrateVaultRef = useRef(hydrateVault);
  useLayoutEffect(() => {
    hydrateVaultRef.current = hydrateVault;
  }, [hydrateVault]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await load(STORE_PATH);
        const saved = await store.get<string>(STORE_KEY_VAULT);
        const fromStore = typeof saved === 'string' ? saved.trim() : '';
        const session = (await getVaultSession())?.trim() ?? '';
        const root = fromStore || session;
        if (root && !cancelled) {
          await hydrateVaultRef.current(root);
        }
      } catch {
        // first launch
      } finally {
        if (!cancelled) {
          setInitialVaultHydrateAttemptDone(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    vaultRoot,
    vaultSettings,
    setVaultSettings,
    settingsName,
    deviceInstanceId,
    initialVaultHydrateAttemptDone,
    busy,
    setBusy,
    err,
    setErr,
    hydrateVault,
  };
}
