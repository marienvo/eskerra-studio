type CloseSyncProgressOverlayProps = {
  visible: boolean;
};

/**
 * Full-window overlay shown while a close-sync is in progress.
 * Rendered above the main layout so users know why the window hasn't closed yet.
 * Hidden on failure/timeout — the existing chip/toast path surfaces those.
 */
export function CloseSyncProgressOverlay({visible}: CloseSyncProgressOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Syncing vault before close"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          background: 'var(--color-surface, #1e1e2e)',
          border: '1px solid var(--color-window-border-floating, rgba(255,255,255,0.12))',
          borderRadius: '10px',
          padding: '2rem 2.5rem',
          maxWidth: '22rem',
          textAlign: 'center',
          color: 'var(--color-text, #e4e4ef)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        }}
      >
        <p
          style={{
            margin: '0 0 0.5rem',
            fontWeight: 600,
            fontSize: '0.95rem',
            color: 'var(--color-text, #e4e4ef)',
          }}
        >
          Syncing before close…
        </p>
        <p
          style={{
            margin: '0 0 1rem',
            fontSize: '0.85rem',
            color: 'var(--color-muted, rgba(228,228,239,0.65))',
            lineHeight: 1.5,
          }}
        >
          Eskerra is syncing your vault before closing.
        </p>
        <p
          style={{
            margin: 0,
            fontSize: '0.78rem',
            color: 'var(--color-shell-icon-muted, rgba(228,228,239,0.45))',
          }}
        >
          Hold Shift next time to close instantly.
        </p>
      </div>
    </div>
  );
}
