# COLIATY API Documentation

**Base URL:** `https://customer-api-v1.coliaty.com`

**Authentication:**
- Header: `Authorization: Bearer {public_key}:{secret_key}`
- Manage your keys in the Token Manager

---

## 🔐 AUTHENTICATION

### 1. Test Authentication
**GET** `/api/client/auth/test`

Test API key authentication and verify it's working correctly.

**Response:**
```json
{
  "success": true,
  "message": "Authentification API Key réussie",
  "data": {
    "authenticated_user": "user@example.com",
    "bussines": {
      "id": 123,
      "name": "Example Business",
      "code": "400",
      "phone": "0612345678",
      "hub_pickup": {
        "id": 1,
        "name": "HUB EXAMPLE"
      }
    },
    "api_access": true,
    "timestamp": "2026-01-06 13:03:23"
  }
}
```

---

## 🏙️ CITIES

### 1. Get Cities List
**GET** `/api/client/cities/getCities`

Retrieve a list of all active cities with their associated hub and category information.

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Liste des villes récupérée avec succès",
  "data": [
    {
      "city_id": 7736,
      "city_name": "Adouz",
      "city_code": "ADOZ",
      "hub_id": 6,
      "hub_name": "HUB BENIMELLAL"
    }
  ]
}
```

---

### 2. Get City Info
**GET** `/api/client/cities/info/{city_id}`

Retrieve detailed information for a specific city including hub information, pricing, and location data.

**Path Parameters:**
- `city_id`: City ID (integer)

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Informations de la ville récupérées avec succès",
  "data": {
    "city_name": "Adouz",
    "city_code": "ADOZ",
    "city_active": true,
    "city_hub": {
      "id": 6,
      "name": "HUB BENIMELLAL"
    },
    "category": {
      "name": "E",
      "ref": "E"
    },
    "fees": {
      "delivered": 45,
      "returned": 0,
      "refused": 10
    },
    "custom_pricing": {
      "type": "Frais personnalisé par ville",
      "delivered_price": "39",
      "returned_price": "0",
      "refused_price": "0"
    }
  }
}
```

---

## 🏢 WAREHOUSES

### 1. List Warehouses
**GET** `/api/client/warehouse/list`

Get list of all available warehouses with their hub information.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "AGADIR",
      "hub": {
        "id": 13,
        "name": "HUB AGADIR"
      }
    }
  ]
}
```

---

### 2. Get Warehouse Products and Variants
**GET** `/api/client/warehouse/getWarehouseProductsAndVariant/{warehouse_id}`

Get products and variants available in warehouses. Optionally filter by warehouse_id.

**Path Parameters:**
- `warehouse_id`: Warehouse ID (integer) - Optional

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Liste des produits récupérée avec succès",
  "data": {
    "warehouses": [
      {
        "warehouse_id": 1,
        "warehouse_name": "AGADIR",
        "products": [
          {
            "product_id": 361,
            "product_name": "Product N",
            "variants": [
              {
                "variant_id": 275,
                "variant_name": "Variant N1",
                "variant_sku": "PROD-N-001",
                "variant_photo": "",
                "stock_quantity": 0,
                "stock_hold": "0",
                "stock_last_update": {
                  "date": "2025-07-04 15:52:32.000000",
                  "timezone_type": 3,
                  "timezone": "Africa/Casablanca"
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

---

## 📦 PARCELS

### 1. Create Normal Parcel
**POST** `/api/client/parcel/normal`

Create a new normal parcel using API key authentication.

**Body Parameters:**
- `package_code`: Tracking code (optional) - Auto-generated if not provided
- `package_reciever`: Receiver name (required)
- `package_phone`: Phone (required) - Format: 06/07 + 8 digits
- `package_price`: Price (required) - Decimal with max 2 decimals
- `package_addresse`: Address (required)
- `package_city`: City ID (integer) or city name (string) - Required
- `package_content`: Content description (optional)
- `package_no_open`: Do not open (boolean)
- `package_replacement`: Is replacement (boolean)
- `package_old_tracking`: Old tracking number (required if replacement is true)

**Example Request:**
```json
{
  "package_code": "OWN_TRACKING",
  "package_reciever": "John Doe",
  "package_phone": "0787654321",
  "package_price": 150.5,
  "package_addresse": "123 Main Street, Downtown",
  "package_city": "Afourar",
  "package_content": "Handle with care - Electronics",
  "package_no_open": false,
  "package_replacement": false,
  "package_old_tracking": ""
}
```

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Colis créé avec succès",
  "data": {
    "package_code": "OWN_TRACKING",
    "package_id": 565048
  }
}
```

---

### 2. Create Stock Parcel
**POST** `/api/client/parcel/stock`

Create a new stock parcel with products from warehouses.

**Body Parameters:**
- `package_code`: Tracking code (optional) - Auto-generated if not provided
- `package_reciever`: Receiver name (required)
- `package_phone`: Phone (required)
- `package_price`: Price (required)
- `package_addresse`: Address (required)
- `package_city`: City ID or name (required)
- `package_no_open`: Do not open (boolean)
- `package_replacement`: Is replacement (boolean)
- `warehouse_id`: Warehouse ID (required)
- `products`: Array of products (required)
  - `variant_sku`: Product variant SKU (required)
  - `quantity`: Quantity (required)

**Example Request:**
```json
{
  "package_reciever": "Jane Smith",
  "package_phone": "0612345678",
  "package_price": 75.25,
  "package_addresse": "456 Oak Street, City Center",
  "package_city": "Afourar",
  "package_no_open": false,
  "package_replacement": false,
  "warehouse_id": 1,
  "products": [
    {
      "variant_sku": "PRODUCT_SKU_X",
      "quantity": 2
    },
    {
      "variant_sku": "PRODUCT_SKU_Y",
      "quantity": 1
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Colis de stock créé avec succès",
  "data": {
    "package_code": "afo01264897CS",
    "package_id": 565086,
    "products": [
      {
        "product_name": "Product A",
        "variant_name": "Variant A1",
        "variant_sku": "PRODUCT_SKU_X",
        "warehouse_name": "AGADIR",
        "quantity": 2
      }
    ]
  }
}
```

---

### 3. Create Normal Parcels (Batch)
**POST** `/api/client/parcel/normal/mass`

Create multiple normal parcels in a single request. Max 100 parcels per request.

**Body Parameters:**
- `parcels`: Array of parcel objects (max 100)
  - Each parcel follows same structure as single parcel creation

**Example Request:**
```json
{
  "parcels": [
    {
      "package_code": "OWN_CODE",
      "package_reciever": "John Doe",
      "package_phone": "0787654321",
      "package_price": 150.5,
      "package_addresse": "123 Main Street",
      "package_city": "Afourar",
      "package_content": "Electronics",
      "package_no_open": false,
      "package_replacement": false
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Batch creation completed: 1 successful, 1 failed",
  "data": {
    "success_parcels": {
      "parcel_1": "deazdzadazd"
    },
    "error_parcels": {
      "parcel_0": {
        "package_phone": "Le numéro de téléphone doit commencer par 06 ou 07 suivi de 8 chiffres"
      }
    }
  }
}
```

---

### 4. Create Stock Parcels (Batch)
**POST** `/api/client/parcel/stock/mass`

Create multiple stock parcels in a single request. Max 100 parcels per request.

**Body Parameters:**
- `parcels`: Array of stock parcel objects (max 100)
  - Each parcel follows same structure as single stock parcel creation

---

### 5. Get New Normal Parcels List
**POST** `/api/client/parcel/normal/new/list`

Get paginated list of new normal parcels for pickup with filtering and sorting (DataTable format).

**Body Parameters:**
- `draw`: Draw counter (integer)
- `start`: Starting index (integer)
- `length`: Number of records (integer)
- `search`: Search term (string)
- `status`: Filter by status (string)
- `city_id`: Filter by city ID (string)
- `date_from`: From date (string)
- `date_to`: To date (string)
- `date_type`: Date type - "UPDATED_DATE" or "CREATED_DATE"
- `order`: Array of ordering objects
- `columns`: Array of column objects

**Example Request:**
```json
{
  "draw": 1,
  "start": 0,
  "length": 5,
  "search": "",
  "status": "",
  "city_id": "",
  "date_from": "",
  "date_to": "",
  "date_type": "UPDATED_DATE",
  "order": [
    {
      "column": 0,
      "dir": "asc"
    }
  ],
  "columns": []
}
```

---

### 6. Get New Stock Parcels List
**POST** `/api/client/parcel/stock/new/list`

Get paginated list of stock parcels with filtering and sorting (DataTable format).

**Body Parameters:**
- `draw`, `start`, `length`, `search`, `status`, `city_id`, `date_from`, `date_to`, `date_type`, `order`, `columns` (same as normal parcels list)
- `warehouse`: Filter by warehouse (string)
- `product`: Filter by product (string)
- `variant`: Filter by variant (string)

---

### 7. Get All Parcels List
**POST** `/api/client/parcel/all/list`

Get paginated list of all parcels (normal and stock) with filtering and sorting.

**Body Parameters:**
- `draw`, `start`, `length`, `search`, `date_type`, `status`, `city_id`, `warehouse`, `product`, `variant`, `date_from`, `date_to`
- `user_id`: Filter by user ID (string)

---

### 8. Search Parcels
**GET** `/api/client/parcel/search?q={query}&limit={limit}`

Live search for parcels by code, receiver name, or phone number.

**Query Parameters:**
- `q`: Search query (required)
- `limit`: Max results (optional, default: 10)

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Search completed successfully",
  "data": {
    "results": [
      {
        "parcel_id": 549483,
        "package_code": "CL-20102025-75875",
        "package_reciever": "John Doe",
        "package_phone": "0648195807",
        "package_status": {
          "status_code": "TROIS",
          "status_extra": ""
        }
      }
    ],
    "total": 1,
    "query": "CL-20102025-75875"
  }
}
```

---

### 9. Get Parcel Details
**GET** `/api/client/parcel/info/{parcel_code}`

Get detailed information about a specific parcel.

**Path Parameters:**
- `parcel_code`: Parcel tracking code

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Détails du colis récupérés avec succès",
  "data": {
    "package_code": "CL-20102025-75875",
    "package_id": 549483,
    "details": {
      "package_id": 549483,
      "package_code": "CL-20102025-75875",
      "package_reciever": "John Doe",
      "package_phone": "0648195807",
      "package_price": "200",
      "package_addresse": "123 Main Street",
      "package_city": "Taroudannt",
      "package_status": "TROIS",
      "package_type": "STOCK",
      "package_products": [],
      "package_accessibility": {
        "can_view": true,
        "can_edit": true,
        "can_delete": true
      }
    }
  }
}
```

---

### 10. Update Normal Parcel
**PUT** `/api/client/parcel/normal/{parcel_code}`

Update an existing normal parcel. Only parcels with 'NEW_PARCEL' status can be updated.

**Path Parameters:**
- `parcel_code`: Parcel tracking code

**Body Parameters:** (Same as create normal parcel, except package_code)

---

### 11. Update Stock Parcel
**PUT** `/api/client/parcel/stock/{parcel_code}`

Update an existing stock parcel including products. Only parcels with 'NEW_PARCEL' status can be updated.

**Path Parameters:**
- `parcel_code`: Parcel tracking code

**Body Parameters:** (Same as create stock parcel, except package_code)

---

### 12. Delete Parcel
**DELETE** `/api/client/parcel/delete/{parcel_code}`

Delete a parcel by its code (soft delete). Only parcels with 'NEW_PARCEL' status can be deleted.

**Path Parameters:**
- `parcel_code`: Parcel tracking code

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Colis supprimé avec succès",
  "data": {
    "package_code": "AGA0925500430TY",
    "package_id": 500430
  }
}
```

---

### 13. Generate Parcel Label
**GET** `/api/client/parcel/generate-label/{parcel_code}`

Generate a PDF label for a specific parcel. Only works for normal parcels with NEW_PARCEL or WAITING_PICKUP status. Returns PDF as Base64 encoded string.

**Path Parameters:**
- `parcel_code`: Parcel tracking code

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Parcel label generated successfully",
  "data": {
    "pdf": "JVBERi0xLjQKJeLjz9MKMyAwIG9iago8PC9MZW5ndGggNCAwIFIvRmlsdGV..."
  }
}
```

---

### 14. Get Parcel History
**GET** `/api/client/parcel/history/{parcel_code}`

Get complete timeline of parcel history including status changes and data modifications.

**Path Parameters:**
- `parcel_code`: Parcel tracking code

**Response:**
```json
{
  "success": true,
  "code": 200,
  "message": "Détails du colis récupérés avec succès",
  "data": {
    "package_code": "CL-21102025-08623",
    "details": [
      {
        "id": "history_1761246993",
        "HISTORY_TYPE": "status_change",
        "HISTORY_TIMESTAMP": 1761246993,
        "HISTORY_STATUS": "REFUSE",
        "HISTORY_COMMENT": "Customer refused delivery",
        "HISTORY_ACTOR": [],
        "HISTORY_LIVREUR": {
          "name": "Delivery Service",
          "phone": "0612345678"
        }
      }
    ]
  }
}
```

---

### 15. Get Parcel Status
**GET** `/api/client/parcel/status/{parcel_code}`

Get current status information for a specific parcel.

**Path Parameters:**
- `parcel_code`: Parcel tracking code

**Response:**
```json
{
  "success": true,
  "code": 200,
  "data": {
    "status": {
      "code": "POSTPONED",
      "label": "Reporté",
      "date": "01/11/2025",
      "comment": "",
      "extra": ""
    },
    "parcel": {
      "code": "CL-27102025-92745",
      "receiver": "John Doe",
      "phone": "0647830143",
      "price": "200"
    },
    "business": {
      "name": "Example Business",
      "code": "690"
    }
  }
}
```

---

### 16. Get Parcel Statuses by Date Range
**POST** `/api/client/parcel/status-by-date-range`

Get status information for all parcels that had status changes within a specific date range.

**Body Parameters:**
- `date_start`: Unix timestamp (seconds since epoch) - Required
- `date_end`: Unix timestamp (seconds since epoch) - Required

**Example Request:**
```json
{
  "date_start": 1763510400,
  "date_end": 1763596800
}
```

**Response:**
```json
{
  "success": true,
  "code": 200,
  "data": [
    {
      "tracking": "CL-28102025-66092",
      "status": {
        "code": "PROGRAMMER",
        "label": "Programmé",
        "date": "19/11/2025",
        "timestamp": 1763510857,
        "comment": ""
      }
    }
  ]
}
```

---

## 📊 SYSTEM STATUS

### 1. Get Parcel Statuses
**GET** `/api/client/parcel/statuses`

Get all available parcel statuses with their labels.

**Response:**
```json
{
  "success": true,
  "data": {
    "all_statuses": [
      {
        "value": "NEW_PARCEL",
        "label": "Nouveau"
      },
      {
        "value": "WAITING_PICKUP",
        "label": "En attente de ramassage"
      },
      {
        "value": "DELIVERED",
        "label": "Livré"
      }
    ]
  }
}
```

---

## 📝 NOTES

### Phone Number Format
- Must start with 06 or 07 followed by 8 digits
- Example: `0612345678` or `0787654321`

### Price Format
- Must be a positive number with maximum 2 decimals
- Examples: `100`, `100.00`, `150.5`

### City Parameter
- Can be either city ID (integer): `6812`
- Or city name (string): `"Afourar"`
- City must exist in the database

### Package Code
- Optional when creating parcels
- Auto-generated if not provided
- Used as tracking identifier for all operations

### Batch Operations
- Maximum 100 parcels per batch request
- Returns both successful and failed parcels
- Failed parcels include validation errors

### Stock Parcels
- Require `warehouse_id` and `products` array
- Products identified by `variant_sku`
- Warehouse must cover the delivery hub zone

### Parcel Status
- Only parcels with `NEW_PARCEL` status can be edited or deleted
- Label generation only for `NEW_PARCEL` or `WAITING_PICKUP` status
- Normal parcels only for label generation (not stock parcels)

### Error Responses
All endpoints follow standard error format:
```json
{
  "success": false,
  "code": 400,
  "message": "Error message",
  "errors": {
    "field_name": "Specific error"
  }
}
```

### Authentication Headers
All requests must include:
```
Authorization: Bearer {public_key}:{secret_key}
Content-Type: application/json
```
