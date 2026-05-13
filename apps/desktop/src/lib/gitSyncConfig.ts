import type {SyncConfig} from './tauriVaultGitSync';

export const GIT_SYNC_REMOTE = 'origin';

export function buildManualGitSyncConfig(branch: string): SyncConfig {
  return {
    remote: GIT_SYNC_REMOTE,
    branch,
    include: ['**/*.md'],
    exclude: [],
    backupDirectory: '_sync-backups',
    conflictPolicies: [{glob: '**/*.md', strategy: 'manual'}],
    markdownConflictCallout: {
      enabled: false,
      calloutKind: 'warning',
      template: 'Conflict backup: [[{backup_path}]]',
    },
    commitMessageTemplate: 'chore: sync {timestamp} {host}',
    hostLabel: null,
    backupLocalSubdir: 'local',
    backupRemoteSubdir: 'remote',
    timeouts: {
      fetchSecs: 30,
      pushSecs: 30,
      mergeSecs: 30,
    },
    allowCreateBackupDirectory: false,
    skipCommitHooks: true,
  };
}
