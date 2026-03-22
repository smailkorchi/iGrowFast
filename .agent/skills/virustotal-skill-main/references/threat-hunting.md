# VirusTotal API Threat Hunting Reference

Premium/Enterprise features for file download, YARA Livehunt, and Retrohunt.

## File Downloads

### Get Download URL
```http
GET /files/{hash}/download_url
```
Returns a signed URL valid for 1 hour. Getting the URL counts as one download from quota, but the URL can be reused multiple times.

**Response:**
```json
{
  "data": "https://vtsamples.commondatastorage.googleapis.com/..."
}
```

### Direct Download
```http
GET /files/{hash}/download
```
Redirects to the download URL. Same 1-hour expiration applies.

**Note:** These endpoints require special privileges (premium/enterprise with download access).

## Livehunt (YARA Rulesets)

Livehunt applies YARA rules to every file analyzed by VirusTotal in real-time.

### List Hunting Rulesets
```http
GET /intelligence/hunting_rulesets
GET /intelligence/hunting_rulesets?filter=enabled:true
```

### Get Ruleset
```http
GET /intelligence/hunting_rulesets/{id}
```

### Create Ruleset
```http
POST /intelligence/hunting_rulesets
Content-Type: application/json

{
  "data": {
    "type": "hunting_ruleset",
    "attributes": {
      "name": "My Ruleset",
      "enabled": true,
      "rules": "rule example { strings: $a=\"malware\" condition: $a }",
      "scope": "union",  // or "intersection"
      "limit": 100
    }
  }
}
```

### Update Ruleset
```http
PATCH /intelligence/hunting_rulesets/{id}
Content-Type: application/json

{
  "data": {
    "type": "hunting_ruleset",
    "attributes": {
      "enabled": false
    }
  }
}
```

### Delete Ruleset
```http
DELETE /intelligence/hunting_rulesets/{id}
```

### Ruleset Object
```json
{
  "data": {
    "attributes": {
      "creation_date": 1591701363,
      "enabled": true,
      "limit": 100,
      "modification_date": 1591701363,
      "name": "Ruleset Name",
      "notification_emails": ["admin@example.com"],
      "rules": "rule example { ... }",
      "scope": "union"
    },
    "id": "ruleset_id",
    "type": "hunting_ruleset"
  }
}
```

## Livehunt Notifications

### List Notifications
```http
GET /intelligence/hunting_notifications
GET /intelligence/hunting_notifications?filter=ruleset_id:{id}
```

### Get Notification
```http
GET /intelligence/hunting_notifications/{id}
```

### Notification Object
```json
{
  "data": {
    "attributes": {
      "date": 1591701363,
      "match_reason": "YARA rule matched",
      "matched_rules": ["rule_name"],
      "rule_tags": ["tag1", "tag2"]
    },
    "relationships": {
      "ruleset": { "data": { "id": "ruleset_id", "type": "hunting_ruleset" } },
      "target": { "data": { "id": "sha256", "type": "file" } }
    },
    "id": "notification_id",
    "type": "hunting_notification"
  }
}
```

### Delete Notifications
```http
DELETE /intelligence/hunting_notifications
DELETE /intelligence/hunting_notifications/{id}
```

## Retrohunt

Retrohunt scans the past 12 months (3 months for standard users) of files with YARA rules.

### List Retrohunt Jobs
```http
GET /intelligence/retrohunt_jobs
```

### Get Retrohunt Job
```http
GET /intelligence/retrohunt_jobs/{id}
```

### Create Retrohunt Job
```http
POST /intelligence/retrohunt_jobs
Content-Type: application/json

{
  "data": {
    "type": "retrohunt_job",
    "attributes": {
      "rules": "rule example { strings: $a=\"malware\" condition: $a }",
      "notification_emails": ["admin@example.com"],
      "corpus": "main",  // "main" or "goodware"
      "time_range": "3m" // "3m" or "12m" (requires Hunting Pro)
    }
  }
}
```

**Limitations:**
- Max 300 YARA rules per job
- Max 1MB total rule text size
- Max 10 concurrent jobs per user
- Max 10,000 matches per job
- Files >100MB not scanned

### Abort/Delete Retrohunt Job
```http
DELETE /intelligence/retrohunt_jobs/{id}
```

### Retrohunt Job Object
```json
{
  "data": {
    "attributes": {
      "corpus": "main",
      "creation_date": 1591701363,
      "finish_date": 1591704963,
      "num_matches": 150,
      "num_matches_outside_time_range": 50,
      "progress": 100,
      "rules": "rule example { ... }",
      "start_date": 1591701363,
      "status": "finished",  // "starting", "running", "aborted", "finished"
      "time_range": "3m"
    },
    "id": "job_id",
    "type": "retrohunt_job"
  }
}
```

### List Retrohunt Matches
```http
GET /intelligence/retrohunt_jobs/{id}/matching_files
```

Returns a list of file objects that matched the YARA rules.

## YARA Rules for Livehunt/Retrohunt

### Supported Standard Modules
- `pe` - PE module
- `elf` - ELF module
- `dotnet` - .NET module
- `lnk` - Windows shortcut module
- `macho` - Mach-O module
- `math` - Math functions
- `magic` - File type detection
- `hash` - Hash functions
- `string` - String functions
- `time` - Time functions

### VT-Specific Variables (Livehunt Only)

| Variable | Type | Description |
|----------|------|-------------|
| `file_name` | string | File's submission name |
| `file_type` | string | File type category |
| `imphash` | string | Import hash |
| `md5` | string | MD5 hash |
| `sha1` | string | SHA1 hash |
| `sha256` | string | SHA256 hash |
| `ssdeep` | string | SSDEEP hash |
| `vhash` | string | Visual hash |
| `positives` | integer | Detection count |
| `submissions` | integer | Submission count |
| `new_file` | boolean | First submission |
| `signatures` | string | All AV signatures |
| `tags` | string | File tags |

### Example YARA Rules

```yara
rule HighDetections {
  condition:
    positives > 10
}

rule SpecificFamily {
  strings:
    $family = "Trojan.Ransom"
  condition:
    $family in signatures
}

rule NewMalware {
  strings:
    $mz = "MZ"
  condition:
    $mz at 0 and new_file and positives > 5
}

rule PEWithImports {
  condition:
    file_type == "peexe" and pe.number_of_imports > 50
}
```

### Using the `vt` Module

```yara
import "vt"

rule VTModuleExample {
  condition:
    vt.metadata.file_type == vt.FileType.PE_EXE and
    vt.metadata.positives > 10
}
```

## IOC Stream

### List IOCs
```http
GET /ioc_stream
GET /ioc_stream?filter=date:7d-
GET /ioc_stream?filter=source_type:hunting_notification
```

### IOC Stream Item Object
```json
{
  "data": {
    "attributes": {
      "date": 1591701363,
      "threat_score": {
        "high": 80,
        "medium": 15,
        "low": 5
      }
    },
    "relationships": {
      "related_object": { "data": { "id": "sha256", "type": "file" } }
    },
    "id": "ioc_id",
    "type": "ioc_stream_item"
  }
}
```

## Privilege Requirements

| Feature | Required Plan |
|---------|--------------|
| File download | Premium/Enterprise with download access |
| Livehunt | Premium/Enterprise with Hunting |
| Retrohunt (3mo) | Premium/Enterprise with Hunting |
| Retrohunt (12mo) | Hunting Pro |
| IOC Stream | Premium/Enterprise |

## Rate Limits

- Livehunt: Real-time, limited by notification quota
- Retrohunt: 10 concurrent jobs per user
- File download: Limited by download quota
