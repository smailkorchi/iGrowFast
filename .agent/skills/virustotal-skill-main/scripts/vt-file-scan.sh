#!/bin/bash
# vt-file-scan.sh - Upload and scan a file

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <file_path> [apikey]"
    exit 1
fi

FILEPATH="$1"
APIKEY="${2:-${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}}"

if [ -z "$APIKEY" ]; then
    echo "Error: API key required"
    exit 1
fi

if [ ! -f "$FILEPATH" ]; then
    echo "Error: File not found: $FILEPATH"
    exit 1
fi

FILESIZE=$(stat -f%z "$FILEPATH" 2>/dev/null || stat -c%s "$FILEPATH" 2>/dev/null || echo "0")

# Check if file is larger than 32MB (33554432 bytes)
if [ "$FILESIZE" -gt 33554432 ]; then
    echo "File > 32MB, getting upload URL..."
    UPLOAD_URL=$(curl -s -H "x-apikey: $APIKEY" \
        "https://www.virustotal.com/api/v3/files/upload_url" | jq -r '.data')
    echo "Uploading to: $UPLOAD_URL"
    RESPONSE=$(curl -s -X POST -H "x-apikey: $APIKEY" \
        -F "file=@$FILEPATH" "$UPLOAD_URL")
else
    echo "Uploading file (< 32MB)..."
    RESPONSE=$(curl -s -X POST -H "x-apikey: $APIKEY" \
        -F "file=@$FILEPATH" \
        "https://www.virustotal.com/api/v3/files")
fi

# Check for errors
if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Error:"
    echo "$RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$RESPONSE"
    exit 1
fi

ANALYSIS_ID=$(echo "$RESPONSE" | jq -r '.data.id')
echo "File submitted successfully!"
echo "Analysis ID: $ANALYSIS_ID"
echo ""
echo "Check status with:"
echo "  curl -H 'x-apikey: $APIKEY' https://www.virustotal.com/api/v3/analyses/$ANALYSIS_ID"
