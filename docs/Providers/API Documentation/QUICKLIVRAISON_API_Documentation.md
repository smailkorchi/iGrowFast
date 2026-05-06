# Quick Livraison API Documentation

Comprehensive reference covering both the officially-documented public API and the undocumented dashboard-session endpoints we reverse-engineered for the DigiCom adapter. Exchange parcels, BL creation, pickup submission, and PDF printing all require the undocumented flow — the public API alone is insufficient.

## Base URLs

| Purpose | Base URL |
|---|---|
| Public API | `https://clients.quicklivraison.ma/api` |
| Dashboard (session) | `https://clients.quicklivraison.ma` |
| PDF service | `https://admin.quicklivraison.ma` |

## Authentication

Three auth mechanisms coexist:

1. **`api_key`** — required on public API endpoints as a form/query parameter.
2. **Session cookies + CSRF** — required on dashboard endpoints. Flow: `POST /login` with `email + password + _token` → stores `quicklivraison_session` + `XSRF-TOKEN` cookies + per-session CSRF token.
3. **Hardcoded PDF token** — `ilernguzhnugfierhgurehfuizelhfnozehfuzi`. Global across all tenants; QL ships it inline in their own dashboard JS. Required on all `admin.quicklivraison.ma/pdf-*` endpoints.

Sub-user keys (prefix `sub_`) are accepted on the same public API endpoints as main account keys. Visibility on list endpoints respects the sub-user's access scope (`own` vs global).

---

## 1. Public API (officially documented)

### 1.1 Create Parcel
`POST /api/deliveries/store`
Content-Type: `application/x-www-form-urlencoded` or `multipart/form-data`

**Required:**
| Field | Type | Description |
|---|---|---|
| `api_key` | string | Main or sub-user API key |
| `district_id` | numeric | Receiver district ID (see §1.3 `getCityIDs`) |
| `name` | string | Receiver full name |
| `amount` | numeric | COD amount (MAD) |
| `phone` | string | 9 digits OR `0` + 9 digits, no spaces/dashes |
| `address` | string | Full delivery address |

**Optional:**
| Field | Type | Notes |
|---|---|---|
| `code` | string | Custom tracking code. Must be unique — returns HTTP 400 if duplicate. Omit for auto-generated `PARCEL_XXXXXXXX`. |
| `note` | string | Internal comment |
| `prd_name` | string | Product description (non-stock mode) |
| `qte_prd` | integer | Quantity (non-stock mode) |
| `received_quantity` | object | `{"productId": qty}` for stock-mode |
| `open` | boolean | See §4 HTML-checkbox gotcha |
| `try` | boolean | See §4 HTML-checkbox gotcha |
| `fragile` | boolean | See §4 HTML-checkbox gotcha |
| `echange` | boolean | **DOCUMENTED BUT SILENTLY IGNORED** — see §4.1 |
| `echange_colis` | string | **DOCUMENTED BUT SILENTLY IGNORED** — see §4.1 |

**Response (200 OK):**
```json
{
  "success": "Colis ajouté avec succès.",
  "tracking_number": "PARCEL_12345678"
}
```

**Error (400/401):**
```json
{ "error": "Invalid API key", "error_code": 401 }
```

### 1.2 Tracking
`GET /api/getParcelDetails/{tracking_number}` — **no auth required** (public).

**Response:**
```json
{
  "tracking_number": "PARCEL_12345678",
  "situation": "NOT_PAID",           // or "PAID", "INVOICED"
  "status": "DELIVERED",              // raw status code
  "status_second": null,              // sub-status (prefer when present)
  "date_creation":               "2026-01-01 10:00:00",
  "date_ramassage":              "2026-01-01 12:00:00",
  "date_expedition":             "2026-01-02 08:30:00",
  "date_livraison":              "2026-01-03 15:45:00",
  "date_derniere_modification":  "2026-01-03 16:00:00"
}
```

Parse rule: prefer `status_second || status`. Timeline milestones are inferred from the four `date_*` fields (creation, ramassage, expedition, livraison).

### 1.3 List Cities
`GET /api/getCityIDs` — public, no auth.
Returns array of `{ id, name }` for all districts. Use `id` as `district_id` on Create Parcel.

### 1.4 Cities with Fees & Delays
`GET /api/cities/frais-delay` — public, no auth.
Returns per-city delivery fees and estimated delays.

### 1.5 List Products
`GET /api/getProductIDs?api_key={key}`
Returns the account's stock products: `{ products: [{ id, reference, quantity }, ...] }`.

### 1.6 List Parcels (sub-user listing)
`GET /api/getParcelDetailsApi?api_key={sub_xxx}`
Returns parcels visible to the sub-user (filtered by `own` access if set). Main account key returns all parcels.

---

## 2. Dashboard-Session API (undocumented, reverse-engineered)

Required for: **exchange parcels, BL creation, BL parcel addition, pickup request submission**. All endpoints are session-authenticated and require CSRF token.

### 2.1 Login
1. `GET /login` → parse `<input name="_token" value="...">` for CSRF form token. Seeds `quicklivraison_session` + `XSRF-TOKEN` cookies.
2. `POST /login` `Content-Type: application/x-www-form-urlencoded`
   - `email`, `password`, `_token`
   - On success: 302 → `/dashboard`.
3. `GET /dashboard` → confirms session + exposes the XHR CSRF token as a JS var: `csrfToken = 'XXX'`.

The per-session CSRF token is used as `X-CSRF-TOKEN` header and form `_token` field on all subsequent POSTs.

### 2.2 Create Parcel (exchange-capable)
`POST /deliveries/store-ajax`
Content-Type: `multipart/form-data`
Headers: `Accept: application/json`, `X-CSRF-TOKEN: {csrf}`, `X-Requested-With: XMLHttpRequest`

**Form fields:**
| Field | Required | Notes |
|---|---|---|
| `_token` | yes | Session CSRF |
| `pickup_ville_id` | yes | Merchant pickup city — scrape `<select name="pickup_ville_id">` on `/deliveries/create` |
| `pickup_district_id` | yes | Merchant pickup district — scrape JS `pickup_district_id"]').html("<option value='N'>").val(N)` on `/deliveries/create` |
| `district_id` | yes | Receiver district |
| `name` | yes | Receiver name |
| `amount` | yes | COD |
| `phone` | yes | 9 or 0+9 digits |
| `address` | yes | Delivery address |
| `prd_name` | yes | Product name |
| `qte_prd` | yes | Quantity |
| `note` | no | Internal comment |
| `open` | no | HTML-checkbox: **present = true**; omit for false |
| `try` | no | Same |
| `fragile` | no | Same |
| `echange` | no | Same — **WORKS on this endpoint** (unlike public API) |
| `echange_colis` | no | Previous parcel tracking code for exchange |
| `is_stock` | no | **DO NOT APPEND** — present = stock-mode, which hides the parcel from the BL pickup queue. See §4.2 |
| `packaging_id` | no | Packaging type |

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Colis ajouté avec succès!",
  "parcel_code": "PARCEL_12345678",
  "parcel_id": 203965701
}
```

**Validation error (422):**
```json
{
  "message": "The phone field is required. (and 1 more error)",
  "errors": { "phone": [...], "address": [...] }
}
```

### 2.3 Create Delivery Note (BL)
`GET /delevery-note/create` (note: spelling `delevery` — not `delivery`).
Session cookies required. Response: **302** with `Location: /DeliveryNote/ref/BL-YYMMDD-XXXXXXXX-XX-XXXX`.

Parse the `BL-...` ref from the `Location` header.

### 2.4 Get BL Detail (for parcel ID resolution)
`GET /DeliveryNote/ref/{ref}` → HTML page. For each parcel in the merchant's available pool (same pickup zone, not already in another BL, not stock-mode), the page embeds:
- `<input type="checkbox" class="rowCheckbox" data-id="{numeric_id}">`
- `<td>{PARCEL_XXX}</td>` in the following cell.

Scrape pattern: for each tracking code, search backwards 1500 bytes for the last `"(\d{5,10})"` match — that's the numeric parcel ID needed for insertion.

### 2.5 Add Parcels to BL
`POST /DeliveryNote/insert`
Content-Type: `application/x-www-form-urlencoded`
Headers: `X-CSRF-TOKEN: {csrf}`, `X-Requested-With: XMLHttpRequest`, `Referer: https://clients.quicklivraison.ma/DeliveryNote/ref/{ref}`

**Body:**
- `_token`: session CSRF
- `ref`: BL reference
- `ids[]`: repeated numeric parcel IDs

**Response (200):** `{ "message": "Data inserted successfully" }`

### 2.6 Remove Parcels from BL
`POST /DeliveryNote/remove` — same payload shape as `/insert`. Unwires parcels from a BL.

### 2.7 Load Available Parcels (AJAX)
`GET /load-parcels` → `{ "parcels": [...] }`. Lists parcels eligible for BL addition (non-stock, not already in any BL, matching pickup zone). Used by the BL detail page's AJAX modal; not needed if scraping the detail HTML directly.

### 2.8 Submit Pickup Request (NEW_PARCEL → WAITING_PICKUP)
`POST /pickups/store`

Required fields: `_token`, `request_type` (`SIMPLE_PARCEL` or `STOCK`), `district_id` (pickup city), `phone`, `address`, `parcel_ids[]`.

The pickup request transitions parcels out of `NEW_PARCEL`. Optional in our adapter — `/DeliveryNote/insert` also auto-transitions some parcels as a side effect of inclusion in a finalized BL.

### 2.9 Parcel Listing (DataTables)
`GET /deliveries/json` — server-side DataTables endpoint. Requires full DataTables column payload or returns 500. Most scenarios can use `GET /deliveries` (HTML page) with the DataTables AJAX call reused.

### 2.10 Account Profile
`GET /profile` — returns HTML with the merchant's configured pickup phone (`<input name="phone" value="0XXXXXXXXX">`). Pickup address is NOT present by default.

---

## 3. PDF Endpoints

All reside on `https://admin.quicklivraison.ma` and require the shared token:

```
token = ilernguzhnugfierhgurehfuizelhfnozehfuzi
```

This token is **global across all QL tenants**, embedded inline in QL's own dashboard JS. No session required.

| Endpoint | Parameters | Purpose |
|---|---|---|
| `GET /pdf-parcel-ticket` | `token`, `parcel-code` (comma-separated list) | Parcel sticker(s) — exchange parcels show "Echange: ☑" |
| `GET /pdf-parcel-eticket` | `token`, `parcel-code` | Electronic sticker (A4 multi-up) |
| `GET /pdf-delivery-note` | `token`, `dn-ref` | BL summary PDF |
| `GET /pdf-delivery-note-tickets` | `token`, `dn-ref` | All parcel stickers for a BL (A4) |
| `GET /pdf-delivery-note-etickets` | `token`, `dn-ref` | All parcel e-stickers for a BL |

---

## 4. Critical Gotchas (empirically verified)

### 4.1 Public API silently drops `echange`
`POST /api/deliveries/store` accepts `echange=true` + `echange_colis=<code>` without error, but the backend discards both fields. The created parcel is a normal (non-exchange) parcel regardless of the value format sent.

Tested variants all produce byte-identical stickers:
- `echange=true` / `echange=on` / `echange=1`
- `is_exchange=true`
- `exchange=true`

**Only `/deliveries/store-ajax` (session endpoint) honors the exchange flag.**

### 4.2 HTML-checkbox convention: presence = true
QL's dashboard uses Laravel's HTML-form checkbox behavior. Any of these fields, **regardless of value**, is treated as "true" the moment the field is sent:
- `open` — allow open
- `try` — allow try-on
- `fragile` — fragile
- `echange` — exchange
- `is_stock` — stock mode

**To send `false`, OMIT the field entirely.** Sending `open=false`, `open=0`, or `open=no` all result in the "open" checkbox being ticked on the printed sticker.

For `is_stock` specifically: appending it (even as `is_stock=0`) flags the parcel as stock-mode, which **hides it from the BL pickup queue**. Omit unconditionally when creating pickup parcels.

### 4.3 BL visibility depends on zone + status + stock flag
The BL detail page (`/DeliveryNote/ref/{ref}`) lists only parcels that:
- Have pickup zone matching the BL's zone (auto-assigned when BL is created)
- Are not already in another BL
- Are NOT in stock mode (`is_stock` not set at creation)
- Status is not terminal (delivered/returned/cancelled/refused)

### 4.4 No webhook — polling required
QL does not expose a status webhook. To receive status updates in near-real-time, poll `/api/getParcelDetails/{tracking_number}` at fixed intervals and diff against the stored status. The DigiCom implementation uses a 15-minute cron (see §6).

### 4.5 Phone format is strict
Validation regex: `^\d{9}$` or `^0\d{9}$`. Spaces, dashes, `+212` prefix all rejected. Normalize before sending.

### 4.6 BL ref URL typo
Creation endpoint is `/delevery-note/create` (note: `delevery`), while detail page is `/DeliveryNote/ref/{ref}` (note: `DeliveryNote`). Both spellings coexist in production URLs.

---

## 5. Status Codes

Full list with mapping to DigiCom's master `package_statuses` table:

| QL raw code | Master code | Master label | Category | Terminal |
|---|---|---|---|---|
| `NEW_PARCEL`, `WAITING_PREPARATION`, `PREPARED`, `ENCORE_PREPARED` | `P_NEW` | Nouveau | `new` | no |
| `WAITING_PICKUP` | `P_E_RAMASSAGE` | En attente de ramassage | `pickup_pending` | no |
| `PICKED_UP`, `Ramassé` | `P_PACKED` | PACKED | `picked_up` | no |
| `SENT`, `Expédié`, `expédier par AMANA` | `P_SHIPPED` | Expédié | `in_transit` | no |
| `DELIVERED`, `Livré`, `Livrée` | `P_DELIVERED` | Livré | `delivered` | **yes** |
| `REFUSE`, `Refusé`, `Refusée`, `Refuser` | `p_refuser` | Refusé | `refused` | **yes** |
| `CANCELED`, `CANCELED_BY_SELLER`, `CANCELED_BY_SYSTEM`, `CANCELED_BY_VENDEUR`, `CANCELED_TEAM`, `Annulé`, `Annulé ( Suivi )`, `Annulé (équipe Quick livraison)`, `Annulé par Vendeur`, `annulée` | `5684` | Annulé | `cancelled` | **yes** |
| `RETURNED`, `RETOUR_CLIENT_DELIVERED`, `RETOUR_WAREHOUSE_RETURNED`, `Retourné` | `RETURNED` | Retourné | `returned` | **yes** |
| `PREPAR_RETURN`, `RETOUR_IN_PROGRESS`, `RETOUR_HUB_AVAILABLE`, `RETOUR_WAREHOUSE_RETURNED_IN_PROGRESS`, `RETOUR_CLIENT_PREPARED_FOR_DELIVERY`, `Au hub de retour`, `En cours de réception au hub de retour`, `En retour par AMANA`, `Retournée` | `P_Auhubderetour` | PRÉPARATION RETOUR | `returning` | **yes** |

---

## 6. DigiCom Adapter Architecture

### 6.1 Parcel creation routing
```
order.replace == true  → dashboard session flow (POST /deliveries/store-ajax, echange=on)
order.replace == false → public API (POST /api/deliveries/store)
```

### 6.2 BL creation flow
1. `GET /delevery-note/create` → parse 302 `Location` → BL ref.
2. `GET /DeliveryNote/ref/{ref}` → scrape numeric IDs for each tracking code.
3. `POST /DeliveryNote/insert` with `ids[]` + `ref` + `_token`.

### 6.3 Polling (no webhook)
- Edge function: `quicklivraison-poll-webhook`
- Cron: `*/15 * * * *` → `public.invoke_quicklivraison_poll('cron')`
- Per tick: walks non-terminal `company_parcels` rows for the QL provider, calls `provider-integration` `track_parcel`, compares French `statusLabel` with stored `status_label`, self-POSTs changes to `provider-webhook/{provider_id}/{secret}`.
- Terminal categories are excluded: `delivered, returned, returning, refused, cancelled`.
- Regression guard in `provider-webhook` blocks backward moves (e.g., `pickup_pending → new`).

### 6.4 City mapping
`docs/Providers/Cities/quicklivraison_cities.json` holds the 480-city list. Per-tenant mapping to DigiCom `master_cities` lives in `provider_cities` (`provider_type='quicklivraison'`). Unmapped cities fail parcel creation with a clear French error.

### 6.5 Credentials stored per provider row
On the `providers` table (`provider_type='quicklivraison'`):
- `api_key` — public API key
- `api_base_url` — defaults to `https://clients.quicklivraison.ma/api`
- `api_login` — dashboard email
- `api_password` — dashboard password

The dashboard credentials are required for exchange parcels and BL creation. Without them the adapter fails with: `Quick Livraison: api_login et api_password requis pour le flux bon de ramassage.`
