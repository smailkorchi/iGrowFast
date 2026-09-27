# 13. Backups, Disaster Recovery, and Observability

> Classification: **Confidential — investor diligence material.** Recovery architecture is summarized without credentials, account identifiers, addresses, private hostnames, or secret locations.

## Investor significance

For a self-hosted commerce platform, resilience depends on more than taking a database dump. Recovery must cover point-in-time database state, logical portability, user uploads, service configuration, independent copies, restoration tooling, operator authorization, and evidence that scheduled jobs are still running.

This is the strongest verified area of the platform. The 2026-08-24 capture enumerated the off-site copies directly and found **34,590 objects totalling 5.02 GiB across two dedicated backup stores**, with material written on the capture date itself. It further confirmed that **all 21 scheduled backup lanes across all three hosts were inside their own declared freshness budgets, with zero stale lanes**.

The one material gap is specific and is stated plainly below: WhatsApp customer media remains a single copy.

## What exists

### The heartbeat model — why these claims are checkable

Every backup lane writes a small manifest to off-site storage on completion containing its host, job name, timestamp, and **its own maximum acceptable age**. Because the staleness budget travels with the evidence, "backups are healthy" becomes a mechanically verifiable statement rather than an assertion, and a silently dead scheduler surfaces as an aging heartbeat rather than as an absence nobody notices.

This dossier's freshness claims were produced by reading those manifests and comparing each lane against the budget it declares for itself.

### Database recovery layers

- **Live-verified, 2026-08-24:** the off-site database-backup bucket held **34,052 objects totalling 2.68 GiB**, structured as a point-in-time repository (33,525 objects, 1.79 GiB), independent encrypted logical dumps from the primary host (390.8 MiB) and from a second host (388.8 MiB), and a user-upload mirror (128.7 MiB).
- **Live-verified:** the most recent incremental backup completed on the capture date; the most recent full backup completed the prior day, against a nine-day budget.
- **Live-verified:** continuous WAL archiving reported **1,862 archives and zero failures**, with the most recent archive written under two hours before capture.
- **Live-verified:** thirteen scheduled backup and monitoring units were installed on the primary host, covering logical dumps, escrow, incremental and full point-in-time backups, repository verification, the upload mirror, deduplicated backups and their maintenance and deep-check passes, archive monitoring, cross-host watchdogs, and a restore drill.
- **Repository-verified:** the point-in-time system provides full and incremental backups plus continuous archive recovery; independent encrypted logical dumps provide a portable fallback in a different format from a different producer.

### Configuration and object recovery

- **Live-verified, 2026-08-24:** the off-site configuration bucket held **538 objects totalling 2.34 GiB** — deduplicated host state (2.34 GiB) plus an escrow area (212 objects).
- **Live-verified:** deduplicated backup jobs are running on **all three hosts**, each within budget, so configuration and state are captured from the application host, the communications/tools host, and the WhatsApp node independently.
- **Live-verified:** the WhatsApp node additionally backs up its own database daily and its provider session material on a nine-hour budget — the session copy is what protects against a costly re-pairing event.
- **Live-verified:** a second host independently pulls database backup material, reducing dependence on the primary host. This lane was current at capture.
- **Repository-verified:** edge configuration export is included as a backup pre-hook, so tunnel, DNS, access, and rule state can be reconstructed from an export rather than memory alone.
- **Repository-verified:** the runbook describes an offline recovery root of trust and operator account recovery.

### Restore evidence

- **Live-verified, 2026-08-24:** an automated restore drill is scheduled, and its heartbeat shows a **successful execution on 2026-08-01** — 23 days before capture, against a 40-day budget. Restore capability is therefore exercised on a schedule, not merely scripted.
- **Repository-verified:** the restore path is split into plan and execute stages, supporting end-of-WAL and target-time recovery in a disposable container. The destructive path revalidates its gates server-side.
- **Historical:** the operations README records successful end-of-WAL and point-in-time restore drills on 2026-07-04.
- **Boundary:** no restore was executed during this read-only audit. The evidence is that drills run and that the most recent one succeeded, not an independently witnessed recovery.

### Recovery control plane

- **Repository-verified:** the backup agent is loopback-bound behind a tunnel, checks an active database-backed backup-administrator entitlement, requires AAL2 for state-changing actions, pins its browser origin, and writes an audit log.
- **Live-verified:** the backup control plane is served by its own dedicated tunnel, healthy with four connections at capture.
- **Live-verified:** cross-host watchdogs are **bidirectional and current** — the primary host monitors both the tools host and the WhatsApp node on a 90-minute budget, and the tools host monitors the primary host in return. A host that dies silently is detected by its peers.
- **Live-verified:** archive monitoring runs on a 20-minute budget and was current at capture, the tightest loop in the system.

## Controls and operating model

| Failure class | Documented recovery path | Evidence level |
|---|---|---|
| Bad rows or table change | Restore to an isolated target time, inspect, then recover selected data | Repository-verified; drill executed 2026-08-01 |
| Whole database failure | Safety backup, controlled stop, point-in-time restore, validation, promotion | Repository-verified; destructive path not exercised in this audit |
| Deleted user upload | Recover mirrored bytes and, when necessary, corresponding metadata | Live-verified mirror present (262 source objects, 274 mirrored) |
| Primary host loss | Restore configuration and database onto replacement compute | Repository-verified; off-site material live-verified present |
| Primary object-store/account loss | Use independently pulled database copies and rebuild storage/configuration | Live-verified: a second host holds an independent pull |
| WhatsApp provider session loss | Restore session material from the node's own off-site copy | Live-verified, current within a nine-hour budget |
| Deleted customer chat media | **No second copy exists** | **Open gap — see risks** |
| Operator workstation loss | Recover from offline escrow and independent infrastructure copies | Runbook-documented; escrow objects live-verified present |

Operating principles visible in the source and confirmed in the live estate:

- use independent backup formats and producers rather than one mechanism;
- encrypt backup material and keep values outside the repository;
- verify archives frequently and schedule full restore drills;
- separate read-only status from destructive recovery operations;
- publish heartbeats carrying their own staleness budgets, and use cross-host watchdogs to detect silent scheduler failure;
- quarantine storage garbage before delayed purge so cleanup remains recoverable;
- take a safety backup before a live restore.

## Current evidence status

| Claim | Status | Boundary |
|---|---|---|
| Off-site backup objects exist and are current | **Live-verified** | Enumerated read-only; objects written on the capture date. |
| All backup lanes within declared freshness budgets | **Live-verified** | 21 of 21 lanes across 3 hosts; zero stale. |
| Continuous archive health | Live-verified | 1,862 archived, zero failed. |
| Cross-host watchdogs operating | Live-verified | Bidirectional and current at capture. |
| Restore drill executes on schedule | Live-verified | Last success 2026-08-01, inside its 40-day budget. |
| Restore correctness independently witnessed | Not established | No drill was executed or observed during this audit. |
| Backup decryptability and completeness | Not established | Object presence and size were verified; contents were not decrypted or restored. |
| User-upload mirror | Live-verified | Object counts and sizes align between source and mirror. |
| WhatsApp media redundancy | **Open gap, confirmed current** | Single copy; no mirror exists. See risks. |
| External uptime and independent monitoring | Unverified | No Grafana, Prometheus, Loki, or external synthetic monitor was verified. |
| Measured RPO/RTO commitments | Not established | Schedules and budgets exist; formal recovery objectives were not evidenced. |

## Risks and limitations

1. **WhatsApp customer media is single-copy.** This was recorded as a concern on 2026-08-05 and **remains open as of 2026-08-24**. The media store holds 4,946 objects totalling roughly 2.6 GiB, and no mirror of it exists in either backup bucket — the upload mirror covers application storage only. Recent engineering added lifecycle cleanup for this media, which is not the same as redundancy. This is the single clearest remediation item in the recovery system, and it is bounded, well understood, and inexpensive to close by extending the existing mirror pattern to one additional bucket.
2. **Restore proof is scheduled, not witnessed.** A passing drill on a 40-day cadence is materially better than a script alone, but the assurance standard for diligence is a recorded restore with measured recovery duration, integrity checks, and operator sign-off. Capture that evidence on the next scheduled drill.
3. **Backup contents were not validated.** Presence and size do not prove decryptability or logical completeness. The scheduled verification and drill jobs address this internally; an externally witnessed restore would close it for diligence purposes.
4. **Monitoring coverage gap.** The estate self-monitors well through heartbeats, watchdogs, archive monitoring, disk guards, and SMTP alerts, but no metrics or log-aggregation runtime, external uptime monitor, or defined on-call and escalation system was evidenced.
5. **Tools-host capacity risk.** The communications/tools disk was 79% utilized. Backup staging, mail, logs, and communications growth can turn a capacity warning into an availability incident.
6. **No validated recovery objectives.** The runbook has detailed schedules and per-lane freshness budgets, but the audit did not find investor-ready, measured RPO/RTO commitments or an SLA. Do not infer them from timer cadence. The per-lane budgets are the natural raw material for defining them.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- Runbook: `docs/DR_RUNBOOK.md`
- Operations index: `ops/README.md`
- Backup and verification scripts: `ops/scripts/igf-pgbackrest-backup.sh`, `ops/scripts/igf-pgbackrest-verify.sh`, `ops/scripts/igf-pgdump.sh`, `ops/scripts/igf-restic-backup.sh`, `ops/scripts/igf-restic-maint.sh`
- Restore scripts: `ops/scripts/igf-restore-drill.sh`, `ops/scripts/igf-restore-plan.sh`, `ops/scripts/igf-restore-execute.sh`, `ops/scripts/igf-restore-runner.sh`
- Monitoring scripts: `ops/scripts/igf-archive-monitor.sh`, `ops/scripts/igf-watchdog.sh`, `ops/scripts/igf-heartbeat.sh`, `ops/scripts/igf-alert.sh`
- Agent authorization and audit path: `ops/agent/igf-backup-agent.py`
- Scheduling: `ops/systemd/box/`, `ops/systemd/toolbox/`, `ops/systemd/whatsapp/`
- Historical single-copy media finding and backup work: `.foreman/ledger.md`, git commits `9fbf3a9`, `6592c07`, `36ccfa0`, `2ab7c49`, `790f84e`
