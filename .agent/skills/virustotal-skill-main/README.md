## VirusTotal API Skill

An OpenClaw/LLM Agent Skill for comprehensive VirusTotal API v3 interaction. Query file hashes, investigate IOCs, search VT Intelligence, and manage threat hunting operations with YARA Livehunt and Retrohunt.

## 🎯 What This Skill Does

The virustotal-skill transforms your LLM agent into a threat intelligence analyst, capable of:

- Querying file reports by hash (MD5, SHA1, SHA256)
- Uploading and scanning files/URLs
- Downloading malware samples for analysis (premium)
- Investigating domains, IPs, and URLs with full enrichment
- Searching VT Intelligence with advanced query syntax
- Exploring relationships between IOCs
- Managing YARA Livehunt rulesets for real-time detection
- Running Retrohunt jobs for historical malware discovery

All through natural language — just ask for threat intelligence on any indicator.

## 📦 Installation

### Option 1: Clone and Copy (Recommended)

```bash
# Clone the repository
git clone https://github.com/Neo23x0/virustotal-skill.git

# Copy to your agent's skills folder
cp -r virustotal-skill ~/.openclaw/skills/
```

### Option 2: Package as .skill File

```bash
# Clone the repository
git clone https://github.com/Neo23x0/virustotal-skill.git
cd virustotal-skill

# Package the skill (requires OpenClaw skill-creator)
python3 ~/.npm-global/lib/node_modules/openclaw/skills/skill-creator/scripts/package_skill.py . .

# Install the packaged skill
cp virustotal-api.skill ~/.openclaw/skills/
```

### Supported Platforms

This skill works with any LLM agent that supports skill files:

- **OpenClaw** — `~/.openclaw/skills/`
- **Claude Desktop** — (skills folder location varies)
- **Other MCP-based agents** — Check your platform's documentation

## 🚀 Prerequisites

Before using this skill, you need a VirusTotal API key:

### Free API Key
1. Sign up at [virustotal.com](https://www.virustotal.com)
2. Get your API key from your profile
3. Set it in the skill:

```bash
mkdir -p ~/.virustotal
echo "your_api_key" > ~/.virustotal/apikey
chmod 600 ~/.virustotal/apikey
```

Or set environment variable:
```bash
export VT_API_KEY="your_api_key"
```

### Premium/Enterprise Features
The following require a premium VT account:
- File downloads
- VT Intelligence search
- Livehunt & Retrohunt
- Relationship data

## 🚀 Usage

Once installed, the skill activates automatically when you discuss VirusTotal or threat intelligence. Just ask:

### Use Case 1: File Hash Lookup

**"Look up this hash in VirusTotal"**

The skill will:
- Query the file report
- Show detection stats and top AV results
- Display file metadata (type, size, first seen)

```bash
# Quick lookup
vt-file-lookup.sh d41d8cd98f00b204e9800998ecf8427e

# With custom API key
vt-file-lookup.sh <hash> <apikey>
```

### Use Case 2: Download Sample

**"Download this malware sample for analysis"** (premium)

The skill will:
- Get a signed download URL
- Download the sample to your specified path
- Verify the hash matches

```bash
# Download to specific path
vt-file-download.sh 3bdc4c0637591533f1d4198a72a33426c01f69bd2e15ceee547866f65e26b7ad /tmp/sample.bin

# Download to current directory
vt-file-download.sh <hash>
```

### Use Case 3: URL Scanning

**"Scan this suspicious URL"**

The skill will:
- Submit the URL for analysis
- Return an analysis ID
- Poll for results (or you can check later)

```bash
# Submit URL for scanning
vt-url-scan.sh "http://suspicious.example.com"

# Check existing report
vt-url-lookup.sh "http://example.com"
```

### Use Case 4: VT Intelligence Search

**"Find recent malware with these characteristics"** (premium)

The skill handles:
- Complex query construction
- URL encoding
- Pagination
- Result formatting

```bash
# Recent high-detection PE files
vt-search.sh "type:peexe positives:10+ first_submission_date:7d-"

# Content search
vt-search.sh 'content:"malicious payload"'

# Network IOCs
vt-search.sh "embedded_domain:evil.com"
```

### Use Case 5: Relationship Exploration

**"Show me what this IP communicates with"**

The skill will:
- Query relationship endpoints
- Return related files, domains, or URLs
- Format connections for analysis

```bash
# Files communicating with IP
vt-relationships.sh ip 8.8.8.8 communicating_files

# Domains contacted by file
vt-relationships.sh file <hash> contacted_domains

# Subdomains of domain
vt-relationships.sh domain example.com subdomains
```

### Use Case 6: YARA Livehunt

**"Set up real-time YARA monitoring"** (premium)

The skill provides:
- Ruleset creation and management
- Notification viewing
- Rule testing

```bash
# List all rulesets
vt-livehunt-rulesets.sh list

# Create new ruleset
vt-livehunt-rulesets.sh create "Ransomware Detector" ./rules.yar true

# View notifications (matches)
vt-livehunt-notifications.sh list 50
```

Example YARA rule for Livehunt:
```yara
rule NewHighDetections {
  condition:
    new_file and positives > 10
}
```

### Use Case 7: Retrohunt

**"Search the last 3 months with my YARA rule"** (premium)

The skill manages:
- Job creation and monitoring
- Match retrieval
- Multiple corpus options

```bash
# Create retrohunt job
vt-retrohunt.sh create ./rules.yar --corpus main --time-range 3m

# List jobs
vt-retrohunt.sh list

# Get matching files
vt-retrohunt.sh matches <job_id> 100

# Abort job
vt-retrohunt.sh abort <job_id>
```

## 📚 What's Included

### Core Capabilities

The skill provides four main workflows:

| Capability | Description | API Level |
|------------|-------------|-----------|
| **Lookup** | Query existing reports | Free/Premium |
| **Scan** | Submit new files/URLs | Free/Premium |
| **Intelligence** | Advanced search & relationships | Premium |
| **Hunting** | Livehunt & Retrohunt YARA | Premium |

### Helper Scripts

| Script | Purpose |
|--------|---------|
| `vt-file-lookup.sh` | Query file by hash |
| `vt-file-scan.sh` | Upload and scan file |
| `vt-file-download.sh` | Download sample (premium) |
| `vt-url-lookup.sh` | Get URL report |
| `vt-url-scan.sh` | Submit URL for scanning |
| `vt-domain-lookup.sh` | Get domain enrichment |
| `vt-ip-lookup.sh` | Get IP enrichment |
| `vt-search.sh` | VT Intelligence search |
| `vt-relationships.sh` | Explore IOC relationships |
| `vt-livehunt-rulesets.sh` | Manage YARA rulesets |
| `vt-livehunt-notifications.sh` | View matches |
| `vt-retrohunt.sh` | Historical YARA scanning |

### API Coverage

**Public API:**
- `/files/{hash}` — File reports
- `/files` — Upload & scan
- `/urls/{id}` — URL reports
- `/urls` — Submit URL
- `/domains/{domain}` — Domain reports
- `/ip_addresses/{ip}` — IP reports
- `/analyses/{id}` — Analysis status

**Premium/Enterprise:**
- `/files/{hash}/download` — File download
- `/intelligence/search` — Advanced search
- `/intelligence/hunting_rulesets` — Livehunt
- `/intelligence/retrohunt_jobs` — Retrohunt

### VT Intelligence Search Modifiers

| Modifier | Description | Example |
|----------|-------------|---------|
| `content:` | File content search | `content:"malware"` |
| `type:` | File type | `type:peexe` |
| `size:` | File size | `size:1MB-` |
| `positives:` | Detection count | `positives:10+` |
| `tag:` | Tags | `tag:ransomware` |
| `first_submission_date:` | Date range | `first_submission_date:7d-` |
| `embedded_domain:` | Network IOC | `embedded_domain:evil.com` |

See [references/search-modifiers.md](references/search-modifiers.md) for complete syntax.

### Livehunt YARA Variables

VT-specific variables available in Livehunt rules:

| Variable | Type | Description |
|----------|------|-------------|
| `file_name` | string | Submission filename |
| `file_type` | string | File type category |
| `md5` | string | MD5 hash |
| `sha1` | string | SHA1 hash |
| `sha256` | string | SHA256 hash |
| `imphash` | string | Import hash |
| `ssdeep` | string | SSDEEP hash |
| `vhash` | string | Visual hash |
| `positives` | integer | Detection count |
| `submissions` | integer | Submission count |
| `new_file` | boolean | First submission |
| `signatures` | string | AV signatures |
| `tags` | string | File tags |

## 🏗️ Repository Structure

```
virustotal-api/
├── SKILL.md                          # Main skill documentation
├── README.md                         # This file
├── LICENSE                           # MIT License
├── .gitignore                        # Git ignore rules
├── scripts/                          # Helper scripts
│   ├── vt-file-lookup.sh
│   ├── vt-file-scan.sh
│   ├── vt-file-download.sh
│   ├── vt-url-lookup.sh
│   ├── vt-url-scan.sh
│   ├── vt-domain-lookup.sh
│   ├── vt-ip-lookup.sh
│   ├── vt-search.sh
│   ├── vt-relationships.sh
│   ├── vt-livehunt-rulesets.sh
│   ├── vt-livehunt-notifications.sh
│   └── vt-retrohunt.sh
└── references/                       # Detailed documentation
    ├── api-reference.md              # Full API endpoint docs
    ├── object-schemas.md             # JSON response schemas
    ├── search-modifiers.md           # VT Intelligence query syntax
    └── threat-hunting.md             # Livehunt/Retrohunt guide
```

## 🧪 Example Workflows

### First-Time Setup

1. Get VT API key from [virustotal.com](https://www.virustotal.com)
2. Install the skill to `~/.openclaw/skills/`
3. Set API key in `~/.virustotal/apikey`
4. Test with a known hash lookup

### Daily Usage - IOC Investigation

```bash
# Quick file check
vt-file-lookup.sh <hash>

# Domain enrichment
vt-domain-lookup.sh suspicious-domain.com

# IP analysis
vt-ip-lookup.sh 192.0.2.1

# Find related files
vt-relationships.sh domain evil.com communicating_files
```

### Threat Hunting

```bash
# Update Livehunt rules
vt-livehunt-rulesets.sh update my-ruleset rules.yar

# Check overnight matches
vt-livehunt-notifications.sh list 100

# Run historical search
vt-retrohunt.sh create new-rules.yar --time-range 3m
```

### Malware Analysis Pipeline

```bash
# Download sample
vt-file-download.sh <hash> /tmp/malware/sample.bin

# Scan with Loki-RS
loki -f /tmp/malware

# Extract IOCs
strings /tmp/malware/sample.bin | grep -E "(http|\\.exe|\\.dll)"
```

## 📊 API Limits

| Tier | Rate Limit | Features |
|------|------------|----------|
| **Public** | 4 req/min | Lookups, basic scans |
| **Premium** | Higher limits | All public + Intelligence |
| **Enterprise** | Custom | All features + downloads |

## 🤝 Contributing

Contributions welcome! Areas to help:

- Additional helper scripts
- New API endpoint coverage
- Documentation improvements
- Example workflows
- Bug fixes

## 📄 License

MIT License — See [LICENSE](LICENSE) file

## 🙏 Acknowledgments

- [VirusTotal](https://www.virustotal.com) — For the excellent API and service
- [YARA](https://virustotal.github.io/yara/) — The pattern matching swiss knife
- [Neo23x0](https://github.com/Neo23x0) — Skill author and security researcher
- [OpenClaw](https://openclaw.ai) — The AI agent platform

## 📚 References

- [VirusTotal API v3 Docs](https://docs.virustotal.com/reference/overview)
- [VirusTotal Intelligence](https://www.virustotal.com/gui/intelligence-overview)
- [VirusTotal Community](https://community.virustotal.com)
- [YARA Documentation](https://virustotal.github.io/yara/)
