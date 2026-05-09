import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {ChevronDownIcon, DashboardIcon} from '@radix-ui/react-icons';
import {useLayoutEffect, useRef, useState} from 'react';

export type TodayHubWorkspaceSelectItem = {
  todayNoteUri: string;
  label: string;
};

type TodayHubWorkspaceSelectProps = {
  items: readonly TodayHubWorkspaceSelectItem[];
  activeTodayNoteUri: string | null;
  activeLabel: string;
  subLabel?: string;
  /** Same chrome as an active editor open-note tab pill (workspace-shell Today). */
  mainShowsActiveTabPill?: boolean;
  onMainActivate: () => void;
  onPickHub: (todayNoteUri: string) => void;
  /** Middle-click / aux click: open hub note in a new editor tab. */
  onOpenHubInNewTab: (todayNoteUri: string) => void;
};

const HUB_WORKSPACE_ICON_DIM = {width: 15, height: 15} as const;

export function TodayHubWorkspaceSelect({
  items,
  activeTodayNoteUri,
  activeLabel,
  subLabel,
  mainShowsActiveTabPill = false,
  onMainActivate,
  onPickHub,
  onOpenHubInNewTab,
}: TodayHubWorkspaceSelectProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const [menuAlignOffsetPx, setMenuAlignOffsetPx] = useState(0);
  const [menuMinWidthPx, setMenuMinWidthPx] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const main = mainRef.current;
    if (!root || !main) {
      return;
    }
    const update = () => {
      setMenuAlignOffsetPx(-main.offsetWidth);
      setMenuMinWidthPx(root.offsetWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(root);
    ro.observe(main);
    return () => {
      ro.disconnect();
    };
  }, [activeLabel, subLabel, items.length]);

  if (items.length === 0 || activeTodayNoteUri == null) {
    return null;
  }

  const mainAriaLabel = subLabel
    ? `Today hub: ${activeLabel}: ${subLabel}. Activate this hub.`
    : `Today hub: ${activeLabel}. Activate this hub.`;

  return (
    <div ref={rootRef} className="today-hub-workspace-select" role="presentation">
      <button
        ref={mainRef}
        type="button"
        className={[
          'today-hub-workspace-select__main',
          mainShowsActiveTabPill ? 'today-hub-workspace-select__main--active-tab' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={mainAriaLabel}
        onClick={onMainActivate}
        onAuxClick={e => {
          if (e.button === 1) {
            e.preventDefault();
            onOpenHubInNewTab(activeTodayNoteUri);
          }
        }}
      >
        <span className="today-hub-workspace-select__icon" aria-hidden>
          <DashboardIcon {...HUB_WORKSPACE_ICON_DIM} />
        </span>
        <span className="today-hub-workspace-select__label">
          <span className="today-hub-workspace-select__label-prefix">{activeLabel}</span>
          {subLabel ? (
            <>
              <span className="today-hub-workspace-select__label-separator">:</span>
              <span className="today-hub-workspace-select__sublabel">{subLabel}</span>
            </>
          ) : null}
        </span>
      </button>
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="today-hub-workspace-select__chevron"
            aria-label="Choose Today hub"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <ChevronDownIcon {...HUB_WORKSPACE_ICON_DIM} aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="today-hub-workspace-select__menu note-list-context-menu"
            sideOffset={4}
            align="start"
            alignOffset={menuAlignOffsetPx}
            collisionPadding={8}
            style={
              menuMinWidthPx != null ? {minWidth: menuMinWidthPx} : undefined
            }
          >
            {items.map(it => (
              <DropdownMenu.Item
                key={it.todayNoteUri}
                className="note-list-context-menu__item"
                onSelect={() => {
                  onPickHub(it.todayNoteUri);
                  setMenuOpen(false);
                }}
                onPointerDown={e => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onOpenHubInNewTab(it.todayNoteUri);
                    setMenuOpen(false);
                  }
                }}
              >
                <span className="today-hub-workspace-select__menu-item-inner">
                  <DashboardIcon {...HUB_WORKSPACE_ICON_DIM} aria-hidden />
                  <span>{it.label}</span>
                </span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
