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
	prefetchKeepFor      = 5 * 24 * time.Hour
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
	mode, prx, canRun := s.prefetchRuntime()
	if !canRun {
		return
	}

	targets := s.collectPrefetchTargets(now, mode)
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
	prx *proxy.Proxy,
	canRun bool,
) {
	s.serverLock.RLock()
	defer s.serverLock.RUnlock()

	mode = normalizePrefetchMode(s.conf.CacheOptimisticPrefetchMode)
	if !s.isRunning || !s.conf.CacheEnabled || !s.conf.CacheOptimistic || mode == cacheOptimisticPrefetchModeDisabled {
		return cacheOptimisticPrefetchModeDisabled, nil, false
	}

	return mode, s.dnsProxy, s.dnsProxy != nil
}

func (s *Server) collectPrefetchTargets(
	now time.Time,
	mode cacheOptimisticPrefetchMode,
) (targets []prefetchTarget) {
	hourStart := now.Truncate(time.Hour)

	s.prefetchLock.Lock()
	defer s.prefetchLock.Unlock()

	targets = make([]prefetchTarget, 0, prefetchMaxPerTick)
	for host, stats := range s.prefetchHosts {
		if now.Sub(stats.lastSeen) > prefetchKeepFor {
			delete(s.prefetchHosts, host)

			continue
		}

		if now.Sub(stats.lastPrefetch) < prefetchCooldown {
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
func (s *Server) recordOptimisticPrefetchHitLocked(host string, qtype uint16) {
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
