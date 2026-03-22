#!/bin/bash
# vt-relationships.sh - Get relationships for an object

set -e

if [ $# -lt 3 ]; then
    echo "Usage: $0 <type> <id> <relationship> [limit] [apikey]"
    echo ""
    echo "Types: file, url, domain, ip"
    echo ""
    echo "Common relationships:"
    echo "  file:   communicating_files, contacted_domains, contacted_ips, downloaded_files"
    echo "  url:    last_serving_ip_address, network_location, downloaded_files"
    echo "  domain: resolutions, subdomains, communicating_files, siblings"
    echo "  ip:     resolutions, communicating_files, downloaded_files"
    echo ""
    echo "Example:"
    echo "  $0 file abc123sha256 contacted_domains"
    echo "  $0 domain example.com resolutions"
    echo "  $0 ip 8.8.8.8 communicating_files"
    exit 1
fi

TYPE="$1"
ID="$2"
RELATIONSHIP="$3"
LIMIT="${4:-10}"
APIKEY="${5:-${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}}"

if [ -z "$APIKEY" ]; then
    echo "Error: API key required"
    exit 1
fi

# Map type to collection name
case "$TYPE" in
    file|files) COLLECTION="files" ;;
    url|urls) COLLECTION="urls" ;;
    domain|domains) COLLECTION="domains" ;;
    ip|ip_address|ip_addresses) COLLECTION="ip_addresses" ;;
    *)
        echo "Error: Unknown type '$TYPE'"
        exit 1
        ;;
esac

RESPONSE=$(curl -s -H "x-apikey: $APIKEY" \
    "https://www.virustotal.com/api/v3/$COLLECTION/$ID/$RELATIONSHIP?limit=$LIMIT")

if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Error:"
    echo "$RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$RESPONSE"
    exit 1
fi

echo "=== $RELATIONSHIP for $TYPE: $ID ==="
echo ""

echo "$RESPONSE" | jq -r '
  if .data then
    if type == "object" and .data.id then
      # Single object
      "Type: " + .data.type,
      "ID: " + .data.id
    elif type == "object" and (.data | type) == "array" then
      # Array of objects
      (.data | length | tostring) + " related objects",
      "",
      (.data[] |
        "---",
        "Type: " + .type,
        "ID: " + .id,
        if .attributes.last_analysis_stats then
          "Detections: " + (.attributes.last_analysis_stats.malicious | tostring) + " malicious"
        else empty end
      )
    else
      .
    end
  else
    "No relationships found"
  end
'
