/** Labels shown next to menu items (US English); mod key reflects typical OS conventions. */

export function reopenClosedTabMenuShortcutLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'Ctrl+Shift+T';
  }
  const ua = navigator.userAgent;
  const platform = navigator.platform ?? '';
  if (/^Mac/i.test(platform) || ua.includes('Mac OS')) {
    return '⌘⇧T';
  }
  return 'Ctrl+Shift+T';
}

/** Mod-Enter save hint in Add to inbox dialog title. */
export function modEnterSaveShortcutLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'Ctrl+Enter';
  }
  const ua = navigator.userAgent;
  const platform = navigator.platform ?? '';
  if (/^Mac/i.test(platform) || ua.includes('Mac OS')) {
    return '⌘Enter';
  }
  return 'Ctrl+Enter';
}

/** Clean this note (markdown normalize); shown in editor context menu. */
export function cleanNoteMenuShortcutLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'Ctrl+E';
  }
  const ua = navigator.userAgent;
  const platform = navigator.platform ?? '';
  if (/^Mac/i.test(platform) || ua.includes('Mac OS')) {
    return '⌘E';
  }
  return 'Ctrl+E';
}
