# VirusTotal API Object Schemas

## Analysis Object

Represents an analysis of a file or URL.

```json
{
  "data": {
    "attributes": {
      "date": 1591701363,
      "results": {
        "EngineName": {
          "category": "malicious|harmless|suspicious|undetected|timeout|failure",
          "engine_name": "EngineName",
          "engine_version": "1.0.0",
          "engine_update": "20240101",
          "method": "blacklist|heuristic|static|dynamic",
          "result": "Trojan.Win32.Generic"
        }
      },
      "stats": {
        "confirmed-timeout": 0,
        "failure": 0,
        "harmless": 50,
        "malicious": 5,
        "suspicious": 0,
        "timeout": 0,
        "type-unsupported": 0,
        "undetected": 15
      },
      "status": "completed|queued|in-progress"
    },
    "id": "analysis_id",
    "type": "analysis"
  }
}
```

## File Object

```json
{
  "data": {
    "attributes": {
      "authentihash": "sha256_hash",
      "creation_date": 1591701363,
      "exiftool": {
        "CompanyName": "Microsoft",
        "FileDescription": "Windows Service",
        "InternalName": "svchost",
        "OriginalFilename": "svchost.exe",
        "ProductName": "Windows OS"
      },
      "first_submission_date": 1591701363,
      "last_analysis_date": 1591701363,
      "last_analysis_results": { /* Engine results */ },
      "last_analysis_stats": { /* Stats object */ },
      "last_modification_date": 1591701363,
      "last_submission_date": 1591701363,
      "magic": "PE32 executable for MS Windows",
      "md5": "d41d8cd98f00b204e9800998ecf8427e",
      "meaningful_name": "svchost.exe",
      "names": ["file.exe", "malware.exe"],
      "pe_info": {
        "imphash": "hash",
        "machine_type": 332,
        "sections": [...]
      },
      "reputation": 0,
      "sha1": "sha1_hash",
      "sha256": "sha256_hash",
      "signature_info": {
        "description": "Windows Service",
        "file_version": "10.0.19041.1",
        "original_name": "svchost.exe",
        "product": "Windows OS",
        "signers": "Microsoft Windows",
        "verified": "Valid|Invalid|Unsigned"
      },
      "size": 12345,
      "ssdeep": "12288:abc:def",
      "tags": ["peexe", "windows"],
      "times_submitted": 100,
      "total_votes": {
        "harmless": 10,
        "malicious": 2
      },
      "trid": [/* File type identification */],
      "type_description": "Win32 EXE",
      "type_extension": "exe",
      "type_tag": "peexe",
      "unique_sources": 50,
      "vhash": "visual_hash"
    },
    "id": "sha256_hash",
    "links": {
      "self": "https://www.virustotal.com/api/v3/files/{hash}"
    },
    "type": "file"
  }
}
```

## URL Object

```json
{
  "data": {
    "attributes": {
      "categories": {
        "BitDefender": "malware",
        "Forcepoint ThreatSeeker": "phishing"
      },
      "favicon": {
        "dhash": "hash",
        "raw_md5": "md5_hash"
      },
      "first_submission_date": 1591701363,
      "has_content": true,
      "html_meta": {
        "description": ["Page description"],
        "title": ["Page Title"]
      },
      "last_analysis_date": 1591701363,
      "last_analysis_results": { /* Scanner results */ },
      "last_analysis_stats": { /* Stats object */ },
      "last_final_url": "http://final.destination.com/",
      "last_http_response_code": 200,
      "last_http_response_content_length": 12345,
      "last_http_response_content_sha256": "sha256_hash",
      "last_http_response_cookies": {},
      "last_http_response_headers": {},
      "last_modification_date": 1591701363,
      "last_submission_date": 1591701363,
      "outgoing_links": ["http://other.com"],
      "redirection_chain": ["http://redirect1.com"],
      "reputation": -10,
      "tags": ["phishing", "scam"],
      "targeted_brand": {
        "Phishtank": "Bank Name"
      },
      "times_submitted": 50,
      "title": "Page Title",
      "total_votes": {
        "harmless": 5,
        "malicious": 20
      },
      "trackers": {
        "Google Tag Manager": [
          {
            "id": "UA-123456-1",
            "timestamp": 1591701363,
            "url": "https://googletagmanager.com/gtag/js"
          }
        ]
      },
      "url": "http://example.com/path"
    },
    "id": "url_sha256",
    "links": {
      "self": "https://www.virustotal.com/api/v3/urls/{id}"
    },
    "type": "url"
  }
}
```

## Domain Object

```json
{
  "data": {
    "attributes": {
      "categories": {
        "Alexa": "top sites",
        "BitDefender": "news"
      },
      "creation_date": 1591701363,
      "favicon": {
        "dhash": "hash",
        "raw_md5": "md5_hash"
      },
      "jarm": "jarm_hash",
      "last_analysis_date": 1591701363,
      "last_analysis_results": { /* Scanner results */ },
      "last_analysis_stats": { /* Stats object */ },
      "last_dns_records": [
        {
          "expire": 1814400,
          "minimum": 600,
          "refresh": 3600,
          "retry": 300,
          "rname": "hostmaster.example.com",
          "serial": 2024010101,
          "ttl": 3600,
          "type": "SOA|A|AAAA|MX|NS|TXT|CAA",
          "value": "record_value"
        }
      ],
      "last_dns_records_date": 1591701363,
      "last_https_certificate": { /* SSL Certificate object */ },
      "last_https_certificate_date": 1591701363,
      "last_modification_date": 1591701363,
      "last_update_date": 1591701363,
      "popularity_ranks": {
        "Alexa": {
          "rank": 1000,
          "timestamp": 1591701363
        }
      },
      "registrar": "Namecheap Inc.",
      "reputation": 0,
      "tags": ["legitimate"],
      "total_votes": {
        "harmless": 100,
        "malicious": 5
      },
      "whois": "Domain Name: EXAMPLE.COM...",
      "whois_date": 1591701363
    },
    "id": "example.com",
    "links": {
      "self": "https://www.virustotal.com/api/v3/domains/{domain}"
    },
    "type": "domain"
  }
}
```

## IP Address Object

```json
{
  "data": {
    "attributes": {
      "as_owner": "Google LLC",
      "asn": 15169,
      "continent": "NA",
      "country": "US",
      "jarm": "jarm_hash",
      "last_analysis_date": 1591701363,
      "last_analysis_results": { /* Scanner results */ },
      "last_analysis_stats": { /* Stats object */ },
      "last_https_certificate": { /* SSL Certificate object */ },
      "last_https_certificate_date": 1591701363,
      "last_modification_date": 1591701363,
      "network": "8.8.8.0/24",
      "regional_internet_registry": "ARIN",
      "reputation": 50,
      "tags": ["dns", "google"],
      "total_votes": {
        "harmless": 1000,
        "malicious": 10
      },
      "whois": "NetRange: 8.8.8.0 - 8.8.8.255...",
      "whois_date": 1591701363
    },
    "id": "8.8.8.8",
    "links": {
      "self": "https://www.virustotal.com/api/v3/ip_addresses/{ip}"
    },
    "type": "ip_address"
  }
}
```

## SSL Certificate Object

```json
{
  "cert_signature": {
    "signature": "hex_signature",
    "signature_algorithm": "sha256RSA"
  },
  "extensions": {
    "CA": true,
    "authority_key_identifier": { "keyid": "..." },
    "ca_information_access": {},
    "certificate_policies": ["..."],
    "crl_distribution_points": ["..."],
    "extended_key_usage": ["serverAuth", "clientAuth"],
    "key_usage": ["ff"],
    "subject_alternative_name": ["domain.com", "*.domain.com"],
    "subject_key_identifier": "...",
    "tags": []
  },
  "issuer": {
    "C": "US",
    "CN": "Issuer Name",
    "L": "City",
    "O": "Organization",
    "OU": "Unit",
    "ST": "State"
  },
  "public_key": {
    "algorithm": "RSA",
    "rsa": {
      "exponent": "010001",
      "key_size": 2048,
      "modulus": "..."
    }
  },
  "serial_number": "...",
  "signature_algorithm": "sha256RSA",
  "size": 2048,
  "subject": {
    "CN": "domain.com"
  },
  "thumbprint": "sha1_hash",
  "thumbprint_sha256": "sha256_hash",
  "validity": {
    "not_after": "2025-01-01 00:00:00",
    "not_before": "2024-01-01 00:00:00"
  },
  "version": "V3"
}
```

## Comment Object

```json
{
  "data": {
    "attributes": {
      "date": 1591701363,
      "html": "<p>Comment with <a href='...'>#tag</a></p>",
      "text": "Comment with #tag",
      "votes": {
        "positive": 10,
        "negative": 2,
        "abuse": 0
      }
    },
    "id": "comment_id",
    "relationships": {
      "author": {
        "data": {
          "id": "user_id",
          "type": "user"
        }
      }
    },
    "type": "comment"
  }
}
```

## Collection List Response

```json
{
  "data": [
    { /* object 1 */ },
    { /* object 2 */ }
  ],
  "meta": {
    "count": 100,
    "cursor": "pagination_cursor"
  },
  "links": {
    "next": "https://api/v3/...?cursor=...",
    "self": "https://api/v3/..."
  }
}
```
