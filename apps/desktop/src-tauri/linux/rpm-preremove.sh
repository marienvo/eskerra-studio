#!/bin/sh
# RPM pre-remove scriptlet (runs as root). $1 is the count of remaining
# instances after this transaction: 0 on a real uninstall, >=1 during an
# upgrade. Only undo the global enable on a real uninstall so an upgrade keeps
# the daemon enabled. Best-effort; never abort the transaction.
if [ "$1" = "0" ]; then
    systemctl --global disable eskerra-reminderd.service >/dev/null 2>&1 || true
fi

exit 0
