#!/bin/bash
# vt-livehunt-notifications.sh - Manage Livehunt notifications

set -e

APIKEY="${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}"

show_usage() {
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  list [limit] [ruleset_id]       - List notifications"
    echo "  get <notification_id>           - Get notification details"
    echo "  delete [notification_id]        - Delete notification(s)"
    echo ""
    echo "Examples:"
    echo "  $0 list 50"
    echo "  $0 list 20 abc123ruleset"
    echo "  $0 delete all"
    exit 1
}

if [ $# -lt 1 ] || [ -z "$APIKEY" ]; then
    show_usage
fi

COMMAND="$1"

case "$COMMAND" in
    list)
        LIMIT="${2:-20}"
        RULESET_FILTER="${3:-}"
        
        URL="https://www.virustotal.com/api/v3/intelligence/hunting_notifications?limit=$LIMIT"
        
        if [ -n "$RULESET_FILTER" ]; then
            URL="${URL}&filter=ruleset_id:$RULESET_FILTER"
        fi
        
        curl -s -H "x-apikey: $APIKEY" "$URL" | \
            jq -r '.data[] | "\(.id): File=\(.relationships.target.data.id) Rules=[\(.attributes.matched_rules | join(","))] Date=\(.attributes.date | strftime("%Y-%m-%d %H:%M"))"'
        ;;
    
    get)
        [ $# -lt 2 ] && show_usage
        NOTIFICATION_ID="$2"
        
        curl -s -H "x-apikey: $APIKEY" \
            "https://www.virustotal.com/api/v3/intelligence/hunting_notifications/$NOTIFICATION_ID" | jq .
        ;;
    
    delete)
        if [ -z "$2" ] || [ "$2" = "all" ]; then
            # Delete all notifications
            curl -s -X DELETE -H "x-apikey: $APIKEY" \
                "https://www.virustotal.com/api/v3/intelligence/hunting_notifications"
            echo "All notifications deleted"
        else
            # Delete specific notification
            curl -s -X DELETE -H "x-apikey: $APIKEY" \
                "https://www.virustotal.com/api/v3/intelligence/hunting_notifications/$2"
            echo "Notification deleted: $2"
        fi
        ;;
    
    *)
        show_usage
        ;;
esac
