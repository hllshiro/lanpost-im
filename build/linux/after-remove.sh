#!/bin/sh
# Runs as root when deb/rpm is removed. Never fail the package removal.

STATE_DIR=/var/lib/lanpost-im
STATE_FILE="$STATE_DIR/firewall-ports"

remove_rules() {
  [ -f "$STATE_FILE" ] || return 0
  reload_firewalld=0
  while read -r backend proto port; do
    [ -n "$port" ] || continue
    case "$backend" in
      ufw)
        if command -v ufw >/dev/null 2>&1; then
          ufw delete allow "$port/$proto" >/dev/null 2>&1 || true
        fi
        ;;
      firewalld)
        if command -v firewall-cmd >/dev/null 2>&1; then
          firewall-cmd --permanent --remove-port="$port/$proto" >/dev/null 2>&1 || true
          reload_firewalld=1
        fi
        ;;
    esac
  done < "$STATE_FILE"
  if [ "$reload_firewalld" = "1" ]; then
    firewall-cmd --reload >/dev/null 2>&1 || true
  fi
  rm -f "$STATE_FILE" 2>/dev/null || true
  rmdir "$STATE_DIR" 2>/dev/null || true
}

case "$1" in
  remove|purge|0)
    remove_rules
    ;;
esac

exit 0
