#!/bin/sh
# Runs as root when the deb is configured. Never fail the package installation.

PORT=2425
STATE_DIR=/var/lib/lanpost-im
STATE_FILE="$STATE_DIR/firewall-ports"

record() {
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  grep -qxF "$1" "$STATE_FILE" 2>/dev/null || echo "$1" >> "$STATE_FILE" 2>/dev/null || true
}

add_ufw() {
  command -v ufw >/dev/null 2>&1 || return 0
  systemctl is-active --quiet ufw 2>/dev/null || return 0
  for proto in tcp udp; do
    if ! ufw status 2>/dev/null | grep -q "^$PORT/$proto"; then
      if ufw allow "$PORT/$proto" >/dev/null 2>&1; then
        record "ufw $proto $PORT"
      fi
    fi
  done
}

add_firewalld() {
  command -v firewall-cmd >/dev/null 2>&1 || return 0
  firewall-cmd --state >/dev/null 2>&1 || return 0
  changed=0
  for proto in tcp udp; do
    if ! firewall-cmd --permanent --query-port="$PORT/$proto" >/dev/null 2>&1; then
      if firewall-cmd --permanent --add-port="$PORT/$proto" >/dev/null 2>&1; then
        record "firewalld $proto $PORT"
        changed=1
      fi
    fi
  done
  if [ "$changed" = "1" ]; then
    firewall-cmd --reload >/dev/null 2>&1 || true
  fi
}

case "$1" in
  configure)
    add_ufw
    add_firewalld
    ;;
esac

exit 0
