#!/bin/bash
# vt-url-scan.sh - Submit a URL for scanning

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

RESPONSE=$(curl -s -X POST -H "x-apikey: $APIKEY" \
    --form "url=$URL" \
    "https://www.virustotal.com/api/v3/urls")

# Check for errors
if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Error:"
    echo "$RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$RESPONSE"
    exit 1
fi

ANALYSIS_ID=$(echo "$RESPONSE" | jq -r '.data.id')
echo "URL submitted successfully!"
echo "Analysis ID: $ANALYSIS_ID"
echo ""
echo "Check status with:"
echo "  curl -H 'x-apikey: $APIKEY' https://www.virustotal.com/api/v3/analyses/$ANALYSIS_ID"
