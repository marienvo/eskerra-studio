#!/bin/sh
# RPM post-install scriptlet (runs as root on install AND upgrade).
#
# Enables the Eskerra reminder daemon as a systemd *user* service for every
# user via `--global`, which writes the symlink into
# /etc/systemd/user/graphical-session.target.wants/. That is what actually makes
# the daemon start at each login — the shipped user-preset is only declarative
# and never applied on its own. Root cannot start the unit inside a running user
# session, so the "already logged in" case is covered by the app's best-effort
# `systemctl --user start` (see reminders_write_config). Best-effort: a failure
# here must never abort the package transaction.
#
# Only on first install ($1 == 1). On upgrade ($1 > 1) we must NOT re-enable:
# an admin who disabled (or preset-disabled) the unit has opted out, and
# recreating the global symlink on every upgrade would silently override that
# and resume reminders at next login.
if [ "$1" -eq 1 ]; then
    systemctl --global enable eskerra-reminderd.service >/dev/null 2>&1 || true
fi

exit 0
