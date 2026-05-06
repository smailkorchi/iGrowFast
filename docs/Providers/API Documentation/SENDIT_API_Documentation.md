# Sendit API — Integration Notes

Reference for DigiCom's Sendit adapter. Captured 2026-04-24.

## Base URLs
- REST API: `https://app.sendit.ma/api/v1/`
- Dashboard: `https://app.sendit.ma`
- Rate limit: 1000 req/h (per app doc header)

---

## 1. Authentication — `POST /login`

**Body:**
```json
{ "public_key": "...", "secret_key": "..." }
```

**Response:**
```json
{ "success": true, "message": "Connexion effectuée avec succès.", "data": { "token": "...", "name": "..." } }
```

Use `Authorization: Bearer {token}` on all subsequent requests. Tokens are stable per-key pair (verified empirically — same token structure across logins). No visible TTL; if a call returns 401 we re-login and cache.

---

## 2. Districts (Cities + Quartiers, merged) — `GET /districts`

Paginated list, 10 rows/page, ~501 total (as of 2026-04-24).

**Row shape:**
```json
{
  "id": 46,
  "ville": "Casablanca",
  "name": "Casablanca - Autres quartiers",
  "arabic_name": "الدار البيضاء - أخرى",
  "price": "19",
  "delais": "24h",
  "pickup_district": 1
}
```

**Quirks:**
- "District" = combined city+quartier record. Casablanca has ~30 sub-districts, Mohammedia has 9, Rabat/Tanger each have one primary.
- `pickup_district: 1` means the seller can configure this as their own warehouse district (58 such districts exist out of 501).
- `price` is the provider's delivery fee for that district (string, MAD).
- Our `cities.sendit_district_id` stores the destination district ID for each DigiCom master_city. Seeding via pg_trgm fuzzy match (same pattern as Forcelog/Vitex).

---

## 3. Deliveries (parcels)

### 3.1 Create — `POST /deliveries`
```json
{
  "pickup_district_id": 46,
  "district_id": 54,
  "name": "Amina Chraibi",
  "amount": 199,
  "address": "Hay Karima Apt 6",
  "phone": "0626125632",
  "comment": "Call before arriving",
  "reference": "DC-12345",
  "allow_open": 1,
  "allow_try": 1,
  "products_from_stock": 0,
  "products": "",
  "packaging_id": null,
  "option_exchange": 0,
  "delivery_exchange_id": ""
}
```

**DigiCom conventions:**
- `pickup_district_id` — seller warehouse district ID, stored on `providers.sendit_pickup_district_id` (configurable from admin UI Permissions modal).
- `district_id` — destination district ID, resolved via `provider_cities.provider_city_id` (provider_type=sendit).
- `allow_open` / `allow_try` — derived from Sendit permission toggles.
- `products_from_stock=0` and `products`/`packaging_id` omitted/null — we do not sync stock ([see project_stock_disabled memory]).
- `option_exchange=1` + `delivery_exchange_id="DXXXXXXX"` — exchange flow (old parcel code required).

**Response on success (200):** `{ success: true, data: { code: "DXXXXXXX", status: "PENDING", labelUrl: "...", ... } }`

Parse `data.code` as the tracking number — store in `company_parcels.tracking_code`.

### 3.2 Get — `GET /deliveries/{code}`
Returns same shape as create, plus `audits` array (status history — used as polling fallback for tracking).

### 3.3 Update — `PUT /deliveries/{code}`
Same body as create. Used for edits (address fix, etc).

### 3.4 Delete — `DELETE /deliveries/{code}`
Works only when parcel is NOT in a pickup. Returns `{success: true, message: "Colis supprimé avec succes."}`.

### 3.5 Print Labels — `POST /deliveries/getlabels`
```json
{ "codesToPrint": "DH1,DH2,DH3", "printFormat": 1 }
```
Returns `{data: {filePrint: true, fileUrl: "http://app.sendit.ma/pdf/labels_colis_UXXX.pdf"}}`.

`printFormat` = 1 (A4 default). Other formats unknown; API doc doesn't enumerate — we'll expose `1` only for now.

### 3.6 Statuses — `GET /all-status-deliveries`
Returns the full status dictionary:
```
PENDING        — En attente              → new
TO_PREPARE     — À préparer              → pickup_pending
NEW_DESTINATION — À changer              → recheck
TO_PICKUP      — Ramassage en cours      → pickup_pending
PICKEDUP       — Ramassé                 → picked_up
WAREHOUSE      — Entrepôt                → in_transit
TRANSIT        — En transit              → in_transit
DISTRIBUTED    — Distribué               → in_transit
UNREACHABLE    — Injoignable             → no_answer
POSTPONED      — Reporté                 → postponed
DELIVERING     — En cours de livraison   → out_for_delivery
DELIVERED      — Livré                   → delivered
CANCELED       — Annulé                  → canceled
REJECTED       — Refusé                  → refused
```

Plus `status_return` (`RETOUR_PENDING`, …) tracked separately.

---

## 4. Pickups (BL equivalent)

Sendit's "Ramassage" = our "Bon de livraison". A pickup bundles N deliveries into a single warehouse pickup event.

### 4.1 Create — `POST /pickups`
```json
{
  "district_id": 46,
  "name": "atlas palm",
  "phone": "0708521650",
  "address": "Warehouse address",
  "note": "",
  "deliveries": "DH1,DH2,DH3",
  "movements": ""
}
```

**`district_id` here = pickup origin** (seller warehouse), same value as `pickup_district_id` on parcels. **`deliveries`** is a comma-joined list of parcel codes already created via `POST /deliveries`.

Returns `{code: "PXXXXXXX", status: "PENDING", deliveries: {...}}`. Store `code` as `delivery_notes.provider_reference`.

### 4.2 Get — `GET /pickups/{code}`
Same shape as create. Used by UI to show current parcels attached.

### 4.3 Update — `PUT /pickups/{code}`
Full-replace semantics on `deliveries` (comma-joined). To ADD a parcel: GET, read current codes, append, PUT. To REMOVE: GET, filter, PUT with reduced list.

### 4.4 Delete — `DELETE /pickups/{code}`
Returns `{success: true}`.

### 4.5 List — `GET /pickups?page=N`

---

## 5. Webhooks (Native, in-dashboard config)

Configured in Sendit UI (Intégration API → Créer un webhook). Each webhook binds to:
- URL
- Event: **Mise à jour du statut du colis** (only event type currently offered)
- API Key (clé API) — payload signed via this key's `secret_key`

### 5.1 Payload (TBD — not yet captured)
Inferred shape based on Sendit's REST envelope style:
```json
{
  "code": "DHXXXXXX",
  "status": "PICKEDUP",
  "status_return": null,
  "last_action_at": "2026-04-24 10:00:00"
}
```
OR wrapped:
```json
{ "event": "delivery.status.updated", "data": { "code": "...", "status": "..." } }
```

**DigiCom webhook handler** (`supabase/functions/provider-webhook/index.ts`) extracts defensively:
- `payload.code || payload.data?.code` → tracking
- `payload.status || payload.data?.status` → status candidate
- `payload.status_return || payload.data?.status_return` → secondary status (for returns)

First real event received will be logged in `webhook_logs.payload` — adjust parsing after inspection.

### 5.2 Signature
Payload is signed — likely HMAC with the `secret_key` of the selected API key. Header name TBD. We'll validate once shape is known. Until then, URL-path gate (`{provider_id}/{webhook_secret}`) is the primary defense, same as Forcelog.

---

## 6. Routing Summary

| Operation | Endpoint | Notes |
|---|---|---|
| Auth | `POST /login` | Bearer token, reuse until 401 |
| List cities | `GET /districts` | Paginated; cache to DB |
| Create parcel | `POST /deliveries` | Standard + exchange |
| Get parcel | `GET /deliveries/{code}` | Contains `audits` for tracking fallback |
| Update parcel | `PUT /deliveries/{code}` | For edits |
| Delete parcel | `DELETE /deliveries/{code}` | Must not be in a pickup |
| Print labels | `POST /deliveries/getlabels` | Batch print, returns PDF URL |
| Create BL (pickup) | `POST /pickups` | Bundles N parcels at creation |
| Get BL | `GET /pickups/{code}` | |
| Update BL | `PUT /pickups/{code}` | Full-replace deliveries list |
| Delete BL | `DELETE /pickups/{code}` | |
| Webhook | native `Mise à jour du statut du colis` | URL+key configured in Sendit UI |

---

## 7. DigiCom Adapter Decisions

- **Stock disabled** — never send products/packaging/from_stock fields.
- **Pickup district** — per-provider config on `providers.sendit_pickup_district_id`, exposed in admin Permissions modal as a dropdown of the 58 pickup-enabled districts.
- **Permissions toggles** — `allow_open`, `allow_try` (same as other providers' "autoriser ouvrir" / "autoriser essayage").
- **Exchange** — routes the same way as other providers: wizard sets `option_exchange=1` + `delivery_exchange_id`.
- **Polling fallback** — if webhook fails to arrive within N hours, fall back to `GET /deliveries/{code}` polling (same pattern as Vitex/Ozon).
