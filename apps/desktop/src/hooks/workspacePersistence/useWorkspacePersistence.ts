import type {MutableRefObject} from 'react';

import {createInboxAutosaveScheduler} from '../../lib/inboxAutosaveScheduler';

import {useInboxAutosaveEffect} from './useInboxAutosaveEffect';
import {useInboxPersistCommands} from './useInboxPersistCommands';
import {
  toWorkspacePersistenceDeps,
  type UseWorkspacePersistenceArgs,
} from './workspacePersistenceTypes';

export function useWorkspacePersistence(args: UseWorkspacePersistenceArgs): {
  saveChainRef: MutableRefObject<Promise<void>>;
  saveActiveRef: MutableRefObject<boolean>;
  autosaveSchedulerRef: MutableRefObject<ReturnType<typeof createInboxAutosaveScheduler>>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  mergeInboxNoteBodyCacheRefAndState: (norm: string, body: string) => void;
  enqueuePersistOutgoingNoteMarkdown: (
    uri: string,
    leaveSnapshotMarkdown: string,
  ) => void;
  enqueueInboxPersist: () => Promise<void>;
  flushInboxSave: () => Promise<void>;
  onInboxSaveShortcut: () => void;
} {
  const deps = toWorkspacePersistenceDeps(args);
  const commands = useInboxPersistCommands(deps);
  useInboxAutosaveEffect(deps, commands.enqueueInboxPersist, commands.autosaveSchedulerRef);
  return commands;
}
