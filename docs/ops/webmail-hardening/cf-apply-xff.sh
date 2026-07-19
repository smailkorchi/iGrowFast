#!/bin/zsh
# Create the http_request_late_transform entrypoint ruleset with an anti-spoof
# rule: on jmap.igrowfast.com, overwrite X-Forwarded-For with cf.connecting_ip
# (Cloudflare's authoritative, unspoofable client IP). Stalwart's useXForwarded
# then reads a value the client cannot forge. Owner-authorized CF action.
set -e
DIR="$(dirname "$0")"
TOKEN="$(security find-generic-password -s cf-igrowfast-api -w)"
ZONE="98723fd0a91e2fe3784eee554f780182"
curl -s -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$DIR/cf-xff-rule.json" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/phases/http_request_late_transform/entrypoint" \
  | python3 -c "import json,sys
d=json.load(sys.stdin)
if d['success']:
    r=d['result']; print('OK ruleset:', r['id'])
    for rule in r.get('rules',[]): print('  rule:', rule.get('id'), '|', rule.get('description'))
else:
    print('FAIL:', json.dumps(d['errors']))"
