# VITEX API Documentation

Complete reference covering the officially-documented public REST API and the undocumented dashboard-session endpoints reverse-engineered for the DigiCom adapter. The dashboard flow is required for special options (fragile, no-open, exchange) and PDF printing — the public API alone covers creation + tracking + BL basics.

## Base URLs

| Purpose | Base URL |
|---|---|
| Public API (Bearer) | `https://vitex.ma/clients-api` |
| Dashboard (session) | `https://vitex.ma/clients` |
| Dashboard login | `https://vitex.ma/clients/login` |

## Authentication

Two mechanisms coexist:

1. **Public API** — `Authorization: Bearer {api_key}` header. No session/CSRF. Cloudflare-protected, so requests must include a browser-like `User-Agent` from unknown IP ranges.
2. **Dashboard session** — `PHPSESSID` cookie after POST login. **No CSRF token required** (unlike QL). Session persists until logout or cookie expiry.

Cloudflare will challenge requests lacking a legitimate `User-Agent` header.

---

## 1. Public REST API (Bearer Token)

All endpoints accept `POST` with `Content-Type: application/json`.

### 1.1 Health Check — `POST /test`
Verifies the API key works. Returns success on valid auth.

### 1.2 List Statuses — `POST /list-status`
**Request body:** `{}`

**Response:**
```json
{
  "status": "success",
  "code": 200,
  "message": "Statuts récupérés avec succès.",
  "data": [
    {
      "statut_code": "DELIVERED",
      "statut_name": "Livré",
      "status_require_comment": false,
      "status_require_date": false
    }
  ]
}
```
Returns 26 status codes. See §5 for the full mapping.

### 1.3 List Cities — `POST /list-ville`
**Request body:** `{}`

**Response:**
```json
{
  "status": "success",
  "code": 200,
  "data": [
    { "city_id": "4462", "city_code": "MKR", "city_name": "Marrakech " },
    { "city_id": "4469", "city_code": "CAS", "city_name": "casablanca" }
  ]
}
```
350 cities total. **Note:** `city_name` has inconsistent casing and trailing whitespace in the raw data. Normalize before matching.

### 1.4 Create Parcel — `POST /add-parcels`
Batch-create up to 100 parcels per request.

**Classic (pickup) mode:**
```json
{
  "parcels": [
    {
      "id": 1,
      "parcel_receiver": "Mohammed Ali",
      "parcel_phone": "0677667766",
      "parcel_price": "220",
      "parcel_city": "AGADIR",
      "parcel_address": "Hay Dakhla",
      "parcel_note": "Appeler avant livraison",
      "marchandise": "Produits cosmétiques",
      "parcel_product_qty": 2
    }
  ]
}
```

**Stock mode:**
```json
{
  "parcels": [
    {
      "id": 1,
      "parcel_from_stock": 1,
      "parcel_receiver": "Fatima Zahra",
      "parcel_phone": "0661223344",
      "parcel_price": "350",
      "parcel_city": "CASABLANCA",
      "parcel_address": "Maarif, Rue des Roses",
      "warehouse": "CASABLANCA",
      "products": [
        {
          "product_name": "T-Shirt Premium",
          "product_variant_name": "Rouge - Taille M",
          "product_qty": 2
        }
      ]
    }
  ]
}
```

**Field reference:**
| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | number | yes | Client-supplied row identifier — echoed in response for correlation |
| `parcel_receiver` | string | yes | Receiver full name |
| `parcel_phone` | string | yes | 10-digit MA phone |
| `parcel_price` | string | yes | COD amount (MAD) |
| `parcel_city` | string | yes | **City NAME** (case-insensitive, e.g. "AGADIR"). Dashboard uses `city_id` instead. |
| `parcel_address` | string | yes | Full address |
| `parcel_note` | string | no | Internal comment |
| `marchandise` | string | no | Classic-mode product description |
| `parcel_product_qty` | number | no | Classic-mode quantity |
| `parcel_from_stock` | number | no | `1` = stock mode |
| `warehouse` | string | cond. | Stock-mode warehouse name (required when `parcel_from_stock=1`) |
| `products` | array | cond. | Stock-mode items `[{product_name, product_variant_name, product_qty}]` |

**Response:**
```json
{
  "status": "success",
  "code": 200,
  "data": {
    "success": { "1": "AGA1024105204MR" },
    "failed": {}
  }
}
```
`success` and `failed` are maps of `request.parcels[i].id` → tracking number (or error string).

**Limitation:** the public API has no `fragile`, `open`, or exchange/replacement fields. Use §2.1 dashboard creation for those.

### 1.5 Tracking (History) — `POST /tracking`
**Body:** `{ "tracking_number": "AGA1024105204MR" }`

**Response:**
```json
{
  "status": "success",
  "code": 200,
  "data": [
    { "statut_code": "NEW_PARCEL", "statut_name": "Nouveau Colis", "created_at": "2024-03-02 13:36" },
    { "statut_code": "DELIVERED",  "statut_name": "Livré",         "created_at": "2024-03-04 17:43" }
  ]
}
```
Flat array, chronological. **Last entry = current status.** No sub-status.

### 1.6 Current Status — `POST /parcelstatus`
**Body:** `{ "tracking_number": "AGA1024105204MR" }`
Lightweight variant of `/tracking` returning only the latest entry. Cheaper when history isn't needed.

### 1.7 Bulk Status by Date Range — `POST /parcel-status-listing-bydate`
**Body:** `{ "date_start": 1701705879, "date_end": 1736279084 }` (Unix seconds).
Returns every parcel's current status in the date window in one call.

**Use case:** efficient polling — one request instead of N per-parcel calls.

### 1.8 Inventory — `POST /inventory`
**Body variants:**
- `{}` — full inventory
- `{ "warehouse": "CASABLANCA" }` — filter by warehouse
- `{ "product_name": "T-Shirt" }` — partial-match search

### 1.9 Create BL — `POST /create-delivery-note`
**Body variants:**
- `{}` — include every `NEW_PARCEL` non-stock parcel in the current hub
- `{ "tracking_codes": ["AGA1024105204MR", "CAS0326733865MUC"] }` — specific parcels
- `{ "hub_id": 5 }` — override hub (defaults to merchant's primary hub)

**Response:**
```json
{
  "status": "success",
  "code": 200,
  "message": "Bon de livraison créé avec succès",
  "data": {
    "delivery_note_ref": "BL-210326-012340-45-176",
    "hub_id": 5,
    "parcels_added": ["CAS0326733865MUC", "AGA1024105204MR"],
    "parcels_count": 2,
    "failed": {},
    "not_found": []
  }
}
```

**Key behavior:** BL creation **auto-transitions all included parcels from `NEW_PARCEL` → `WAITING_PICKUP`**. No separate pickup submission required (unlike QL).

**Constraint:** only `NEW_PARCEL` non-stock parcels are eligible.

### 1.10 Create Stock BL — `POST /create-delivery-note-stock`
**Body:**
- `{ "warehouse": "CASABLANCA" }` — all stock parcels from the warehouse
- `{ "warehouse": "CASABLANCA", "tracking_codes": [...] }` — specific parcels

Stock is verified and deducted automatically.

---

## 2. Dashboard Session API (undocumented, reverse-engineered)

Required for: fragile option, no-open option, exchange parcels, delete parcel, delete BL, PDF downloads.

### 2.1 Login
1. `GET /clients/login` — seeds `PHPSESSID` cookie.
2. `POST /clients/login?action=login`
   Content-Type: `application/x-www-form-urlencoded`
   Header: `X-Requested-With: XMLHttpRequest`
   Body:
   - `login_customers_email` — email OR username
   - `login_customers_password` — password

   **Success response** (HTML with embedded JS):
   ```js
   showCustomSwal("success", "Connexion réussie", "Vous êtes connecté avec succès", 0, 5);
   setTimeout(function(){ $(location).attr("href","home"); }, 1000);
   ```

   **Failure** — contains `showCustomSwal("error", ...)`. No redirect.

3. Subsequent requests include the `PHPSESSID` cookie. No CSRF header required.

### 2.2 Create Parcel (full feature set)
`POST /clients/parcels?action=add-action`
Content-Type: `application/x-www-form-urlencoded`
Header: `X-Requested-With: XMLHttpRequest`

**Body fields:**
| Field | Type | Notes |
|---|---|---|
| `action` | `add-action` | (also included as query string) |
| `current_business_id` | number | Multi-business selector (Vitex accounts can have multiple shops) |
| `parcel_receiver` | string | |
| `parcel_phone` | string | |
| `parcel_city` | number | **`city_id` from `/list-ville`** — NOT the name (different from public API) |
| `parcel_address` | string | |
| `parcel_prd_name` | string | Product name (different name from public API's `marchandise`) |
| `parcel_prd_qty` | number | Quantity (different from public API's `parcel_product_qty`) |
| `parcel_note` | string | |
| `parcel_price` | number | COD |
| `parcel_is_fragile` | 0/1 | Fragile surcharge (confirmed 5 DH added to parcel) |
| `parcel_open` | 0/1 | **Semantic:** `1` = "Interdit d'ouvrir" (DO NOT open). Inverse of QL convention. |
| `replacing_parcel_code` | string | Exchange: previous parcel tracking. Empty string = not an exchange. |
| `hub_id` | number | Merchant warehouse hub |

**Response:** HTML with embedded JS:
```js
window.lastCreatedParcel = {
  code: "MKR0426777002LPR",
  id: 777002,
  isFragile: true,
  fragileFee: 5,
  businessId: 3434
};
```

Scrape `window.lastCreatedParcel.code` for the tracking number.

### 2.3 Create BL (session)
`GET /clients/delivery-note?action=create`
Returns JSON or HTML redirecting to the new BL's edit page. Extract the BL reference from the redirect URL (pattern `BL-YYMMDD-XXXXXXXX-XX-BUSINESSID`).

### 2.4 Add Parcel to BL
`GET /clients/parcels-waiting-pick-up?action=add-to-delivery&dn-ref={BL_REF}&parcel-code={PARCEL_CODE}`

**Response:** HTML with embedded JS:
```js
ajaxResult("Colis ajouté avec succès au bon de livraison");
```

### 2.5 Remove Parcel from BL
`GET /clients/parcels-waiting-pick-up?action=remove-from-delivery&dn-ref={BL_REF}&parcel-code={PARCEL_CODE}`

### 2.6 Delete BL
`GET /clients/delivery-note?action=delete&dn-ref={BL_REF}`
**Irreversible.**

### 2.7 Delete Parcel
`GET /clients/parcels?action=delete&parcel-code={PARCEL_CODE}`
**Irreversible.**

### 2.8 PDF Downloads (session-gated — no public token)
| Format | URL pattern |
|---|---|
| BL bordereau | `/clients/pdf-delivery-note?dn-ref={REF}` |
| BL stickers (A4) | `/clients/pdf-delivery-note-tickets?dn-ref={REF}` |
| BL e-stickers | `/clients/pdf-delivery-note-etickets?dn-ref={REF}` |

**All PDFs require authenticated cookie.** Unlike QL (shared global token), Vitex PDFs are strictly session-scoped — the adapter must either stream them through the edge function or mint a short-lived pre-signed URL.

---

## 3. Critical Gotchas

### 3.1 Public vs Dashboard city field diverges
- Public API `/add-parcels`: `parcel_city` = **city name string** (e.g. `"AGADIR"`)
- Dashboard `/clients/parcels?action=add-action`: `parcel_city` = **numeric city_id** (e.g. `4462`)

Always cross-reference with `/list-ville` before creating.

### 3.2 Public API lacks special options
`fragile`, `open`, and `replacing_parcel_code` are dashboard-only. A parcel created via public API cannot be flagged as fragile or exchange. If any of those toggles are set on the DigiCom order, route through the dashboard path.

### 3.3 `parcel_open=1` means "do NOT open"
Inverse semantic from QL (`open=on` = "can open"). The dashboard label reads "Interdit d'ouvrir" — translate carefully when mapping UI state.

### 3.4 Cloudflare bot challenge
Public API requests from unknown server IPs / non-browser User-Agents may receive a Cloudflare 403 HTML challenge page. Send a Chrome-desktop `User-Agent` header. Supabase edge functions have been observed working without challenges.

### 3.5 No webhook
Vitex does not push status updates. Polling is required. `/parcel-status-listing-bydate` is the efficient choice — one call returns all parcels in a date window.

### 3.6 Phone format
10 digits expected (Moroccan format, leading `0`). Spaces, dashes, `+212` prefix — normalize before sending.

### 3.7 Multi-business
Vitex accounts may own multiple businesses (`business_id`). The dashboard has a top-bar business switcher and all requests include `current_business_id`. The public API implicitly uses the api_key's primary business. If a merchant has multiple businesses, dashboard operations must target the correct one via the request parameter.

### 3.8 BL create is single-shot
Unlike QL (`GET /delevery-note/create` → scrape IDs → `POST /DeliveryNote/insert`), Vitex's `POST /create-delivery-note` accepts `tracking_codes[]` directly and returns the BL ref + confirmed list. No HTML scraping needed.

### 3.9 BL auto-transitions parcels
Adding a parcel to a BL (via `/create-delivery-note` or the session `add-to-delivery` action) automatically moves it from `NEW_PARCEL` to `WAITING_PICKUP`. No separate pickup request endpoint.

---

## 4. Inferred / Undocumented Statuses

The following status codes surfaced in responses but are absent from `/list-status`:

| Code | Source | Notes |
|---|---|---|
| `NEW_PARCEL` | `/tracking` response, BL docs | Initial state after parcel creation |
| `WAITING_PICKUP` | BL docs | Auto-assigned when added to a BL |

---

## 5. Status Code Mapping

Full enumeration from `/list-status` (26 codes) + the 2 inferred codes, mapped to DigiCom's master `package_statuses` categories.

### Delivery-state codes (tracked as parcel status)

| Vitex `statut_code` | `statut_name` | DigiCom category | Terminal |
|---|---|---|---|
| `NEW_PARCEL` | Nouveau Colis | `new` | no |
| `WAITING_PICKUP` | En attente de ramassage | `pickup_pending` | no |
| `POSTPONED` | Reporté | `in_transit` | no |
| `NOANSWER` | Pas de réponse | `in_transit` | no |
| `UNREACHABLE` | Injoignable | `in_transit` | no |
| `OUT_OF_AREA` | Hors-zone | `in_transit` | no |
| `ERR` | Numero Erroné | `in_transit` | no |
| `DEUX` | Deuxième Appel Pas Réponse | `in_transit` | no |
| `TROIS` | Troisième Appel Pas Réponse | `in_transit` | no |
| `PROGRAMMER` | Programmé | `in_transit` | no |
| `EN_VOYAGE` | En Voyage | `in_transit` | no |
| `WAIT_RELANCE` | Attende de relancer | `in_transit` | no |
| `BV` | Boite Vocal | `in_transit` | no |
| `RELANCER` | RELANCER (confirmation VITEX) | `in_transit` | no |
| `PAS_DE_REPONSE_SMS` | Pas de reponse SMS (suivi VITEX) | `in_transit` | no |
| `CONF` | Confirmé (call center) | `in_transit` | no |
| `CIS` | CLIENT INTERESSE | `in_transit` | no |
| `DELIVERED` | Livré | `delivered` | **yes** |
| `REFUSE` | Refusé | `refused` | **yes** |
| `CANCELED` | Annulé | `cancelled` | **yes** |
| `CANCELEDE` | Annuler (SUPPORT vitex) | `cancelled` | **yes** |
| `RETURN_BY_AMANA` | En retour | `returning` | **yes** |
| `RETURNE` | Retour en cours de traitement par le livreur | `returning` | **yes** |
| `PREPARATION_RETOUR` | Préparation du retour | `returning` | **yes** |
| `INSPECTION_APRES_ECHEC_LIVR` | Inspection Après Échec Livraison | `returning` | **yes** |

### Financial-state codes (tracked separately — NOT parcel status)

| Vitex code | Meaning | Stored in |
|---|---|---|
| `NOT_PAID` | Non Payé | `situation` field |
| `PAID` | Payé | `situation` field |
| `INVOICED` | Facturé | `situation` field |

These describe payout state, not delivery state. The adapter must NOT map them into `package_statuses`.

---

## 6. DigiCom Adapter Architecture

### 6.1 Credentials (stored per `providers` row)
| Column | Purpose |
|---|---|
| `api_key` | Public API bearer token |
| `api_base_url` | `https://vitex.ma/clients-api` |
| `api_login` | Dashboard email/username |
| `api_password` | Dashboard password |
| `business_id` | `current_business_id` — required for dashboard parcel creation |

### 6.2 Parcel creation routing
```
if order.replace || provider.vitex_parcel_fragile || order.disallow_open:
    → dashboard /clients/parcels?action=add-action (session)
else:
    → public API /clients-api/add-parcels (bearer)
```

### 6.3 BL flow
Single-path via public API:
1. `POST /clients-api/create-delivery-note` with `tracking_codes[]` → returns `delivery_note_ref`.
2. Add/remove individual parcels later via dashboard session endpoints (§2.4, §2.5).
3. Delete via dashboard (§2.6).

### 6.4 Polling (no webhook)
- Edge function: `vitex-poll-webhook` — mirrors `ozon-poll-webhook` + `quicklivraison-poll-webhook`.
- Cron: `*/15 * * * *` → `public.invoke_vitex_poll('cron')`.
- Uses `/parcel-status-listing-bydate` (bulk) to reduce API calls — one request per poll tick covers all non-terminal parcels.
- Terminal categories excluded: `delivered, returned, returning, refused, cancelled`.

### 6.5 City mapping
- Seed source: `docs/Providers/Cities/vitex_cities.json` (350 rows).
- Per-tenant mapping in `provider_cities` (`provider_type='vitex'`).
- Dashboard parcel creation uses `city_id` (numeric); public API uses `city_name` (string). Store `city_id` as `provider_city_id` and the name as metadata.

### 6.6 PDF handling
Because PDFs are session-gated, the adapter must either:
- Stream the PDF bytes through the edge function (authenticate → download → return to caller), or
- Generate a short-lived signed URL backed by Supabase Storage after pre-fetching.

Direct-link PDF URLs (as used for QL) do NOT work — Vitex PDFs will return 302 → login.
