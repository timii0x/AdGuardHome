#!/usr/bin/env bash

set -euo pipefail

DOMAIN="${1:-time.cloudflare.com}"
AGH_DNS="${AGH_DNS:-127.0.0.1}"
UPSTREAM_IP="${UPSTREAM_IP:-1.1.1.1}"
IFACE="${IFACE:-any}"
CAPTURE_WINDOW="${CAPTURE_WINDOW:-30}"
LEAD_SECONDS="${LEAD_SECONDS:-5}"

for cmd in dig tcpdump timeout awk grep; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "ERROR: Missing required command: ${cmd}"
        exit 1
    fi
done

FQDN="${DOMAIN%.}."

echo "== Prefetch 10% TTL test =="
echo "Domain:        ${FQDN}"
echo "AGH DNS:       ${AGH_DNS}"
echo "Upstream IP:   ${UPSTREAM_IP}"
echo "Interface:     ${IFACE}"
echo

echo "[1/5] Warming cache (A and AAAA)..."
dig @"${AGH_DNS}" "${FQDN}" A +noall +answer >/dev/null
dig @"${AGH_DNS}" "${FQDN}" AAAA +noall +answer >/dev/null || true

echo "[2/5] Reading current TTL from AGH response..."
TTL="$(dig @"${AGH_DNS}" "${FQDN}" A +noall +answer | awk 'NR==1{print $2}')"
if [[ -z "${TTL}" || ! "${TTL}" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Could not read numeric TTL for ${FQDN}"
    echo "Hint: try another domain with valid A record."
    exit 1
fi

MARGIN="$(( TTL / 10 ))"
if (( MARGIN < 1 )); then
    MARGIN=1
fi

PREFETCH_AT="$(( TTL - MARGIN ))"
SLEEP_FOR="$(( PREFETCH_AT - LEAD_SECONDS ))"
if (( SLEEP_FOR < 0 )); then
    SLEEP_FOR=0
fi

echo "TTL=${TTL}s, expected prefetch around t+${PREFETCH_AT}s (10% before expiry)."
echo "[3/5] Sleeping ${SLEEP_FOR}s to approach prefetch moment..."
sleep "${SLEEP_FOR}"

TMP_LOG="$(mktemp)"
trap 'rm -f "${TMP_LOG}"' EXIT

echo "[4/5] Capturing outbound DNS packets for up to ${CAPTURE_WINDOW}s..."
echo "     (Do not query ${FQDN} manually during this window.)"

set +e
timeout "${CAPTURE_WINDOW}" tcpdump -l -ni "${IFACE}" "udp dst port 53 and host ${UPSTREAM_IP}" 2>/dev/null \
    | tee "${TMP_LOG}" \
    | grep -m1 -F "? ${FQDN}" >/dev/null
RC=$?
set -e

echo "[5/5] Result:"
if [[ "${RC}" -eq 0 ]]; then
    echo "PASS: Detected background upstream query for ${FQDN} before TTL expiry."
    echo "      10% pre-expiry refresh is active."
else
    echo "FAIL: No matching background query seen in capture window."
    echo "Possible reasons:"
    echo " - Upstream is DoH/DoT/DoQ (encrypted), so UDP/53 capture cannot see it."
    echo " - Different upstream IP than UPSTREAM_IP=${UPSTREAM_IP}."
    echo " - Domain TTL too long / low traffic / test window too short."
    echo " - Optimistic cache + prefetch mode not enabled."
    echo
    echo "Captured packets (debug):"
    sed -n '1,20p' "${TMP_LOG}" || true
    exit 2
fi
