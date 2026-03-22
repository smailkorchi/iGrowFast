#!/bin/bash
# vt-livehunt-rulesets.sh - Manage Livehunt YARA rulesets

set -e

APIKEY="${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}"

show_usage() {
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  list                                    - List all rulesets"
    echo "  get <ruleset_id>                        - Get ruleset details"
    echo "  create <name> <rules_file> [enabled]    - Create new ruleset"
    echo "  update <ruleset_id> <field> <value>     - Update ruleset"
    echo "  delete <ruleset_id>                     - Delete ruleset"
    echo ""
    echo "Examples:"
    echo "  $0 list"
    echo "  $0 create 'Ransomware Detection' ./rules.yar true"
    echo "  $0 update abc123 enabled false"
    exit 1
}

if [ $# -lt 1 ] || [ -z "$APIKEY" ]; then
    show_usage
fi

COMMAND="$1"

case "$COMMAND" in
    list)
        curl -s -H "x-apikey: $APIKEY" \
            "https://www.virustotal.com/api/v3/intelligence/hunting_rulesets" | \
            jq -r '.data[] | "\(.id): \(.attributes.name) [\(.attributes.enabled | if . then "enabled" else "disabled" end)]"'
        ;;
    
    get)
        [ $# -lt 2 ] && show_usage
        RULESET_ID="$2"
        curl -s -H "x-apikey: $APIKEY" \
            "https://www.virustotal.com/api/v3/intelligence/hunting_rulesets/$RULESET_ID" | jq .
        ;;
    
    create)
        [ $# -lt 3 ] && show_usage
        NAME="$2"
        RULES_FILE="$3"
        ENABLED="${4:-true}"
        
        if [ ! -f "$RULES_FILE" ]; then
            echo "Error: Rules file not found: $RULES_FILE"
            exit 1
        fi
        
        RULES=$(cat "$RULES_FILE")
        
        curl -s -X POST -H "x-apikey: $APIKEY" \
            -H "Content-Type: application/json" \
            -d "{
                \"data\": {
                    \"type\": \"hunting_ruleset\",
                    \"attributes\": {
                        \"name\": \"$NAME\",
                        \"rules\": $(echo "$RULES" | jq -Rs),
                        \"enabled\": $ENABLED
                    }
                }
            }" \
            "https://www.virustotal.com/api/v3/intelligence/hunting_rulesets" | jq .
        ;;
    
    update)
        [ $# -lt 4 ] && show_usage
        RULESET_ID="$2"
        FIELD="$3"
        VALUE="$4"
        
        # Convert boolean strings
        if [ "$VALUE" = "true" ] || [ "$VALUE" = "false" ]; then
            VALUE_BOOL="$VALUE"
            curl -s -X PATCH -H "x-apikey: $APIKEY" \
                -H "Content-Type: application/json" \
                -d "{\"data\": {\"type\": \"hunting_ruleset\", \"attributes\": {\"$FIELD\": $VALUE_BOOL}}}" \
                "https://www.virustotal.com/api/v3/intelligence/hunting_rulesets/$RULESET_ID" | jq .
        else
            curl -s -X PATCH -H "x-apikey: $APIKEY" \
                -H "Content-Type: application/json" \
                -d "{\"data\": {\"type\": \"hunting_ruleset\", \"attributes\": {\"$FIELD\": \"$VALUE\"}}}" \
                "https://www.virustotal.com/api/v3/intelligence/hunting_rulesets/$RULESET_ID" | jq .
        fi
        ;;
    
    delete)
        [ $# -lt 2 ] && show_usage
        RULESET_ID="$2"
        
        curl -s -X DELETE -H "x-apikey: $APIKEY" \
            "https://www.virustotal.com/api/v3/intelligence/hunting_rulesets/$RULESET_ID"
        
        echo "Ruleset deleted: $RULESET_ID"
        ;;
    
    *)
        show_usage
        ;;
esac
