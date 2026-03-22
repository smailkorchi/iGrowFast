#!/bin/bash
# vt-retrohunt.sh - Manage Retrohunt jobs

set -e

APIKEY="${VT_API_KEY:-$(cat ~/.virustotal/apikey 2>/dev/null || true)}"

show_usage() {
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  list                            - List all retrohunt jobs"
    echo "  get <job_id>                    - Get job details"
    echo "  create <rules_file> [options]   - Create new retrohunt job"
    echo "  matches <job_id> [limit]        - Get matching files"
    echo "  abort <job_id>                  - Abort/Delete job"
    echo ""
    echo "Create options:"
    echo "  --corpus main|goodware          - Corpus to scan (default: main)"
    echo "  --time-range 3m|12m             - Time range (default: 3m)"
    echo "  --email user@example.com        - Notification email"
    echo ""
    echo "Examples:"
    echo "  $0 create ./rules.yar --corpus main --time-range 3m"
    echo "  $0 matches abc123job 50"
    exit 1
}

if [ $# -lt 1 ] || [ -z "$APIKEY" ]; then
    show_usage
fi

COMMAND="$1"

case "$COMMAND" in
    list)
        curl -s -H "x-apikey: $APIKEY" \
            "https://www.virustotal.com/api/v3/intelligence/retrohunt_jobs" | \
            jq -r '.data[] | "\(.id): [\(.attributes.status)] \(.attributes.creation_date | strftime("%Y-%m-%d")) Matches=\(.attributes.num_matches) Progress=\(.attributes.progress)%"'
        ;;
    
    get)
        [ $# -lt 2 ] && show_usage
        JOB_ID="$2"
        
        curl -s -H "x-apikey: $APIKEY" \
            "https://www.virustotal.com/api/v3/intelligence/retrohunt_jobs/$JOB_ID" | jq .
        ;;
    
    create)
        [ $# -lt 2 ] && show_usage
        RULES_FILE="$2"
        
        if [ ! -f "$RULES_FILE" ]; then
            echo "Error: Rules file not found: $RULES_FILE"
            exit 1
        fi
        
        CORPUS="main"
        TIME_RANGE="3m"
        EMAIL=""
        
        shift 2
        while [ $# -gt 0 ]; do
            case "$1" in
                --corpus)
                    CORPUS="$2"
                    shift 2
                    ;;
                --time-range)
                    TIME_RANGE="$2"
                    shift 2
                    ;;
                --email)
                    EMAIL="$2"
                    shift 2
                    ;;
                *)
                    echo "Unknown option: $1"
                    exit 1
                    ;;
            esac
        done
        
        RULES=$(cat "$RULES_FILE")
        
        JSON_PAYLOAD="{
            \"data\": {
                \"type\": \"retrohunt_job\",
                \"attributes\": {
                    \"rules\": $(echo "$RULES" | jq -Rs),
                    \"corpus\": \"$CORPUS\",
                    \"time_range\": \"$TIME_RANGE\"
                }
            }
        }"
        
        if [ -n "$EMAIL" ]; then
            JSON_PAYLOAD=$(echo "$JSON_PAYLOAD" | jq --arg email "$EMAIL" '.data.attributes.notification_emails = [$email]')
        fi
        
        echo "Creating retrohunt job..."
        echo "Corpus: $CORPUS"
        echo "Time range: $TIME_RANGE"
        
        curl -s -X POST -H "x-apikey: $APIKEY" \
            -H "Content-Type: application/json" \
            -d "$JSON_PAYLOAD" \
            "https://www.virustotal.com/api/v3/intelligence/retrohunt_jobs" | jq .
        ;;
    
    matches)
        [ $# -lt 2 ] && show_usage
        JOB_ID="$2"
        LIMIT="${3:-20}"
        
        curl -s -H "x-apikey: $APIKEY" \
            "https://www.virustotal.com/api/v3/intelligence/retrohunt_jobs/$JOB_ID/matching_files?limit=$LIMIT" | \
            jq -r '.data[] | "\(.id): Type=\(.attributes.type_description // "unknown") Size=\(.attributes.size) bytes Detections=\(.attributes.last_analysis_stats.malicious)"'
        ;;
    
    abort|delete)
        [ $# -lt 2 ] && show_usage
        JOB_ID="$2"
        
        curl -s -X DELETE -H "x-apikey: $APIKEY" \
            "https://www.virustotal.com/api/v3/intelligence/retrohunt_jobs/$JOB_ID"
        
        echo "Job aborted/deleted: $JOB_ID"
        ;;
    
    *)
        show_usage
        ;;
esac
