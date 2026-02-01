// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

class ColiatyAdapter {
    constructor(credentials) {
        this.baseUrl = credentials.api_base_url || 'https://customer-api-v1.coliaty.com';
        this.dashboardBaseUrl = 'https://app.coliaty.com';
        this.apiKeyPublic = credentials.api_public_key || '';
        this.apiKeySecret = credentials.api_secret_key || '';
        this.login = credentials.api_login || '';
        this.password = credentials.api_password || '';
        this.jwtToken = null;
        this.jwtExpiresAt = null;
    }

    getAuthHeader() {
        return `Bearer ${this.apiKeyPublic}:${this.apiKeySecret}`;
    }

    async getDashboardToken() {
        if (this.jwtToken && this.jwtExpiresAt && Date.now() < this.jwtExpiresAt - 300000) {
            return this.jwtToken;
        }
        const res = await fetch(`${this.dashboardBaseUrl}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: this.login, password: this.password })
        });
        if (!res.ok) throw new Error('Dashboard Login Failed');
        const data = await res.json();
        this.jwtToken = data.token;
        this.jwtExpiresAt = Date.now() + (data.token_expires_in * 1000);
        return this.jwtToken;
    }

    async trackParcel(code, externalId) {
        const response = await fetch(`${this.baseUrl}/parcel/history/${code}`, {
            headers: { Authorization: this.getAuthHeader() }
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to track parcel: ${errorText}`);
        }
        const result = await response.json();
        // Coliaty returns { success, data: { package_code, details: [] } }
        const details = result.data?.details || [];

        // Transform Coliaty format to match frontend expectations
        return details.map((event: any) => ({
            status: event.HISTORY_STATUS,
            date: event.HISTORY_STATUS_DATE
                ? new Date(parseInt(event.HISTORY_STATUS_DATE) * 1000).toISOString()
                : (event.HISTORY_TIMESTAMP
                    ? new Date(parseInt(event.HISTORY_TIMESTAMP) * 1000).toISOString()
                    : null),
            comment: event.HISTORY_COMMENT || '',
            user: event.HISTORY_LIVREUR?.name || event.HISTORY_ACTOR?.name || '',
            _original: event
        }));
    }

    async getPrintUrl(deliveryNoteRef, labelFormat = '10x10') {
        const token = await this.getDashboardToken();
        const response = await fetch(`${this.dashboardBaseUrl}/api/v1/delivery-notes/${deliveryNoteRef}/print`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ type: labelFormat })
        });
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Failed to get print URL: ${errText}`);
        }
        const result = await response.json();
        return result.data?.url || result.data?.pdf_url || result.data;
    }

    async createParcel(parcelData) {
        console.log('=== COLIATY createParcel START ===');
        console.log('Input parcelData:', JSON.stringify(parcelData, null, 2));

        // Map frontend fields to Coliaty API fields
        // Coliaty uses /parcel/normal endpoint with package_* field names
        const payload = {
            package_code: parcelData.package_code || '',  // Optional - Coliaty will generate if empty
            package_reciever: parcelData.receiver_name || parcelData.customer_name,
            package_phone: parcelData.receiver_phone || parcelData.customer_phone,
            package_price: parcelData.cash_on_delivery || parcelData.cod_amount || 0,
            package_addresse: parcelData.receiver_address || parcelData.delivery_address,
            package_city: parcelData.city_name,  // Coliaty uses CITY NAME, not ID!
            package_content: parcelData.note || parcelData.notes || '',
            package_no_open: parcelData.no_open || false,
            package_replacement: parcelData.replaceable || false,
            package_old_tracking: parcelData.old_tracking || ''
        };

        console.log('Mapped payload for Coliaty:', JSON.stringify(payload, null, 2));

        const response = await fetch(`${this.baseUrl}/parcel/normal`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: this.getAuthHeader()
            },
            body: JSON.stringify(payload)
        });

        console.log('Coliaty Response Status:', response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coliaty Error Response:', errorText);

            // Try to parse as JSON to get validation errors
            try {
                const errorJson = JSON.parse(errorText);
                const errorMsg = errorJson?.message || errorJson?.error || errorText;
                const errors = errorJson?.errors ? JSON.stringify(errorJson.errors) : '';
                throw new Error(`Coliaty Error: ${errorMsg} ${errors}`);
            } catch (parseError) {
                throw new Error(`Coliaty API returned ${response.status}: ${errorText.substring(0, 500)}`);
            }
        }

        const responseText = await response.text();
        console.log('Coliaty Success Response:', responseText);

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('Failed to parse Coliaty response as JSON:', e);
            throw new Error(`Coliaty returned non-JSON response: ${responseText.substring(0, 200)}`);
        }

        console.log('=== COLIATY createParcel END ===');
        // Coliaty returns {success: true, data: {package_code: "...", package_id: ...}}
        // Extract and standardize the response
        const trackingCode = data.data?.package_code || data.data?.code;
        const externalId = data.data?.package_id || data.data?.id;

        console.log('Extracted tracking_code:', trackingCode);
        console.log('Extracted external_id:', externalId);

        // Return standardized format that matches AMEEX and frontend expectations
        return {
            tracking_code: trackingCode,
            external_id: externalId,
            provider_response: data
        };
    }

    async createDeliveryNote() {
        console.log('📋 Coliaty: Creating pickup note (bon de ramassage)...');

        // Get JWT token for dashboard API
        const token = await this.getDashboardToken();

        const response = await fetch(`${this.dashboardBaseUrl}/api/v1/pickup-note/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                description: `Bon de ramassage créé via API`,
                colis_ids: [] // Empty initially, parcels added later
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coliaty Error Response:', errorText);
            throw new Error(`Failed to create pickup note: ${errorText}`);
        }

        const result = await response.json();
        console.log('Coliaty pickup note created:', JSON.stringify(result, null, 2));

        if (!result.success || !result.data?.reference) {
            throw new Error('Invalid response from pickup note creation');
        }

        return {
            reference: result.data.reference,
            provider_response: result
        };
    }

    async addParcelsToNote(deliveryNoteRef, parcelCodes) {
        console.log('📋 Coliaty: Adding parcels to pickup note:', deliveryNoteRef);
        console.log('Parcel codes:', parcelCodes);

        const token = await this.getDashboardToken();

        const response = await fetch(`${this.dashboardBaseUrl}/api/v1/pickup-note/add-parcels`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pickup_note_reference: deliveryNoteRef,
                parcel_codes: parcelCodes
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coliaty Error Response:', errorText);
            throw new Error(`Failed to add parcels to pickup note: ${errorText}`);
        }

        const result = await response.json();
        console.log('Parcels added to pickup note:', JSON.stringify(result, null, 2));

        return {
            success: result.success,
            message: result.message,
            data: result.data
        };
    }

    async deleteNote(reference) {
        console.log('🗑️ Coliaty: Deleting pickup note:', reference);

        const token = await this.getDashboardToken();

        const response = await fetch(`${this.dashboardBaseUrl}/api/v1/pickup-note/${reference}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coliaty Error Response:', errorText);
        }

        return { success: true };
    }

    async getParcelInfo(trackingCode) {
        // Coliaty API endpoint for parcel status
        if (!trackingCode) {
            throw new Error('Tracking code required');
        }

        const response = await fetch(`${this.baseUrl}/parcel/status/${trackingCode}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKeyPublic}:${this.apiKeySecret}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get Coliaty parcel info: ${errorText}`);
        }

        const result = await response.json();

        // Coliaty returns {success, data: {status, parcel, business}}
        if (result.success && result.data) {
            const { status, parcel } = result.data;
            return {
                tracking_code: parcel.code,
                status: status.code,
                statusLabel: status.label,
                statusColor: null, // Coliaty doesn't provide color in this endpoint
                receiver: parcel.receiver,
                phone: parcel.phone,
                price: parcel.price,
                comment: status.comment || '',
                date: status.date,
                _original: result.data
            };
        }

        return null;
    }

    async getPrintUrl(deliveryNoteRef, labelFormat, printType = 'labels') {
        console.log('🖨️ Coliaty: Getting print PDF for pickup note:', deliveryNoteRef);
        console.log('Format:', labelFormat);
        console.log('Print type:', printType, '(ignored - Coliaty returns PDF labels)');

        // Get JWT token for dashboard API
        const token = await this.getDashboardToken();

        // Determine endpoint based on label format
        // labelFormat can be 'A4' or '10x10' (default)
        const endpoint = labelFormat === 'A4'
            ? `${this.dashboardBaseUrl}/api/v1/pickup-note/${deliveryNoteRef}/generate-labels-a4`
            : `${this.dashboardBaseUrl}/api/v1/pickup-note/${deliveryNoteRef}/generate-labels`;

        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/pdf'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coliaty print error:', errorText);
            throw new Error(`Failed to generate pickup note labels: ${errorText}`);
        }

        // Get PDF as blob
        const pdfBlob = await response.blob();

        // Convert blob to base64
        const arrayBuffer = await pdfBlob.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(arrayBuffer)
                .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        // Return as data URL string
        return `data:application/pdf;base64,${base64}`;
    }
}

class AmeexAdapter {
    constructor(credentials) {
        this.baseUrl = credentials.api_base_url || 'https://api.ameex.app';
        // AMEEX uses business_id as C-Api-Id and api_key as C-Api-Key
        this.apiId = credentials.business_id || credentials.api_public_key || '';
        this.apiKey = credentials.api_key || credentials.api_secret_key || '';
    }

    getAuthHeaders() {
        return {
            'C-Api-Id': this.apiId,
            'C-Api-Key': this.apiKey,
            'Content-Type': 'application/json'
        };
    }

    async trackParcel(trackingCode, externalId) {
        // AMEEX API uses /customer/Delivery/Parcels/Tracking?ParcelCode={code}
        if (!trackingCode) {
            throw new Error('AMEEX tracking requires tracking code');
        }

        console.log('AMEEX Tracking Request:', {
            url: `${this.baseUrl}/customer/Delivery/Parcels/Tracking?ParcelCode=${trackingCode}`,
            headers: {
                'C-Api-Id': this.apiId,
                'C-Api-Key': this.apiKey ? '***' : 'MISSING'
            }
        });

        const response = await fetch(`${this.baseUrl}/customer/Delivery/Parcels/Tracking?ParcelCode=${trackingCode}`, {
            method: 'GET',
            headers: this.getAuthHeaders()
        });

        console.log('AMEEX Response Status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('AMEEX Error Response:', errorText);
            throw new Error(`Failed to track AMEEX parcel: ${errorText}`);
        }

        const data = await response.json();
        console.log('AMEEX Response Data:', JSON.stringify(data));

        // AMEEX returns tracking history in data.api.tracking
        // Format: { login: "success", api: { type: "success", tracking: [...] } }
        if (data && data.api && data.api.tracking) {
            const trackingData = data.api.tracking;
            console.log('Found tracking data at data.api.tracking, length:', trackingData.length);

            // Normalize AMEEX data to match UI expectations
            const normalized = trackingData.map((event) => ({
                status: event.statut,                    // NEW_PARCEL, WAITING_PICKUP, etc.
                statusLabel: event.statut_name,          // "Nouveau Colis", "Attente De Ramassage"
                date: event.time_str,                    // "2026-02-01 00:08"
                timestamp: event.time,                   // Unix timestamp
                comment: event.comment || '',
                color: event.statut_color,               // Status color
                hub: event.hub_name,
                city: event.city_name,
                zone: event.zone_name,
                by: event.by_data,
                data_list: event.data_list || [],
                // Keep original data for debugging
                _original: event
            }));

            return normalized;
        }

        // Fallback to other possible formats
        if (data && Array.isArray(data)) {
            console.log('Returning array data, length:', data.length);
            return data;
        }

        if (data && data.data) {
            console.log('Found data.data, type:', typeof data.data, 'isArray:', Array.isArray(data.data));
            return Array.isArray(data.data) ? data.data : [data.data];
        }

        console.log('No tracking data found, returning empty array');
        return [];
    }

    async getParcelInfo(trackingCode) {
        // AMEEX API endpoint for parcel info
        if (!trackingCode) {
            throw new Error('AMEEX parcel info requires tracking code');
        }

        const response = await fetch(`${this.baseUrl}/customer/Delivery/Parcels/Info?ParcelCode=${trackingCode}`, {
            method: 'GET',
            headers: this.getAuthHeaders()
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get AMEEX parcel info: ${errorText}`);
        }

        const data = await response.json();

        //AMEEX returns parcel info with current status
        if (data && data.api && data.api.parcel) {
            const parcel = data.api.parcel;

            // Extract status name from badge HTML (e.g., "Attente De Ramassage")
            let statusLabel = parcel.statut;
            const badgeHtml = parcel.statut_badge_html || parcel.statut_s_badge_html || '';
            const match = badgeHtml.match(/>([^<]+)</);
            if (match && match[1]) {
                // Remove any <hr> tags from the matched text
                statusLabel = match[1].replace(/<hr[^>]*>/g, '').trim();
            }

            // Extract color from badge HTML style
            let statusColor = null;
            const colorMatch = badgeHtml.match(/--color:\s*([^;]+);/);
            if (colorMatch && colorMatch[1]) {
                statusColor = colorMatch[1].trim();
            }

            return {
                tracking_code: parcel.code,
                status: parcel.statut,
                statusLabel: statusLabel,
                statusColor: statusColor,
                receiver: parcel.receiver,
                phone: parcel.phone,
                city: parcel.city_name,
                address: parcel.address,
                cod: parcel.cod,
                created_at: parcel.c_time_str,
                _original: parcel
            };
        }

        return null;
    }


    async getPrintUrl(deliveryNoteRef, labelFormat = 'Label_100_100') {
        // AMEEX uses GET endpoint for printing labels
        let url;
        if (labelFormat === 'Note') {
            // Print delivery note details
            url = `${this.baseUrl}/customer/Delivery/DeliveryNotes/Print/Type/Note?Ref=${deliveryNoteRef}`;
        } else {
            // Print labels
            url = `${this.baseUrl}/customer/Delivery/DeliveryNotes/Print/Type/Labels?Ref=${deliveryNoteRef}&LabelType=${labelFormat}`;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getAuthHeaders()
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Failed to get AMEEX print URL: ${errText}`);
        }

        // AMEEX returns HTML directly for printing
        const html = await response.text();
        return html;
    }

    async createParcel(parcelData) {
        // AMEEX uses form-data format
        console.log('=== AMEEX createParcel START ===');
        console.log('Input parcelData:', JSON.stringify(parcelData, null, 2));

        const formData = new URLSearchParams();
        formData.append('type', parcelData.parcel_type || 'SIMPLE');
        formData.append('business', this.apiId);

        // Support both old and new field names
        const receiver = parcelData.receiver_name || parcelData.customer_name;
        let phone = parcelData.receiver_phone || parcelData.customer_phone;
        const address = parcelData.receiver_address || parcelData.delivery_address;
        const cod = parcelData.cash_on_delivery || parcelData.cod_amount || 0;

        // Normalize phone for AMEEX: must be 10 digits starting with 05/06/07/08
        if (phone) {
            // Remove any spaces, dashes, or special characters
            phone = phone.replace(/[\s\-\(\)]/g, '');

            // If it's 9 digits and starts with 5, 6, 7, or 8, add leading 0
            if (phone.length === 9 && /^[5678]/.test(phone)) {
                phone = '0' + phone;
                console.log('Added leading 0 to phone:', phone);
            }

            // Validate format
            if (!/^0[5678]\d{8}$/.test(phone)) {
                console.error('Invalid phone format for AMEEX:', phone);
                throw new Error(`Invalid phone number "${phone}". AMEEX requires format: 06xxxxxxxx, 07xxxxxxxx, 08xxxxxxxx, or 05xxxxxxxx (10 digits starting with 0)`);
            }
        }

        console.log('Mapped fields:', { receiver, phone, address, cod });

        formData.append('receiver', receiver);
        formData.append('phone', phone);
        formData.append('address', address);
        formData.append('cod', cod);

        // City: CRITICAL - Must use ameex_city_code (numeric code)
        const cityCode = parcelData.ameex_city_code;
        if (!cityCode) {
            console.error('MISSING AMEEX_CITY_CODE!');
            console.error('Available city fields:', {
                ameex_city_code: parcelData.ameex_city_code,
                city_id: parcelData.city_id,
                city_name: parcelData.city_name
            });
            throw new Error(`AMEEX city code is required. Got: city_id=${parcelData.city_id}, city_name=${parcelData.city_name}. Please ensure ameex_code is set in the cities table.`);
        }

        console.log('Using AMEEX city code:', cityCode);
        formData.append('city', cityCode);

        const comment = parcelData.note || parcelData.notes || '';
        formData.append('comment', comment);
        formData.append('product', parcelData.product_name || '');
        formData.append('fragile', parcelData.fragile || '0');
        formData.append('open', parcelData.open || 'NO');
        formData.append('try', parcelData.try || 'NO');
        if (parcelData.order_num) formData.append('order_num', parcelData.order_num);

        // Add products if provided
        if (parcelData.products && parcelData.products.length > 0) {
            parcelData.products.forEach((product, index) => {
                if (product.id) formData.append(`products[${index}][id]`, product.id);
                if (product.quantity) formData.append(`products[${index}][qty]`, product.quantity);
            });
        }

        const url = `${this.baseUrl}/customer/Delivery/Parcels/Action/Type/Add`;
        const bodyString = formData.toString();

        console.log('AMEEX API Request:');
        console.log('URL:', url);
        console.log('Headers:', {
            'C-Api-Id': this.apiId,
            'C-Api-Key': this.apiKey ? '***' : 'MISSING'
        });
        console.log('Body:', bodyString);

        // Generate curl command for debugging
        const curlCommand = `curl -X POST '${url}' \\
  -H 'C-Api-Id: ${this.apiId}' \\
  -H 'C-Api-Key: ${this.apiKey}' \\
  -H 'Content-Type: application/x-www-form-urlencoded' \\
  -d '${bodyString}'`;
        console.log('Equivalent curl command:');
        console.log(curlCommand);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'C-Api-Id': this.apiId,
                'C-Api-Key': this.apiKey,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: bodyString
        });

        console.log('AMEEX Response Status:', response.status, response.statusText);
        console.log('AMEEX Response Headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));

        if (!response.ok) {
            const errorText = await response.text();
            console.error('AMEEX Error Response Body:', errorText);

            // Try to parse as JSON to get the actual error message
            try {
                const errorJson = JSON.parse(errorText);
                const ameexMsg = errorJson?.api?.msg || errorText;
                throw new Error(`AMEEX Error: ${ameexMsg}`);
            } catch (parseError) {
                // If not JSON, return the raw error
                throw new Error(`AMEEX API returned ${response.status}: ${errorText.substring(0, 500)}`);
            }
        }

        const responseText = await response.text();
        console.log('AMEEX Success Response:', responseText);

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('Failed to parse AMEEX response as JSON:', e);
            throw new Error(`AMEEX returned non-JSON response: ${responseText.substring(0, 200)}`);
        }

        console.log('=== AMEEX createParcel END ===');

        // Extract tracking code and external ID from AMEEX response
        // AMEEX can return: {login: "success", api: {type: "success", data: {id: ..., code: "..."}}}
        const trackingCode = data.data?.code || data.data?.parcel_code || data.api?.data?.code || data.code;
        const externalId = data.data?.id || data.api?.data?.id || data.id;

        console.log('Extracted tracking_code:', trackingCode);
        console.log('Extracted external_id:', externalId);

        // Return standardized format
        return {
            tracking_code: trackingCode,
            external_id: externalId,
            provider_response: data
        };
    }

    async createDeliveryNote() {
        console.log('=== AMEEX createDeliveryNote START ===');

        const formData = new URLSearchParams();
        formData.append('business', this.apiId);

        const response = await fetch(`${this.baseUrl}/customer/Delivery/DeliveryNotes/Action/Type/Add`, {
            method: 'POST',
            headers: {
                'C-Api-Id': this.apiId,
                'C-Api-Key': this.apiKey,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('AMEEX create delivery note error:', errText);
            throw new Error(`Failed to create AMEEX delivery note: ${errText}`);
        }

        const result = await response.json();
        console.log('AMEEX createDeliveryNote response:', JSON.stringify(result, null, 2));

        // Extract reference from AMEEX response
        // AMEEX returns: {login: "success", api: {type: "success", data: {ref: "..."}}}
        const reference = result.data?.ref || result.data?.reference || result.api?.data?.ref || result.api?.data?.reference || result.ref;

        console.log('Extracted delivery note reference:', reference);
        console.log('=== AMEEX createDeliveryNote END ===');

        return {
            reference,
            provider_response: result
        };
    }

    async addParcelsToNote(deliveryNoteRef, parcelCodes) {
        console.log('=== AMEEX addParcelsToNote START ===');
        console.log('Delivery note ref:', deliveryNoteRef);
        console.log('Parcel codes:', parcelCodes);

        const formData = new URLSearchParams();
        // AMEEX expects parcels[] array in query params
        parcelCodes.forEach(code => {
            formData.append('parcels[]', code);
        });

        const response = await fetch(`${this.baseUrl}/customer/Delivery/DeliveryNotes/Action/Type/AddParcels?Ref=${deliveryNoteRef}`, {
            method: 'POST',
            headers: {
                'C-Api-Id': this.apiId,
                'C-Api-Key': this.apiKey,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('AMEEX add parcels error:', errText);
            throw new Error(`Failed to add parcels to AMEEX note: ${errText}`);
        }

        const result = await response.json();
        console.log('AMEEX addParcelsToNote response:', JSON.stringify(result, null, 2));
        console.log('=== AMEEX addParcelsToNote END ===');

        return result.data || result;
    }

    async deleteNote(reference) {
        try {
            const response = await fetch(`${this.baseUrl}/customer/Delivery/DeliveryNotes/Action/Type/Delete?Ref=${reference}`, {
                method: 'DELETE',
                headers: {
                    'C-Api-Id': this.apiId,
                    'C-Api-Key': this.apiKey
                }
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error('Delete AMEEX note failed:', errText);
            }
        } catch (err) {
            console.error('Delete AMEEX note error:', err);
        }
        return { success: true };
    }

    async finalizeDeliveryNote(deliveryNoteRef) {
        console.log('=== AMEEX finalizeDeliveryNote START ===');
        console.log('Finalizing delivery note:', deliveryNoteRef);

        const response = await fetch(`${this.baseUrl}/customer/Delivery/DeliveryNotes/Action/Type/Save?Ref=${deliveryNoteRef}`, {
            method: 'PUT',
            headers: {
                'C-Api-Id': this.apiId,
                'C-Api-Key': this.apiKey
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('AMEEX finalize error:', errText);
            throw new Error(`Failed to finalize AMEEX delivery note: ${errText}`);
        }

        const result = await response.json();
        console.log('AMEEX finalizeDeliveryNote response:', JSON.stringify(result, null, 2));
        console.log('=== AMEEX finalizeDeliveryNote END ===');

        return result.data || result;
    }


    async getPrintUrl(deliveryNoteRef, labelFormat, printType = 'labels') {
        console.log('🖨️ AMEEX: Getting print URL for:', deliveryNoteRef);
        console.log('Label format:', labelFormat);
        console.log('Print type:', printType);

        // AMEEX has two different print endpoints:
        // 1. Labels: /Print/Type/Labels - prints parcel labels
        // 2. Note: /Print/Type/Note - prints the delivery note document
        let printUrl;
        if (printType === 'note') {
            printUrl = `${this.baseUrl}/customer/Delivery/DeliveryNotes/Print/Type/Note?Ref=${deliveryNoteRef}`;
        } else {
            // Labels - format: 10x10, 10x15, or A4
            printUrl = `${this.baseUrl}/customer/Delivery/DeliveryNotes/Print/Type/Labels?Ref=${deliveryNoteRef}&LabelType=${labelFormat || '10x10'}`;
        }

        console.log('Print URL:', printUrl);

        const response = await fetch(printUrl, {
            headers: {
                'C-Api-Id': this.apiId,
                'C-Api-Key': this.apiKey
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('🖨️ AMEEX Print Error:', errorText);
            throw new Error(`Failed to fetch print HTML: ${errorText}`);
        }

        // AMEEX can return HTML directly or JSON with HTML
        const text = await response.text();
        console.log('🖨️ Response first 100 chars:', text.substring(0, 100));

        // Check if response starts with HTML
        if (text.trim().startsWith('<') || text.trim().startsWith('<!')) {
            // It's HTML directly
            return text;
        }

        // Try to parse as JSON (in case AMEEX wraps it or returns error)
        try {
            const result = JSON.parse(text);
            console.log('🖨️ Parsed JSON response type:', result.api?.type);

            // Check for HTML in response - AMEEX returns: { api: { data: { html: "..." } } }
            const html = result.api?.data?.html || result.data?.html || result.html;

            if (html !== undefined) {
                if (html.trim() === '') {
                    throw new Error('AMEEX: No content to print. Make sure the delivery note has parcels.');
                }
                return html;
            }

            // Check for error in response
            const errorMsg = result.api?.message || result.api?.msg || result.api?.error || result.message || result.error;
            if (errorMsg) {
                throw new Error(`AMEEX: ${errorMsg}`);
            }

            console.error('🖨️ Unexpected response:', text);
            throw new Error('HTML not found in AMEEX response');
        } catch (e) {
            if (e.message.startsWith('AMEEX:')) {
                throw e; // Re-throw our formatted error
            }
            // Not JSON, might be HTML anyway
            if (text.includes('<html') || text.includes('<body') || text.includes('<div')) {
                return text;
            }
            throw new Error(`Unexpected response: ${text.substring(0, 200)}`);
        }
    }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { action, provider_id, data } = await req.json();

        console.log('=== EDGE FUNCTION REQUEST ===');
        console.log('Action:', action);
        console.log('Provider ID:', provider_id);
        console.log('Data:', JSON.stringify(data, null, 2));

        const { data: provider } = await supabase.from('providers').select('*').eq('id', provider_id).single();
        if (!provider) {
            console.error('Provider not found for ID:', provider_id);
            throw new Error('Provider not found');
        }

        console.log('Provider:', provider.name, 'Type:', provider.provider_type);

        const adapter = provider.provider_type === 'coliaty' ? new ColiatyAdapter(provider) : new AmeexAdapter(provider);

        let result;
        switch (action) {
            case 'track_parcel':
                console.log('Tracking parcel:', data.tracking_code);
                result = await adapter.trackParcel(data.tracking_code, data.external_id);
                break;
            case 'get_parcel_info':
                console.log('Getting parcel info:', data.tracking_code);
                result = await adapter.getParcelInfo(data.tracking_code);
                break;
            case 'get_print_url':
                console.log('Getting print URL for:', data.delivery_note_ref, 'Format:', data.label_format, 'Type:', data.print_type);
                const link = await adapter.getPrintUrl(data.delivery_note_ref, data.label_format, data.print_type);
                result = { print_html: link };
                break;
            case 'create_parcel':
                console.log('Creating parcel with data:', JSON.stringify(data, null, 2));
                result = await adapter.createParcel(data);
                console.log('Parcel created:', JSON.stringify(result, null, 2));
                break;
            case 'create_delivery_note':
                console.log('Creating delivery note');
                result = await adapter.createDeliveryNote();
                console.log('Delivery note created:', JSON.stringify(result, null, 2));
                break;
            case 'add_parcels_to_delivery_note':
                console.log('Adding parcels to delivery note:', data.delivery_note_ref);
                console.log('Parcel codes:', data.parcel_codes);
                result = await adapter.addParcelsToNote(data.delivery_note_ref, data.parcel_codes);
                console.log('Parcels added:', JSON.stringify(result, null, 2));
                break;
            case 'finalize_delivery_note':
                console.log('Finalizing delivery note:', data.delivery_note_ref);
                // Call adapter's finalize method if it exists (AMEEX needs this)
                if (typeof adapter.finalizeDeliveryNote === 'function') {
                    result = await adapter.finalizeDeliveryNote(data.delivery_note_ref);
                } else {
                    // Providers like Coliaty don't need explicit finalization
                    result = { success: true, reference: data.delivery_note_ref };
                }
                console.log('Delivery note finalized');
                break;
            case 'delete_delivery_note':
                console.log('Deleting delivery note:', data.reference);
                result = await adapter.deleteNote(data.reference);
                break;
            default:
                console.error('Unknown action:', action);
                throw new Error(`Action ${action} not implemented`);
        }

        console.log('=== SUCCESS ===');
        console.log('Result:', JSON.stringify(result, null, 2));

        return new Response(JSON.stringify({ success: true, data: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('=== ERROR ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);

        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
