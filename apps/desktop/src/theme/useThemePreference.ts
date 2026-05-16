import {
  DEFAULT_THEME_PREFERENCE,
  isVaultR2PlaylistConfigured,
  type EskerraSettings,
  type ThemePreference,
  getR2ThemePreferenceObject,
  putR2ThemePreferenceObject,
  type VaultFilesystem,
} from '@eskerra/core';
import type {Dispatch, SetStateAction} from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';

import {desktopR2SignedTransport} from '../lib/desktopR2Transport';
import {writeVaultSettings} from '../lib/vaultBootstrap';

const R2_HTTP = {transport: desktopR2SignedTransport} as const;

type UseThemePreferenceParams = {
  vaultRoot: string | null;
  vaultSettings: EskerraSettings | null;
  setVaultSettings: Dispatch<SetStateAction<EskerraSettings | null>>;
  fs: VaultFilesystem;
  initialPreference?: ThemePreference | null;
};

export function useThemePreference({
  vaultRoot,
  vaultSettings,
  setVaultSettings,
  fs,
  initialPreference = null,
}: UseThemePreferenceParams): {
  preference: ThemePreference;
  preferenceLoaded: boolean;
  setPreferenceLocal: (next: ThemePreference) => void;
  persistPreference: (next: ThemePreference) => Promise<void>;
} {
  const [noVaultPreference, setNoVaultPreference] = useState<ThemePreference>(
    initialPreference ?? DEFAULT_THEME_PREFERENCE,
  );
  const [r2Preference, setR2Preference] = useState<ThemePreference>(
    initialPreference ?? DEFAULT_THEME_PREFERENCE,
  );
  const [r2Loaded, setR2Loaded] = useState(false);
  const migratedSharedToR2Ref = useRef(false);

  const isR2 = Boolean(vaultSettings && isVaultR2PlaylistConfigured(vaultSettings));

  const preference: ThemePreference = (() => {
    if (vaultRoot === null) {
      return noVaultPreference;
    }
    if (vaultSettings === null) {
      return initialPreference ?? DEFAULT_THEME_PREFERENCE;
    }
    if (!isR2) {
      return vaultSettings.themePreference ?? DEFAULT_THEME_PREFERENCE;
    }
    return r2Preference;
  })();

  const preferenceLoaded: boolean = (() => {
    if (vaultRoot === null) {
      return true;
    }
    if (vaultSettings === null) {
      return false;
    }
    if (!isR2) {
      return true;
    }
    return r2Loaded;
  })();

  // Initial R2 fetch + migrate shared → R2 once.
  useEffect(() => {
    if (vaultRoot === null || vaultSettings === null) {
      return;
    }
    if (!isVaultR2PlaylistConfigured(vaultSettings)) {
      return;
    }
    let cancelled = false;
    // Defer so we do not call setState synchronously in the effect body (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (!cancelled) {
        setR2Loaded(false);
      }
    });
    void (async () => {
      try {
        const fromR2 = await getR2ThemePreferenceObject(vaultSettings.r2, R2_HTTP);
        if (cancelled) {
          return;
        }
        const sharedPref = vaultSettings.themePreference;
        if (sharedPref && !migratedSharedToR2Ref.current) {
          migratedSharedToR2Ref.current = true;
          if (fromR2 == null) {
            await putR2ThemePreferenceObject(vaultSettings.r2, sharedPref, R2_HTTP);
          }
          const cleared: EskerraSettings = {...vaultSettings};
          delete cleared.themePreference;
          await writeVaultSettings(vaultRoot, fs, cleared);
          if (cancelled) {
            return;
          }
          setVaultSettings(cleared);
          setR2Preference(fromR2 ?? sharedPref);
          setR2Loaded(true);
          return;
        }
        if (!cancelled) {
          setR2Preference(fromR2 ?? DEFAULT_THEME_PREFERENCE);
        }
      } catch {
        if (!cancelled) {
          setR2Preference(DEFAULT_THEME_PREFERENCE);
        }
      }
      if (!cancelled) {
        setR2Loaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vaultRoot, vaultSettings, fs, setVaultSettings]);

  const persistPreference = useCallback(
    async (next: ThemePreference) => {
      if (vaultRoot === null) {
        setNoVaultPreference(next);
        return;
      }
      if (vaultSettings === null) {
        return;
      }
      if (isVaultR2PlaylistConfigured(vaultSettings)) {
        setR2Preference(next);
        await putR2ThemePreferenceObject(vaultSettings.r2, next, R2_HTTP);
        return;
      }
      const merged: EskerraSettings = {...vaultSettings, themePreference: next};
      await writeVaultSettings(vaultRoot, fs, merged);
      setVaultSettings(merged);
    },
    [vaultRoot, vaultSettings, fs, setVaultSettings],
  );

  const setPreferenceLocal = useCallback((next: ThemePreference) => {
    setR2Preference(next);
  }, []);

  return {preference, preferenceLoaded, setPreferenceLocal, persistPreference};
}
