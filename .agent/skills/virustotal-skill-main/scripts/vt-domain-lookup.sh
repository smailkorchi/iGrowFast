#!/bin/bash
# vt-domain-lookup.sh - Look up a domain in VirusTotal

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <domain> [apikey]"
    exit 1
fi

DOMAIN="$1"
APIKEY="${2:-${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}}"

if [ -z "$APIKEY" ]; then
    echo "Error: API key required"
    exit 1
fi

RESPONSE=$(curl -s -H "x-apikey: $APIKEY" \
    "https://www.virustotal.com/api/v3/domains/$DOMAIN")

if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Error:"
    echo "$RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$RESPONSE"
    exit 1
fi

echo "$RESPONSE" | jq -r '
  "=== DOMAIN REPORT ===",
  "Domain: " + .data.id,
  "Registrar: " + (.data.attributes.registrar // "N/A"),
  "Creation: " + (if .data.attributes.creation_date then (.data.attributes.creation_date | strftime("%Y-%m-%d")) else "N/A" end),
  "Reputation: " + (.data.attributes.reputation | tostring),
  "JARM: " + (.data.attributes.jarm // "N/A")[0:40] + "...",
  "",
  "=== DETECTION ===",
  "Malicious: " + (.data.attributes.last_analysis_stats.malicious | tostring),
  "Suspicious: " + (.data.attributes.last_analysis_stats.suspicious | tostring),
  "Harmless: " + (.data.attributes.last_analysis_stats.harmless | tostring),
  "Undetected: " + (.data.attributes.last_analysis_stats.undetected | tostring),
  "",
  "=== CATEGORIES ===",
  (.data.attributes.categories // {} | to_entries | map("  " + .key + ": " + .value) | join("\n")),
  "",
  "=== DNS RECORDS ===",
  (.data.attributes.last_dns_records // [] | map("  " + .type + ": " + .value) | join("\n")),
  "",
  "=== POPULARITY ===",
  (.data.attributes.popularity_ranks // {} | to_entries | map("  " + .key + ": #" + (.value.rank | tostring)) | join("\n"))
'
