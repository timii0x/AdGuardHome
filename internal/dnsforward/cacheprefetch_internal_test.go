package dnsforward

import (
	"testing"
	"time"

	"github.com/miekg/dns"
	"github.com/stretchr/testify/assert"
)

func TestTTLFromResponse(t *testing.T) {
	const host = "example.org."

	resp := &dns.Msg{
		Answer: []dns.RR{
			&dns.CNAME{
				Hdr: dns.RR_Header{
					Name:   host,
					Rrtype: dns.TypeCNAME,
					Class:  dns.ClassINET,
					Ttl:    300,
				},
			},
			&dns.A{
				Hdr: dns.RR_Header{
					Name:   host,
					Rrtype: dns.TypeA,
					Class:  dns.ClassINET,
					Ttl:    120,
				},
			},
			&dns.A{
				Hdr: dns.RR_Header{
					Name:   host,
					Rrtype: dns.TypeA,
					Class:  dns.ClassINET,
					Ttl:    60,
				},
			},
		},
	}

	assert.Equal(t, time.Minute, ttlFromResponse(resp, dns.TypeA))
	assert.Zero(t, ttlFromResponse(resp, dns.TypeAAAA))
}

func TestPrefetchHostStats_SetTTLRefreshSchedule(t *testing.T) {
	now := time.Date(2026, 3, 22, 12, 0, 0, 0, time.UTC)
	st := &prefetchHostStats{}

	st.setTTLRefreshSchedule(now, 100*time.Second)
	assert.Equal(t, now.Add(90*time.Second), st.nextPrefetch)

	// Keep the earlier schedule if a later deadline is calculated before the
	// currently planned refresh moment.
	st.setTTLRefreshSchedule(now.Add(10*time.Second), 90*time.Second)
	assert.Equal(t, now.Add(90*time.Second), st.nextPrefetch)
}

func TestCollectPrefetchTargets_RespectsNextPrefetch(t *testing.T) {
	now := time.Date(2026, 3, 22, 12, 0, 0, 0, time.UTC)
	s := &Server{
		prefetchHosts: map[string]*prefetchHostStats{
			"example.org": {
				lastSeen:     now,
				nextPrefetch: now.Add(30 * time.Second),
				hourStart:    now.Truncate(time.Hour),
				hitsInHour:   1,
				wantA:        true,
			},
		},
	}

	targets := s.collectPrefetchTargets(now, cacheOptimisticPrefetchModeAll, 1)
	assert.Empty(t, targets)

	targets = s.collectPrefetchTargets(now.Add(31*time.Second), cacheOptimisticPrefetchModeAll, 1)
	assert.Len(t, targets, 1)
	assert.Equal(t, "example.org", targets[0].host)
	assert.True(t, targets[0].wantA)
}
