#!/bin/sh

# Custom AdGuard Home installer/updater for system-level deployments.
#
# This script:
#  1. Checks if AGH is already installed.
#  2. Clones/updates your fork.
#  3. Builds AGH from source.
#  4. Installs (or upgrades) /opt/AdGuardHome/AdGuardHome with rollback.
#  5. Installs helper commands for panel-triggered updates.

set -eu

AGH_REPO_URL="${AGH_REPO_URL:-}"
AGH_REPO_BRANCH="${AGH_REPO_BRANCH:-master}"
AGH_UPSTREAM_URL="${AGH_UPSTREAM_URL:-https://github.com/AdguardTeam/AdGuardHome.git}"
AGH_UPSTREAM_BRANCH="${AGH_UPSTREAM_BRANCH:-master}"
AGH_SYNC_UPSTREAM="${AGH_SYNC_UPSTREAM:-1}"
AGH_AUTO_INSTALL_DEPS="${AGH_AUTO_INSTALL_DEPS:-1}"
AGH_SOURCE_DIR="${AGH_SOURCE_DIR:-/usr/local/src/agh-custom}"
AGH_INSTALL_DIR="${AGH_INSTALL_DIR:-/opt/AdGuardHome}"
AGH_SERVICE_NAME="${AGH_SERVICE_NAME:-AdGuardHome}"
AGH_BACKUP_DIR="${AGH_BACKUP_DIR:-$AGH_INSTALL_DIR/backups}"
AGH_MANAGER_PATH="${AGH_MANAGER_PATH:-/usr/local/sbin/agh-custom-manager}"
AGH_UPDATE_CMD_PATH="${AGH_UPDATE_CMD_PATH:-/usr/local/sbin/agh-custom-update}"

case "$0" in
    /*) AGH_SELF_PATH="$0" ;;
    *) AGH_SELF_PATH="$PWD/$0" ;;
esac

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
    log "ERROR: $*"
    exit 1
}

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        fail "Run as root (sudo)."
    fi
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

required_tools_missing() {
    missing=""
    for tool in git make go npm systemctl install; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            missing="${missing} ${tool}"
        fi
    done

    printf '%s\n' "${missing# }"
}

install_missing_dependencies() {
    if command -v apt-get >/dev/null 2>&1; then
        export DEBIAN_FRONTEND=noninteractive
        apt-get update
        apt-get install -y git make golang-go nodejs npm ca-certificates

        return
    fi

    if command -v dnf >/dev/null 2>&1; then
        dnf install -y git make golang nodejs npm ca-certificates

        return
    fi

    if command -v yum >/dev/null 2>&1; then
        yum install -y git make golang nodejs npm ca-certificates

        return
    fi

    if command -v apk >/dev/null 2>&1; then
        apk add --no-cache git make go nodejs npm ca-certificates

        return
    fi

    fail "Unsupported package manager. Install dependencies manually: git make go npm"
}

ensure_dependencies() {
    missing_before="$(required_tools_missing)"
    if [ -z "$missing_before" ]; then
        return
    fi

    if [ "$AGH_AUTO_INSTALL_DEPS" != "1" ]; then
        fail "Missing required commands:${missing_before}. Install them or set AGH_AUTO_INSTALL_DEPS=1."
    fi

    log "Missing required commands:${missing_before}. Installing automatically ..."
    install_missing_dependencies

    missing_after="$(required_tools_missing)"
    if [ -n "$missing_after" ]; then
        fail "Still missing commands after install:${missing_after}"
    fi
}

service_exists() {
    systemctl cat "$AGH_SERVICE_NAME" >/dev/null 2>&1
}

is_installed() {
    if [ -x "$AGH_INSTALL_DIR/AdGuardHome" ] || service_exists; then
        return 0
    fi

    return 1
}

clone_or_update_repo() {
    if [ ! -d "$AGH_SOURCE_DIR/.git" ]; then
        [ -n "$AGH_REPO_URL" ] || fail "Set AGH_REPO_URL to your fork URL before first run."
        log "Cloning fork from $AGH_REPO_URL ..."
        mkdir -p "$(dirname "$AGH_SOURCE_DIR")"
        git clone --branch "$AGH_REPO_BRANCH" "$AGH_REPO_URL" "$AGH_SOURCE_DIR"
    fi

    cd "$AGH_SOURCE_DIR"

    if [ -n "$AGH_REPO_URL" ]; then
        git remote set-url origin "$AGH_REPO_URL"
    fi

    log "Updating fork branch $AGH_REPO_BRANCH ..."
    git fetch origin
    git checkout "$AGH_REPO_BRANCH"
    git pull --ff-only origin "$AGH_REPO_BRANCH"

    if [ "$AGH_SYNC_UPSTREAM" = "1" ]; then
        if git remote get-url upstream >/dev/null 2>&1; then
            git remote set-url upstream "$AGH_UPSTREAM_URL"
        else
            git remote add upstream "$AGH_UPSTREAM_URL"
        fi

        log "Syncing with upstream/$AGH_UPSTREAM_BRANCH (fast-forward only) ..."
        git fetch upstream "$AGH_UPSTREAM_BRANCH"
        if ! git merge --ff-only "upstream/$AGH_UPSTREAM_BRANCH"; then
            fail "Upstream sync failed (merge conflict). Resolve in your fork first."
        fi

        if [ -n "$AGH_REPO_URL" ]; then
            git push origin "$AGH_REPO_BRANCH"
        fi
    fi
}

build_binary() {
    cd "$AGH_SOURCE_DIR"
    log "Building AdGuard Home ..."
    make build
    [ -x "$AGH_SOURCE_DIR/AdGuardHome" ] || fail "Build finished but binary was not created."
}

install_tooling() {
    log "Installing helper commands ..."
    mkdir -p "$(dirname "$AGH_MANAGER_PATH")"
    install -m 0755 "$AGH_SELF_PATH" "$AGH_MANAGER_PATH"

    cat >"$AGH_UPDATE_CMD_PATH" <<'EOF'
#!/bin/sh
set -eu
AGH_MANAGER_PATH="${AGH_MANAGER_PATH:-/usr/local/sbin/agh-custom-manager}"
exec "$AGH_MANAGER_PATH" apply
EOF
    chmod 0755 "$AGH_UPDATE_CMD_PATH"
}

install_fresh() {
    new_bin="$1"

    log "No AGH installation detected. Installing fresh instance ..."
    install -d -m 0755 "$AGH_INSTALL_DIR"
    install -d -m 0755 "$AGH_INSTALL_DIR/work" "$AGH_INSTALL_DIR/conf"
    install -m 0755 "$new_bin" "$AGH_INSTALL_DIR/AdGuardHome"

    # Install a system service if it isn't installed yet.
    "$AGH_INSTALL_DIR/AdGuardHome" -s install || true
    systemctl enable --now "$AGH_SERVICE_NAME"
    systemctl is-active --quiet "$AGH_SERVICE_NAME" || fail "Service did not start after fresh install."
}

upgrade_existing() {
    new_bin="$1"
    old_bin="$AGH_INSTALL_DIR/AdGuardHome"
    timestamp="$(date '+%Y%m%d-%H%M%S')"
    backup_bin="$AGH_BACKUP_DIR/AdGuardHome.$timestamp"

    install -d -m 0755 "$AGH_BACKUP_DIR"
    if [ -x "$old_bin" ]; then
        cp -f "$old_bin" "$backup_bin"
        log "Backup created: $backup_bin"
    fi

    if service_exists; then
        systemctl stop "$AGH_SERVICE_NAME" || true
    fi

    install -m 0755 "$new_bin" "$old_bin"

    if service_exists; then
        if ! systemctl restart "$AGH_SERVICE_NAME"; then
            if [ -f "$backup_bin" ]; then
                log "Restart failed. Rolling back binary ..."
                install -m 0755 "$backup_bin" "$old_bin"
                systemctl restart "$AGH_SERVICE_NAME" || true
            fi

            fail "Service restart failed after upgrade."
        fi
    else
        "$old_bin" -s install || true
        systemctl enable --now "$AGH_SERVICE_NAME"
    fi

    systemctl is-active --quiet "$AGH_SERVICE_NAME" || fail "Service is not active after upgrade."
}

apply_update() {
    require_root
    ensure_dependencies
    require_cmd systemctl
    require_cmd install

    clone_or_update_repo
    build_binary
    install_tooling

    if is_installed; then
        log "Existing AGH installation detected, upgrading ..."
        upgrade_existing "$AGH_SOURCE_DIR/AdGuardHome"
    else
        install_fresh "$AGH_SOURCE_DIR/AdGuardHome"
    fi

    log "Custom AGH update finished successfully."
}

usage() {
    cat <<EOF
Usage:
  $0 apply
  $0 install-tools

Environment (important):
  AGH_REPO_URL        Your fork URL (required on first run)
  AGH_REPO_BRANCH     Fork branch to build (default: master)
  AGH_SYNC_UPSTREAM   1=sync from upstream before build (default: 1)
  AGH_AUTO_INSTALL_DEPS 1=install missing build deps automatically (default: 1)
  AGH_UPSTREAM_BRANCH Upstream branch (default: master)
EOF
}

cmd="${1:-apply}"
case "$cmd" in
    apply)
        apply_update
        ;;
    install-tools)
        require_root
        install_tooling
        ;;
    *)
        usage
        exit 1
        ;;
esac
