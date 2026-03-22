#!/bin/bash
# vt-url-lookup.sh - Look up a URL in VirusTotal

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <url> [apikey]"
    exit 1
fi

URL="$1"
APIKEY="${2:-${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}}"

if [ -z "$APIKEY" ]; then
    echo "Error: API key required"
    exit 1
fi

# Generate URL ID (SHA256 of URL)
URL_ID=$(echo -n "$URL" | sha256sum | cut -d' ' -f1)

RESPONSE=$(curl -s -H "x-apikey: $APIKEY" \
    "https://www.virustotal.com/api/v3/urls/$URL_ID")

# Check for errors
if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Error:"
    echo "$RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$RESPONSE"
    echo ""
    echo "URL may not be in database. Try scanning it first with vt-url-scan.sh"
    exit 1
fi

echo "$RESPONSE" | jq -r '
  "=== URL REPORT ===",
  "URL: " + .data.attributes.url,
  "Final URL: " + (.data.attributes.last_final_url // "N/A"),
  "Title: " + (.data.attributes.title // "N/A"),
  "HTTP Code: " + (.data.attributes.last_http_response_code | tostring),
  "Reputation: " + (.data.attributes.reputation | tostring),
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
  "=== TOP DETECTIONS ===",
  (.data.attributes.last_analysis_results | to_entries | 
   map(select(.value.category == "malicious" or .value.category == "suspicious")) |
   sort_by(.value.result) | .[:10] |
   map("  " + .key + ": " + (.value.result // "unknown")) | join("\n"))
'
