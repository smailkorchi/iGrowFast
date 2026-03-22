# VirusTotal API v3 Reference

## Base URL
```
https://www.virustotal.com/api/v3
```

## Authentication
All requests require an API key in the header:
```
x-apikey: YOUR_API_KEY
```

## Core Endpoints

### Files

#### Get File Report
```http
GET /files/{hash}
```
Retrieve analysis report for a file by MD5, SHA1, or SHA256 hash.

**Response:** File object with `last_analysis_results`, `last_analysis_stats`, `size`, `type_description`, etc.

#### Upload & Scan File
```http
POST /files
Content-Type: multipart/form-data

file=@/path/to/file
```
Upload a file (max 32MB) for analysis. Returns an Analysis object.

#### Large File Upload (32MB - 650MB)
```http
GET /files/upload_url
```
Returns a one-time upload URL for large files.

Then POST the file to the returned URL.

#### Reanalyze File
```http
POST /files/{hash}/analyse
```
Request a fresh analysis of an already uploaded file.

### URLs

#### Get URL Report
```http
GET /urls/{url_id}
```
`url_id` is SHA256(URL).

#### Scan URL
```http
POST /urls
Content-Type: application/x-www-form-urlencoded

url=https://example.com
```
Submit a URL for scanning. Returns an Analysis object.

### Domains

#### Get Domain Report
```http
GET /domains/{domain}
```
Retrieve information about a domain (whois, DNS records, analysis, etc.)

### IP Addresses

#### Get IP Report
```http
GET /ip_addresses/{ip}
```
Retrieve information about an IP (geolocation, ASN, analysis, etc.)

### Analyses

#### Get Analysis
```http
GET /analyses/{analysis_id}
```
Retrieve analysis status and results by analysis ID.

## Intelligence Search (Premium)

```http
GET /intelligence/search?query={query}&limit={limit}
```

Search the VirusTotal corpus using VT Intelligence query syntax.

**Parameters:**
- `query` - Search query (URL-encoded)
- `limit` - Max results (default: 10)
- `cursor` - For pagination
- `order` - Sort order (e.g., `last_submission_date-`)
- `descriptors_only` - Return only IDs (faster)

## Relationships

Retrieve related objects:

```http
GET /{collection}/{id}/{relationship}
GET /{collection}/{id}/relationships/{relationship}  # Descriptors only
```

### Common Relationships by Object Type

**Files:**
- `communicating_files` - Files that communicate with this file's network IOCs
- `contacted_domains` - Domains contacted during execution
- `contacted_ips` - IPs contacted during execution
- `downloaded_files` - Files downloaded by this file
- `embedded_domains` - Domains embedded in file
- `embedded_ips` - IPs embedded in file
- `execution_parents` - Files that execute this file
- `parent` - Parent file (for extracted files)
- `children` - Extracted files
- `comments` - Community comments

**URLs:**
- `last_serving_ip_address` - Last IP that served this URL
- `network_location` - Domain or IP for this URL
- `redirects_to` - URLs this redirects to
- `redirecting_urls` - URLs that redirect here
- `downloaded_files` - Files downloaded from URL

**Domains:**
- `resolutions` - DNS resolutions
- `subdomains` - Known subdomains
- `siblings` - Sibling domains
- `parent` - Parent domain
- `referrer_files` - Files containing this domain
- `communicating_files` - Files that communicate with this domain
- `historical_whois` - WHOIS history
- `historical_ssl_certificates` - SSL certificate history

**IP Addresses:**
- `resolutions` - Domain resolutions
- `communicating_files` - Files communicating with this IP
- `downloaded_files` - Files downloaded from this IP
- `referrer_files` - Files containing this IP
- `historical_whois` - WHOIS history
- `historical_ssl_certificates` - SSL certificate history

## Comments

### Get Comments
```http
GET /{collection}/{id}/comments
```

### Add Comment
```http
POST /{collection}/{id}/comments
Content-Type: application/json

{
  "data": {
    "type": "comment",
    "attributes": {
      "text": "Comment text with #tags"
    }
  }
}
```

## Collections & Pagination

List responses include pagination:

```json
{
  "data": [...],
  "meta": {
    "cursor": "CuABChEKBGRhdGUSCQjA1..."
  },
  "links": {
    "next": "https://www.virustotal.com/api/v3/...?cursor=...",
    "self": "https://www.virustotal.com/api/v3/..."
  }
}
```

Use the `cursor` from `meta` to fetch the next page.

## Error Handling

Common error codes:

| Status | Code | Meaning |
|--------|------|---------|
| 400 | BadRequestError | Invalid request |
| 401 | AuthenticationRequiredError | Invalid/missing API key |
| 403 | ForbiddenError | Insufficient privileges |
| 404 | NotFoundError | Object not found |
| 429 | TooManyRequestsError | Rate limit exceeded |
| 500 | InternalError | Server error |

Error response format:
```json
{
  "error": {
    "code": "NotFoundError",
    "message": "File not found"
  }
}
```
