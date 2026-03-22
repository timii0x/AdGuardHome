#!/bin/sh

set -eu

SOURCE_DIR="${1:-$(pwd)}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PATCH_FILE="$SCRIPT_DIR/patches/0001-optimistic-prefetch-ttl10.patch"
AGH_PATCH_ALLOW_DIRTY="${AGH_PATCH_ALLOW_DIRTY:-1}"

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
    log "ERROR: $*"
    exit 1
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

is_patch_already_applied() {
    [ -f "$SOURCE_DIR/internal/dnsforward/cacheprefetch.go" ] || return 1
    [ -f "$SOURCE_DIR/internal/dnsforward/stats.go" ] || return 1

    grep -q 'defaultPrefetchTTLRefreshPercent' "$SOURCE_DIR/internal/dnsforward/cacheprefetch.go" &&
        grep -q 'recordOptimisticPrefetchHitLocked(host, qt, pctx.Res)' "$SOURCE_DIR/internal/dnsforward/stats.go"
}

main() {
    require_cmd git

    [ -f "$PATCH_FILE" ] || fail "Patch file not found: $PATCH_FILE"
    [ -d "$SOURCE_DIR/.git" ] || fail "Not a git repo: $SOURCE_DIR"

    if [ -n "$(git -C "$SOURCE_DIR" status --porcelain --untracked-files=no 2>/dev/null || true)" ]; then
        if [ "$AGH_PATCH_ALLOW_DIRTY" != "1" ]; then
            fail "Working tree is not clean in $SOURCE_DIR. Commit/stash first."
        fi

        log "Working tree is not clean, continuing because AGH_PATCH_ALLOW_DIRTY=1."
    fi

    if is_patch_already_applied; then
        log "TTL 10% prefetch patch is already applied."
        exit 0
    fi

    log "Applying TTL 10% optimistic prefetch patch ..."
    if ! git -C "$SOURCE_DIR" apply --3way "$PATCH_FILE"; then
        fail "Patch apply failed (conflict). Rebase your fork or adjust patch context."
    fi

    log "Patch applied successfully."
    log "Next: build/install (e.g. ./scripts/custom/agh-custom-manager.sh apply)"
}

main "$@"
