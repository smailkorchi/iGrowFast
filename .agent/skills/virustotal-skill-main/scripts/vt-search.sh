#!/bin/bash
# vt-search.sh - Search VirusTotal Intelligence (Premium)

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <query> [limit] [apikey]"
    echo ""
    echo "Examples:"
    echo "  $0 'type:peexe positives:10+'"
    echo "  $0 'content:\"malicious string\"' 20"
    echo "  $0 'tag:ransomware first_submission_date:7d-'"
    exit 1
fi

QUERY="$1"
LIMIT="${2:-10}"
APIKEY="${3:-${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}}"

if [ -z "$APIKEY" ]; then
    echo "Error: API key required"
    exit 1
fi

# URL encode the query
ENCODED_QUERY=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$QUERY'''))")

RESPONSE=$(curl -s -H "x-apikey: $APIKEY" \
    "https://www.virustotal.com/api/v3/intelligence/search?query=$ENCODED_QUERY&limit=$LIMIT")

if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Error:"
    echo "$RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$RESPONSE"
    exit 1
fi

echo "=== SEARCH RESULTS ==="
echo "Query: $QUERY"
echo ""

echo "$RESPONSE" | jq -r '
  if .data then
    (.data | length | tostring) + " results found",
    "",
    (.data[] |
      "---",
      "ID: " + .id,
      "Type: " + .type,
      if .context_attributes then
        "Match confidence: " + (.context_attributes.confidence // "N/A" | tostring)
      else empty end
    )
  else
    "No results"
  end
'

# Check for pagination
CURSOR=$(echo "$RESPONSE" | jq -r '.meta.cursor // empty')
if [ -n "$CURSOR" ]; then
    echo ""
    echo "More results available. Use cursor for pagination:"
    echo "  cursor=$CURSOR"
fi
