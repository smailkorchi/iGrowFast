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
        const response = await fetch(`${this.baseUrl}/parcel/history/${code}?include=status`, {
            headers: { Authorization: this.getAuthHeader() }
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to track parcel: ${errorText}`);
        }
        const data = await response.json();
        return data.data || [];
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
        const payload = {
            delivery_type: parcelData.delivery_type || 'domicile',
            cash_on_delivery: parcelData.delivery_type === 'domicile' ? (parcelData.cash_on_delivery || 0) : 0,
            parcel_value: parcelData.parcel_value || 0,
            weight: parcelData.weight,
            receiver_name: parcelData.receiver_name,
            receiver_phone: parcelData.receiver_phone,
            receiver_city_id: parcelData.receiver_city_id,
            receiver_address: parcelData.receiver_address,
            note: parcelData.note || '',
            products: parcelData.products || []
        };

        const response = await fetch(`${this.baseUrl}/parcel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: this.getAuthHeader()
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create parcel: ${errorText}`);
        }

        const data = await response.json();
        return data.data;
    }

    async createDeliveryNote() {
        const token = await this.getDashboardToken();
        const response = await fetch(`${this.dashboardBaseUrl}/api/v1/delivery-notes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Failed to create delivery note: ${errText}`);
        }

        const result = await response.json();
        return result.data;
    }

    async addParcelsToNote(deliveryNoteRef, parcelCodes) {
        const token = await this.getDashboardToken();
        const response = await fetch(`${this.dashboardBaseUrl}/api/v1/delivery-notes/${deliveryNoteRef}/add-parcels`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ parcel_codes: parcelCodes })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Failed to add parcels to note: ${errText}`);
        }

        const result = await response.json();
        return result.data;
    }

    async deleteNote(reference) {
        const token = await this.getDashboardToken();
        const response = await fetch(`${this.dashboardBaseUrl}/api/v1/delivery-notes/${reference}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('Delete note failed:', errText);
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
        const formData = new URLSearchParams();
        formData.append('type', parcelData.parcel_type || 'SIMPLE');
        formData.append('business', this.apiId);
        formData.append('receiver', parcelData.receiver_name);
        formData.append('phone', parcelData.receiver_phone);
        formData.append('city', parcelData.receiver_city_id);
        formData.append('address', parcelData.receiver_address);
        formData.append('cod', parcelData.cash_on_delivery || 0);
        formData.append('comment', parcelData.note || '');
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

        const response = await fetch(`${this.baseUrl}/customer/Delivery/Parcels/Action/Type/Add`, {
            method: 'POST',
            headers: {
                'C-Api-Id': this.apiId,
                'C-Api-Key': this.apiKey,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create AMEEX parcel: ${errorText}`);
        }

        const data = await response.json();
        return data.data || data;
    }

    async createDeliveryNote() {
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
            throw new Error(`Failed to create AMEEX delivery note: ${errText}`);
        }

        const result = await response.json();
        return result.data || result;
    }

    async addParcelsToNote(deliveryNoteRef, parcelCodes) {
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
            throw new Error(`Failed to add parcels to AMEEX note: ${errText}`);
        }

        const result = await response.json();
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
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { action, provider_id, data } = await req.json();
        const { data: provider } = await supabase.from('providers').select('*').eq('id', provider_id).single();
        if (!provider) throw new Error('Provider not found');

        const adapter = provider.provider_type === 'coliaty' ? new ColiatyAdapter(provider) : new AmeexAdapter(provider);

        let result;
        switch (action) {
            case 'track_parcel':
                result = await adapter.trackParcel(data.tracking_code, data.external_id);
                break;
            case 'get_parcel_info':
                result = await adapter.getParcelInfo(data.tracking_code);
                break;
            case 'get_print_url':
                const link = await adapter.getPrintUrl(data.delivery_note_ref, data.label_format);
                result = { print_html: link };
                break;
            case 'create_parcel':
                result = await adapter.createParcel(data);
                break;
            case 'create_delivery_note':
                result = await adapter.createDeliveryNote();
                break;
            case 'add_parcels_to_delivery_note':
                result = await adapter.addParcelsToNote(data.delivery_note_ref, data.parcel_codes);
                break;
            case 'delete_delivery_note':
                result = await adapter.deleteNote(data.reference);
                break;
            default:
                throw new Error(`Action ${action} not implemented`);
        }
        return new Response(JSON.stringify({ success: true, data: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
