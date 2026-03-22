#!/bin/sh

# Apply only the "refresh at 10% before TTL expiry" logic for optimistic
# prefetch.  No other custom features are changed.
#
# Usage:
#   ./scripts/custom/apply-ttl10-refresh-only.sh [AGH_SOURCE_DIR]
#
# Example:
#   ./scripts/custom/apply-ttl10-refresh-only.sh /root/AdGuardHome

set -eu

SOURCE_DIR="${1:-$(pwd)}"
ALLOW_DIRTY="${AGH_PATCH_ALLOW_DIRTY:-0}"

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

is_applied() {
    grep -q 'defaultPrefetchTTLRefreshPercent' "$SOURCE_DIR/internal/dnsforward/cacheprefetch.go" &&
        grep -q 'recordOptimisticPrefetchHitLocked(host, qt, pctx.Res)' "$SOURCE_DIR/internal/dnsforward/stats.go"
}

main() {
    require_cmd git
    require_cmd mktemp

    [ -d "$SOURCE_DIR/.git" ] || fail "Not a git repository: $SOURCE_DIR"
    [ -f "$SOURCE_DIR/internal/dnsforward/cacheprefetch.go" ] || fail "Missing file: internal/dnsforward/cacheprefetch.go"
    [ -f "$SOURCE_DIR/internal/dnsforward/stats.go" ] || fail "Missing file: internal/dnsforward/stats.go"

    if [ -n "$(git -C "$SOURCE_DIR" status --porcelain --untracked-files=no 2>/dev/null || true)" ] &&
        [ "$ALLOW_DIRTY" != "1" ]; then
        fail "Working tree not clean. Commit/stash first or run with AGH_PATCH_ALLOW_DIRTY=1."
    fi

    if is_applied; then
        log "TTL 10% refresh patch is already applied."
        exit 0
    fi

    tmp_patch="$(mktemp)"
    trap 'rm -f "$tmp_patch"' EXIT

    cat >"$tmp_patch" <<'PATCH'
diff --git a/internal/dnsforward/cacheprefetch.go b/internal/dnsforward/cacheprefetch.go
index f2c1e067..4820ae5d 100644
--- a/internal/dnsforward/cacheprefetch.go
+++ b/internal/dnsforward/cacheprefetch.go
@@ -22,6 +22,7 @@ const (
 )
 
 const defaultPrefetchKeepDays uint32 = 5
+const defaultPrefetchTTLRefreshPercent uint32 = 10
 
 func isValidPrefetchKeepDays(days uint32) (ok bool) {
 	switch days {
@@ -64,6 +65,7 @@ func isValidPrefetchMode(mode cacheOptimisticPrefetchMode) (ok bool) {
 type prefetchHostStats struct {
 	lastSeen     time.Time
 	lastPrefetch time.Time
+	nextPrefetch time.Time
 	hourStart    time.Time
 	hitsInHour   uint32
 	wantA        bool
@@ -182,6 +184,10 @@ func (s *Server) collectPrefetchTargets(
 			continue
 		}
 
+		if !stats.nextPrefetch.IsZero() && now.Before(stats.nextPrefetch) {
+			continue
+		}
+
 		if !stats.isEligible(mode, hourStart) {
 			continue
 		}
@@ -234,6 +240,8 @@ func (s *Server) prefetchResolve(ctx context.Context, prx *proxy.Proxy, host str
 			err,
 		)
 	}
+
+	s.updateOptimisticPrefetchTTL(host, qtype, pctx.Res, time.Now())
 }
 
 func (st *prefetchHostStats) isEligible(
@@ -254,7 +262,7 @@ func (st *prefetchHostStats) isEligible(
 
 // recordOptimisticPrefetchHitLocked records a domain hit for threshold-based
 // optimistic prefetching.  s.serverLock is expected to be locked.
-func (s *Server) recordOptimisticPrefetchHitLocked(host string, qtype uint16) {
+func (s *Server) recordOptimisticPrefetchHitLocked(host string, qtype uint16, resp *dns.Msg) {
 	mode := normalizePrefetchMode(s.conf.CacheOptimisticPrefetchMode)
 	if !s.conf.CacheEnabled || !s.conf.CacheOptimistic || mode == cacheOptimisticPrefetchModeDisabled {
 		return
@@ -296,6 +304,86 @@ func (s *Server) recordOptimisticPrefetchHitLocked(host string, qtype uint16) {
 	st.lastSeen = now
 	st.wantA = st.wantA || qtype == dns.TypeA
 	st.wantAAAA = st.wantAAAA || qtype == dns.TypeAAAA
+	st.setTTLRefreshSchedule(now, ttlFromResponse(resp, qtype))
+}
+
+// updateOptimisticPrefetchTTL updates cached TTL schedule for prefetch entries.
+// It's used to keep background prefetch cadence aligned with current response
+// TTL values.
+func (s *Server) updateOptimisticPrefetchTTL(
+	host string,
+	qtype uint16,
+	resp *dns.Msg,
+	now time.Time,
+) {
+	if host == "" {
+		return
+	}
+
+	switch qtype {
+	case dns.TypeA, dns.TypeAAAA:
+	default:
+		return
+	}
+
+	ttl := ttlFromResponse(resp, qtype)
+	if ttl <= 0 {
+		return
+	}
+
+	s.prefetchLock.Lock()
+	defer s.prefetchLock.Unlock()
+
+	st, ok := s.prefetchHosts[host]
+	if !ok {
+		return
+	}
+
+	st.setTTLRefreshSchedule(now, ttl)
+}
+
+func (st *prefetchHostStats) setTTLRefreshSchedule(now time.Time, ttl time.Duration) {
+	if ttl <= 0 {
+		return
+	}
+
+	refreshWindow := ttl * time.Duration(defaultPrefetchTTLRefreshPercent) / 100
+	if refreshWindow == 0 && ttl > time.Second {
+		refreshWindow = time.Second
+	}
+
+	next := now.Add(ttl - refreshWindow)
+	if !st.nextPrefetch.IsZero() && now.Before(st.nextPrefetch) && next.After(st.nextPrefetch) {
+		return
+	}
+
+	st.nextPrefetch = next
+}
+
+func ttlFromResponse(resp *dns.Msg, qtype uint16) (ttl time.Duration) {
+	if resp == nil {
+		return 0
+	}
+
+	found := false
+	var ttlSec uint32
+	for _, rr := range resp.Answer {
+		hdr := rr.Header()
+		if hdr == nil || hdr.Rrtype != qtype {
+			continue
+		}
+
+		if !found || hdr.Ttl < ttlSec {
+			found = true
+			ttlSec = hdr.Ttl
+		}
+	}
+
+	if !found {
+		return 0
+	}
+
+	return time.Duration(ttlSec) * time.Second
 }
 
 func (req *jsonDNSConfig) checkCachePrefetchMode() (err error) {
diff --git a/internal/dnsforward/stats.go b/internal/dnsforward/stats.go
index 700be41b..a78ba6ac 100644
--- a/internal/dnsforward/stats.go
+++ b/internal/dnsforward/stats.go
@@ -44,7 +44,7 @@ func (s *Server) processQueryLogsAndStats(ctx context.Context, dctx *dnsContext)
 	s.serverLock.RLock()
 	defer s.serverLock.RUnlock()
 
-	s.recordOptimisticPrefetchHitLocked(host, qt)
+	s.recordOptimisticPrefetchHitLocked(host, qt, pctx.Res)
 
 	if s.shouldLog(host, qt, cl, ids) {
 		s.logQuery(dctx, ip, processingTime)
PATCH

    log "Applying TTL 10% refresh patch ..."
    if ! git -C "$SOURCE_DIR" apply --3way "$tmp_patch"; then
        fail "Patch apply failed (likely upstream code changed)."
    fi

    if is_applied; then
        log "Patch applied successfully."
        log "Now build/install AGH as usual."
        exit 0
    fi

    fail "Patch command finished, but verification failed."
}

main "$@"
