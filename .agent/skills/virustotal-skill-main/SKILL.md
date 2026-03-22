---
name: virustotal-api
description: Interact with VirusTotal API v3 for threat intelligence, file/URL/IP/domain analysis, and malware hunting. Use when looking up hashes, scanning files/URLs, investigating IOCs (IPs, domains), searching VT Intelligence, retrieving analysis reports, checking file reputations, or working with threat intelligence data from VirusTotal.
---

# VirusTotal API v3

Query VirusTotal for threat intelligence on files, URLs, IPs, and domains. Supports lookups, scans, Intelligence searches, and relationship exploration.

## Authentication

Store your API key in `~/.virustotal/apikey` or set `VT_API_KEY` environment variable.

## Quick Reference

| Task | Endpoint | Script |
|------|----------|--------|
| Get file report | `GET /files/{hash}` | `vt-file-lookup.sh {hash}` |
| Upload & scan file | `POST /files` | `vt-file-scan.sh {path}` |
| Download file | `GET /files/{hash}/download` | `vt-file-download.sh {hash}` |
| Get URL report | `GET /urls/{url_id}` | `vt-url-lookup.sh {url}` |
| Scan URL | `POST /urls` | `vt-url-scan.sh {url}` |
| Get domain report | `GET /domains/{domain}` | `vt-domain-lookup.sh {domain}` |
| Get IP report | `GET /ip_addresses/{ip}` | `vt-ip-lookup.sh {ip}` |
| Intelligence search | `GET /intelligence/search` | `vt-search.sh "query"` |
| Get relationships | `GET /{obj}/{id}/{rel}` | `vt-relationships.sh {type} {id} {rel}` |
| **Livehunt Rulesets** | `GET /intelligence/hunting_rulesets` | `vt-livehunt-rulesets.sh list` |
| **Livehunt Notifications** | `GET /intelligence/hunting_notifications` | `vt-livehunt-notifications.sh list` |
| **Retrohunt Jobs** | `GET /intelligence/retrohunt_jobs` | `vt-retrohunt.sh list` |

## URL Identifiers

URL endpoints use SHA256(URL) as ID. Generate with:
```bash
echo -n "http://example.com" | sha256sum
```

## Common Relationships

**Files:** `communicating_files`, `downloaded_files`, `contacted_domains`, `contacted_ips`, `embedded_domains`, `embedded_ips`, `parent`, `children`

**URLs:** `last_serving_ip_address`, `network_location`, `redirects_to`

**Domains:** `resolutions`, `subdomains`, `referrer_files`, `communicating_files`

**IPs:** `resolutions`, `communicating_files`, `downloaded_files`

## Analysis Verdicts

| Category | Meaning |
|----------|---------|
| `harmless` | Clean/not malicious |
| `undetected` | No opinion from engine |
| `suspicious` | Suspicious behavior |
| `malicious` | Confirmed malicious |
| `timeout` | Engine timed out |

## Search Modifiers (VT Intelligence)

- `content:"string"` - File content search
- `type:peexe` - File type
- `size:1MB-` - File size
- `positives:5+` - Detection count
- `tag:ransomware` - Tags
- `submissions:10+` - Times submitted
- `first_submission_date:2024-01-01+` - Date range

## API Limits

- Public API: 4 requests/minute
- Premium API: Higher limits apply
- Intelligence: Separate quota

## Usage Examples

```bash
# Look up a file hash
vt-file-lookup.sh d41d8cd98f00b204e9800998ecf8427e

# Download malware sample (premium)
vt-file-download.sh d41d8cd98f00b204e9800998ecf8427e /tmp/sample.bin

# Scan a suspicious URL
vt-url-scan.sh "http://suspicious.example.com"

# Search for recent malware
vt-search.sh "type:peexe positives:10+ first_submission_date:7d-"

# Get IP relationships
vt-relationships.sh ip 8.8.8.8 communicating_files
```

## Threat Hunting (Premium)

### Livehunt - Real-time YARA Matching

```bash
# List all rulesets
vt-livehunt-rulesets.sh list

# Create a new ruleset from YARA file
vt-livehunt-rulesets.sh create "Ransomware Detector" rules.yar true

# Enable/disable ruleset
vt-livehunt-rulesets.sh update abc123 enabled false

# View notifications (matches)
vt-livehunt-notifications.sh list 50

# Delete all notifications
vt-livehunt-notifications.sh delete all
```

### Retrohunt - Historical YARA Scanning

```bash
# List retrohunt jobs
vt-retrohunt.sh list

# Create job (scans 500M+ files from past 3-12 months)
vt-retrohunt.sh create rules.yar --corpus main --time-range 3m

# Check job status
vt-retrohunt.sh get job_id

# Get matching files
vt-retrohunt.sh matches job_id 100

# Abort running job
vt-retrohunt.sh abort job_id
```

### Livehunt YARA Variables

| Variable | Description |
|----------|-------------|
| `positives` | Detection count |
| `new_file` | First time submitted |
| `signatures` | All AV signatures |
| `file_type` | File type string |
| `submissions` | Submission count |

Example YARA for Livehunt:
```yara
rule NewHighDetections {
  condition:
    new_file and positives > 10
}
```

## References

- **Full API documentation**: See [references/api-reference.md](references/api-reference.md)
- **Search modifiers**: See [references/search-modifiers.md](references/search-modifiers.md)
- **Response schemas**: See [references/object-schemas.md](references/object-schemas.md)
- **Threat hunting**: See [references/threat-hunting.md](references/threat-hunting.md)
