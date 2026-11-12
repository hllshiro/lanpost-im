#!/bin/sh
# Runs as root when deb/rpm is configured. Never fail the package installation.

UDP_PORTS="9011 9012"
TCP_PORTS="9013 9014"
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
    if [ "$proto" = "tcp" ]; then
      ports="$TCP_PORTS"
    else
      ports="$UDP_PORTS"
    fi
    for port in $ports; do
      if ! ufw status 2>/dev/null | grep -q "^$port/$proto"; then
        if ufw allow "$port/$proto" >/dev/null 2>&1; then
          record "ufw $proto $port"
        fi
      fi
    done
  done
}

add_firewalld() {
  command -v firewall-cmd >/dev/null 2>&1 || return 0
  firewall-cmd --state >/dev/null 2>&1 || return 0
  changed=0
  for proto in tcp udp; do
    if [ "$proto" = "tcp" ]; then
      ports="$TCP_PORTS"
    else
      ports="$UDP_PORTS"
    fi
    for port in $ports; do
      if ! firewall-cmd --permanent --query-port="$port/$proto" >/dev/null 2>&1; then
        if firewall-cmd --permanent --add-port="$port/$proto" >/dev/null 2>&1; then
          record "firewalld $proto $port"
          changed=1
        fi
      fi
    done
  done
  if [ "$changed" = "1" ]; then
    firewall-cmd --reload >/dev/null 2>&1 || true
  fi
}

# 只在 deb/rpm 安装或升级时执行，重复添加是幂等的。
add_ufw
add_firewalld

exit 0
