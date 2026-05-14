import {load} from '@tauri-apps/plugin-store';

const STORE_PATH = 'eskerra-desktop.json';
const KEY_V4 = 'layoutPanelsV4';
const KEY_V3 = 'layoutPanelsV3';

/** Left column width in pixels (shared by Vault, Episodes, and the stacked pair). */
export type LeftSplitLayout = {
  leftWidthPx: number;
};

/** Right-side Notifications pane width (main | … | notifications | rail). */
export type NotificationsPanelLayout = {
  widthPx: number;
};

/** Vault pane height when Vault and Episodes are both visible (stacked in the left column). */
export type VaultEpisodesStackLayout = {
  topHeightPx: number;
};

/**
 * Vertical stack in the shell **end** column: **Notifications** (top) and **Inbox** tree (bottom).
 * `topHeightPx` is the persisted height of the notifications block when both are visible.
 */
export type NotificationsInboxStackLayout = {
  topHeightPx: number;
};

export type StoredLayouts = {
  /** Legacy key: main workspace left column width (Vault / Episodes / stack). */
  inbox: LeftSplitLayout;
  /** Legacy key: must mirror {@link StoredLayouts.inbox} `leftWidthPx` for a single left-pane width. */
  podcastsMain: LeftSplitLayout;
  notifications: NotificationsPanelLayout;
  vaultEpisodesStack: VaultEpisodesStackLayout;
  notificationsInboxStack: NotificationsInboxStackLayout;
};

/** Minimum CSS pixel size for each resizable split pane edge (left column, editor reserve, stack rows, notifications). */
export const MIN_RESIZABLE_PANE_PX = 20 as const;

export const INBOX_LEFT_PANEL = {
  defaultPx: 280,
  minPx: MIN_RESIZABLE_PANE_PX,
  maxPx: 520,
} as const;

export const PODCASTS_LEFT_PANEL = {
  defaultPx: 300,
  minPx: MIN_RESIZABLE_PANE_PX,
  maxPx: 560,
} as const;

export const NOTIFICATIONS_PANEL = {
  defaultPx: 280,
  minPx: MIN_RESIZABLE_PANE_PX,
  maxPx: 520,
} as const;

/**
 * Vertical split between Vault (top) and Episodes (bottom) when both panes are visible.
 * `maxPx` is a soft cap for persisted values; the vertical split clamps the live height to the
 * column height first, so a low max would block shrinking the bottom pane on tall windows.
 */
export const VAULT_EPISODES_STACK_TOP = {
  defaultPx: 280,
  minPx: MIN_RESIZABLE_PANE_PX,
  maxPx: 10_000,
} as const;

/**
 * Same semantics as {@link VAULT_EPISODES_STACK_TOP}: persisted **top** row height (notifications)
 * when the Inbox tree is open below it in the shell end column.
 */
export const NOTIFICATIONS_INBOX_STACK_TOP = {
  defaultPx: 280,
  minPx: MIN_RESIZABLE_PANE_PX,
  maxPx: 10_000,
} as const;

export const DEFAULT_LAYOUTS: StoredLayouts = {
  inbox: {leftWidthPx: INBOX_LEFT_PANEL.defaultPx},
  podcastsMain: {leftWidthPx: INBOX_LEFT_PANEL.defaultPx},
  notifications: {widthPx: NOTIFICATIONS_PANEL.defaultPx},
  vaultEpisodesStack: {topHeightPx: VAULT_EPISODES_STACK_TOP.defaultPx},
  notificationsInboxStack: {topHeightPx: NOTIFICATIONS_INBOX_STACK_TOP.defaultPx},
};

const ASSUMED_WIDTH_FOR_V3_MIGRATION = 1024;

function clampLeftWidth(
  px: number,
  minPx: number,
  maxPx: number,
  fallback: number,
): number {
  if (typeof px !== 'number' || !Number.isFinite(px)) {
    return fallback;
  }
  const r = Math.round(px);
  return Math.min(maxPx, Math.max(minPx, r));
}

function sanitizeInbox(layout: LeftSplitLayout | undefined): LeftSplitLayout {
  const fb = DEFAULT_LAYOUTS.inbox.leftWidthPx;
  if (!layout || typeof layout.leftWidthPx !== 'number') {
    return {leftWidthPx: fb};
  }
  return {
    leftWidthPx: clampLeftWidth(
      layout.leftWidthPx,
      INBOX_LEFT_PANEL.minPx,
      INBOX_LEFT_PANEL.maxPx,
      fb,
    ),
  };
}

function sanitizePodcastsMain(layout: LeftSplitLayout | undefined): LeftSplitLayout {
  const fb = DEFAULT_LAYOUTS.podcastsMain.leftWidthPx;
  if (!layout || typeof layout.leftWidthPx !== 'number') {
    return {leftWidthPx: fb};
  }
  return {
    leftWidthPx: clampLeftWidth(
      layout.leftWidthPx,
      PODCASTS_LEFT_PANEL.minPx,
      PODCASTS_LEFT_PANEL.maxPx,
      fb,
    ),
  };
}

/** One width for the whole left pane: take the larger of legacy inbox vs podcasts values, then clamp. */
function mergeMainLeftPaneWidths(
  inbox: LeftSplitLayout,
  podcastsMain: LeftSplitLayout,
): LeftSplitLayout {
  const merged = Math.max(inbox.leftWidthPx, podcastsMain.leftWidthPx);
  return {
    leftWidthPx: clampLeftWidth(
      merged,
      INBOX_LEFT_PANEL.minPx,
      INBOX_LEFT_PANEL.maxPx,
      DEFAULT_LAYOUTS.inbox.leftWidthPx,
    ),
  };
}

function sanitizeNotifications(
  layout: NotificationsPanelLayout | undefined,
): NotificationsPanelLayout {
  const fb = DEFAULT_LAYOUTS.notifications.widthPx;
  if (!layout || typeof layout.widthPx !== 'number') {
    return {widthPx: fb};
  }
  return {
    widthPx: clampLeftWidth(
      layout.widthPx,
      NOTIFICATIONS_PANEL.minPx,
      NOTIFICATIONS_PANEL.maxPx,
      fb,
    ),
  };
}

function sanitizeVaultEpisodesStack(
  layout: VaultEpisodesStackLayout | undefined,
): VaultEpisodesStackLayout {
  const fb = DEFAULT_LAYOUTS.vaultEpisodesStack.topHeightPx;
  if (!layout || typeof layout.topHeightPx !== 'number') {
    return {topHeightPx: fb};
  }
  return {
    topHeightPx: clampLeftWidth(
      layout.topHeightPx,
      VAULT_EPISODES_STACK_TOP.minPx,
      VAULT_EPISODES_STACK_TOP.maxPx,
      fb,
    ),
  };
}

function sanitizeNotificationsInboxStack(
  layout: NotificationsInboxStackLayout | undefined,
): NotificationsInboxStackLayout {
  const fb = DEFAULT_LAYOUTS.notificationsInboxStack.topHeightPx;
  if (!layout || typeof layout.topHeightPx !== 'number') {
    return {topHeightPx: fb};
  }
  return {
    topHeightPx: clampLeftWidth(
      layout.topHeightPx,
      NOTIFICATIONS_INBOX_STACK_TOP.minPx,
      NOTIFICATIONS_INBOX_STACK_TOP.maxPx,
      fb,
    ),
  };
}

function isInboxV3Layout(v: unknown): v is {files: number; editor: number} {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const o = v as Record<string, unknown>;
  return typeof o.files === 'number' && typeof o.editor === 'number';
}

function isPodcastsV3Layout(v: unknown): v is {episodes: number; rightCol: number} {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const o = v as Record<string, unknown>;
  return typeof o.episodes === 'number' && typeof o.rightCol === 'number';
}

/** Exported for unit tests: migrate v3 percentage map to v4 pixel widths. */
export function migrateV3LayoutsToV4(raw: unknown): StoredLayouts | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const o = raw as Partial<{inbox: unknown; podcastsMain: unknown}>;
  if (!isInboxV3Layout(o.inbox) || !isPodcastsV3Layout(o.podcastsMain)) {
    return null;
  }
  const w = ASSUMED_WIDTH_FOR_V3_MIGRATION;
  const inboxPx = Math.round((o.inbox.files / 100) * w);
  const episodesPx = Math.round((o.podcastsMain.episodes / 100) * w);
  const unified = mergeMainLeftPaneWidths(
    sanitizeInbox({leftWidthPx: inboxPx}),
    sanitizePodcastsMain({leftWidthPx: episodesPx}),
  );
  return {
    inbox: unified,
    podcastsMain: unified,
    notifications: sanitizeNotifications(undefined),
    vaultEpisodesStack: sanitizeVaultEpisodesStack(undefined),
    notificationsInboxStack: sanitizeNotificationsInboxStack(undefined),
  };
}

function parseV4Payload(parsed: unknown): StoredLayouts | null {
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const o = parsed as Partial<StoredLayouts> & {
    /** @deprecated Renamed to {@link StoredLayouts.notificationsInboxStack}; read for migration. */
    editorInboxStack?: NotificationsInboxStackLayout;
  };
  if (o.inbox === undefined || o.podcastsMain === undefined) {
    return null;
  }
  const inbox = sanitizeInbox(o.inbox);
  const podcastsMain = sanitizePodcastsMain(o.podcastsMain);
  const unifiedLeft = mergeMainLeftPaneWidths(inbox, podcastsMain);
  const notifications = sanitizeNotifications(o.notifications);
  const vaultEpisodesStack = sanitizeVaultEpisodesStack(o.vaultEpisodesStack);
  const notificationsInboxStack = sanitizeNotificationsInboxStack(
    o.notificationsInboxStack ?? o.editorInboxStack,
  );
  return {
    inbox: unifiedLeft,
    podcastsMain: unifiedLeft,
    notifications,
    vaultEpisodesStack,
    notificationsInboxStack,
  };
}

/** Exposed for unit tests (e.g. legacy `editorInboxStack` key migration). */
export function parseLayoutPanelsV4ForTest(parsed: unknown): StoredLayouts | null {
  return parseV4Payload(parsed);
}

export async function loadStoredLayouts(): Promise<StoredLayouts> {
  try {
    const store = await load(STORE_PATH);

    const rawV4 = await store.get<string>(KEY_V4);
    if (rawV4?.trim()) {
      try {
        const parsed = JSON.parse(rawV4) as unknown;
        const v4 = parseV4Payload(parsed);
        if (v4) {
          return v4;
        }
      } catch {
        /* fall through */
      }
    }

    const rawV3 = await store.get<string>(KEY_V3);
    if (rawV3?.trim()) {
      try {
        const parsed = JSON.parse(rawV3) as unknown;
        const migrated = migrateV3LayoutsToV4(parsed);
        if (migrated) {
          await store.set(KEY_V4, JSON.stringify(migrated));
          await store.delete(KEY_V3);
          await store.save();
          return migrated;
        }
      } catch {
        /* fall through */
      }
    }

    return DEFAULT_LAYOUTS;
  } catch {
    return DEFAULT_LAYOUTS;
  }
}

export async function saveStoredLayouts(layouts: StoredLayouts): Promise<void> {
  const store = await load(STORE_PATH);
  const inbox = sanitizeInbox(layouts.inbox);
  const normalized: StoredLayouts = {
    inbox,
    podcastsMain: {leftWidthPx: inbox.leftWidthPx},
    notifications: sanitizeNotifications(layouts.notifications),
    vaultEpisodesStack: sanitizeVaultEpisodesStack(layouts.vaultEpisodesStack),
    notificationsInboxStack: sanitizeNotificationsInboxStack(
      layouts.notificationsInboxStack,
    ),
  };
  await store.set(KEY_V4, JSON.stringify(normalized));
  await store.save();
}
