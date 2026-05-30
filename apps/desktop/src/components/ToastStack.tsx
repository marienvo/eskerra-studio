import {createPortal} from 'react-dom';

import type {SessionNotification} from '../lib/sessionNotifications';
import {MaterialIcon} from './MaterialIcon';

type ToastStackProps = {
  items: readonly SessionNotification[];
  onDismiss: (id: string) => void;
};

export function ToastStack({items, onDismiss}: ToastStackProps) {
  if (items.length === 0) {
    return null;
  }

  return createPortal(
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {items.map(item => (
        <div
          key={item.id}
          className={`toast toast--${item.tone}`}
          role={item.tone === 'error' ? 'alert' : undefined}
        >
          <MaterialIcon
            name={item.tone === 'error' ? 'error_outline' : 'info'}
            size={12}
            className="toast__icon"
            aria-hidden
          />
          <p className="toast__text">{item.text}</p>
          <button
            type="button"
            className="toast__dismiss icon-btn-ghost"
            aria-label="Dismiss"
            onClick={() => onDismiss(item.id)}
          >
            <MaterialIcon name="close" size={12} aria-hidden />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
