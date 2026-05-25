import {ToastStack} from '../../components/ToastStack';
import type {SessionNotification} from '../../lib/sessionNotifications';
import {AppDiskConflictBanners} from '../AppDiskConflictBanners';
import {CloseSyncProgressOverlay} from '../CloseSyncProgressOverlay';

type AppChromeCloseSyncOverlayProps = {
  placement: 'closeSync';
  closeSyncInProgress: boolean;
};

type AppChromeStageOverlayProps = {
  placement: 'stage';
  err: string | null;
  diskConflict: unknown;
  diskConflictSoft: {uri: string} | null;
  selectedUri: string | null;
  enterDiskConflictMergeView: () => void;
  resolveDiskConflictReloadFromDisk: () => void;
  resolveDiskConflictKeepLocal: () => void;
  elevateDiskConflictSoftToBlocking: () => void;
  dismissDiskConflictSoft: () => void;
  notificationItems: readonly SessionNotification[];
  onDismissNotification: (id: string) => void;
};

export type AppChromeOverlaysProps =
  | AppChromeCloseSyncOverlayProps
  | AppChromeStageOverlayProps;

/**
 * Shell-level overlays. Use `placement="closeSync"` as a sibling before `.app-root-chrome`
 * (fixed overlay must not sit under `overflow: hidden`). Use `placement="stage"` inside
 * `.app-root-chrome` after the main stage and before the status bar.
 */
export function AppChromeOverlays(props: AppChromeOverlaysProps) {
  if (props.placement === 'closeSync') {
    return <CloseSyncProgressOverlay visible={props.closeSyncInProgress} />;
  }

  const {
    err,
    diskConflict,
    diskConflictSoft,
    selectedUri,
    enterDiskConflictMergeView,
    resolveDiskConflictReloadFromDisk,
    resolveDiskConflictKeepLocal,
    elevateDiskConflictSoftToBlocking,
    dismissDiskConflictSoft,
    notificationItems,
    onDismissNotification,
  } = props;

  return (
    <>
      <AppDiskConflictBanners
        err={err}
        diskConflict={diskConflict}
        diskConflictSoft={diskConflictSoft}
        selectedUri={selectedUri}
        enterDiskConflictMergeView={enterDiskConflictMergeView}
        resolveDiskConflictReloadFromDisk={resolveDiskConflictReloadFromDisk}
        resolveDiskConflictKeepLocal={resolveDiskConflictKeepLocal}
        elevateDiskConflictSoftToBlocking={elevateDiskConflictSoftToBlocking}
        dismissDiskConflictSoft={dismissDiskConflictSoft}
      />
      <ToastStack items={notificationItems} onDismiss={onDismissNotification} />
    </>
  );
}
