# iGrowFast Relocation Recovery — 2026-09-24

The complete relocation capture is distributed through the private GitHub Release tagged `igf-relocation-20260924`. It is intentionally stored as encrypted split Release assets instead of Git objects because the capture contains production credentials and is larger than GitHub's normal Git object limits.

## Recovery kit

Required files:

- Every `igf-relocation-20260924.tar.zst.age.part-*` asset from the Release.
- `PARTS-SHA256SUMS` from the Release.
- `IGROWFAST-RECOVERY-KEY.agekey`, supplied separately by the project owner.

The portable recovery key is not tied to the original Mac or its Keychain. Treat it as a production root secret: anyone holding the key and the Release assets can read all captured credentials and data.

## Verify and extract

Install `age` and `zstd`, download all Release assets into one directory, then run:

```bash
shasum -a 256 -c PARTS-SHA256SUMS
cat igf-relocation-20260924.tar.zst.age.part-* \
  | age --decrypt --identity /secure/path/IGROWFAST-RECOVERY-KEY.agekey \
  | zstd --decompress --stdout \
  | tar -xvf -
```

After extraction:

```bash
cd IGROWFAST-RELOCATION-20260924T130453Z
shasum -a 256 -c 00-manifest/FINAL-ROOT-SHA256SUMS
```

The final command must report every listed file as `OK`.

## Provenance

- Captured source commit: `c12b8b7d2589149bdb7705e357a73773e16ae051`
- Final manifest entries: `56,121`
- Final manifest SHA-256: `6f96c92258b9a9331e565ebae2375e6a452b0efb9da30a7221c97f9fb803ba7d`
- Archive member count: `56,122` (the 56,121 sealed files plus the final manifest itself)
- Encrypted Release assets: `11` ordered parts totaling `20,537,415,911` bytes
- `PARTS-SHA256SUMS` SHA-256: `225165e79b75c7521429208b63a4368d328fa8a63881147a0659e7b258752bf8`
- Scope: three IGF servers, Supabase stack and data, WhatsApp node, toolbox host, Cloudflare account inventory, R2 objects, container filesystems, databases, Redis data, credentials, configuration, and rebuild runbooks.

## Known Cloudflare limitation

The capture records one Cloudflare API coverage limitation: Page Rules enumeration was rejected by Cloudflare error `1011` for the available account-owned tokens. Custom-hostname enumeration was conclusively unavailable because the account had no SSL for SaaS quota. All other recorded Cloudflare surfaces were captured or explicitly classified in the package audit.

## Start here after extraction

Read these files in order:

1. `00-manifest/RECOVERY-CRITICAL-AUDIT.md`
2. `00-manifest/FINAL-COMPLETENESS-AUDIT.md`
3. `00-manifest/CLOUDFLARE-COVERAGE-GAPS.md`
4. The rebuild and restore runbooks under the package documentation directories.

Do not deploy by copying secrets directly into source control. Restore them into the target secret stores and rotate credentials after the relocated system has been verified.
