#!/bin/bash
# vt-ip-lookup.sh - Look up an IP address in VirusTotal

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <ip> [apikey]"
    exit 1
fi

IP="$1"
APIKEY="${2:-${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}}"

if [ -z "$APIKEY" ]; then
    echo "Error: API key required"
    exit 1
fi

RESPONSE=$(curl -s -H "x-apikey: $APIKEY" \
    "https://www.virustotal.com/api/v3/ip_addresses/$IP")

if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Error:"
    echo "$RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$RESPONSE"
    exit 1
fi

echo "$RESPONSE" | jq -r '
  "=== IP REPORT ===",
  "IP: " + .data.id,
  "Country: " + (.data.attributes.country // "N/A"),
  "Continent: " + (.data.attributes.continent // "N/A"),
  "ASN: " + (.data.attributes.asn | tostring),
  "AS Owner: " + (.data.attributes.as_owner // "N/A"),
  "Network: " + (.data.attributes.network // "N/A"),
  "RIR: " + (.data.attributes.regional_internet_registry // "N/A"),
  "Reputation: " + (.data.attributes.reputation | tostring),
  "JARM: " + (.data.attributes.jarm // "N/A")[0:40] + "...",
  "",
  "=== DETECTION ===",
  "Malicious: " + (.data.attributes.last_analysis_stats.malicious | tostring),
  "Suspicious: " + (.data.attributes.last_analysis_stats.suspicious | tostring),
  "Harmless: " + (.data.attributes.last_analysis_stats.harmless | tostring),
  "Undetected: " + (.data.attributes.last_analysis_stats.undetected | tostring),
  "",
  "=== VOTES ===",
  "Community Harmless: " + (.data.attributes.total_votes.harmless | tostring),
  "Community Malicious: " + (.data.attributes.total_votes.malicious | tostring)
'
