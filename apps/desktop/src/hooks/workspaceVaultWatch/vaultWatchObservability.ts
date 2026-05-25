export function vaultChangedPathsSignature(paths: readonly string[]): string {
  return [...new Set(paths.map(p => p.trim()).filter(Boolean))].sort().join('\n');
}

export function vaultWatchBackendFromReason(reason: string | null): string {
  if (!reason) {
    return 'unknown';
  }
  const parts = reason.split(':');
  return parts.length >= 2 && parts[1] ? parts[1] : 'unknown';
}

export function normalizeVaultWatchErrorReason(message: string): string {
  const lower = message.toLowerCase();
  const osMatch = lower.match(/\(os error (\d+)\)/);
  if (osMatch?.[1]) {
    return `os_error_${osMatch[1]}`;
  }
  if (lower.includes('permission denied') || lower.includes('operation not permitted')) {
    return 'permission_denied';
  }
  if (lower.includes('no such file') || lower.includes('not found')) {
    return 'not_found';
  }
  if (lower.includes('too many open files')) {
    return 'too_many_open_files';
  }
  if (lower.includes('recommended watcher')) {
    return 'recommended_watcher_error';
  }
  if (lower.includes('poll watcher')) {
    return 'poll_watcher_error';
  }
  return 'unknown';
}
