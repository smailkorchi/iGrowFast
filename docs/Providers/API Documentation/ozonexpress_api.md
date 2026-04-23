# OzonExpress API Documentation

## Base Information
- **Base URL**: `https://api.ozonexpress.ma/customers/{YOUR_ID}/{YOUR_API_KEY}`
- **PDF Base URL**: `https://client.ozoneexpress.ma`
- **Method**: POST
- **Encoding**: multipart/form-data (for most endpoints)

## Endpoints

### 1. Ajouter Nouveau colis (Add Parcel)
- **URL**: `POST /add-parcel`
- **Parameters (form-data)**:
    - `tracking-number` (optional): Custom tracking number
    - `parcel-receiver` (required): Full name
    - `parcel-phone` (required): Phone number
    - `parcel-city` (required): City ID (integer)
    - `parcel-address` (required): Full address
    - `parcel-note` (optional): Special instructions
    - `parcel-price` (required): COD amount in MAD
    - `parcel-nature` (optional): Content description
    - `parcel-stock` (required): 1 = stock, 0 = pickup
    - `parcel-open` (optional): 1 = Open, 2 = Don't open (default: 1)
    - `parcel-fragile` (optional): 1 = Yes, 0 = No (default: 0)
    - `parcel-replace` (optional): 1 = Yes, 0 = No (default: 0)
    - `products` (optional): JSON string e.g., `[{"ref": "PROD001", "qnty": 2}]`

### 2. Infos du colis (Parcel Info)
- **URL**: `POST /parcel-info`
- **Parameters**:
    - `tracking-number` (required): Tracking number

### 3. Tracking
- **URL**: `POST /tracking`
- **Parameters**:
    - `tracking-number` (required): Tracking number (Single string OR JSON array for bulk)

### 4. Bon De Livraison (Delivery Note)
Process in 4 steps:
1. **Create BL**: `POST /add-delivery-note` -> returns `{ "ADD-BL": { "NEW-BL": { "REF": "..." } } }`
2. **Add Parcels**: `POST /add-parcel-to-delivery-note`
    - `Ref`: BL Reference
    - `Codes[]`: List of tracking numbers
3. **Save BL**: `POST /save-delivery-note`
    - `Ref`: BL Reference
4. **Download PDFs**:
    - **Standard**: `https://client.ozoneexpress.ma/pdf-delivery-note?dn-ref={BL_REF}`
    - **Labels A4**: `https://client.ozoneexpress.ma/pdf-delivery-note-tickets?dn-ref={BL_REF}`
    - **Labels 10x10**: `https://client.ozoneexpress.ma/pdf-delivery-note-tickets-4-4?dn-ref={BL_REF}`

## Response Examples

### Success Create Delivery Note (BL):
```json
{
  "CHECK_API": { "RESULT": "SUCCESS", "MESSAGE": "Valide API Key" },
  "ADD-BL": {
    "CUSTOMER": { "RESULT": "SUCCESS", "MESSAGE": "Valid Customer" },
    "RESULT": "SUCCESS",
    "MESSAGE": "New BL ADDED",
    "NEW-BL": {
      "REF": "BL-130226-047961700-46-81384",
      "ID": 4796170
    }
  }
}
```

### Success Add Parcels to BL:
```json
{
  "ADD-PARCEL-BL": {
    "RESULT": "SUCCESS",
    "MESSAGE": "Processed parcels: 1 success, 0 errors",
    "PARCELS": { "AGA022625165301JB": "success" },
    "SUMMARY": { "total_processed": 1, "successful": 1, "errors": 0 }
  }
}
```

### Success Save BL:
```json
{
  "CHECK_API": { "RESULT": "SUCCESS", "MESSAGE": "Valide API Key" },
  "SAVE-BL": { "RESULT": "SUCCESS", "MESSAGE": "BL Saved" }
}
```

### Success Create Parcel:
```json
{
  "ADD-PARCEL": {
    "CUSTOMER": { "RESULT": "SUCCESS", "MESSAGE": "Valid Customer" },
    "RESULT": "SUCCESS",
    "MESSAGE": "New Parcel Added",
    "NEW-PARCEL": {
      "TRACKING-NUMBER": "jamaat022625164371LH",
      "RECEIVER": "test",
      "PHONE": "0762554432",
      "CITY_ID": 1618,
      "ADDRESS": "test...",
      "PRICE": 123,
      "NOTE": "tzst",
      "DELIVERED-PRICE": 35,
      "RETURNED-PRICE": 0,
      "REFUSED-PRICE": 10
    }
  }
}
```

### Success Tracking:
```json
{
  "CHECK_API": { "RESULT": "SUCCESS" },
  "TRACKING": {
    "TRACKING-NUMBER": "...",
    "RESULT": "SUCCESS",
    "HISTORY": {
      "1": { "STATUT": "Nouveau Colis", "TIME": "1771014694", "STATUT_STR": "2026-02-13 21:31" }
    },
    "LAST_TRACKING": { "STATUT": "Nouveau Colis" }
  }
}
```
