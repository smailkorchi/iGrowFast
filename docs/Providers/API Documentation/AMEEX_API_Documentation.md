# AMEEX API Documentation

**Base URL:** `https://api.ameex.app`

**Authentication:**
- Header: `C-Api-Id` - Your API ID
- Header: `C-Api-Key` - Your API Key

---

## 📦 PARCEL ENDPOINTS

### 1. Add Parcel
**POST** `/customer/Delivery/Parcels/Action/Type/Add`

**Parameters:**
- `type`: SIMPLE / STOCK
- `business`: Business ID (API ID) - Required
- `order_num`: Order Number - Optional
- `replace`: true / false
- `exchange_code`: Exchange Parcel Code
- `open`: YES / NO
- `try`: YES / NO
- `fragile`: 0 / 1
- `receiver`: Receiver Name - Required
- `phone`: Phone - Required
- `city`: City ID - Required
- `address`: Address - Required
- `comment`: Comment - Optional
- `product`: Product Name - Optional
- `cod`: COD/CRBT/Price - Required
- `products[0][id]`: Optional
- `products[0][qty]`: Optional

---

### 2. Edit Parcel
**POST** `/customer/Delivery/Parcels/Action/Type/Edit?ParcelCode={code}`

**Query Params:**
- `ParcelCode`: Parcel tracking code

**Body Parameters:** (Same as Add Parcel, except `type` and `business`)
- `order_num`: Order Number - Optional
- `replace`: true / false
- `exchange_code`: Exchange Parcel Code
- `open`: YES / NO
- `try`: YES / NO
- `fragile`: 0 / 1
- `receiver`: Receiver Name - Required
- `phone`: Phone - Required
- `city`: City ID - Required
- `address`: Address - Required
- `comment`: Comment - Optional
- `product`: Product Name - Optional
- `cod`: COD/CRBT/Price - Required
- `products[0][id]`: Optional
- `products[0][qty]`: Optional

---

### 3. Delete Parcel
**DELETE** `/customer/Delivery/Parcels/Action/Type/Delete?ParcelCode={code}`

**Query Params:**
- `ParcelCode`: Parcel tracking code

---

### 4. Parcel Info
**GET** `/customer/Delivery/Parcels/Info?ParcelCode={code}`

**Query Params:**
- `ParcelCode`: Parcel tracking code

---

### 5. Parcel Tracking
**GET** `/customer/Delivery/Parcels/Tracking?ParcelCode={code}`

**Query Params:**
- `ParcelCode`: Parcel tracking code

---

### 6. Parcel Status (Get All Statuses)
**GET** `/customer/Delivery/Parcels/Statuts`

Returns list of all available parcel statuses

---

### 7. Parcel Mass Tracking
**POST** `/customer/Delivery/Parcels/MassTracking`

**Parameters:**
- `codes`: Comma-separated tracking codes - MAX 25 codes
  - Example: `TRACKING_NUMBER_1,TRACKING_NUMBER_2,TRACKING_NUMBER_3`

---

### 8. Parcel Mass Info
**POST** `/customer/Delivery/Parcels/MassInfo`

**Parameters:**
- `codes`: Comma-separated tracking codes - MAX 25 codes
  - Example: `TRACKING_NUMBER_1,TRACKING_NUMBER_2,TRACKING_NUMBER_3`

---

### 9. Relaunch Parcel (Same Customer)
**GET** `/customer/Delivery/Parcels/Action/Type/Relaunch?ParcelCode={code}`

**Query Params:**
- `ParcelCode`: Parcel tracking code

Relaunches parcel to the same customer info

---

### 10. Relaunch Parcel (New Customer)
**POST** `/customer/Delivery/Parcels/Action/Type/RelaunchNew?ParcelCode={code}`

**Query Params:**
- `ParcelCode`: Parcel tracking code

**Body Parameters:**
- `order_num`: Order Number - Optional
- `receiver`: Receiver Name - Required
- `phone`: Phone - Required
- `city`: City ID - Required
- `address`: Address - Required
- `comment`: Comment - Optional
- `price`: COD/CRBT/Price - Required

---

### 11. Parcels List (Filtered)
**POST** `/customer/Delivery/Parcels/Json`

**Parameters:**
- `start`: Starting index (pagination)
- `length`: Number of records to fetch
- `search[value]`: Search term
- `search[regex]`: true / false
- `business`: Filter by business
- `team`: Filter by team
- `city`: Filter by city
- `situation`: Filter by situation
- `statut`: Filter by status
- `statut_s`: Filter by sub-status
- `type`: Filter by type
- `date_type`: Date filter type
- `date[from]`: From date (MM/DD/YYYY)
- `date[to]`: To date (MM/DD/YYYY)
- `all_data`: 1 to get all data

---

## 📋 DELIVERY NOTE ENDPOINTS

### 1. Add Delivery Note
**POST** `/customer/Delivery/DeliveryNotes/Action/Type/Add`

**Parameters:**
- `business`: Business ID (API ID) - Required

Returns delivery note reference

---

### 2. Add Parcels To Delivery Note
**POST** `/customer/Delivery/DeliveryNotes/Action/Type/AddParcels?Ref={ref}`

**Query Params:**
- `Ref`: Delivery Note Reference

**Body Parameters:**
- `parcels[]`: Array of parcel codes
  - Can add multiple parcels

---

### 3. Delete Delivery Note
**DELETE** `/customer/Delivery/DeliveryNotes/Action/Type/Delete?Ref={ref}`

**Query Params:**
- `Ref`: Delivery Note Reference

---

### 4. Save Delivery Note
**PUT** `/customer/Delivery/DeliveryNotes/Action/Type/Save?Ref={ref}`

**Query Params:**
- `Ref`: Delivery Note Reference

Finalizes the delivery note

---

### 5. Print Delivery Note Labels (HTML)
**GET** `/customer/Delivery/DeliveryNotes/Print/Type/Labels?Ref={ref}&LabelType={type}`

**Query Params:**
- `Ref`: Delivery Note Reference
- `LabelType`: Label type
  - `Label_100_100`
  - `Label_A4`
  - `Label_A4_8`

Returns HTML for printing labels

---

### 6. Print Delivery Note Details (HTML)
**GET** `/customer/Delivery/DeliveryNotes/Print/Type/Note?Ref={ref}`

**Query Params:**
- `Ref`: Delivery Note Reference

Returns HTML for printing delivery note details

---

## 🚚 PICKUP REQUEST ENDPOINTS

### 1. Add Pickup Request
**POST** `/customer/Delivery/PickupRequests/Action/Type/Add`

**Parameters:**
- `mdl_business`: Business ID (API ID) - Required
- `mdl_type`: Type (e.g., PARCEL_M)
- `mdl_city`: City ID - Required
- `p_address`: Pickup Address - Required
- `p_phone`: Pickup Phone - Required
- `p_note`: Pickup Note - Optional

---

## 🔐 AUTHENTICATION
All endpoints require:
```
Headers:
  C-Api-Id: YOUR_API_ID
  C-Api-Key: YOUR_API_KEY
```

## 📝 NOTES
- All POST/PUT/DELETE requests use `form-data` format
- City IDs must match the cities in your database
- Mass operations limited to 25 items maximum
- Parcel codes are unique tracking identifiers returned when creating parcels
