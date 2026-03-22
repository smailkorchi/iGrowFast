#!/bin/bash
# vt-file-lookup.sh - Look up a file by hash in VirusTotal

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <hash> [apikey]"
    echo "  hash: MD5, SHA1, or SHA256 hash"
    exit 1
fi

HASH="$1"
APIKEY="${2:-${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}}"

if [ -z "$APIKEY" ]; then
    echo "Error: API key required. Set VT_API_KEY or ~/.virustotal/apikey"
    exit 1
fi

RESPONSE=$(curl -s -H "x-apikey: $APIKEY" \
    "https://www.virustotal.com/api/v3/files/$HASH")

# Check for errors
if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Error:"
    echo "$RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$RESPONSE"
    exit 1
fi

# Pretty print key info
echo "$RESPONSE" | jq -r '
  "=== FILE REPORT ===",
  "Hash: " + .data.id,
  "Size: " + (.data.attributes.size | tostring) + " bytes",
  "Type: " + (.data.attributes.type_description // "unknown"),
  "First seen: " + (.data.attributes.first_submission_date | strftime("%Y-%m-%d %H:%M:%S")),
  "",
  "=== DETECTION ===",
  "Malicious: " + (.data.attributes.last_analysis_stats.malicious | tostring),
  "Suspicious: " + (.data.attributes.last_analysis_stats.suspicious | tostring),
  "Harmless: " + (.data.attributes.last_analysis_stats.harmless | tostring),
  "Undetected: " + (.data.attributes.last_analysis_stats.undetected | tostring),
  "",
  "=== TOP DETECTIONS ===",
  (.data.attributes.last_analysis_results | to_entries | 
   map(select(.value.category == "malicious" or .value.category == "suspicious")) |
   sort_by(.value.result) | .[:10] |
   map("  " + .key + ": " + (.value.result // "unknown")) | join("\n"))
'
