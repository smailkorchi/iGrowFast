# Forcelog API Documentation

Complete reference covering the officially-documented public REST API, the undocumented dashboard-session endpoints reverse-engineered for the DigiCom adapter, and the native webhook contract. Forcelog is the only provider in our stack with native push-based status updates — all other providers (Ozon, Coliaty, QL, Vitex) require polling.

## Base URLs

| Purpose | Base URL |
|---|---|
| Public API (API Key) | `https://api.forcelog.ma` |
| Dashboard (session) | `https://customer.forcelog.ma` |
| Dashboard login | `https://customer.forcelog.ma/index/login` |
| Health check | `https://api.forcelog.ma/health` |

## Authentication

Two mechanisms coexist, chosen per operation:

1. **Public API** — `X-API-Key: {api_key}` header. No session/CSRF. Used for parcel create (standard mode), tracking, cities, per-parcel sticker PDF, and relaunch operations.
2. **Dashboard session** — `PHPSESSID` + `cstmr_phpsessid` cookies after POST login. Used for: BL lifecycle (create/edit/add/remove/finalize/reopen/delete), parcel create with special options (fragile, carton, exchange), parcel delete, and BL-level PDF printing (4 formats).

### Login reality check
The login form UI triggers reCAPTCHA v3 and posts a `recaptcha_response` token, but **the server does not actually validate the token**. An empty body with just `login_email` + `login_password` returns `SUCCESS` and sets valid session cookies. Programmatic login from edge functions works with no captcha-solving infrastructure. Verified empirically.

The `apptokenkey` header seen in browser captures is also cosmetic — the server does not require it.

---

## 1. Public REST API (X-API-Key)

All endpoints require `X-API-Key` header. Despite docs showing `application/x-www-form-urlencoded`, **the server only parses `application/json` bodies for POSTs**. Form-encoded submissions silently return "fields empty" errors. Always send JSON.

### 1.1 Health Check — `GET /health/`
Verifies the API is reachable. Note the trailing slash — `/health` returns 301.

### 1.2 Auth Verify
Any API call returns `AUTH.RESULT=SUCCESS` when the key is valid:
```json
{ "AUTH": { "RESULT": "SUCCESS", "MESSAGE": "Customer Authenticated, Welcome to Forcelog API 👋" } }
```

### 1.3 List Cities — `GET /customer/Cities`
Returns the full city catalog keyed by numeric ID.

**Response:**
```json
{
  "AUTH": {...},
  "Cities": {
    "1":  { "CODE": "MRK", "NAME": "Marrakech",  "D_FEES": "35", "D_FEES_SAME_CITY": "25" },
    "34": { "CODE": "CAS", "NAME": "Casablanca", "D_FEES": "30", "D_FEES_SAME_CITY": "20" }
  }
}
```

**439 cities** total. Fee fields are strings (DH as integer). The `D_FEES_SAME_CITY` rate applies when the sender and receiver are both in that city.

### 1.4 Create Parcel — `POST /customer/Parcels/AddParcel`
Creates a single parcel. Used for the **standard path** only — exchange/fragile/carton require the dashboard route (§2.5).

**Body (JSON):**
```json
{
  "ORDER_NUM": "WLCD-00081",
  "RECEIVER": "Mohammed Ali",
  "PHONE": "0612345678",
  "CITY": "Casablanca",
  "ADDRESS": "Rue 1, Quartier X",
  "COMMENT": "Optional note",
  "PRODUCT_NATURE": "Vêtement",
  "COD": 299.00,
  "CAN_OPEN": 1,
  "STOCK": "REF1:2,REF2:1"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `ORDER_NUM` | string(20) | Yes | Customer order number |
| `RECEIVER` | string(50) | Yes | Receiver name |
| `PHONE` | string(14) | Yes | 10-digit MA number (no leading `+212`) |
| `CITY` | string(50) | Yes | **City NAME only** (e.g. `"Casablanca"`). Docs claim code-or-name works; empirically **CODE (`"CAS"`) and ID (`"34"`) both fail** with `"City Not Found"`. Always send the name. |
| `ADDRESS` | string(100) | Yes | Full address |
| `COMMENT` | string(100) | No | Default: empty |
| `PRODUCT_NATURE` | string(100) | No | Default: empty |
| `COD` | number | No | Cash on delivery amount. Default: 0 |
| `CAN_OPEN` | boolean (0/1) | No | Default: 1 (can open) |
| `STOCK` | string | No | Stock mode: `"SKU:qty,SKU:qty"`. Quantity optional (`"SKU1,SKU2"`). |

**Success response:**
```json
{
  "AUTH": {...},
  "ADD-PARCEL": {
    "RESULT": "SUCCESS",
    "MESSAGE": "New Parcel Added Successfully",
    "NEW-PARCEL": {
      "TRACKING_NUMBER": "F-CSA2SQU37XY6",
      "ORDER_NUM": "WLCD-00081",
      "RECEIVER": "Mohammed Ali",
      "PHONE": "0612345678",
      "CITY_NAME": "Casablanca",
      "ADDRESS": "Rue 1, Quartier X",
      "PRICE": "299.00",
      "COMMENT": "",
      "PRODUCT_NATURE": ""
    }
  },
  "GET-PARCEL": { "PARCEL": { "DELIVERY_FEES": null } }
}
```

Tracking code format: `F-{cityCodeShort}{random11}` (e.g. `F-CSA2SQU37XY6`).

**Error response:**
```json
{ "ADD-PARCEL": { "RESULT": "ERROR", "MESSAGE": "City Not Found" } }
```
HTTP status is 400 on validation errors.

### 1.5 Get Parcel — `GET /customer/Parcels/GetParcel?Code={trackingCode}`

**⚠️ Limited scope:** This endpoint returns `{"GET-PARCEL": {"RESULT": "ERROR", "MESSAGE": "Parcel code Not Found"}}` for parcels created via the dashboard (`/Parcels/AddParcelAction`) — even when the parcel clearly exists and the tracking code is correct. The public API appears to only index parcels created via `POST /customer/Parcels/AddParcel`. For dashboard-created parcels (fragile, carton, exchange, or any flag that routes to dashboard creation) use §2.9 `Parcels/Tracking` instead.

**Response envelope is also different from what the docs suggest** — the real shape is `{AUTH, GET-PARCEL: {RESULT, MESSAGE}}` on error, not `{RESULT, PARCEL}`. On success the PARCEL payload lives under `GET-PARCEL` key (not `PARCEL`).

```json
{
  "AUTH": { "RESULT": "SUCCESS", "MESSAGE": "Customer Authenticated, …" },
  "GET-PARCEL": {
    "TRACKING_NUMBER": "F-CSA2SQU37XY6",
    "ORDER_NUM": "WLCD-00081",
    "RECEIVER": "Mohammed Ali",
    "PHONE": "0612345678",
    "CITY_NAME": "Casablanca",
    "ADDRESS": "Rue 1, Quartier X",
    "PRICE": "299.00",
    "STATUS": "Livré",
    "SITUATION": "Payé",
    "DELIVERY_FEES": 30
  }
}
```

`STATUS` and `SITUATION` are French labels (see §5 for the mapping to our `package_statuses`). Use this as a polling fallback when webhooks miss.

### 1.6 Relaunch (same city) — `POST /customer/Parcels/Relaunch`
Re-dispatches a parcel to a new recipient at the same city. **Not an exchange** — this is used when the first recipient rejected/no-showed and a new buyer is targeted.

**Body:**
```json
{
  "CODE": "F-CSA2SQU37XY6",
  "RECEIVER": "New Receiver",
  "PHONE": "0612345679",
  "ADDRESS": "New address",
  "COD": 299,
  "COMMENT": "Relaunch note"
}
```

### 1.7 Relaunch (new city) — `POST /customer/Parcels/RelaunchZone`
Same as above but into a different city. `CITY` field is the **city ID** (numeric string from §1.3). Confirmed behavior — unlike `AddParcel` where `CITY` is the name, here it's the numeric ID.

**Body:**
```json
{
  "CODE": "F-CSA2SQU37XY6",
  "CITY": "34",
  "RECEIVER": "...", "PHONE": "...", "ADDRESS": "...", "COD": 299
}
```

### 1.8 Parcel Sticker PDF — `GET /customer/PDF/ParcelSticker?parcelCode={code}`
Returns a single-parcel sticker PDF. Gated by `X-API-Key`. Stream as base64 data URL or proxy through our edge function.

---

## 2. Dashboard Session Endpoints

All require valid `PHPSESSID` + `cstmr_phpsessid` cookies. Base: `https://customer.forcelog.ma`.

### 2.1 Login — `POST /index/login/action`
**Body (form-urlencoded):**
```
login_email=your@email.com
login_password=YourPassword
```

The `recaptcha_response` field is accepted but not validated server-side. Response on success:
```html
<script>
  smNotif("","Vous êtes connecté avec succès","success");
  setTimeout(function(){ $(location).attr("href","https://customer.forcelog.ma/index/home"); }, 1000);
</script>
```

**Set-Cookie headers** deliver `PHPSESSID` (20-char hex) and `cstmr_phpsessid` (`CSTMR-...-SC|VE` token). Capture both. Typical TTL ~3 days (`Max-Age=259200`). Sessions are **not IP-bound** — cookies captured from a browser work from edge function IPs.

**Error response** on bad credentials:
```html
<script>smNotif("","Email ou mot de passe invalide","error");</script>
```

### 2.2 Create Delivery Note (BL) — `GET /index/DeliveryNotes/AddNewAction`
Creates an empty BL in draft state. Response body is a JS redirect:
```html
<script>window.location = "https://customer.forcelog.ma/index/DeliveryNotes/Edit/Ref/BL-230426-02325960-76-3999534";</script>
```
Parse the `BL-XXX` reference from the URL. BL format: `BL-{YYMMDD}-{serial}-{rand}-{companyId}`.

### 2.3 Save BL Draft Metadata — `POST /index/DeliveryNotes/JsonEdit/Type/New/Ref/{ref}`
Optional — used by the browser to persist edits to BL metadata. Not required for our integration (create + add parcels is sufficient).

### 2.4 Add Parcel to BL — `POST /index/DeliveryNotes/AddToNote/Ref/{ref}`
**Body (form-urlencoded):** `parcels_code[]=F-CSA2SQU37XY6` (snake_case, repeat the key per parcel)

The field name is exactly `parcels_code[]` — do **not** confuse with `parcelsCode[]` (camelCase), which is the checkbox name on the standalone `ParcelsPickUp` page but NOT accepted here. The server silently ignores the wrong name while still returning a generic `dataTableReload("NoteNewParcels"); dataTableReload("NoteAddedParcels");` script, producing a false-positive success signal. The real success indicator is the notif line `smNotif("","Ajouté avec succès <b>F-XXX</b>","success")` — absence of that notif means the parcel was NOT linked.

Parcels added to a BL cannot be deleted via §2.6 until removed from the BL.

### 2.5 Create Parcel (Dashboard) — `POST /index/Parcels/AddParcelAction`
**Used when any of: exchange, fragile, carton, or custom `parcel_type` is required.**

**Body (form-urlencoded):**
```
parcel_order_num={order_num}
parcel_replace=on              # presence = exchange mode; omit otherwise
parcel_replace_old=F-PREVIOUS  # required when parcel_replace=on
parcel_type=SIMPLE_PARCEL      # or STOCK_PARCEL
parcel_open=YES                # or NO
parcel_receiver={name}
parcel_phone={phone}
parcel_city={cityId}           # numeric city ID
parcel_district={quartier}
parcel_address={address}
parcel_comment={comment}
parcel_price={price}
parcel_product_type={nature}
fragile_parcel=on              # presence = fragile (+5 DH); omit otherwise
carton_size={0|cartonId}       # 0 = no packaging; >0 = packaging ID
```

**HTML-checkbox convention** (same as QL/Vitex): presence of a field = true, absence = false. Do **not** send `fragile_parcel=off` or `parcel_replace=off` — those are invalid. Omit entirely when false.

**Success response:** JS redirect to the newly-created parcel page. Parse `F-XXX` tracking code from the response body or follow the redirect.

**Error response examples:**
```html
<script>smNotif("","S'il vous plaît écrivez un numéro de téléphone valide","error");</script>
<script>smNotif("","Veuillez ajouter le colis à remplacer","error");</script>
```

### 2.6 Remove Parcel from BL — `POST /index/DeliveryNotes/RemoveFromNote/Ref/{ref}`
**Body (form-urlencoded):** `parcelCode=F-CSA2SQU37XY6`

### 2.7 Finalize BL — `GET /index/DeliveryNotes/Save/Ref/{ref}`
Submits the BL to Forcelog's ops. Required before PDF printing. GET method (Vitex uses POST — different).

### 2.8 Reopen BL — `GET /index/DeliveryNotes/Open/Ref/{ref}/Type/InPg`
Moves a finalized BL back to draft, allowing further add/remove operations.

### 2.9 Delete BL — `GET /index/DeliveryNotes/Delete/Ref/{ref}`
**Requires 0 parcels in the BL.** Returns error otherwise.

### 2.10 Delete Parcel — `GET /index/Parcels/Delete/ParcelCode/{code}`
**Requires parcel not to be in any BL.** Returns error otherwise.

### 2.11 Parcel Tracking Timeline — `GET /index/Parcels/Tracking/ParcelCode/{code}`
Session-gated. Returns `{TITLE, BODY, FOOTER}` where BODY is HTML containing a `vertical-timeline` list of status events. Each event node has:
- `<div class="badge badge-statut" style="--color: #RRGGBB;">{French status label}</div>` (the LAST such badge in the event is the status; a prior one like "Non Payé" / "Payé" represents payment state).
- `<div class="text-muted text-end col-4">{relative date}</div>` — e.g. `aujourd'hui à 23:13`.
- `<div class='timeline-content'>…</div>` — optional free-text comment (e.g. city, notes).

Used for polling tracking history instead of §1.5 Get Parcel, which cannot see dashboard-created parcels.

### 2.12 BL PDF Printing
All require the BL to be finalized (§2.7). All gated by session cookies.

| Format | URL | Description |
|---|---|---|
| Bon de livraison (list) | `/index/PDF/DeliveryNote/Ref/{ref}` | BL summary page (list of parcels) |
| Note A4 (single per page) | `/index/PDF/DeliveryNoteA4_NEW/Ref/{ref}` | One label per A4 sheet |
| Note A4 x8 (8 per page) | `/index/PDF/DeliveryNoteA4_8_NEW/Ref/{ref}` | 8 labels per A4 |
| Square sticker | `/index/PDF/DeliveryNoteSquare_NEW/Ref/{ref}` | Sticker-format labels |

Stream as base64 data URL (same pattern as Vitex/Coliaty session-gated PDFs).

---

## 3. Webhooks (Native Push)

Forcelog is the **only provider in our stack with native webhook support**. No polling required for status updates.

### 3.1 Configuration
Configure the webhook URL in Forcelog's dashboard. Our endpoint:
```
https://{project}.supabase.co/functions/v1/provider-webhook/{provider_id}/{webhook_secret}
```

### 3.2 Events
- `parcel.created` — new parcel created
- `parcel.updated` — status changed
- `parcel.history` — new history entry

All three carry the same payload shape.

### 3.3 Payload
```json
{
  "event": "parcel.updated",
  "timestamp": "2024-08-16T16:52:04.462111Z",
  "data": {
    "parcel_code": "F-CSA6SFJ6EMY",
    "status": "IN_PROGRESS",
    "secondary_status": "NO_ANSWER"
  }
}
```

Payload is **minimal by design** — Forcelog explicitly no longer ships the full parcel object. Only `parcel_code`, `status`, and `secondary_status` (nullable).

### 3.4 Headers
- `Content-Type: application/json`
- `X-Webhook-Event: parcel.updated`
- `X-Forcelog-Signature: sha256={hmac}` — HMAC SHA256 of JSON body using the webhook secret
- `User-Agent: ForcelogWebhook/1.0`

### 3.5 Signature Verification
HMAC SHA256 of the raw JSON body (UTF-8) using our `webhook_secret`. Prefixed with `sha256=`. **Use constant-time comparison.**

Our integration **reuses `provider_webhooks.webhook_secret`** for both the URL gate and HMAC key. Customer sets the same value on Forcelog's side. Signature verification is defense-in-depth on top of the unguessable URL.

---

## 4. Integration Routing (DigiCom Adapter Decisions)

| Operation | Path | Why |
|---|---|---|
| Create parcel (standard) | Public API `/AddParcel` | Cleaner, no session |
| Create parcel (exchange, fragile, carton) | Dashboard `/Parcels/AddParcelAction` | Public API has no such fields |
| Track parcel | Public API `/GetParcel` | French labels returned — use for polling fallback |
| Cities | Public API `/Cities` | Cached to DB |
| Create BL | Dashboard `/DeliveryNotes/AddNewAction` | No BL concept in public API |
| Add/Remove from BL | Dashboard `/AddToNote` / `/RemoveFromNote` | Session only |
| Finalize BL | Dashboard `/DeliveryNotes/Save` | Session only |
| Reopen BL | Dashboard `/DeliveryNotes/Open` | Session only |
| Delete BL | Dashboard `/DeliveryNotes/Delete` | Session only; requires 0 parcels |
| Delete parcel | Dashboard `/Parcels/Delete` | Session only; must not be in any BL |
| Print BL PDFs (4 formats) | Dashboard `/index/PDF/*` | Session only |
| Print per-parcel sticker | Public API `/PDF/ParcelSticker` | Bearer-gated |
| Relaunch (same/new city) | Public API `/Relaunch` or `/RelaunchZone` | Not wired yet — available for future feature |
| Status updates | Native webhook | Real-time, no polling cron |

---

## 5. Status Mapping

Forcelog webhooks emit English `SCREAMING_SNAKE_CASE` codes (`status` + optional `secondary_status`). The Get-Parcel endpoint returns French labels. Our `package_statuses.delivery_service_statuses` JSONB stores both so a single row matches either source.

### 5.1 Documented codes (high confidence)
| Code | French label | DigiCom category |
|---|---|---|
| `IN_PROGRESS` | En cours | in_transit |
| `DELIVERED` | Livré / Livré - Facturé / Livré - Non Facturé | delivered |
| `RELAUNCH` | Relancer / Relancer vers un nouveau client | relaunched |
| `NO_ANSWER` (secondary) | Pas de réponse | no_answer |

### 5.2 French labels inferred from dashboard UI
These seed the polling path (GetParcel `STATUS` field). English code mappings below are **best-guess** — verify via `webhook_logs` after go-live.

| French label | Inferred code | Category |
|---|---|---|
| Reçu Hub | `RECEIVED_HUB` | picked_up |
| Ramassé | `PICKED_UP` | picked_up |
| Expédié vers la ville | `SHIPPED` | in_transit |
| En Voyage | `IN_TRANSIT` | in_transit |
| Reçu ville | `RECEIVED_CITY` | in_transit |
| En cours de livraison | `OUT_FOR_DELIVERY` | out_for_delivery |
| Livré | `DELIVERED` | delivered |
| Livré - Facturé | `DELIVERED_INVOICED` | delivered |
| Livré - Non Facturé | `DELIVERED_UNINVOICED` | delivered |
| Retourné | `RETURNED` | returned |
| Préparation retour | `RETURN_PREP` | returning |
| Demande de retour (Par client) | `RETURN_REQUEST` | returning |
| Annulé | `CANCELLED` | cancelled |
| Refusé | `REFUSED` | refused |
| Reporté | `RESCHEDULED` | scheduled |
| Programmé | `SCHEDULED` | scheduled |
| Pas de réponse | `NO_ANSWER` | no_answer |
| Pas de réponse + SMS | `NO_ANSWER_SMS` | no_answer |
| Injoignable | `UNREACHABLE` | no_answer |
| Numéro invalide | `INVALID_NUMBER` | no_answer |
| Boîte vocale | `VOICE_MAIL` | no_answer |
| Hors-zone | `OUT_OF_ZONE` | cancelled |
| Aucune réponse depuis 3 jours | `NO_ANSWER_3D` | no_answer |
| Confirmé par forcelog | `CONFIRMED` | new |
| Attente Confirmation | `AWAITING_CONFIRMATION` | new |
| Colis dêja préparer | `ALREADY_PREPARED` | picked_up |
| Colis Non Reçu - Hub casablanca | `NOT_RECEIVED_HUB` | new |
| Traitement Suivi en cours | `FOLLOWUP_IN_PROGRESS` | in_transit |
| En cours de traitement par Forcelog | `PROCESSING` | new |
| Eligible pour relancer vers nouvelle ville | `ELIGIBLE_RELAUNCH` | relaunched |
| Relancer vers une nouvelle ville (Même zone) | `RELAUNCH_ZONE` | relaunched |

### 5.3 Follow-up secondary statuses
Secondary statuses from webhook `data.secondary_status` are treated as refinements. These "(Suivi)" variants map to the same category as their base:
- `Pas de réponse (Suivi)` → same as `Pas de réponse`
- `Injoignable (Suivi)` → same as `Injoignable`
- `Reporté (Suivi)` → same as `Reporté`
- `Annulé (Suivi)` → same as `Annulé`

### 5.4 Unknown-code handling
Any code not in the seeded list falls through to a raw-label update on `company_parcels.status_label` (`package_status_id` stays unchanged). Monitor `webhook_logs.error_message` for `No mapping found` entries and add the missing codes via migration.

---

## 6. City Matching Strategy

Forcelog's `AddParcel` public API accepts **only the city NAME** — CODE and numeric ID both fail with `"City Not Found"`. The dashboard `/AddParcelAction` accepts the numeric ID only. So the adapter stores both:

| Column | Type | Used for |
|---|---|---|
| `cities.forcelog_city_id` | text | Dashboard parcel creation |
| `cities.forcelog_city_name` | text | Public API parcel creation |

Initial mapping via `pg_trgm` fuzzy match against our 350+ city rows (same pattern as Vitex). Unmapped cities can be linked manually in the Cities admin page.

---

## 7. Known Quirks & Empirical Findings

1. **JSON-only POST bodies** — despite docs showing form fields, the public API rejects `application/x-www-form-urlencoded` with "fields empty" errors. Always send JSON.
2. **CITY parameter is name-only in public API** — contradicts docs which claim "code or name".
3. **reCAPTCHA is client-side only** — login works without a token.
4. **apptokenkey header is cosmetic** — server ignores it.
5. **Sessions not IP-bound** — cookies move across IPs freely.
6. **Session TTL ~3 days** — auto-renews on activity per PHP defaults.
7. **`/health` 301-redirects to `/health/`** — trailing slash mandatory.
8. **BL finalize is GET, not POST** — different from Vitex.
9. **Tracking code prefix is `F-`** followed by a city-abbreviation-and-random string.
10. **BL ref format** `BL-{YYMMDD}-{serial}-{rand}-{companyId}`.

---

## 8. Rate Limits & Reliability

Not documented. No 429 responses observed during integration testing. Webhooks retry on 5xx (retry policy not documented — assume at-least-once delivery, design idempotent handlers).

## 9. Credentials (Testing Account)

- Email: `ismailelqorchi@protonmail.com`
- Password: `MATAmata@123`
- API key: `5b9c62b29eda7a15a55ffe160864b6f7`
- Dashboard: `https://customer.forcelog.ma`
