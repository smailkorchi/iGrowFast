#!/bin/bash
# vt-file-download.sh - Download a file from VirusTotal (Premium/Enterprise)

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <hash> [output_path] [apikey]"
    echo ""
    echo "Download a file from VirusTotal by hash."
    echo "Requires premium/enterprise privileges with download access."
    echo ""
    echo "Example:"
    echo "  $0 d41d8cd98f00b204e9800998ecf8427e /tmp/malware.bin"
    exit 1
fi

HASH="$1"
OUTPUT="${2:-$HASH.bin}"
APIKEY="${3:-${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}}"

if [ -z "$APIKEY" ]; then
    echo "Error: API key required"
    exit 1
fi

echo "Getting download URL for $HASH..."

# Get download URL
RESPONSE=$(curl -s -H "x-apikey: $APIKEY" \
    "https://www.virustotal.com/api/v3/files/$HASH/download_url")

if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Error:"
    echo "$RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$RESPONSE"
    echo ""
    echo "Note: File download requires premium/enterprise privileges."
    exit 1
fi

DOWNLOAD_URL=$(echo "$RESPONSE" | jq -r '.data')

echo "Downloading to: $OUTPUT"
curl -s -L "$DOWNLOAD_URL" -o "$OUTPUT"

echo "Download complete: $OUTPUT"
ls -lh "$OUTPUT"
