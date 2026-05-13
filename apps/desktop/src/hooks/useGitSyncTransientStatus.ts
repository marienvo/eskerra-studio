import {useCallback, useEffect, useRef, useState} from 'react';

export type TransientGitStatus = {
  tone: 'success' | 'info';
  label: string;
  icon: string;
  description?: string;
};

type UseGitSyncTransientStatusOptions = {
  readonly visibleMs?: number;
};

const DEFAULT_VISIBLE_MS = 3_000;

export function useGitSyncTransientStatus(
  opts?: UseGitSyncTransientStatusOptions,
): {
  transient: TransientGitStatus | null;
  show: (status: TransientGitStatus) => void;
  clear: () => void;
} {
  const visibleMs = opts?.visibleMs ?? DEFAULT_VISIBLE_MS;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transient, setTransient] = useState<TransientGitStatus | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current == null) {
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const clear = useCallback(() => {
    clearTimer();
    setTransient(null);
  }, [clearTimer]);

  const show = useCallback(
    (status: TransientGitStatus) => {
      clearTimer();
      setTransient(status);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setTransient(null);
      }, visibleMs);
    },
    [clearTimer, visibleMs],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return {transient, show, clear};
}
