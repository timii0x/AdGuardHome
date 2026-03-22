package dnsforward

import (
	"context"
	"fmt"
	"time"

	"github.com/AdguardTeam/dnsproxy/proxy"
	"github.com/AdguardTeam/golibs/logutil/slogutil"
	"github.com/miekg/dns"
)

// cacheOptimisticPrefetchMode defines the host-selection strategy for
// optimistic cache prefetching.
type cacheOptimisticPrefetchMode string

const (
	cacheOptimisticPrefetchModeDisabled cacheOptimisticPrefetchMode = "disabled"
	cacheOptimisticPrefetchModeAll      cacheOptimisticPrefetchMode = "all"
	cacheOptimisticPrefetchModeHits2    cacheOptimisticPrefetchMode = "hits_2_per_hour"
	cacheOptimisticPrefetchModeHits5    cacheOptimisticPrefetchMode = "hits_5_per_hour"
)

const defaultPrefetchKeepDays uint32 = 5
const defaultPrefetchTTLRefreshPercent uint32 = 10

func isValidPrefetchKeepDays(days uint32) (ok bool) {
	switch days {
	case 1, 3, 5, 7, 14:
		return true
	default:
		return false
	}
}

func normalizePrefetchKeepDays(days uint32) (normalized uint32) {
	if isValidPrefetchKeepDays(days) {
		return days
	}

	return defaultPrefetchKeepDays
}

func normalizePrefetchMode(mode cacheOptimisticPrefetchMode) (normalized cacheOptimisticPrefetchMode) {
	if mode == "" {
		return cacheOptimisticPrefetchModeDisabled
	}

	return mode
}

func isValidPrefetchMode(mode cacheOptimisticPrefetchMode) (ok bool) {
	switch normalizePrefetchMode(mode) {
	case
		cacheOptimisticPrefetchModeDisabled,
		cacheOptimisticPrefetchModeAll,
		cacheOptimisticPrefetchModeHits2,
		cacheOptimisticPrefetchModeHits5:
		return true
	default:
		return false
	}
}

type prefetchHostStats struct {
	lastSeen     time.Time
	lastPrefetch time.Time
	nextPrefetch time.Time
	hourStart    time.Time
	hitsInHour   uint32
	wantA        bool
	wantAAAA     bool
}

type prefetchTarget struct {
	host     string
	wantA    bool
	wantAAAA bool
}

const (
	prefetchTickInterval = time.Minute
	prefetchCooldown     = 10 * time.Minute
	prefetchMaxPerTick   = 256
	prefetchMaxTracked   = 100_000
	prefetchReqTimeout   = 3 * time.Second
)

// startOptimisticPrefetchLocked starts the background prefetch loop if needed.
// s.serverLock is expected to be locked.
func (s *Server) startOptimisticPrefetchLocked() {
	if s.prefetchCancel != nil {
		return
	}

	loopCtx, cancel := context.WithCancel(context.Background())
	s.prefetchCancel = cancel

	go s.runOptimisticPrefetchLoop(loopCtx)
}

// stopOptimisticPrefetchLocked stops the background prefetch loop.
// s.serverLock is expected to be locked.
func (s *Server) stopOptimisticPrefetchLocked() {
	if s.prefetchCancel == nil {
		return
	}

	s.prefetchCancel()
	s.prefetchCancel = nil
}

func (s *Server) runOptimisticPrefetchLoop(ctx context.Context) {
	t := time.NewTicker(prefetchTickInterval)
	defer t.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			s.runOptimisticPrefetchTick(ctx, now)
		}
	}
}

func (s *Server) runOptimisticPrefetchTick(ctx context.Context, now time.Time) {
	mode, keepDays, prx, canRun := s.prefetchRuntime()
	if !canRun {
		return
	}

	targets := s.collectPrefetchTargets(now, mode, keepDays)
	for _, target := range targets {
		if target.wantA {
			s.prefetchResolve(ctx, prx, target.host, dns.TypeA)
		}

		if target.wantAAAA {
			s.prefetchResolve(ctx, prx, target.host, dns.TypeAAAA)
		}
	}
}

// prefetchRuntime returns the current prefetch mode and proxy.
func (s *Server) prefetchRuntime() (
	mode cacheOptimisticPrefetchMode,
	keepDays uint32,
	prx *proxy.Proxy,
	canRun bool,
) {
	s.serverLock.RLock()
	defer s.serverLock.RUnlock()

	mode = normalizePrefetchMode(s.conf.CacheOptimisticPrefetchMode)
	keepDays = normalizePrefetchKeepDays(s.conf.CacheOptimisticPrefetchKeepDays)
	if !s.isRunning || !s.conf.CacheEnabled || !s.conf.CacheOptimistic || mode == cacheOptimisticPrefetchModeDisabled {
		return cacheOptimisticPrefetchModeDisabled, 0, nil, false
	}

	return mode, keepDays, s.dnsProxy, s.dnsProxy != nil
}

func (s *Server) collectPrefetchTargets(
	now time.Time,
	mode cacheOptimisticPrefetchMode,
	keepDays uint32,
) (targets []prefetchTarget) {
	hourStart := now.Truncate(time.Hour)
	keepFor := time.Duration(keepDays) * 24 * time.Hour

	s.prefetchLock.Lock()
	defer s.prefetchLock.Unlock()

	targets = make([]prefetchTarget, 0, prefetchMaxPerTick)
	for host, stats := range s.prefetchHosts {
		if now.Sub(stats.lastSeen) > keepFor {
			delete(s.prefetchHosts, host)

			continue
		}

		if now.Sub(stats.lastPrefetch) < prefetchCooldown {
			continue
		}

		if !stats.nextPrefetch.IsZero() && now.Before(stats.nextPrefetch) {
			continue
		}

		if !stats.isEligible(mode, hourStart) {
			continue
		}

		stats.lastPrefetch = now
		targets = append(targets, prefetchTarget{
			host:     host,
			wantA:    stats.wantA,
			wantAAAA: stats.wantAAAA,
		})
		if len(targets) >= prefetchMaxPerTick {
			break
		}
	}

	return targets
}

func (s *Server) prefetchResolve(ctx context.Context, prx *proxy.Proxy, host string, qtype uint16) {
	hostFQDN := dns.Fqdn(host)
	req := &dns.Msg{
		MsgHdr: dns.MsgHdr{
			Id:               dns.Id(),
			RecursionDesired: true,
		},
		Question: []dns.Question{{
			Name:   hostFQDN,
			Qtype:  qtype,
			Qclass: dns.ClassINET,
		}},
	}
	pctx := &proxy.DNSContext{
		Proto: proxy.ProtoUDP,
		Req:   req,
	}

	reqCtx, cancel := context.WithTimeout(ctx, prefetchReqTimeout)
	defer cancel()

	err := prx.Resolve(reqCtx, pctx)
	if err != nil {
		s.logger.DebugContext(
			ctx,
			"optimistic cache prefetch failed",
			"host",
			host,
			"qtype",
			dns.Type(qtype).String(),
			slogutil.KeyError,
			err,
		)
	}

	s.updateOptimisticPrefetchTTL(host, qtype, pctx.Res, time.Now())
}

func (st *prefetchHostStats) isEligible(
	mode cacheOptimisticPrefetchMode,
	hourStart time.Time,
) (ok bool) {
	switch mode {
	case cacheOptimisticPrefetchModeAll:
		return true
	case cacheOptimisticPrefetchModeHits2:
		return st.hourStart.Equal(hourStart) && st.hitsInHour >= 2
	case cacheOptimisticPrefetchModeHits5:
		return st.hourStart.Equal(hourStart) && st.hitsInHour >= 5
	default:
		return false
	}
}

// recordOptimisticPrefetchHitLocked records a domain hit for threshold-based
// optimistic prefetching.  s.serverLock is expected to be locked.
func (s *Server) recordOptimisticPrefetchHitLocked(host string, qtype uint16, resp *dns.Msg) {
	mode := normalizePrefetchMode(s.conf.CacheOptimisticPrefetchMode)
	if !s.conf.CacheEnabled || !s.conf.CacheOptimistic || mode == cacheOptimisticPrefetchModeDisabled {
		return
	}
	if host == "" {
		return
	}

	switch qtype {
	case dns.TypeA, dns.TypeAAAA:
	default:
		return
	}

	now := time.Now()
	hourStart := now.Truncate(time.Hour)

	s.prefetchLock.Lock()
	defer s.prefetchLock.Unlock()

	st, ok := s.prefetchHosts[host]
	if !ok {
		if len(s.prefetchHosts) >= prefetchMaxTracked {
			return
		}

		st = &prefetchHostStats{
			hourStart: hourStart,
		}
		s.prefetchHosts[host] = st
	}

	if !st.hourStart.Equal(hourStart) {
		st.hourStart = hourStart
		st.hitsInHour = 0
	}

	st.hitsInHour++
	st.lastSeen = now
	st.wantA = st.wantA || qtype == dns.TypeA
	st.wantAAAA = st.wantAAAA || qtype == dns.TypeAAAA
	st.setTTLRefreshSchedule(now, ttlFromResponse(resp, qtype))
}

// updateOptimisticPrefetchTTL updates cached TTL schedule for prefetch entries.
// It's used to keep background prefetch cadence aligned with current response
// TTL values.
func (s *Server) updateOptimisticPrefetchTTL(
	host string,
	qtype uint16,
	resp *dns.Msg,
	now time.Time,
) {
	if host == "" {
		return
	}

	switch qtype {
	case dns.TypeA, dns.TypeAAAA:
	default:
		return
	}

	ttl := ttlFromResponse(resp, qtype)
	if ttl <= 0 {
		return
	}

	s.prefetchLock.Lock()
	defer s.prefetchLock.Unlock()

	st, ok := s.prefetchHosts[host]
	if !ok {
		return
	}

	st.setTTLRefreshSchedule(now, ttl)
}

func (st *prefetchHostStats) setTTLRefreshSchedule(now time.Time, ttl time.Duration) {
	if ttl <= 0 {
		return
	}

	refreshWindow := ttl * time.Duration(defaultPrefetchTTLRefreshPercent) / 100
	if refreshWindow == 0 && ttl > time.Second {
		refreshWindow = time.Second
	}

	next := now.Add(ttl - refreshWindow)
	if !st.nextPrefetch.IsZero() && now.Before(st.nextPrefetch) && next.After(st.nextPrefetch) {
		return
	}

	st.nextPrefetch = next
}

func ttlFromResponse(resp *dns.Msg, qtype uint16) (ttl time.Duration) {
	if resp == nil {
		return 0
	}

	found := false
	var ttlSec uint32
	for _, rr := range resp.Answer {
		hdr := rr.Header()
		if hdr == nil || hdr.Rrtype != qtype {
			continue
		}

		if !found || hdr.Ttl < ttlSec {
			found = true
			ttlSec = hdr.Ttl
		}
	}

	if !found {
		return 0
	}

	return time.Duration(ttlSec) * time.Second
}

func (req *jsonDNSConfig) checkCachePrefetchMode() (err error) {
	if req.CacheOptimisticPrefetchMode == nil {
		return nil
	}

	mode := *req.CacheOptimisticPrefetchMode
	if !isValidPrefetchMode(mode) {
		return fmt.Errorf("cache_optimistic_prefetch_mode: incorrect value %q", mode)
	}

	return nil
}

func (req *jsonDNSConfig) checkCachePrefetchKeepDays() (err error) {
	if req.CacheOptimisticPrefetchKeepDays == nil {
		return nil
	}

	days := *req.CacheOptimisticPrefetchKeepDays
	if !isValidPrefetchKeepDays(days) {
		return fmt.Errorf(
			"cache_optimistic_prefetch_keep_days: incorrect value %d (supported: 1,3,5,7,14)",
			days,
		)
	}

	return nil
}
