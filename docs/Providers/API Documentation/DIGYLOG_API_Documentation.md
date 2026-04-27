# Digylog API — Integration Notes

Reference for DigiCom's Digylog adapter. Captured 2026-04-27.
Public spec: Digylog `Api Seller v2.4` (Oct 20, 2025).

## Base URLs
- REST API: `https://api.digylog.com/api/v2/seller/`
- Dashboard: `https://apiseller.digylog.com`
- Public docs PDF: bundled in `docs/Providers/API Documentation/Digylog api.pdf`

---

## 1. Authentication

Static **Bearer token**, no `/login` endpoint. The token is the seller's "API Access Key" (provisioned in their dashboard).

Mandatory headers on **every** request:

| Header | Value |
|---|---|
| `Authorization` | `Bearer {token}` |
| `Referer` | `https://apiseller.digylog.com` |
| `Content-Type` | `application/json` (when sending a body) |
| `Accept` | `application/json` (recommended) |

**Quirks discovered empirically:**
- Docs say `bearer` (lowercase) — but the API rejects lowercase with `OAuth2 authentication required`. Capitalised `Bearer` is required.
- Missing `Referer` returns the same error. Always set it.

DigiCom adapter stores the token on `providers.api_key`. Login/password fields are dashboard-only and not used by the API.

---

## 2. Reference data

### 2.1 Networks — `GET /networks`
List of regional networks (~2 active for our test account: Agence Agadir, Agence Casablanca).
```json
[ { "id": 1, "name": "Agence Agadir" }, { "id": 2, "name": "Agence Casablanca" } ]
```
DigiCom stores the chosen network on `providers.digylog_network_id` (admin Permissions modal dropdown).

### 2.2 Stores — `GET /stores`
Seller's registered shops (used as the "store" string on parcel creation).
```json
[ { "id": 9217, "name": "rim benyssef" }, { "id": 9218, "name": "GOLDEN DESIGN" } ]
```
DigiCom stores the chosen store on `providers.digylog_store_name`.

### 2.3 Cities — `GET /cities`
606 cities (as of 2026-04-27). Format:
```json
[ { "id": 1, "name": "Agadir", "nameAr": "اكادير" }, { "id": 2, "name": "Marrakech", "nameAr": "مراكش" } ]
```
**Posting accepts city `name`, not `id`** (per docs and confirmed empirically). DigiCom seeds `provider_cities.provider_city_name` for the `digylog` provider type via pg_trgm fuzzy match (same pattern as Coliaty).

Optional `?hub=N` parameter scopes by hub.

### 2.4 Statuses — `GET /statuses`
Authoritative status dictionary. Snapshot for our integration:
```
0  Non envoyée                          → new
1  En cours de réception au hub …       → pickup_pending
2  Reçu                                 → in_transit
3  En cours de livraison                → out_for_delivery
4  Injoignable                          → no_answer
5  Reportée                             → postponed
6  Livrée                               → delivered
7  Annulée                              → canceled
8  Retournée                            → returned
9  Refusée                              → refused
…
```
Webhook payloads carry both the numeric `idStatus` and the `status` label. Adapter matches on the label string via `package_statuses.delivery_service_statuses`.

### 2.5 Fulfilment centres — `GET /fc`
Used only in mode=2 (FC orders). Not exposed in DigiCom v1.

### 2.6 Pickup areas — `GET /pickup/areas?network=N`
Used when creating per-parcel pickup requests. **Not used by DigiCom** — sellers schedule pickups manually from Digylog's dashboard.

---

## 3. Orders (parcels) — `POST /orders`

```json
{
  "mode": 1,
  "network": 1,
  "store": "GOLDEN DESIGN",
  "status": 0,
  "checkDuplicate": 1,
  "orders": [
    {
      "num": "DC-12345",
      "type": 1,
      "name": "Amina Chraibi",
      "phone": "0626125632",
      "address": "Hay Karima Apt 6",
      "city": "Agadir",
      "price": 199,
      "openproduct": 0,
      "port": 2,
      "note": "Call before arriving",
      "refs": [ { "designation": "Robe rouge", "quantity": 1 } ],
      "pickup": 0
    }
  ]
}
```

**DigiCom conventions:**
- `mode=1` (standard) — only mode supported in v1. mode=2 (FC) requires `fc` instead of `network`.
- `network` — `providers.digylog_network_id`.
- `store` — `providers.digylog_store_name` (the **name** string, not the id).
- `status=0` — add only. The BL is created later by `PUT /orders/send`.
- `checkDuplicate=1` — Digylog rejects duplicates (same `num` already on file).
- `port` — `1` = customer pays delivery, `2` = seller pays. Per-provider config (`providers.digylog_default_port`, default 2).
- `openproduct` — `1` allows the customer to open the parcel before paying. From `providers.digylog_allow_open`.
- `pickup=0` — sellers schedule pickups via Digylog dashboard.
- `type=1` normal, `type=2` exchange. For type=2, `refs[].ref` (product SKU) is required; for type=1, `refs[].designation`.

**Response on success:** array — one object per submitted order:
```json
[ { "num": "DC-12345", "tracking": "S1036052CA", ... } ]
```

Tracking codes start with `S` (standard) or other letters depending on order type.

---

## 4. BL (Bon de Livraison)

Digylog has no "create empty BL" endpoint. BL is generated once by **`PUT /orders/send`** with the list of trackings and is **immutable** afterwards.

### 4.1 Send orders (= create BL) — `PUT /orders/send`
```json
{ "orders": ["S1036052CA", "S1036052CB", "S1036052CC"] }
```
Returns `{ "bl": 1036052 }`.

DigiCom flow (mirrors Sendit):
1. `createDeliveryNote()` returns a draft `DIGYLOG-DRAFT-{ts}`.
2. First `addParcelsToNote(draft, codes)` calls `PUT /orders/send` and replaces the draft reference with the real BL id.
3. Subsequent adds throw — BL is immutable, sellers must create a new note.

### 4.2 Print BL PDF — `GET /bl/{id}/pdf`
Returns the BL PDF (binary). Adapter encodes as a `data:application/pdf;base64,…` URL.

### 4.3 Print labels — `POST /labels`
```json
{ "bl": 1036052, "format": 1 }
```
or
```json
{ "orders": "S1036052CA,S1036052CB", "format": 1 }
```

`format`:
- `1` = A4, 4 labels/page
- `2` = A4, 8 labels/page
- `3` = thermal 100×100
- `4` = thermal 70×100
- `5` = thermal 60×100

Returns the PDF blob. All five formats are exposed in the DeliveryNote print dropdown.

---

## 5. Tracking

### 5.1 Order info — `GET /order/{tracking}/infos`
Returns `{ id, hub_id, deliveryCost, … }`. Used by trackParcel as a sanity check.

### 5.2 Order refs — `GET /order/{tracking}/refs`
Returns the products attached to the order.

### 5.3 Status history — `GET /historics?trackings=S1,S2,…`
**Primary tracking source.** Returns an object keyed by tracking code:
```json
{
  "S4001940AA": [
    { "date": "2024-02-06", "type": "Changement Status", "location": "Hub Agadir",
      "old value": "En cours de livraison", "new value": "Livrée" }
  ]
}
```

DigiCom adapter walks the array; `new value` is the human-readable status label, mapped via `package_statuses`. `location` becomes the `hub` field on the timeline.

---

## 6. Webhooks (Native, API-registered)

Unlike Sendit/Forcelog (dashboard-configured), Digylog accepts webhook URLs **via API**.

### 6.1 Register — `PUT /webhook`
```json
{ "url": "https://….supabase.co/functions/v1/provider-webhook/{provider_id}/{webhook_secret}" }
```
Returns `{ "message": "webhook updated successfully" }`.

DigiCom auto-calls this immediately after the provider is created or its credentials are updated (see `companyMutation` in `src/pages/admin/DeliveryServices.tsx`). No manual setup required.

### 6.2 Payload (PUT, JSON)
```json
{
  "tracking": "S1036052CA",
  "status": "Livrée",
  "idStatus": 6,
  "motif": "",
  "postponedTo": null,
  "updatedAt": "2025-02-10"
}
```

**Quirks:**
- HTTP method is **`PUT`**, not POST. DigiCom's `provider-webhook` already accepts any non-OPTIONS method.
- The docs misspell the key as **`traking`** in one table — DigiCom extracts both `payload.tracking || payload.traking` defensively.
- `status` is the localised label string. `idStatus` is the numeric id from `GET /statuses`.

### 6.3 Test — `PUT /order/{tracking}/status`
Lets you simulate a status change from the dashboard to verify the webhook flow.

```json
{ "status": 6, "postponedTo": "2025-02-12" }
```
`postponedTo` is required when `status ∈ {5, 18, 44}`.

---

## 7. Complaints / exceptions — `POST /complaints`

Multiple complaint types share the same endpoint, discriminated by `type`:

| `type` | Use case |
|---|---|
| `1` | Urgent delivery |
| `2` | Change recipient |
| `3` | Request another attempt |
| `4` | Delay in updating order status |
| `5` | Cancel request (with motif) |
| `9` | Change infos (name, phone, address, price) |
| `10` | Return request |

Read complaints with `GET /order/{tracking}/complaints`. **Not exposed in DigiCom v1** — sellers handle exceptions from Digylog's dashboard.

---

## 8. Routing summary

| Operation | Endpoint | Notes |
|---|---|---|
| Networks list | `GET /networks` | Permissions modal dropdown |
| Stores list | `GET /stores` | Permissions modal dropdown |
| Cities list | `GET /cities` | Seeded into provider_cities |
| Statuses dict | `GET /statuses` | Mapped to package_statuses |
| Create parcel | `POST /orders` | mode=1, status=0 (BL deferred) |
| Send → create BL | `PUT /orders/send` | Returns `{bl}` (immutable) |
| Get refs | `GET /order/{tracking}/refs` | |
| Status history | `GET /historics?trackings=…` | Primary tracking |
| Order info | `GET /order/{tracking}/infos` | Hub + delivery cost |
| Print labels | `POST /labels` | format 1–5 |
| Print BL PDF | `GET /bl/{id}/pdf` | Final BL document |
| Webhook register | `PUT /webhook` | Auto-called on save |
| Webhook event (incoming) | PUT to our URL | `{tracking,status,idStatus,…}` |
| Test webhook | `PUT /order/{tracking}/status` | Trigger from dashboard |
| Complaint | `POST /complaints` | Not in v1 |
| Pickup areas | `GET /pickup/areas` | Not in v1 |

---

## 9. DigiCom Adapter Decisions

- **Auth** — Bearer token only (`api_key`). Capitalised `Bearer`, mandatory `Referer`.
- **Stock disabled** — Digylog doesn't expose a stock concept; nothing to skip.
- **Pickup** — always `pickup=0`. Sellers schedule from Digylog dashboard.
- **Port (delivery payer)** — Permissions toggle `digylog_default_port` (1=customer, 2=seller, default 2).
- **Open product** — Permissions toggle `digylog_allow_open` → `openproduct` field.
- **Network + Store** — Permissions modal dropdowns, populated by `list_networks` / `list_stores` edge actions.
- **BL flow** — Sendit-pattern draft → real upgrade. Once sent, BL is immutable; subsequent adds throw and force a new note.
- **Exchange** — `type=2` on the order; uses product `ref` instead of `designation`. No old-tracking column required (Digylog doesn't link the new parcel to a previous one via API).
- **Webhook** — auto-registered on provider create/update via `register_webhook` action. URL signed by the standard `{provider_id}/{webhook_secret}` path gate.
- **Print formats** — all six exposed in the DeliveryNote dropdown (4-up, 8-up A4, three thermal sizes, BL PDF).
- **Polling fallback** — `GET /historics` covers the case where a webhook is missed.
