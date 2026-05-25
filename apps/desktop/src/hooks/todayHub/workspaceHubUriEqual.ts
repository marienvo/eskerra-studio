import {normalizeWorkspaceUri} from '../../lib/workspaceModel';

export function workspaceHubUriEqual(a: string | null, b: string | null): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  return normalizeWorkspaceUri(a) === normalizeWorkspaceUri(b);
}
