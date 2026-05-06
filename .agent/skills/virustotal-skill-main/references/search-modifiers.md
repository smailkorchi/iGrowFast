# VirusTotal Intelligence Search Modifiers

Complete reference for VT Intelligence search syntax.

## File Search Modifiers

### Content & Structure
- `content:"string"` - Search file content for string
- `hex:DEADBEEF` - Search for hex pattern
- `type:peexe` - File type (see below)
- `tag:elf` - File format tag
- `main_icon_dhash:"hash"` - Icon similarity search

### File Types
- `type:peexe` - Windows executable
- `type:pedll` - Windows DLL
- `type:elf` - ELF binary
- `type:mach-o` - macOS/iOS binary
- `type:doc` - Word document
- `type:pdf` - PDF
- `type:zip` - ZIP archive
- `type:html` - HTML file
- `type:email` - Email message

### Metadata
- `size:1MB` - Exact size
- `size:1MB-` - Minimum size
- `size:-1MB` - Maximum size
- `size:500KB-2MB` - Size range
- `entropy:7.0+` - Entropy value

### Detection & Reputation
- `positives:5` - Exact detection count
- `positives:5+` - Minimum detections
- `positives:-5` - Maximum detections
- `reputation:0` - Community reputation score
- `times_submitted:10+` - Submission count

### Dates
- `first_submission_date:2024-01-01` - Exact date
- `first_submission_date:2024-01-01+` - After date
- `first_submission_date:-2024-01-01` - Before date
- `first_submission_date:30d-` - Last 30 days
- `first_submission_date:2023-01-01T00:00:00+` - Timestamp

Also available: `last_submission_date`, `last_analysis_date`

### ExifTool Metadata
- `exiftool:FileType:"PE32"` - File type from ExifTool
- `exiftool:CompanyName:"Microsoft"` - Company name
- `exiftool:ProductName:"Windows"` - Product name
- `exiftool:InternalName:"kernel32"` - Internal name
- `exiftool:OriginalFilename:"svchost.exe"` - Original filename
- `exiftool:FileDescription:"System"` - File description

### PE Specific
- `pe:sections:5` - Number of sections
- `pe:imphash:"hash"` - Import hash
- `pe:richpehash:"hash"` - Rich PE hash
- `pe:resource_details:"ICON"` - Resource type
- `pe:signatures:"Valid"` - Signature status

### Network IOCs
- `embedded_domain:example.com` - Domain embedded in file
- `embedded_ip:1.2.3.4` - IP embedded in file
- `contacted_domain:evil.com` - Domain contacted during sandbox
- `contacted_ip:1.2.3.4` - IP contacted during sandbox

### Behavior & Tags
- `tag:ransomware` - Tagged as ransomware
- `tag:trojan` - Tagged as trojan
- `tag:botnet` - Tagged as botnet
- `behaviour:"Registry"` - Behavior observed
- `sandbox:"CrowdStrike"` - Sandbox name

### Similarity Search
- `similar_to:hash` - Fuzzy hash similarity
- `ssdeep:"chunk:size:hash"` - ssdeep hash
- `tlsh:"hash"` - TLSH hash
- `vhash:"hash"` - Visual hash

## URL Search Modifiers

### Basic
- `url:"http://example.com/path"` - Full URL
- `domain:example.com` - Domain
- `tld:com` - Top-level domain

### Analysis
- `positives:3+` - Detection count
- `status:200` - HTTP status code
- `final_url:"..."` - Final URL after redirects

### Content
- `title:"Login"` - Page title
- `tracker:"Google Analytics"` - Tracker name
- `has_content:true` - Has content

## Domain Search Modifiers

### Basic
- `domain:example.com` - Exact domain
- `domain:*.example.com` - Subdomains

### Properties
- `cname:target.com` - CNAME record
- `mx_record:"mail.example.com"` - MX record
- `ns_record:"ns1.example.com"` - NS record
- `soa_email:"admin.example.com"` - SOA email

### Reputation
- `reputation:-10` - Negative reputation
- `positives:5+` - URL scanners detecting

### WHOIS
- `whois_date:2024-01-01+` - WHOIS update date
- `creation_date:2020-01-01+` - Domain creation
- `registrar:"Namecheap"` - Registrar name
- `whois_name:"John Doe"` - Registrant name
- `whois_org:"Company Inc"` - Registrant org
- `whois_email:"admin@example.com"` - Registrant email

## IP Search Modifiers

### Basic
- `ip:1.2.3.4` - Exact IP
- `ip:1.2.3.0/24` - CIDR range

### Properties
- `asn:15169` - ASN number
- `as_owner:"Google"` - AS owner
- `country:US` - Country code
- `continent:NA` - Continent code
- `network:1.2.3.0/24` - Network range
- `jarm:"hash"` - JARM fingerprint

## Combining Queries

### Boolean Operators
- `AND` (default) - Both conditions
- `OR` - Either condition
- `NOT` / `-` - Exclude

### Examples
```
type:peexe AND positives:10+
type:pdf AND content:"Invoice" AND positives:5+
domain:example.com OR ip:1.2.3.4
NOT tag:adware
```

### Grouping
```
(type:peexe OR type:pedll) AND positives:10+
```

## Sorting Results

Add to query or use `order` parameter:
- `order:first_submission_date-` - Newest first
- `order:last_submission_date+` - Oldest first
- `order:positives-` - Most detections first
- `order:size-` - Largest first

## Escaping Special Characters

- Spaces: Quote the value `"hello world"`
- Quotes: Escape with backslash `\"`
- Backslash: Double it `\\`

URL encode when using programmatically.
