// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

class OzonAdapter {
    constructor(credentials) {
        // Documentation says Base URL: https://api.ozonexpress.ma/customers/{YOUR_ID}/{YOUR_API_KEY}
        // credentials.business_id maps to {YOUR_ID}
        // credentials.api_key maps to {YOUR_API_KEY}
        const customerId = credentials.business_id || '';
        const apiKey = credentials.api_key || '';
        this.baseUrl = `https://api.ozonexpress.ma/customers/${customerId}/${apiKey}`;
        this.pdfBaseUrl = 'https://client.ozoneexpress.ma';
    }

    async createParcel(parcelData, supabase) {
        console.log('=== OZON createParcel START ===');

        let ozonCityId = parcelData.ozon_city_id;

        if (parcelData.master_city_id && supabase) {
            const { data: mapping } = await supabase
                .from('provider_cities')
                .select('provider_city_id')
                .eq('master_city_id', parcelData.master_city_id)
                .eq('provider_type', 'ozon')
                .single();

            if (mapping?.provider_city_id) {
                ozonCityId = mapping.provider_city_id;
            }
        }

        if (!ozonCityId) {
            throw new Error('Ozon city ID is required and could not be resolved from master_city_id');
        }

        // Ozon uses multipart/form-data. Using FormData object for fetch.
        const formData = new FormData();
        formData.append('parcel-receiver', parcelData.receiver_name || parcelData.customer_name);
        formData.append('parcel-phone', parcelData.receiver_phone || parcelData.customer_phone);
        formData.append('parcel-city', ozonCityId);
        formData.append('parcel-address', parcelData.receiver_address || parcelData.delivery_address);
        formData.append('parcel-price', String(parcelData.cash_on_delivery || parcelData.cod_amount || 0));
        formData.append('parcel-note', parcelData.delivery_note || '');
        formData.append('parcel-nature', parcelData.product_info || '');
        formData.append('parcel-stock', '0'); // 1 = stock, 0 = pickup
        formData.append('parcel-open', parcelData.open === 'YES' ? '1' : '2'); // 1 = Open, 2 = Don't open
        formData.append('parcel-fragile', parcelData.fragile ? '1' : '0');
        formData.append('parcel-replace', parcelData.replaceable ? '1' : '0');

        const response = await fetch(`${this.baseUrl}/add-parcel`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Ozon Error: ${errText}`);
        }

        const rawData = await response.json();
        const data = rawData['ADD-PARCEL'];

        if (!data || data.RESULT !== 'SUCCESS') {
            throw new Error(`Ozon API Error: ${data?.MESSAGE || 'Unknown error'}`);
        }

        return {
            tracking_code: data['NEW-PARCEL']['TRACKING-NUMBER'],
            external_id: data['NEW-PARCEL']['TRACKING-NUMBER'], // Ozon uses tracking number as primary ref
            provider_response: rawData
        };
    }

    async getParcelInfo(trackingCode) {
        // Since getParcelInfo often needs the current status and Ozon's parcel-info might be limited,
        // we'll reuse the robust tracking logic to ensure consistent data.
        return this.trackParcel(trackingCode);
    }

    async trackParcel(trackingCode) {
        const formData = new FormData();
        formData.append('tracking-number', trackingCode);

        const response = await fetch(`${this.baseUrl}/tracking`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) return null;
        const rawData = await response.json();
        const data = rawData['TRACKING'];

        if (!data || data.RESULT !== 'SUCCESS') return null;

        // Ozon returns history as an object with numeric keys. Convert it to a sorted array.
        const historyObj = data.HISTORY || {};
        const history = Object.entries(historyObj)
            .sort(([a], [b]) => Number(b) - Number(a))
            .map(([_, event]: any) => ({
                status: event.STATUT,
                date: event.TIME ? new Date(Number(event.TIME) * 1000).toISOString() : event.TIME_STR,
                comment: event.COMMENT || '',
                _original: event
            }));

        const lastStatus = data.LAST_TRACKING?.STATUT || 'Unknown';

        return {
            tracking_code: trackingCode,
            status: lastStatus,
            statusLabel: lastStatus,
            history: history,
            _original: rawData
        };
    }

    // Delivery Note workflow (BL)
    async createDeliveryNote() {
        // Step 1: Create BL
        const response = await fetch(`${this.baseUrl}/add-delivery-note`, { method: 'POST' });
        if (!response.ok) throw new Error('Ozon BL Creation Failed');

        const data = await response.json();
        if (data['ADD-BL']?.RESULT !== 'SUCCESS') {
            throw new Error(`Ozon BL Error: ${data['ADD-BL']?.MESSAGE || 'Unknown'}`);
        }

        return {
            reference: data['ADD-BL']['NEW-BL']['REF'],
            external_id: String(data['ADD-BL']['NEW-BL']['ID'])
        };
    }

    async addParcelsToNote(blRef, parcels) {
        // Step 2: Add Parcels
        const formData = new FormData();
        formData.append('Ref', blRef);
        parcels.forEach(code => formData.append('Codes[]', code));

        const response = await fetch(`${this.baseUrl}/add-parcel-to-delivery-note`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Ozon Add Parcels Failed');
        const data = await response.json();

        return {
            success: data['ADD-PARCEL-BL']?.RESULT === 'SUCCESS',
            _original: data
        };
    }

    async finalizeDeliveryNote(blRef) {
        // Step 3: Save BL
        const formData = new FormData();
        formData.append('Ref', blRef);

        const response = await fetch(`${this.baseUrl}/save-delivery-note`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Ozon Finalize BL Failed');
        const data = await response.json();

        return {
            success: data['SAVE-BL']?.RESULT === 'SUCCESS',
            reference: blRef
        };
    }

    async getPrintUrl(blRef, labelFormat, printType = 'labels') {
        let endpoint = '/pdf-delivery-note'; // Default Standard (Note)

        if (printType === 'labels') {
            if (labelFormat === 'Label_A4' || labelFormat === 'A4') {
                endpoint = '/pdf-delivery-note-tickets';
            } else if (labelFormat === 'Label_100_100' || labelFormat === '10x10' || labelFormat === 'thermal' || labelFormat === 'A6') {
                endpoint = '/pdf-delivery-note-tickets-4-4';
            }
        } else if (printType === 'note') {
            endpoint = '/pdf-delivery-note';
        }

        return `${this.pdfBaseUrl}${endpoint}?dn-ref=${blRef}`;
    }
}

export class ColiatyAdapter {
    // Fully migrated to the customer/public API (https://customer-api-v1.coliaty.com,
    // Bearer {public}:{secret}, NO /api/client prefix). Pickup-note create/add/remove/
    // labels are now public — the old dashboard (app.coliaty.com, email/password JWT) is
    // no longer used at all, removing the api_login/api_password dependency and the
    // Cloudflare-challenge exposure on app.coliaty.com.
    constructor(credentials) {
        this.baseUrl = credentials.api_base_url || 'https://customer-api-v1.coliaty.com';
        this.apiKeyPublic = credentials.api_public_key || '';
        this.apiKeySecret = credentials.api_secret_key || '';
    }

    getAuthHeader() {
        return `Bearer ${this.apiKeyPublic}:${this.apiKeySecret}`;
    }

    // Coliaty requires package_content between 5 and 100 characters.
    // The wizard sends "CODE xN, CODE xN" which can blow past 100 chars on
    // multi-SKU orders. Fall back to "{N} produits, {M} pieces" derived from
    // the same string so we don't lose item/piece counts.
    buildPackageContent(productInfo) {
        const MIN = 5;
        const MAX = 100;
        const raw = String(productInfo || '').trim();

        if (raw.length >= MIN && raw.length <= MAX) return raw;

        let itemCount = 0;
        let totalPieces = 0;
        if (raw) {
            const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
            itemCount = parts.length;
            for (const p of parts) {
                const m = p.match(/x(\d+)\s*$/i);
                if (m) totalPieces += parseInt(m[1], 10);
            }
        }

        if (itemCount > 0) {
            const productLabel = itemCount === 1 ? 'produit' : 'produits';
            const pieceLabel = totalPieces === 1 ? 'piece' : 'pieces';
            const summary = totalPieces > 0
                ? `${itemCount} ${productLabel}, ${totalPieces} ${pieceLabel}`
                : `${itemCount} ${productLabel}`;
            if (summary.length >= MIN && summary.length <= MAX) return summary;
            if (summary.length > MAX) return summary.substring(0, MAX);
        }

        if (raw.length > MAX) return raw.substring(0, MAX);
        return 'Colis';
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

        // Transform Coliaty format to match frontend expectations.
        // Phone candidates cover Coliaty payload variations across livreur/actor
        // shapes (phone, mobile, tel, gsm). The frontend renders it as a tel: link.
        const pickPhone = (src: any): string => {
            if (!src) return '';
            return String(src.phone || src.mobile || src.tel || src.gsm || '').trim();
        };
        const history = details.map((event: any) => {
            const livreur = event.HISTORY_LIVREUR || null;
            const actor = event.HISTORY_ACTOR || null;
            return {
                status: event.HISTORY_STATUS,
                date: event.HISTORY_STATUS_DATE
                    ? new Date(parseInt(event.HISTORY_STATUS_DATE) * 1000).toISOString()
                    : (event.HISTORY_TIMESTAMP
                        ? new Date(parseInt(event.HISTORY_TIMESTAMP) * 1000).toISOString()
                        : null),
                comment: event.HISTORY_COMMENT || '',
                user: livreur?.name || actor?.name || '',
                phone: pickPhone(livreur) || pickPhone(actor),
                _original: event
            };
        });

        // Get current status from the latest event
        const latestEvent = history[0] || {};

        return {
            status: latestEvent.status || 'Unknown',
            statusLabel: latestEvent.status || 'Unknown',
            history: history,
            _original: result
        };
    }

    // Build the /parcel/normal payload for ONE parcel (shared by single + batch).
    // Resolves the destination city via provider_cities the same way both paths need.
    async buildNormalPayload(parcelData, supabase) {
        const payload = {
            package_code: parcelData.package_code || '',  // Optional - Coliaty will generate if empty
            package_reciever: parcelData.receiver_name || parcelData.customer_name,
            package_phone: parcelData.receiver_phone || parcelData.customer_phone,
            package_price: parcelData.cash_on_delivery || parcelData.cod_amount || 0,
            package_addresse: parcelData.receiver_address || parcelData.delivery_address,
            package_city: parcelData.coliaty_city_name || parcelData.city_name,
            package_content: this.buildPackageContent(parcelData.product_info),
            package_note: parcelData.delivery_note || '',
            package_no_open: parcelData.no_open || false,
            package_replacement: parcelData.replaceable || false,
            package_old_tracking: parcelData.old_tracking || ''
        };

        if (parcelData.master_city_id && supabase) {
            const { data: mapping } = await supabase
                .from('provider_cities')
                .select('provider_city_name')
                .eq('master_city_id', parcelData.master_city_id)
                .eq('provider_type', 'coliaty')
                .single();

            if (mapping?.provider_city_name) {
                payload.package_city = mapping.provider_city_name;
            }
        }

        return payload;
    }

    async createParcel(parcelData, supabase) {
        console.log('=== COLIATY createParcel START ===');
        console.log('Input parcelData:', JSON.stringify(parcelData, null, 2));

        // Map frontend fields to Coliaty API fields (shared builder).
        const payload = await this.buildNormalPayload(parcelData, supabase);
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

    // Batch create up to 100 normal parcels in ONE call via /parcel/normal/mass.
    // Returns an array index-aligned to `parcelDataArray`, each element either
    // { tracking_code, external_id, provider_response } (success) or { error }.
    // A whole-call HTTP failure THROWS (caller fails the chunk, no auto-retry);
    // per-parcel validation errors are returned inline so one bad parcel never
    // sinks the rest. Coliaty keys results by request position: success_parcels
    // and error_parcels are objects keyed "parcel_<0-based index>".
    async createParcelsBatch(parcelDataArray, supabase) {
        console.log('=== COLIATY createParcelsBatch START ===', Array.isArray(parcelDataArray) ? parcelDataArray.length : 0);
        const arr = Array.isArray(parcelDataArray) ? parcelDataArray : [];
        if (arr.length === 0) return [];

        // Build one payload per parcel (per-parcel city resolution).
        const parcels = [];
        for (const pd of arr) parcels.push(await this.buildNormalPayload(pd, supabase));

        const response = await fetch(`${this.baseUrl}/parcel/normal/mass`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: this.getAuthHeader()
            },
            body: JSON.stringify({ parcels })
        });

        const responseText = await response.text();
        console.log('Coliaty batch Response Status:', response.status, response.statusText);

        if (!response.ok) {
            // Whole request rejected — surface as a thrown error so the caller marks
            // the entire chunk failed (some parcels MAY have been created; the caller
            // must verify on the carrier before any retry).
            throw new Error(`Coliaty batch API returned ${response.status}: ${responseText.substring(0, 500)}`);
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            throw new Error(`Coliaty batch returned non-JSON response: ${responseText.substring(0, 200)}`);
        }

        const success = data.data?.success_parcels || {};
        const errors = data.data?.error_parcels || {};

        return arr.map((_, i) => {
            const key = `parcel_${i}`;
            const sv = success[key];
            if (sv !== undefined && sv !== null) {
                // success value is the tracking-code string (fallbacks kept defensive).
                const tracking = typeof sv === 'string' ? sv : (sv.package_code || sv.code || sv.tracking_code);
                if (tracking) {
                    return {
                        tracking_code: tracking,
                        external_id: tracking,
                        provider_response: { batch: true, tracking_code: tracking }
                    };
                }
            }
            const ev = errors[key];
            let msg;
            if (ev == null) msg = 'aucun résultat renvoyé pour ce colis';
            else if (typeof ev === 'string') msg = ev;
            else msg = Object.values(ev).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ');
            return { error: `Coliaty: ${msg}` };
        });
    }

    async createDeliveryNote() {
        console.log('📋 Coliaty: Creating pickup note (bon de ramassage)...');

        // Public API: empty body, Bearer public:secret. Returns { data: { reference } }.
        const response = await fetch(`${this.baseUrl}/pickup-note/create`, {
            method: 'POST',
            headers: {
                'Authorization': this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
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
        const codes = (parcelCodes || []).filter(Boolean);
        console.log('📋 Coliaty: Adding parcels to pickup note:', deliveryNoteRef, `(${codes.length} codes)`);

        if (codes.length === 0) {
            return { success: true, message: 'no codes', data: { success_parcels: {}, error_parcels: {} } };
        }

        // Coliaty caps /pickup-note/add-parcels at 100 codes per request (400
        // "Trop de colis fournis (maximum 100)"), so a batch-created note holding
        // >100 parcels must add in chunks. success_parcels / error_parcels are keyed
        // by tracking CODE, so merging chunks never collides; the shape returned to
        // the caller is identical to a single call.
        // Public API: same body + response as the old dashboard call. Same-phone
        // DUPLICATEs come back in error_parcels with error_id + error_can_ignore.
        const MAX = 100;
        const successObj: Record<string, unknown> = {};
        let successArr: unknown[] | null = null;
        const errorObj: Record<string, unknown> = {};
        let lastMessage = '';
        let allOk = true;

        for (let s = 0; s < codes.length; s += MAX) {
            const chunk = codes.slice(s, s + MAX);
            const response = await fetch(`${this.baseUrl}/pickup-note/add-parcels`, {
                method: 'POST',
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pickup_note_reference: deliveryNoteRef,
                    parcel_codes: chunk
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Coliaty Error Response:', errorText);
                throw new Error(`Failed to add parcels to pickup note: ${errorText}`);
            }

            const result = await response.json();
            console.log(`Coliaty add-parcels chunk ${Math.floor(s / MAX) + 1} (${chunk.length}):`, JSON.stringify(result?.data ?? result).slice(0, 400));
            if (result.success === false) allOk = false;
            if (result.message) lastMessage = result.message;

            const d = result.data || {};
            if (Array.isArray(d.success_parcels)) {
                successArr = (successArr || []).concat(d.success_parcels);
            } else if (d.success_parcels && typeof d.success_parcels === 'object') {
                Object.assign(successObj, d.success_parcels);
            }
            if (d.error_parcels && typeof d.error_parcels === 'object' && !Array.isArray(d.error_parcels)) {
                Object.assign(errorObj, d.error_parcels);
            } else if (Array.isArray(d.error_parcels)) {
                for (const e of d.error_parcels) {
                    const key = e?.code || e?.package_code || e?.tracking_code;
                    if (key) errorObj[key] = e;
                }
            }
        }

        return {
            success: allOk,
            message: lastMessage,
            data: {
                success_parcels: successArr !== null ? successArr : successObj,
                error_parcels: errorObj
            }
        };
    }

    // Remove parcels from a pickup note (public API). Mirrors a local "remove parcel from
    // delivery note" so Coliaty's note stays in sync. Partial-success response shape matches
    // add-parcels: { data: { success_parcels, error_parcels } }. A parcel not in the note
    // comes back in error_parcels ("Le colis n'est pas dans ce bon") — benign for our caller.
    async removeParcelsFromNote(deliveryNoteRef, parcelCodes) {
        const codes = (parcelCodes || []).filter(Boolean);
        if (codes.length === 0) {
            return { success: true, data: { success_parcels: {}, error_parcels: {} } };
        }
        console.log('📋 Coliaty: removing parcels from pickup note:', deliveryNoteRef, codes);

        const response = await fetch(`${this.baseUrl}/pickup-note/remove-parcels`, {
            method: 'POST',
            headers: {
                'Authorization': this.getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pickup_note_reference: deliveryNoteRef,
                parcel_codes: codes
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coliaty remove-parcels error:', errorText);
            throw new Error(`Failed to remove parcels from pickup note: ${errorText}`);
        }

        const result = await response.json();
        return {
            success: result.success,
            message: result.message,
            data: result.data
        };
    }

    // Ignore Coliaty "parcel errors" (e.g. same-phone DUPLICATE) raised when adding
    // parcels to a pickup note. These come back in addParcelsToNote's `error_parcels`
    // with `error_id` + `error_can_ignore:true`. Endpoint is the CUSTOMER-API surface
    // (Bearer public:secret), NOT the dashboard JWT one. After ignoring, re-adding the
    // same parcel code to the note succeeds. Batch endpoint accepts up to 50 ids.
    async ignoreParcelErrors(errorIds) {
        const ids = Array.from(
            new Set((errorIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))
        );
        if (ids.length === 0) {
            return { success: true, ignored: [], failed: [], message: 'No parcel errors to ignore' };
        }
        console.log('🔁 Coliaty: ignoring parcel errors:', ids);

        const ignored = [];
        const failed = [];

        for (let i = 0; i < ids.length; i += 50) {
            const chunk = ids.slice(i, i + 50);
            const response = await fetch(`${this.baseUrl}/parcel/error/ignore/batch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: this.getAuthHeader()
                },
                body: JSON.stringify({ error_ids: chunk })
            });
            const text = await response.text();
            if (!response.ok) {
                console.error('Coliaty ignore-errors HTTP error:', response.status, text.substring(0, 300));
                for (const id of chunk) failed.push({ error_id: id, message: `HTTP ${response.status}` });
                continue;
            }
            let json;
            try {
                json = JSON.parse(text);
            } catch (_) {
                for (const id of chunk) failed.push({ error_id: id, message: 'non-JSON response' });
                continue;
            }
            // Batch shape: { data: { ignored_errors: {"123": {...}}, error_errors: {"124": {...}} } }
            const okMap = json?.data?.ignored_errors || {};
            const badMap = json?.data?.error_errors || {};
            for (const id of chunk) {
                const key = String(id);
                if (okMap[key]?.ignored || (json?.success && Object.keys(okMap).length === 0 && Object.keys(badMap).length === 0)) {
                    ignored.push(id);
                } else if (badMap[key]) {
                    failed.push({ error_id: id, message: badMap[key]?.message || 'could not be ignored' });
                } else {
                    failed.push({ error_id: id, message: json?.message || 'not acknowledged by Coliaty' });
                }
            }
        }

        return { success: failed.length === 0, ignored, failed };
    }

    async deleteNote(reference) {
        // The public API has NO pickup-note delete. Best-effort: read the note and remove
        // all its parcels so the provider note matches our local (authoritative) delete.
        // The empty note shell may linger on Coliaty's side, but no parcels stay attached.
        // Never throws — the local delete already succeeded; this is provider cleanup only.
        console.log('🗑️ Coliaty: emptying pickup note (no public delete):', reference);
        try {
            const detailRes = await fetch(`${this.baseUrl}/pickup-note/detail/${reference}`, {
                method: 'GET',
                headers: { 'Authorization': this.getAuthHeader(), 'Accept': 'application/json' }
            });
            if (!detailRes.ok) {
                console.error('Coliaty deleteNote: detail fetch failed', detailRes.status);
                return { success: true };
            }
            const detail = await detailRes.json();
            const codes = (detail?.data?.parcels || [])
                .map((p) => p?.parcel_code)
                .filter(Boolean);
            if (codes.length > 0) {
                const rmRes = await fetch(`${this.baseUrl}/pickup-note/remove-parcels`, {
                    method: 'POST',
                    headers: { 'Authorization': this.getAuthHeader(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pickup_note_reference: reference, parcel_codes: codes })
                });
                if (!rmRes.ok) {
                    console.error('Coliaty deleteNote: remove-parcels failed', rmRes.status, (await rmRes.text()).substring(0, 200));
                }
            }
        } catch (e) {
            console.error('Coliaty deleteNote best-effort error:', e?.message || e);
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
        console.log('Format:', labelFormat, '(public API has a single label layout — A4 variant not available)');
        console.log('Print type:', printType, '(ignored - Coliaty returns PDF labels)');

        // Public API: single labels endpoint (no -a4 variant), Bearer public:secret.
        // Returns the PDF directly (Content-Type application/pdf), same as before.
        const endpoint = `${this.baseUrl}/pickup-note/${deliveryNoteRef}/generate-labels`;

        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Authorization': this.getAuthHeader(),
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

        return `data:application/pdf;base64,${base64}`;
    }

    // GET /parcel/{code}/allowed-destination-cities. Live shape (verified 2026-07-28):
    // { success, code, message, data: { package_code, package_id, details: {
    //   can_change_destination: bool, reason: string, allowed_hubs: [], allowed_cities: [] } } }
    // `allowed_cities` item shape unconfirmed (only seen empty) — items normalized
    // defensively; array-shaped fallbacks kept in case the endpoint varies.
    async getAllowedDestinationCities(trackingCode) {
        const response = await fetch(`${this.baseUrl}/parcel/${encodeURIComponent(trackingCode)}/allowed-destination-cities`, {
            headers: { Authorization: this.getAuthHeader() }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coliaty allowed-destination-cities error:', response.status, errorText);
            let errorMsg = errorText;
            let errors;
            try {
                const errorJson = JSON.parse(errorText);
                errorMsg = errorJson?.message || errorJson?.error || errorText;
                errors = errorJson?.errors;
            } catch (parseError) {
                // errorText is not JSON - keep the raw text as the message
            }
            const err: any = new Error(`Coliaty Error: ${errorMsg}`);
            err.status_code = response.status;
            if (errors) err.errors = errors;
            throw err;
        }

        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            throw new Error(`Coliaty returned non-JSON response: ${responseText.substring(0, 300)}`);
        }

        const details = data?.data?.details;
        const raw = Array.isArray(details?.allowed_cities) ? details.allowed_cities
            : Array.isArray(data) ? data
            : Array.isArray(data?.data) ? data.data
            : null;
        if (!raw) {
            throw new Error(`Coliaty: unrecognized allowed-destination-cities response: ${responseText.substring(0, 300)}`);
        }

        const cities = raw.map((c: any) => {
            if (typeof c === 'string') return { id: null, name: c };
            return {
                id: c?.id ?? c?.city_id ?? null,
                name: String(c?.name ?? c?.city_name ?? c?.label ?? c?.ville ?? '')
            };
        }).filter((c: any) => c.name);

        if (cities.length === 0 && raw.length > 0) {
            throw new Error(`Coliaty: unrecognized allowed-destination-cities item shape: ${responseText.substring(0, 300)}`);
        }

        return {
            cities,
            // Coliaty tells us whether this parcel's status allows a destination
            // change, with a French reason — surface it instead of an empty list.
            can_change_destination: details ? details.can_change_destination !== false : true,
            reason: typeof details?.reason === 'string' ? details.reason : null
        };
    }

    // POST /parcel-change-demand/create. request_type CORRECT_INFORMATION fixes
    // phone/receiver/price/note (city+address not required); CHANGE_DESTINATION also
    // requires package_city + package_address. package_reciever is Coliaty's own
    // misspelling - sent exactly as they define it.
    async createParcelChangeDemand(trackingCode, params) {
        const payload: any = {
            package_code: trackingCode,
            request_type: params.request_type,
            package_phone: params.package_phone,
            package_reciever: params.package_reciever,
            package_price: params.package_price,
            package_note: params.package_note
        };
        if (params.request_type === 'CHANGE_DESTINATION') {
            payload.package_city = params.package_city;
            payload.package_address = params.package_address;
        }

        const response = await fetch(`${this.baseUrl}/parcel-change-demand/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: this.getAuthHeader()
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Coliaty parcel-change-demand error:', response.status, errorText);
            let errorMsg = errorText;
            let errors;
            try {
                const errorJson = JSON.parse(errorText);
                errorMsg = errorJson?.message || errorJson?.error || errorText;
                errors = errorJson?.errors;
            } catch (parseError) {
                // errorText is not JSON - keep the raw text as the message
            }
            const err: any = new Error(`Coliaty Error: ${errorMsg}`);
            err.status_code = response.status;
            if (errors) err.errors = errors;
            throw err;
        }

        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            throw new Error(`Coliaty returned non-JSON response: ${responseText.substring(0, 300)}`);
        }

        const details = data?.data?.details || {};
        const ref = details.ref;
        // Coliaty can answer 2xx without actually confirming the demand — never
        // treat that as success. Require an explicit success flag AND a ref.
        if (data?.success !== true || ref === undefined || ref === null || ref === '') {
            const err: any = new Error(
                data?.message || data?.error || `Coliaty: réponse de succès invalide (ref manquante) — ${responseText.substring(0, 300)}`
            );
            err.status_code = 502;
            if (data?.errors) err.errors = data.errors;
            throw err;
        }
        return {
            success: true,
            demand: {
                id: details.id,
                ref,
                status: details.status,
                request_type: details.request_type,
                created_at: details.created_at
            },
            package_code: data?.data?.package_code,
            package_id: data?.data?.package_id,
            message: data?.message
        };
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
            const history = trackingData.map((event) => ({
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

            // Get current status from the latest event (Ameex history is sorted ASC, so latest is at the end)
            const latestEvent = history[history.length - 1] || {};

            return {
                status: latestEvent.status || 'Unknown',
                statusLabel: latestEvent.statusLabel || latestEvent.status || 'Unknown',
                statusColor: latestEvent.color,
                history: history,
                _original: data
            };
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
        // AMEEX returns HTML directly for printing
        const html = await response.text();

        // Defensive check: if it's JSON, it might be an error or misinterpretation
        if (html.trim().startsWith('{') || html.trim().startsWith('[')) {
            console.log('AMEEX JSON Response:', html);
            try {
                const json = JSON.parse(html);

                // Check if it's an error message
                if (json.error || json.message) {
                    // Check if it's a "success" message but wrapped
                    if (json.login === 'success' || json.status === 'success' || json.api?.type === 'success') {
                        // Try to find HTML content
                        const content = json.api?.data?.html || json.data?.html || json.html || json.content;
                        if (content && typeof content === 'string') {
                            return content;
                        }
                    } else {
                        throw new Error(json.error || json.message);
                    }
                }

                // Fallback: try to find any HTML-like string
                const content = json.api?.data?.html || json.data?.html || json.html;
                if (content && typeof content === 'string') {
                    return content;
                }

            } catch (e) {
                // Should we ignore? The outer block catches it.
                if (e.message !== 'AMEEX returned JSON instead of HTML...') {
                    // It's a real error from the API
                    throw new Error(`AMEEX Error: ${e.message}`);
                }
            }
            throw new Error(`AMEEX returned JSON instead of HTML: ${html.substring(0, 200)}...`);
        }

        return html;
    }

    async createParcel(parcelData, supabase) {
        // AMEEX uses form-data format
        console.log('=== AMEEX createParcel START ===');
        console.log('Input parcelData:', JSON.stringify(parcelData, null, 2));

        const formData = new URLSearchParams();
        // AMEEX Add Parcel: type SIMPLE or STOCK. Exchange: replace=true + exchange_code = previous parcel tracking (dashboard shows "ÉCHANGE: {code}").
        formData.append('type', parcelData.parcel_type || 'SIMPLE');
        formData.append('business', this.apiId);

        // Support both old and new field names
        const receiver = parcelData.receiver_name || parcelData.customer_name;
        let phone = parcelData.receiver_phone || parcelData.customer_phone;
        const address = parcelData.receiver_address || parcelData.delivery_address;
        const cod = parcelData.cash_on_delivery || parcelData.cod_amount || 0;

        // Normalize phone for AMEEX: must be 10 digits starting with 05/06/07/08
        if (phone) {
            // Remove + and any non-digits
            phone = String(phone).replace(/\D/g, '');

            // Handle 212 prefix
            if (phone.startsWith('212')) {
                phone = phone.substring(3);
            }

            // Ensure starts with 0
            if (!phone.startsWith('0')) {
                phone = '0' + phone;
            }

            console.log('📱 Phone normalization result:', phone);

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

        // City selection: Prefer master_city_id resolve, then ameex_city_code
        let cityCode = parcelData.ameex_city_code;

        if (parcelData.master_city_id && supabase) {
            console.log('Resolving AMEEX code from master_city_id:', parcelData.master_city_id);
            const { data: mapping } = await supabase
                .from('provider_cities')
                .select('provider_city_id')
                .eq('master_city_id', parcelData.master_city_id)
                .eq('provider_type', 'ameex')
                .single();

            if (mapping?.provider_city_id) {
                cityCode = mapping.provider_city_id;
                console.log('Resolved AMEEX code:', cityCode);
            }
        }

        if (!cityCode) {
            console.error('MISSING AMEEX_CITY_CODE!');
            throw new Error(`AMEEX city code is required. Please ensure the city is mapped to AMEEX.`);
        }

        formData.append('city', cityCode);

        const comment = parcelData.delivery_note || '';
        formData.append('comment', comment);
        formData.append('product', parcelData.product_info || '');
        formData.append('fragile', parcelData.fragile || '0');
        formData.append('open', parcelData.open || 'NO');
        formData.append('try', parcelData.try || 'NO');
        if (parcelData.order_num) formData.append('order_num', parcelData.order_num);

        if (parcelData.replaceable) {
            const exchangeParcelCode = String(parcelData.old_tracking || '').trim();
            if (!exchangeParcelCode) {
                throw new Error(
                    'AMEEX exchange requires the previous parcel tracking number (exchange_code). Save it on the order (ameex_old_tracking) before creating the parcel.'
                );
            }
            formData.append('replace', 'true');
            formData.append('exchange_code', exchangeParcelCode);
        }

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

        // AMEEX returns HTTP 200 even on auth failure: {login: "error", api: null}
        // Must validate the response body, not just HTTP status
        if (data.login === 'error' || (data.api && data.api.type === 'error')) {
            const errorMsg = data.api?.msg || data.api?.message || 'AMEEX authentication failed. Check C-Api-Id and C-Api-Key credentials.';
            console.error('AMEEX API returned error:', errorMsg);
            throw new Error(`AMEEX Error: ${errorMsg}`);
        }

        // Extract tracking code and external ID from AMEEX response
        // AMEEX can return: {login: "success", api: {type: "success", data: {id: ..., code: "..."}}}
        const trackingCode = data.data?.code || data.data?.parcel_code || data.api?.data?.code || data.code;
        const externalId = data.data?.id || data.api?.data?.id || data.id;

        console.log('Extracted tracking_code:', trackingCode);
        console.log('Extracted external_id:', externalId);

        if (!trackingCode) {
            console.error('AMEEX response missing tracking code. Full response:', JSON.stringify(data));
            throw new Error('AMEEX did not return a tracking code. Response: ' + JSON.stringify(data).substring(0, 300));
        }

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

        const url = `${this.baseUrl}/customer/Delivery/DeliveryNotes/Action/Type/AddParcels?Ref=${deliveryNoteRef}`;
        console.log('📡 AMEEX AddParcels Request:', url);
        console.log('📦 Payload:', formData.toString());

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'C-Api-Id': this.apiId,
                'C-Api-Key': this.apiKey,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        console.log('📡 AMEEX Response Status:', response.status);

        if (!response.ok) {
            const errText = await response.text();
            console.error('❌ AMEEX add parcels error:', errText);
            throw new Error(`Failed to add parcels to AMEEX note: ${errText}`);
        }

        const result = await response.json();
        console.log('✅ AMEEX addParcelsToNote result:', JSON.stringify(result, null, 2));
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


}

class QuickLivraisonAdapter {
    constructor(credentials) {
        this.apiKey = credentials.api_key || '';
        this.baseUrl = credentials.api_base_url || 'https://clients.quicklivraison.ma/api';
        this.dashboardBaseUrl = 'https://clients.quicklivraison.ma';
        // Public PDF service — same token ships in QL's own dashboard JS for every tenant.
        this.pdfBaseUrl = 'https://admin.quicklivraison.ma';
        this.pdfToken = 'ilernguzhnugfierhgurehfuizelhfnozehfuzi';
        // Dashboard credentials for bordereau flow (undocumented, scraped routes).
        this.login = credentials.api_login || '';
        this.password = credentials.api_password || '';
        // Session state (per-invocation).
        this.cookies = new Map();
        this.csrfToken = null;
    }

    // ---- dashboard session helpers ----
    parseSetCookie(res) {
        const getAll = typeof res.headers.getSetCookie === 'function'
            ? res.headers.getSetCookie.bind(res.headers)
            : null;
        const list = getAll ? getAll() : [res.headers.get('set-cookie')].filter(Boolean);
        for (const raw of list) {
            if (!raw) continue;
            const [pair] = String(raw).split(';');
            const eq = pair.indexOf('=');
            if (eq > 0) this.cookies.set(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
        }
    }
    cookieHeader() {
        return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    async ensureSession() {
        if (this.csrfToken && this.cookies.has('quicklivraison_session')) return;
        if (!this.login || !this.password) {
            throw new Error('Quick Livraison: api_login et api_password requis pour le flux bon de ramassage.');
        }
        // 1. GET login page → seed cookies + capture form _token
        const r1 = await fetch(`${this.dashboardBaseUrl}/login`, { redirect: 'manual' });
        this.parseSetCookie(r1);
        const loginHtml = await r1.text();
        const tokMatch = loginHtml.match(/name="_token"\s+value="([^"]+)"/);
        if (!tokMatch) throw new Error('Quick Livraison: jeton CSRF introuvable sur la page login.');
        const formToken = tokMatch[1];

        // 2. POST credentials (expect 302 to /dashboard)
        const body = new URLSearchParams();
        body.set('email', this.login);
        body.set('password', this.password);
        body.set('_token', formToken);
        const r2 = await fetch(`${this.dashboardBaseUrl}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': this.cookieHeader(),
                'Referer': `${this.dashboardBaseUrl}/login`,
            },
            body: body.toString(),
            redirect: 'manual',
        });
        this.parseSetCookie(r2);
        if (r2.status !== 302) {
            throw new Error(`Quick Livraison login failed: HTTP ${r2.status}. Vérifiez api_login / api_password.`);
        }
        // 3. GET /dashboard to capture in-page CSRF used by XHR
        const r3 = await fetch(`${this.dashboardBaseUrl}/dashboard`, {
            headers: { 'Cookie': this.cookieHeader() },
        });
        this.parseSetCookie(r3);
        const dashHtml = await r3.text();
        const csrfMatch = dashHtml.match(/csrfToken\s*=\s*['"]([^'"]+)['"]/);
        if (!csrfMatch) throw new Error('Quick Livraison: jeton CSRF introuvable sur le dashboard.');
        this.csrfToken = csrfMatch[1];
    }

    async dashboardFetch(path, init) {
        await this.ensureSession();
        const opts = init || {};
        const headers = new Headers(opts.headers || {});
        headers.set('Cookie', this.cookieHeader());
        if (!headers.has('Referer')) headers.set('Referer', `${this.dashboardBaseUrl}/dashboard`);
        const res = await fetch(`${this.dashboardBaseUrl}${path}`, {
            method: opts.method || 'GET',
            headers,
            body: opts.body,
            redirect: opts.redirect || 'manual',
        });
        this.parseSetCookie(res);
        return res;
    }

    async resolveMasterStatus(rawStatus, supabase) {
        if (!rawStatus || !supabase) return null;
        // 1) JSONB containment match (fast exact match) — must carry the master id.
        const { data: exact } = await supabase
            .from('package_statuses')
            .select('id, code, label, color')
            .contains('delivery_service_statuses', JSON.stringify([rawStatus]))
            .limit(1)
            .maybeSingle();
        if (exact) return exact;
        // 2) RPC fallback (case-insensitive, diacritic-insensitive)
        try {
            const { data: rpcMatch } = await supabase.rpc('match_package_status', { p_status_value: rawStatus });
            if (rpcMatch && rpcMatch[0]) return rpcMatch[0];
        } catch (_) { /* RPC optional */ }
        return null;
    }

    async normalizeTrackingPayload(data, trackingCode, supabase) {
        const rawStatus = data.status_second || data.status || 'Unknown';

        // Map current raw QL code → master package_statuses row (French label + color)
        const master = await this.resolveMasterStatus(rawStatus, supabase);
        const statusLabel = master?.label || rawStatus;
        const statusColor = master?.color || null;

        // Helper: resolve a milestone raw code to its master row (label + color + id).
        const resolveEvent = async (rawCode) => {
            const m = await this.resolveMasterStatus(rawCode, supabase);
            return {
                label: m?.label || rawCode,
                color: m?.color || null,
                statusId: m?.id || null,
            };
        };

        // Milestones: each filled QL timestamp = a state transition. Resolve label+color via master.
        const history = [];
        const pushMilestone = async (date, rawCode) => {
            if (!date) return;
            const r = await resolveEvent(rawCode);
            history.push({
                status: rawCode,
                statusLabel: r.label,
                statusColor: r.color,
                statusId: r.statusId,
                color: r.color, // UI-compatible alias used elsewhere (AMEEX shape)
                date,
                comment: ''
            });
        };
        await pushMilestone(data.date_creation, 'NEW_PARCEL');
        await pushMilestone(data.date_ramassage, 'PICKED_UP');
        await pushMilestone(data.date_expedition, 'SENT');
        await pushMilestone(data.date_livraison, 'DELIVERED');
        history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // If the current status is NOT already represented by a milestone (e.g. WAITING_PICKUP,
        // REFUSE, POSTPONED, etc.), append it so the timeline ends on the current state.
        const milestoneCodes = new Set(['NEW_PARCEL', 'PICKED_UP', 'SENT', 'DELIVERED']);
        if (statusLabel && statusLabel !== 'Unknown' && !milestoneCodes.has(rawStatus)) {
            const lastDate = history[history.length - 1]?.date;
            const modDate = data.date_derniere_modification || lastDate || new Date().toISOString();
            history.push({
                status: rawStatus,
                statusLabel,
                statusColor,
                statusId: master?.id || null,
                color: statusColor,
                date: modDate,
                comment: '',
            });
        }

        return {
            tracking_code: data.tracking_number || trackingCode,
            status: rawStatus,
            statusLabel,
            statusColor,
            status_code: master?.code || null,
            history,
            _original: data
        };
    }

    async trackParcel(trackingCode, _externalId, supabase) {
        if (!trackingCode) throw new Error('Tracking code required');
        const response = await fetch(`${this.baseUrl}/getParcelDetails/${encodeURIComponent(trackingCode)}`, {
            method: 'GET'
        });
        if (response.status === 404) return null;
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`QuickLivraison track error: ${errText}`);
        }
        const data = await response.json();
        if (data && data.error) return null;
        return await this.normalizeTrackingPayload(data, trackingCode, supabase);
    }

    async getParcelInfo(trackingCode, supabase) {
        return this.trackParcel(trackingCode, undefined, supabase);
    }

    async createParcel(parcelData, supabase) {
        console.log('=== QUICKLIVRAISON createParcel START ===');
        console.log('Input parcelData:', JSON.stringify(parcelData, null, 2));

        let districtId = parcelData.district_id || parcelData.quicklivraison_city_id;
        if (!districtId && parcelData.master_city_id && supabase) {
            console.log('Resolving QuickLivraison district_id from master_city_id:', parcelData.master_city_id);
            const { data: mapping } = await supabase
                .from('provider_cities')
                .select('provider_city_id')
                .eq('master_city_id', parcelData.master_city_id)
                .eq('provider_type', 'quicklivraison')
                .single();
            if (mapping?.provider_city_id) {
                districtId = mapping.provider_city_id;
                console.log('Resolved QuickLivraison district_id:', districtId);
            }
        }
        if (!districtId) {
            throw new Error('Quick Livraison district_id manquant. La ville doit être mappée pour QuickLivraison.');
        }

        // Phone normalization: QL validation says 9 digits without spaces or dashes.
        // We accept 0XXXXXXXXX (10 digits) and strip leading 0 if API rejects, else pass as-is.
        let phone = String(parcelData.receiver_phone || parcelData.customer_phone || '').replace(/\D/g, '');
        if (phone.startsWith('212')) phone = '0' + phone.substring(3);
        if (!/^0\d{9}$/.test(phone) && !/^\d{9}$/.test(phone)) {
            throw new Error(`Format téléphone invalide pour Quick Livraison: "${phone}". Attendu 9 chiffres ou 0 + 9 chiffres.`);
        }

        const form = new URLSearchParams();
        form.append('api_key', this.apiKey);
        form.append('district_id', String(districtId));
        form.append('name', parcelData.receiver_name || parcelData.customer_name || '');
        form.append('amount', String(parcelData.cash_on_delivery || parcelData.cod_amount || 0));
        form.append('phone', phone);
        form.append('address', parcelData.receiver_address || parcelData.delivery_address || '');
        if (parcelData.delivery_note) form.append('note', String(parcelData.delivery_note));
        // QL's API treats the *presence* of `open` / `try` / `fragile` fields as "true"
        // regardless of value — `open=false` or `open=0` still prints the checkbox ticked.
        // The ONLY way to disable these flags is to OMIT the field entirely.
        // Tested empirically: open=false → ticked; field omitted → unticked.
        const truthy = (v) => v === true || v === 'true' || v === 'YES' || v === '1' || v === 1;
        if (truthy(parcelData.open)) form.append('open', 'true');
        if (truthy(parcelData.try) || truthy(parcelData.try_on)) form.append('try', 'true');
        if (truthy(parcelData.fragile)) form.append('fragile', 'true');
        if (parcelData.product_info) form.append('prd_name', String(parcelData.product_info));
        if (parcelData.product_qty) form.append('qte_prd', String(parcelData.product_qty));

        // Exchange parcels can NOT go through the public API — /api/deliveries/store silently
        // drops the `echange` flag regardless of value format (true/on/1/is_exchange/exchange).
        // Confirmed empirically: the dashboard endpoint `/deliveries/store-ajax` with session
        // auth is the only route that actually flags parcels as exchange.
        if (parcelData.replaceable) {
            return await this.createParcelViaDashboard(parcelData, districtId, phone);
        }

        const url = `${this.baseUrl}/deliveries/store`;
        const body = form.toString();
        console.log('QL request:', url, 'body:', body.replace(this.apiKey, '***'));

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });

        const text = await response.text();
        let data;
        try { data = JSON.parse(text); }
        catch {
            throw new Error(`QuickLivraison returned non-JSON: ${text.substring(0, 300)}`);
        }

        if (!response.ok || data.error) {
            const msg = data.error || data.message || text.substring(0, 300);
            throw new Error(`QuickLivraison Error: ${msg}`);
        }
        if (!data.tracking_number) {
            throw new Error(`QuickLivraison: tracking_number absent. Réponse: ${JSON.stringify(data).substring(0, 300)}`);
        }

        console.log('=== QUICKLIVRAISON createParcel END ===');
        return {
            tracking_code: data.tracking_number,
            external_id: data.tracking_number,
            provider_response: data
        };
    }

    async createParcelViaDashboard(parcelData, districtId, phone) {
        console.log('=== QUICKLIVRAISON createParcel via DASHBOARD (exchange) ===');
        await this.ensureSession();

        // GET /deliveries/create → fresh form _token + pickup defaults for this tenant.
        const r = await this.dashboardFetch('/deliveries/create');
        if (r.status !== 200) {
            throw new Error(`Quick Livraison: /deliveries/create HTTP ${r.status}`);
        }
        const html = await r.text();
        const tokenMatch = html.match(/name="_token"\s+value="([^"]+)"/);
        if (!tokenMatch) throw new Error("Quick Livraison: _token introuvable sur /deliveries/create.");
        const formToken = tokenMatch[1];

        // pickup_district_id is hardcoded by QL into an inline JS `.val(<id>)` in the create page.
        // pickup_ville_id is the selected <option> of the select named pickup_ville_id.
        let pickupDistrict = null;
        const pdMatch = html.match(/name=['"]pickup_district_id['"][^\n]*?value=['"]?(\d+)['"]?/)
            || html.match(/pickup_district_id['"]?\)\.html\("<option\s+value=['"]?(\d+)/)
            || html.match(/pickup_district_id['"]?\)[^\)]*\.val\((\d+)\)/);
        if (pdMatch) pickupDistrict = pdMatch[1];
        let pickupVille = null;
        const pvSel = html.match(/<select[^>]*name=['"]pickup_ville_id['"][\s\S]*?<\/select>/);
        if (pvSel) {
            const m = pvSel[0].match(/<option\s+value=['"](\d+)['"]\s+selected/);
            if (m) pickupVille = m[1];
            else {
                const m2 = pvSel[0].match(/<option\s+value=['"](\d+)['"]/);
                if (m2) pickupVille = m2[1];
            }
        }
        if (!pickupDistrict) {
            throw new Error('Quick Livraison: pickup_district_id introuvable sur /deliveries/create. Vérifiez la configuration de ramassage.');
        }

        const form = new FormData();
        form.append('_token', formToken);
        if (pickupVille) form.append('pickup_ville_id', pickupVille);
        form.append('pickup_district_id', pickupDistrict);
        form.append('district_id', String(districtId));
        form.append('name', parcelData.receiver_name || parcelData.customer_name || '');
        form.append('amount', String(parcelData.cash_on_delivery || parcelData.cod_amount || 0));
        form.append('phone', phone);
        form.append('address', parcelData.receiver_address || parcelData.delivery_address || '');
        if (parcelData.delivery_note) form.append('note', String(parcelData.delivery_note));
        // NEVER append is_stock: the dashboard uses HTML-checkbox convention — the mere
        // presence of the field makes QL flag the parcel as stock-mode, hiding it from
        // the BL/pickup queue. Omit entirely to keep it as a regular pickup parcel.
        form.append('prd_name', String(parcelData.product_info || 'Produit'));
        form.append('qte_prd', String(parcelData.product_qty || 1));

        // Dashboard uses HTML-checkbox convention: field present = checked, absent = unchecked.
        const truthy = (v) => v === true || v === 'true' || v === 'YES' || v === '1' || v === 1;
        if (truthy(parcelData.open)) form.append('open', 'on');
        if (truthy(parcelData.try) || truthy(parcelData.try_on)) form.append('try', 'on');
        if (truthy(parcelData.fragile)) form.append('fragile', 'on');
        form.append('echange', 'on');
        if (parcelData.old_tracking) form.append('echange_colis', String(parcelData.old_tracking));

        const res = await this.dashboardFetch('/deliveries/store-ajax', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'X-CSRF-TOKEN': formToken,
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.dashboardBaseUrl}/deliveries/create`,
            },
            body: form,
            redirect: 'manual',
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch {
            throw new Error(`Quick Livraison store-ajax non-JSON (HTTP ${res.status}): ${text.substring(0, 300)}`);
        }
        if (!data.success || !data.parcel_code) {
            const err = data.errors ? JSON.stringify(data.errors) : (data.message || text.substring(0, 300));
            throw new Error(`Quick Livraison store-ajax error: ${err}`);
        }

        console.log('=== QUICKLIVRAISON createParcel via DASHBOARD END ===');
        return {
            tracking_code: data.parcel_code,
            external_id: data.parcel_code,
            provider_response: data
        };
    }

    async createDeliveryNote() {
        // GET /delevery-note/create → 302 redirect whose Location header carries the new BL ref.
        const res = await this.dashboardFetch('/delevery-note/create');
        if (res.status !== 302 && res.status !== 200) {
            const txt = await res.text();
            throw new Error(`Quick Livraison createDeliveryNote failed: ${res.status} ${txt.substring(0, 200)}`);
        }
        const loc = res.headers.get('location') || res.headers.get('Location') || '';
        const m = loc.match(/BL-[0-9-]+/);
        if (!m) throw new Error(`Quick Livraison: référence BL introuvable (Location=${loc}).`);
        return {
            reference: m[0],
            provider_response: { location: loc }
        };
    }

    async resolveParcelIds(trackingCodes, ref) {
        const res = await this.dashboardFetch(`/DeliveryNote/ref/${ref}`);
        if (!res.ok && res.status !== 200) {
            throw new Error(`Quick Livraison: lecture BL ${ref} échouée (HTTP ${res.status}).`);
        }
        const html = await res.text();
        const idMap = new Map();
        for (const code of trackingCodes) {
            const idx = html.indexOf(String(code));
            if (idx < 0) continue;
            // Internal numeric id appears as a quoted number within ~1.5KB before the tracking code.
            const windowText = html.substring(Math.max(0, idx - 1500), idx);
            const matches = windowText.match(/["']([0-9]{5,10})["']/g) || [];
            if (matches.length === 0) continue;
            const last = matches[matches.length - 1].replace(/['"]/g, '');
            idMap.set(code, last);
        }
        return idMap;
    }

    async addParcelsToNote(deliveryNoteRef, parcelCodes) {
        await this.ensureSession();
        const codes = Array.isArray(parcelCodes) ? parcelCodes.filter(Boolean) : [];
        if (codes.length === 0 || !deliveryNoteRef) {
            return { success: true, reference: deliveryNoteRef, parcel_codes: codes, inserted_ids: [] };
        }
        if (!/^BL-/.test(deliveryNoteRef)) {
            throw new Error('Quick Livraison: référence BL invalide (doit commencer par BL-).');
        }

        const idMap = await this.resolveParcelIds(codes, deliveryNoteRef);
        const ids = [];
        const missing = [];
        for (const code of codes) {
            const id = idMap.get(code);
            if (id) ids.push(id); else missing.push(code);
        }
        if (ids.length === 0) {
            throw new Error(`Quick Livraison: IDs internes introuvables pour ${missing.join(', ')}. Les colis doivent d'abord être créés chez QL.`);
        }

        const body = new URLSearchParams();
        for (const id of ids) body.append('ids[]', id);
        body.set('ref', deliveryNoteRef);
        body.set('_token', this.csrfToken || '');

        const res = await this.dashboardFetch('/DeliveryNote/insert', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-TOKEN': this.csrfToken || '',
                'Referer': `${this.dashboardBaseUrl}/DeliveryNote/ref/${deliveryNoteRef}`,
                'Accept': 'application/json, text/plain, */*',
            },
            body: body.toString(),
        });
        const txt = await res.text();
        let parsed = null;
        try { parsed = JSON.parse(txt); } catch {}

        if (res.status !== 200 && res.status !== 302) {
            throw new Error(`Quick Livraison: /DeliveryNote/insert HTTP ${res.status}: ${txt.substring(0, 200)}`);
        }
        return {
            success: true,
            reference: deliveryNoteRef,
            inserted_ids: ids,
            missing,
            message: parsed?.message || 'inserted',
        };
    }

    async finalizeDeliveryNote(deliveryNoteRef) {
        // Insert already persists on QL's side; no explicit finalize endpoint exists.
        return { success: true, reference: deliveryNoteRef };
    }

    async deleteNote(reference) {
        if (!reference || !/^BL-/.test(reference)) return { success: true, reference };
        try {
            const res = await this.dashboardFetch(`/DeliveryNote/${reference}/drop`);
            return { success: res.status === 302 || res.ok, reference };
        } catch (err) {
            console.error('QL drop note error:', err);
            return { success: false, reference, error: err.message };
        }
    }

    async getPrintUrl(deliveryNoteRef, labelFormat, _printType, options) {
        const fmt = String(labelFormat || '').toLowerCase();
        const isRealBL = deliveryNoteRef && /^BL-/.test(String(deliveryNoteRef));

        // --- Bordereau-level formats (require a real QL BL reference) ---
        if (fmt === 'note' || fmt === 'bordereau' || fmt === 'bl' || fmt === 'bl-pdf') {
            if (!isRealBL) {
                throw new Error('Bordereau QL indisponible: ce bon n\'a pas de référence QL. Recréez-le après activation du flux dashboard.');
            }
            return `${this.pdfBaseUrl}/pdf-delivery-note?token=${encodeURIComponent(this.pdfToken)}&dn-ref=${encodeURIComponent(deliveryNoteRef)}`;
        }
        if (fmt === 'bl-tickets' || fmt === 'note-tickets') {
            if (!isRealBL) throw new Error('Étiquettes du bon QL indisponibles: référence non-QL.');
            return `${this.pdfBaseUrl}/pdf-delivery-note-tickets?token=${encodeURIComponent(this.pdfToken)}&dn-ref=${encodeURIComponent(deliveryNoteRef)}`;
        }
        if (fmt === 'bl-etickets' || fmt === 'note-etickets') {
            if (!isRealBL) throw new Error('E-tickets du bon QL indisponibles: référence non-QL.');
            return `${this.pdfBaseUrl}/pdf-delivery-note-etickets?token=${encodeURIComponent(this.pdfToken)}&dn-ref=${encodeURIComponent(deliveryNoteRef)}`;
        }

        // --- Parcel-level formats (work with or without a real BL) ---
        const supabase = options?.supabase;
        const noteId = options?.noteId;
        if (!supabase || !noteId) {
            throw new Error('Quick Livraison: note_id manquant pour impression parcel.');
        }
        const { data: parcels, error } = await supabase
            .from('company_parcels')
            .select('tracking_code')
            .eq('company_delivery_note_id', noteId);
        if (error) throw new Error(`Quick Livraison: lecture colis échouée (${error.message})`);
        const codes = (parcels || [])
            .map((p) => String(p.tracking_code || '').trim())
            .filter(Boolean);
        if (codes.length === 0) throw new Error('Quick Livraison: aucun colis avec tracking_code dans ce bon.');

        const endpoint = (fmt === 'eticket' || fmt === 'e-ticket')
            ? '/pdf-parcel-eticket'
            : '/pdf-parcel-ticket';
        return `${this.pdfBaseUrl}${endpoint}?token=${encodeURIComponent(this.pdfToken)}&parcel-code=${codes.join(',')}`;
    }
}

export class VitexAdapter {
    constructor(credentials) {
        this.apiKey = credentials.api_key || '';
        this.apiBaseUrl = credentials.api_base_url || 'https://vitex.ma/clients-api';
        this.dashboardBaseUrl = 'https://vitex.ma';
        // Dashboard login credentials (required for fragile/no-open/PDF/BL operations).
        this.login = credentials.api_login || '';
        this.password = credentials.api_password || '';
        // business_id is the Vitex `current_business_id` required by dashboard parcel-create.
        this.businessId = credentials.business_id || '';
        // Per-provider permission flags (snapshot at construction time).
        this.permFragile = credentials.vitex_parcel_fragile === true;
        this.permForbidOpen = credentials.vitex_parcel_open === true;
        // Dashboard session state (per-invocation).
        this.cookies = new Map();
        // Browser UA to dodge Cloudflare bot challenges.
        this.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
    }

    // ---- session helpers ----
    parseSetCookie(res) {
        const getAll = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie.bind(res.headers) : null;
        const list = getAll ? getAll() : [res.headers.get('set-cookie')].filter(Boolean);
        for (const raw of list) {
            if (!raw) continue;
            const [pair] = String(raw).split(';');
            const eq = pair.indexOf('=');
            if (eq > 0) this.cookies.set(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
        }
    }
    cookieHeader() {
        return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    async ensureSession() {
        if (this.cookies.has('PHPSESSID') && this.cookies.has('_vitex_logged_in')) return;
        if (!this.login || !this.password) {
            throw new Error('Vitex: api_login et api_password requis pour le flux dashboard.');
        }
        // 1. Seed PHPSESSID
        const r1 = await fetch(`${this.dashboardBaseUrl}/clients/login`, {
            headers: { 'User-Agent': this.userAgent }
        });
        this.parseSetCookie(r1);
        // 2. POST credentials — success returns 200 with inline JS redirect to /clients/home
        const body = new URLSearchParams();
        body.set('login_customers_email', this.login);
        body.set('login_customers_password', this.password);
        const r2 = await fetch(`${this.dashboardBaseUrl}/clients/login?action=login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': this.userAgent,
                'Cookie': this.cookieHeader(),
                'Referer': `${this.dashboardBaseUrl}/clients/login`,
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: body.toString(),
        });
        this.parseSetCookie(r2);
        const text = await r2.text();
        if (!text.includes('showCustomSwal("success"') && !text.includes('Connexion réussie')) {
            const errMatch = text.match(/showCustomSwal\("error",\s*"([^"]*)",\s*"([^"]*)"/);
            const msg = errMatch ? `${errMatch[1]}: ${errMatch[2]}` : 'identifiants invalides';
            throw new Error(`Vitex login failed: ${msg}`);
        }
        // Sentinel marker so ensureSession short-circuits.
        this.cookies.set('_vitex_logged_in', '1');
    }

    async dashboardFetch(path, init) {
        await this.ensureSession();
        const opts = init || {};
        const headers = new Headers(opts.headers || {});
        headers.set('Cookie', this.cookieHeader());
        headers.set('User-Agent', this.userAgent);
        if (!headers.has('Referer')) headers.set('Referer', `${this.dashboardBaseUrl}/clients`);
        const res = await fetch(`${this.dashboardBaseUrl}${path}`, {
            method: opts.method || 'GET',
            headers,
            body: opts.body,
            redirect: opts.redirect || 'manual',
        });
        this.parseSetCookie(res);
        return res;
    }

    async apiFetch(path, jsonBody) {
        const res = await fetch(`${this.apiBaseUrl}${path}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': this.userAgent,
            },
            body: JSON.stringify(jsonBody || {}),
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch {
            throw new Error(`Vitex non-JSON response (HTTP ${res.status}): ${text.substring(0, 200)}`);
        }
        if (!res.ok || data.status === 'error') {
            const msg = data.message || data.error || text.substring(0, 300);
            throw new Error(`Vitex API error: ${msg}`);
        }
        return data;
    }

    // ---- status mapping ----
    async resolveMasterStatus(rawStatus, supabase) {
        if (!rawStatus || !supabase) return null;
        const { data: exact } = await supabase
            .from('package_statuses')
            .select('id, code, label, color')
            .contains('delivery_service_statuses', JSON.stringify([rawStatus]))
            .limit(1)
            .maybeSingle();
        if (exact) return exact;
        try {
            const { data: rpcMatch } = await supabase.rpc('match_package_status', { p_status_value: rawStatus });
            if (rpcMatch && rpcMatch[0]) return rpcMatch[0];
        } catch (_) { /* RPC optional */ }
        return null;
    }

    async normalizeTrackingPayload(events, trackingCode, supabase) {
        // events is an array of { statut_code, statut_name, created_at } — chronological.
        const history = [];
        for (const ev of (events || [])) {
            const raw = ev.statut_code || '';
            const m = await this.resolveMasterStatus(raw, supabase);
            history.push({
                status: raw,
                statusLabel: m?.label || ev.statut_name || raw,
                statusColor: m?.color || null,
                statusId: m?.id || null,
                color: m?.color || null,
                date: ev.created_at || '',
                comment: '',
            });
        }
        const last = history[history.length - 1] || null;
        return {
            tracking_code: trackingCode,
            status: last?.status || null,
            statusLabel: last?.statusLabel || null,
            statusColor: last?.statusColor || null,
            status_code: null,
            history,
            _original: events,
        };
    }

    // ---- parcel operations ----
    // Resolve Vitex destination city (public API uses NAME, dashboard uses id) and
    // normalize the MA phone. Shared by single + batch. Throws on unmapped city or
    // bad phone so the caller can record a per-parcel error.
    async resolveCityAndPhone(parcelData, supabase) {
        let cityName = null;
        let cityId = null;
        if (parcelData.master_city_id && supabase) {
            const { data: mapping } = await supabase
                .from('provider_cities')
                .select('provider_city_id, provider_city_name')
                .eq('master_city_id', parcelData.master_city_id)
                .eq('provider_type', 'vitex')
                .single();
            if (mapping) {
                cityId = mapping.provider_city_id || null;
                cityName = mapping.provider_city_name || null;
            }
        }
        if (!cityName && parcelData.city_name) cityName = parcelData.city_name;
        if (!cityName) {
            throw new Error('Vitex: ville non mappée. Mappez la ville (provider_cities) avant de créer un colis.');
        }
        // Phone normalization: MA 10 digits starting with 0.
        let phone = String(parcelData.receiver_phone || parcelData.customer_phone || '').replace(/\D/g, '');
        if (phone.startsWith('212')) phone = '0' + phone.substring(3);
        if (!/^0\d{9}$/.test(phone)) {
            throw new Error(`Vitex: format téléphone invalide "${phone}". Attendu 10 chiffres commençant par 0.`);
        }
        return { cityName, cityId, phone };
    }

    // Pure builder for one element of the public /add-parcels `parcels[]` array.
    buildPublicParcelItem(parcelData, cityName, phone, id) {
        return {
            id,
            parcel_receiver: parcelData.receiver_name || parcelData.customer_name || '',
            parcel_phone: phone,
            parcel_price: String(parcelData.cash_on_delivery || parcelData.cod_amount || 0),
            parcel_city: cityName,
            parcel_address: parcelData.receiver_address || parcelData.delivery_address || '',
            parcel_note: String(parcelData.delivery_note || ''),
            marchandise: String(parcelData.product_info || ''),
            parcel_product_qty: Number(parcelData.product_qty || 1),
        };
    }

    async createParcel(parcelData, supabase) {
        console.log('=== VITEX createParcel START ===');
        // Resolve district/city + phone (public API uses city NAME; dashboard uses city_id).
        const { cityName, cityId, phone } = await this.resolveCityAndPhone(parcelData, supabase);

        // Decide path: dashboard if any special flag is active, else public API.
        const useFragile = this.permFragile === true;
        const useForbidOpen = this.permForbidOpen === true;
        const useDashboard = useFragile || useForbidOpen;

        if (useDashboard) {
            if (!cityId) {
                throw new Error('Vitex: city_id (numérique) requis pour le flux dashboard. Complétez provider_cities.provider_city_id.');
            }
            return await this.createParcelViaDashboard(parcelData, cityId, phone, { useFragile, useForbidOpen });
        }

        // Public API create (the batch endpoint used with a single element).
        const reqBody = { parcels: [this.buildPublicParcelItem(parcelData, cityName, phone, 1)] };
        const resp = await this.apiFetch('/add-parcels', reqBody);
        const successMap = resp?.data?.success || {};
        const failedMap = resp?.data?.failed || {};
        const tracking = successMap['1'];
        if (!tracking) {
            const err = failedMap['1'] || JSON.stringify(resp).substring(0, 300);
            throw new Error(`Vitex: création échouée: ${err}`);
        }
        console.log('=== VITEX createParcel END (public) ===', tracking);
        return {
            tracking_code: tracking,
            external_id: tracking,
            provider_response: resp,
        };
    }

    // Batch create up to 100 parcels via the public /add-parcels endpoint.
    // ONLY valid on the public path — if fragile/forbid-open flags are set the
    // provider uses the per-parcel dashboard flow (no batch endpoint), so this
    // throws and the caller falls back to single creates. Returns an array
    // index-aligned to `parcelDataArray`; per-parcel validation errors are inline.
    async createParcelsBatch(parcelDataArray, supabase) {
        if (this.permFragile === true || this.permForbidOpen === true) {
            throw new Error('Vitex: batch indisponible avec les options fragile/interdiction-ouverture (flux dashboard).');
        }
        console.log('=== VITEX createParcelsBatch START ===', Array.isArray(parcelDataArray) ? parcelDataArray.length : 0);
        const arr = Array.isArray(parcelDataArray) ? parcelDataArray : [];
        const results = new Array(arr.length).fill(null);
        const parcels = [];
        const idToIndex = new Map();
        for (let i = 0; i < arr.length; i++) {
            try {
                const { cityName, phone } = await this.resolveCityAndPhone(arr[i], supabase);
                const id = i + 1; // Vitex keys its success/failed maps by this id.
                idToIndex.set(id, i);
                parcels.push(this.buildPublicParcelItem(arr[i], cityName, phone, id));
            } catch (e) {
                results[i] = { error: e.message };
            }
        }
        if (parcels.length === 0) {
            return results.map((r) => r || { error: 'Vitex: aucun colis valide' });
        }
        const resp = await this.apiFetch('/add-parcels', { parcels });
        const successMap = resp?.data?.success || {};
        const failedMap = resp?.data?.failed || {};
        for (const p of parcels) {
            const idx = idToIndex.get(p.id);
            const tracking = successMap[String(p.id)];
            if (tracking) {
                results[idx] = {
                    tracking_code: tracking,
                    external_id: tracking,
                    provider_response: { batch: true, tracking_code: tracking },
                };
            } else {
                const err = failedMap[String(p.id)];
                results[idx] = { error: `Vitex: ${err ? (typeof err === 'string' ? err : JSON.stringify(err)) : 'création échouée'}` };
            }
        }
        return results;
    }

    async createParcelViaDashboard(parcelData, cityId, phone, flags) {
        console.log('=== VITEX createParcel via DASHBOARD ===');
        if (!this.businessId) {
            throw new Error('Vitex: business_id requis pour le flux dashboard (current_business_id).');
        }
        await this.ensureSession();

        const body = new URLSearchParams();
        body.set('current_business_id', String(this.businessId));
        body.set('parcel_receiver', parcelData.receiver_name || parcelData.customer_name || '');
        body.set('parcel_phone', phone);
        body.set('parcel_city', String(cityId));
        body.set('parcel_address', parcelData.receiver_address || parcelData.delivery_address || '');
        body.set('parcel_prd_name', String(parcelData.product_info || 'Produit'));
        body.set('parcel_prd_qty', String(parcelData.product_qty || 1));
        body.set('parcel_note', String(parcelData.delivery_note || ''));
        body.set('parcel_price', String(parcelData.cash_on_delivery || parcelData.cod_amount || 0));
        // HTML-checkbox convention on Vitex dashboard: 1=on, 0=off. Both values accepted — presence matters only for URLs, form-encoded values are passed through.
        body.set('parcel_is_fragile', flags.useFragile ? '1' : '0');
        body.set('parcel_open', flags.useForbidOpen ? '1' : '0');
        body.set('replacing_parcel_code', '');

        const res = await this.dashboardFetch('/clients/parcels?action=add-action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': '*/*',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.dashboardBaseUrl}/clients/parcels?action=add`,
            },
            body: body.toString(),
        });
        const text = await res.text();
        if (!res.ok && res.status !== 200) {
            throw new Error(`Vitex dashboard create HTTP ${res.status}: ${text.substring(0, 300)}`);
        }
        // Success inline JS: window.lastCreatedParcel = { code: "...", id: ..., isFragile: ... };
        const codeMatch = text.match(/window\.lastCreatedParcel\s*=\s*\{\s*code:\s*"([^"]+)"/);
        if (!codeMatch) {
            const errMatch = text.match(/showCustomSwal\("error",\s*"([^"]*)",\s*"([^"]*)"/);
            const msg = errMatch ? `${errMatch[1]}: ${errMatch[2]}` : text.substring(0, 300);
            throw new Error(`Vitex dashboard create failed: ${msg}`);
        }
        const tracking = codeMatch[1];
        console.log('=== VITEX createParcel via DASHBOARD END ===', tracking);
        return {
            tracking_code: tracking,
            external_id: tracking,
            provider_response: { parcel_code: tracking, raw_html_length: text.length },
        };
    }

    async trackParcel(trackingCode, _externalId, supabase) {
        if (!trackingCode) throw new Error('Tracking code required');
        const resp = await this.apiFetch('/tracking', { tracking_number: trackingCode });
        const events = Array.isArray(resp?.data) ? resp.data : [];
        if (events.length === 0) return null;
        return await this.normalizeTrackingPayload(events, trackingCode, supabase);
    }

    async getParcelInfo(trackingCode, supabase) {
        return this.trackParcel(trackingCode, undefined, supabase);
    }

    async createDeliveryNote() {
        // Dashboard session creates an empty BL we can later fill via add-to-delivery.
        // GET /clients/delivery-note?action=create returns 302 with Location to the new edit URL.
        const res = await this.dashboardFetch('/clients/delivery-note?action=create');
        if (res.status !== 302 && res.status !== 200) {
            const txt = await res.text();
            throw new Error(`Vitex createDeliveryNote HTTP ${res.status}: ${txt.substring(0, 200)}`);
        }
        const loc = res.headers.get('location') || res.headers.get('Location') || '';
        const m = loc.match(/BL-[0-9-]+/);
        if (m) {
            return { reference: m[0], provider_response: { location: loc } };
        }
        // If 200 (no redirect), try to extract ref from HTML.
        const body = await res.text();
        const m2 = body.match(/dn-ref=(BL-[0-9-]+)/);
        if (m2) return { reference: m2[1], provider_response: { location: '' } };
        throw new Error('Vitex: référence BL introuvable après création.');
    }

    async addParcelsToNote(deliveryNoteRef, parcelCodes) {
        const codes = Array.isArray(parcelCodes) ? parcelCodes.filter(Boolean) : [];
        if (!deliveryNoteRef) throw new Error('Vitex: référence BL requise.');
        if (codes.length === 0) {
            return { success: true, reference: deliveryNoteRef, parcel_codes: [], inserted: 0 };
        }
        const inserted = [];
        const failed = [];
        for (const code of codes) {
            const path = `/clients/parcels-waiting-pick-up?action=add-to-delivery&dn-ref=${encodeURIComponent(deliveryNoteRef)}&parcel-code=${encodeURIComponent(code)}`;
            const res = await this.dashboardFetch(path);
            const txt = await res.text();
            if (res.ok && txt.includes('ajouté avec succès')) {
                inserted.push(code);
            } else {
                failed.push({ code, error: txt.substring(0, 200) });
            }
        }
        if (inserted.length === 0 && failed.length > 0) {
            throw new Error(`Vitex: aucun colis ajouté. Échecs: ${JSON.stringify(failed).substring(0, 400)}`);
        }
        return { success: true, reference: deliveryNoteRef, parcel_codes: inserted, inserted: inserted.length, failed };
    }

    async finalizeDeliveryNote(deliveryNoteRef) {
        // Vitex transitions parcels to WAITING_PICKUP automatically on add-to-delivery. No explicit finalize.
        return { success: true, reference: deliveryNoteRef };
    }

    async deleteNote(reference) {
        if (!reference || !/^BL-/.test(reference)) return { success: true, reference };
        try {
            const res = await this.dashboardFetch(`/clients/delivery-note?action=delete&dn-ref=${encodeURIComponent(reference)}`);
            return { success: res.ok || res.status === 302, reference };
        } catch (err) {
            console.error('Vitex deleteNote error:', err);
            return { success: false, reference, error: err.message };
        }
    }

    async deleteParcel(parcelCode) {
        if (!parcelCode) return { success: true };
        try {
            const res = await this.dashboardFetch(`/clients/parcels?action=delete&parcel-code=${encodeURIComponent(parcelCode)}`);
            return { success: res.ok || res.status === 302, parcel_code: parcelCode };
        } catch (err) {
            return { success: false, parcel_code: parcelCode, error: err.message };
        }
    }

    async getPrintUrl(deliveryNoteRef, labelFormat, _printType, _options) {
        const fmt = String(labelFormat || '').toLowerCase();
        const isRealBL = deliveryNoteRef && /^BL-/.test(String(deliveryNoteRef));
        if (!isRealBL) {
            throw new Error("Vitex: référence BL manquante ou invalide pour l'impression.");
        }
        // Vitex PDFs are session-gated — fetch with cookies and return a data URL.
        // Three formats: bordereau BL, stickers, e-stickers.
        let path;
        if (fmt === 'eticket' || fmt === 'e-ticket' || fmt === 'bl-etickets' || fmt === 'note-etickets') {
            path = `/clients/pdf-delivery-note-etickets?dn-ref=${encodeURIComponent(deliveryNoteRef)}`;
        } else if (fmt === 'ticket' || fmt === 'tickets' || fmt === 'bl-tickets' || fmt === 'note-tickets' || fmt === 'labels') {
            path = `/clients/pdf-delivery-note-tickets?dn-ref=${encodeURIComponent(deliveryNoteRef)}`;
        } else {
            // Default + explicit 'note' / 'bl' / 'bordereau' → the main Bon de Livraison PDF.
            path = `/clients/pdf-delivery-note?dn-ref=${encodeURIComponent(deliveryNoteRef)}`;
        }
        const res = await this.dashboardFetch(path, { redirect: 'follow' });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Vitex PDF HTTP ${res.status}: ${txt.substring(0, 200)}`);
        }
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        return `data:application/pdf;base64,${base64}`;
    }
}

class ForcelogAdapter {
    constructor(credentials) {
        this.providerId = credentials.id || null;
        this.apiKey = credentials.api_key || '';
        this.apiBaseUrl = credentials.api_base_url || 'https://api.forcelog.ma';
        this.dashboardBaseUrl = 'https://customer.forcelog.ma';
        // Dashboard login credentials (required for fragile/carton/exchange/BL/PDF operations).
        this.login = credentials.api_login || '';
        this.password = credentials.api_password || '';
        // Per-provider permission flags (snapshot at construction time).
        this.permFragile = credentials.forcelog_parcel_fragile === true;
        this.permForbidOpen = credentials.forcelog_parcel_open === true;
        // Dashboard session state (per-invocation).
        this.cookies = new Map();
        this.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
        // Preload cached session from DB (written by prior invocation).
        const cached = credentials.session_cache || null;
        if (cached && typeof cached === 'object' && cached.cookies && typeof cached.cookies === 'object') {
            for (const [k, v] of Object.entries(cached.cookies)) {
                if (typeof v === 'string') this.cookies.set(k, v);
            }
            this.cachedAt = cached.updated_at || null;
        } else {
            this.cachedAt = null;
        }
        // Short-lived in-adapter supabase client (service role) for session persistence.
        this._supabase = null;
    }

    getSupabase() {
        if (this._supabase) return this._supabase;
        try {
            const url = Deno.env.get('SUPABASE_URL');
            const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
            if (url && key) {
                this._supabase = createClient(url, key);
            }
        } catch (_) { /* service client unavailable */ }
        return this._supabase;
    }

    async persistSession() {
        if (!this.providerId) return;
        const sb = this.getSupabase();
        if (!sb) return;
        const cookiesObj = Object.fromEntries(this.cookies.entries());
        try {
            await sb.from('providers').update({
                session_cache: { cookies: cookiesObj, updated_at: new Date().toISOString() },
            }).eq('id', this.providerId);
        } catch (_) { /* best-effort persistence */ }
    }

    async clearPersistedSession() {
        if (!this.providerId) return;
        const sb = this.getSupabase();
        if (!sb) return;
        try {
            await sb.from('providers').update({ session_cache: null }).eq('id', this.providerId);
        } catch (_) { /* best-effort */ }
    }

    parseSetCookie(res) {
        const getAll = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie.bind(res.headers) : null;
        const list = getAll ? getAll() : [res.headers.get('set-cookie')].filter(Boolean);
        for (const raw of list) {
            if (!raw) continue;
            const [pair] = String(raw).split(';');
            const eq = pair.indexOf('=');
            if (eq > 0) this.cookies.set(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
        }
    }
    cookieHeader() {
        return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    async ensureSession() {
        // Short-circuit if cached cookies are present AND not stale (< 2h).
        if (this.cookies.has('PHPSESSID')) {
            if (!this.cachedAt) return;
            const ageMs = Date.now() - new Date(this.cachedAt).getTime();
            if (Number.isFinite(ageMs) && ageMs < 2 * 60 * 60 * 1000) return;
            // Stale — force re-login by clearing cookies.
            this.cookies.clear();
            this.cachedAt = null;
        }
        if (!this.login || !this.password) {
            throw new Error('Forcelog: api_login et api_password requis pour le flux dashboard.');
        }
        const body = new URLSearchParams();
        body.set('login_email', this.login);
        body.set('login_password', this.password);
        const r = await fetch(`${this.dashboardBaseUrl}/index/login/action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': this.userAgent,
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.dashboardBaseUrl}/index/login`,
                'Origin': this.dashboardBaseUrl,
                'Accept': '*/*',
            },
            body: body.toString(),
        });
        this.parseSetCookie(r);
        const text = await r.text();
        if (!text.includes('connecté avec succès') && !text.includes('Vous êtes connecté')) {
            const errMatch = text.match(/smNotif\(\s*""\s*,\s*"([^"]*)"\s*,\s*"error"/);
            const msg = errMatch ? errMatch[1] : 'identifiants invalides';
            throw new Error(`Forcelog login failed: ${msg}`);
        }
        if (!this.cookies.has('PHPSESSID')) {
            throw new Error('Forcelog login: PHPSESSID introuvable après authentification.');
        }
        this.cachedAt = new Date().toISOString();
        // Persist fresh cookies so the next edge function invocation reuses them (avoids rate-limit).
        await this.persistSession();
    }

    async dashboardFetch(path, init, _retried) {
        await this.ensureSession();
        const opts = init || {};
        const headers = new Headers(opts.headers || {});
        headers.set('Cookie', this.cookieHeader());
        headers.set('User-Agent', this.userAgent);
        if (!headers.has('Referer')) headers.set('Referer', `${this.dashboardBaseUrl}/index/home`);
        if (!headers.has('X-Requested-With')) headers.set('X-Requested-With', 'XMLHttpRequest');
        const res = await fetch(`${this.dashboardBaseUrl}${path}`, {
            method: opts.method || 'GET',
            headers,
            body: opts.body,
            redirect: opts.redirect || 'manual',
        });
        this.parseSetCookie(res);
        // If the server returned a login-redirect stub, cached session is stale → clear + retry once.
        if (!_retried && res.ok) {
            const peek = res.clone();
            try {
                const txt = await peek.text();
                if (/window\.location\s*=\s*"[^"]*\/index\/login"/i.test(txt)) {
                    this.cookies.clear();
                    this.cachedAt = null;
                    await this.clearPersistedSession();
                    return this.dashboardFetch(path, init, true);
                }
            } catch (_) { /* body peek optional */ }
        }
        return res;
    }

    async apiFetch(path, method, jsonBody) {
        const init = {
            method: method || 'GET',
            headers: {
                'X-API-Key': this.apiKey,
                'Accept': 'application/json',
                'User-Agent': this.userAgent,
            },
        };
        if (jsonBody !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(jsonBody);
        }
        const res = await fetch(`${this.apiBaseUrl}${path}`, init);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch {
            throw new Error(`Forcelog non-JSON response (HTTP ${res.status}): ${text.substring(0, 200)}`);
        }
        return { ok: res.ok, status: res.status, data };
    }

    async resolveMasterStatus(rawStatus, supabase) {
        if (!rawStatus || !supabase) return null;
        const { data: exact } = await supabase
            .from('package_statuses')
            .select('id, code, label, color')
            .contains('delivery_service_statuses', JSON.stringify([rawStatus]))
            .limit(1)
            .maybeSingle();
        if (exact) return exact;
        try {
            const { data: rpcMatch } = await supabase.rpc('match_package_status', { p_status_value: rawStatus });
            if (rpcMatch && rpcMatch[0]) return rpcMatch[0];
        } catch (_) { /* RPC optional */ }
        return null;
    }

    async createParcel(parcelData, supabase) {
        console.log('=== FORCELOG createParcel START ===');
        // Resolve city: public API uses NAME, dashboard uses numeric ID.
        let cityName = null;
        let cityId = null;
        if (parcelData.master_city_id && supabase) {
            const { data: mapping } = await supabase
                .from('provider_cities')
                .select('provider_city_id, provider_city_name')
                .eq('master_city_id', parcelData.master_city_id)
                .eq('provider_type', 'forcelog')
                .maybeSingle();
            if (mapping) {
                cityId = mapping.provider_city_id || null;
                cityName = mapping.provider_city_name || null;
            }
        }
        if (!cityName && parcelData.city_name) cityName = parcelData.city_name;
        if (!cityName) {
            throw new Error('Forcelog: ville non mappée. Mappez la ville (provider_cities) avant de créer un colis.');
        }

        // Phone normalization: MA 10 digits starting with 0.
        let phone = String(parcelData.receiver_phone || parcelData.customer_phone || '').replace(/\D/g, '');
        if (phone.startsWith('212')) phone = '0' + phone.substring(3);
        if (!/^0\d{9}$/.test(phone)) {
            throw new Error(`Forcelog: format téléphone invalide "${phone}". Attendu 10 chiffres commençant par 0.`);
        }

        // Decide path: dashboard if any special flag is active OR exchange requested, else public API.
        const useFragile = this.permFragile === true;
        const useForbidOpen = this.permForbidOpen === true;
        const hasExchange = Boolean(parcelData.replace_parcel_code || parcelData.old_parcel_code);
        const useDashboard = useFragile || useForbidOpen || hasExchange;

        if (useDashboard) {
            if (!cityId) {
                throw new Error('Forcelog: city_id (numérique) requis pour le flux dashboard. Complétez provider_cities.provider_city_id pour cette ville.');
            }
            return await this.createParcelViaDashboard(parcelData, cityId, phone, { useFragile, useForbidOpen, hasExchange });
        }

        // Public API JSON.
        const reqBody = {
            ORDER_NUM: String(parcelData.order_num || parcelData.reference || '').substring(0, 20),
            RECEIVER: String(parcelData.receiver_name || parcelData.customer_name || '').substring(0, 50),
            PHONE: phone,
            CITY: cityName,
            ADDRESS: String(parcelData.receiver_address || parcelData.delivery_address || '').substring(0, 100),
            COMMENT: String(parcelData.delivery_note || '').substring(0, 100),
            PRODUCT_NATURE: String(parcelData.product_info || '').substring(0, 100),
            COD: Number(parcelData.cash_on_delivery || parcelData.cod_amount || 0),
            CAN_OPEN: 1,
        };
        const resp = await this.apiFetch('/customer/Parcels/AddParcel', 'POST', reqBody);
        const addParcel = resp.data?.['ADD-PARCEL'];
        if (!resp.ok || addParcel?.RESULT !== 'SUCCESS') {
            const msg = addParcel?.MESSAGE || resp.data?.AUTH?.MESSAGE || JSON.stringify(resp.data).substring(0, 300);
            throw new Error(`Forcelog: création échouée: ${msg}`);
        }
        const tracking = addParcel?.['NEW-PARCEL']?.TRACKING_NUMBER;
        if (!tracking) {
            throw new Error('Forcelog: TRACKING_NUMBER manquant dans la réponse.');
        }
        console.log('=== FORCELOG createParcel END (public) ===', tracking);
        return {
            tracking_code: tracking,
            external_id: tracking,
            provider_response: resp.data,
        };
    }

    async createParcelViaDashboard(parcelData, cityId, phone, flags) {
        console.log('=== FORCELOG createParcel via DASHBOARD ===');
        await this.ensureSession();

        const orderNum = String(parcelData.order_num || parcelData.reference || '');
        const body = new URLSearchParams();
        body.set('parcel_order_num', orderNum);
        if (flags.hasExchange) {
            body.set('parcel_replace', 'on');
            body.set('parcel_replace_old', String(parcelData.replace_parcel_code || parcelData.old_parcel_code || ''));
        }
        body.set('parcel_type', 'SIMPLE_PARCEL');
        body.set('parcel_open', flags.useForbidOpen ? 'NO' : 'YES');
        body.set('parcel_receiver', String(parcelData.receiver_name || parcelData.customer_name || ''));
        body.set('parcel_phone', phone);
        body.set('parcel_city', String(cityId));
        body.set('parcel_district', String(parcelData.district || parcelData.quartier || ''));
        body.set('parcel_address', String(parcelData.receiver_address || parcelData.delivery_address || ''));
        body.set('parcel_comment', String(parcelData.delivery_note || ''));
        body.set('parcel_price', String(parcelData.cash_on_delivery || parcelData.cod_amount || 0));
        body.set('parcel_product_type', String(parcelData.product_info || ''));
        if (flags.useFragile) body.set('fragile_parcel', 'on');
        body.set('carton_size', '0');

        const res = await this.dashboardFetch('/index/Parcels/AddParcelAction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': '*/*',
                'Referer': `${this.dashboardBaseUrl}/index/Parcels/AddParcel`,
                'Origin': this.dashboardBaseUrl,
            },
            body: body.toString(),
        });
        const text = await res.text();
        // Error path: smNotif(...,"error")
        const errMatch = text.match(/smNotif\(\s*""\s*,\s*"([^"]*)"\s*,\s*"error"/);
        if (errMatch) {
            throw new Error(`Forcelog dashboard create: ${errMatch[1]}`);
        }
        // Success path: smNotif(...,"Colis ajouté avec succès","success") — response has no tracking code inline.
        if (!text.includes('Colis ajouté') && !text.includes('success')) {
            throw new Error(`Forcelog dashboard create: réponse inattendue. ${text.substring(0, 300)}`);
        }
        // Lookup the freshly-created parcel via the pickup list (DT_RowId="parcel-F-XXX", CODE contains our order_num).
        const tracking = await this.lookupLatestParcelTracking(orderNum, phone);
        if (!tracking) {
            throw new Error(`Forcelog dashboard create: colis créé côté Forcelog mais code de suivi introuvable dans la liste pickup (order_num=${orderNum}).`);
        }
        console.log('=== FORCELOG createParcel via DASHBOARD END ===', tracking);
        return {
            tracking_code: tracking,
            external_id: tracking,
            provider_response: { parcel_code: tracking },
        };
    }

    async lookupLatestParcelTracking(orderNum, phone) {
        // Query DataTables JSON endpoint for ParcelsPickUp, find row matching our order_num (primary) or phone (fallback).
        const body = new URLSearchParams();
        body.set('draw', '1');
        body.set('start', '0');
        body.set('length', '25');
        const res = await this.dashboardFetch('/index/ParcelsPickUp/Json', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json',
                'Referer': `${this.dashboardBaseUrl}/index/ParcelsPickUp`,
                'Origin': this.dashboardBaseUrl,
            },
            body: body.toString(),
        });
        if (!res.ok) return null;
        let parsed;
        try { parsed = JSON.parse(await res.text()); } catch { return null; }
        const rows = Array.isArray(parsed?.aaData) ? parsed.aaData : [];
        const wantedOrderNum = String(orderNum || '').trim();
        const wantedPhone = String(phone || '').trim();
        // Primary: CODE cell contains our order_num (unique per creation).
        for (const row of rows) {
            const codeCell = String(row?.CODE || '');
            if (wantedOrderNum && codeCell.includes(wantedOrderNum)) {
                const m = String(row?.DT_RowId || '').match(/F-[A-Z0-9]+/);
                if (m) return m[0];
                const m2 = codeCell.match(/F-[A-Z0-9]+/);
                if (m2) return m2[0];
            }
        }
        // Fallback: newest row with matching phone.
        for (const row of rows) {
            if (wantedPhone && String(row?.PHONE || '').replace(/\D/g, '') === wantedPhone) {
                const m = String(row?.DT_RowId || '').match(/F-[A-Z0-9]+/);
                if (m) return m[0];
            }
        }
        return null;
    }

    async trackParcel(trackingCode, _externalId, supabase) {
        if (!trackingCode) throw new Error('Tracking code required');
        // Public API (/customer/Parcels/GetParcel) can't see dashboard-created parcels — returns
        // "Parcel code Not Found" even when the parcel exists. Scrape the dashboard tracking modal
        // instead; it returns {TITLE, BODY, FOOTER} where BODY is an HTML timeline of status events.
        const res = await this.dashboardFetch(
            `/index/Parcels/Tracking/ParcelCode/${encodeURIComponent(trackingCode)}`,
            { headers: { 'Accept': 'application/json' } }
        );
        if (!res.ok) return null;
        const txt = await res.text();
        let payload;
        try { payload = JSON.parse(txt); } catch { return null; }
        const body = String(payload?.BODY || '');
        if (!body) return null;
        // Convert Forcelog's relative French dates to ISO. Morocco is UTC+1 (no DST).
        // Accepts: "aujourd'hui à HH:MM", "hier à HH:MM", "il y a N minutes/heures", "YYYY-MM-DD à HH:MM".
        const frenchDateToIso = (raw) => {
            const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
            if (!s) return '';
            const nowMs = Date.now();
            const tzOffsetMs = 60 * 60 * 1000; // UTC+1
            const hmMatch = s.match(/(\d{1,2}):(\d{2})/);
            const todayStr = new Date(nowMs + tzOffsetMs).toISOString().slice(0, 10);
            if (s.startsWith("aujourd'hui") || s.startsWith('aujourdhui')) {
                if (hmMatch) return `${todayStr}T${hmMatch[1].padStart(2, '0')}:${hmMatch[2]}:00+01:00`;
                return new Date(nowMs).toISOString();
            }
            if (s.startsWith('hier')) {
                const yest = new Date(nowMs + tzOffsetMs - 86400000).toISOString().slice(0, 10);
                if (hmMatch) return `${yest}T${hmMatch[1].padStart(2, '0')}:${hmMatch[2]}:00+01:00`;
                return new Date(nowMs - 86400000).toISOString();
            }
            const agoMatch = s.match(/il y a (\d+)\s*(minute|heure|jour)/);
            if (agoMatch) {
                const n = parseInt(agoMatch[1], 10);
                const unitMs = agoMatch[2] === 'minute' ? 60000 : agoMatch[2] === 'heure' ? 3600000 : 86400000;
                return new Date(nowMs - n * unitMs).toISOString();
            }
            const abs = s.match(/(\d{4})-(\d{2})-(\d{2})(?:\s*(?:à|a)\s*(\d{1,2}):(\d{2}))?/);
            if (abs) {
                const [, y, mo, d, h, mi] = abs;
                const hh = (h || '00').padStart(2, '0');
                const mm = (mi || '00').padStart(2, '0');
                return `${y}-${mo}-${d}T${hh}:${mm}:00+01:00`;
            }
            return raw;
        };
        const events = [];
        // Each event is a <div class="vertical-timeline-item vertical-timeline-element">…</div>.
        const elRe = /<div class="vertical-timeline-item vertical-timeline-element">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
        let m;
        while ((m = elRe.exec(body)) !== null) {
            const chunk = m[1];
            const badges = [...chunk.matchAll(/<div class=["']badge badge-statut\s*["'] style=["']--color:\s*([^;"']+)\s*;?["']>([^<]+)<\/div>/g)];
            if (badges.length === 0) continue;
            const statusBadge = badges[badges.length - 1];
            const color = (statusBadge[1] || '').trim();
            const label = (statusBadge[2] || '').trim();
            const dateM = chunk.match(/<div class="text-muted text-end col-4">([^<]+)<\/div>/);
            const rawDate = dateM ? dateM[1].trim() : '';
            const date = frenchDateToIso(rawDate);
            const contentM = chunk.match(/<div class=['"]timeline-content['"]>([\s\S]*?)<\/div>/);
            const comment = contentM ? contentM[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
            if (label) events.push({ label, color, date, comment });
        }
        if (events.length === 0) return null;
        // Latest event is the last one in the timeline (Forcelog renders chronologically top→bottom).
        const latest = events[events.length - 1];
        const master = await this.resolveMasterStatus(latest.label, supabase);
        const history = events.map((e) => ({
            status: e.label,
            statusLabel: e.label,
            statusColor: e.color || null,
            statusId: null,
            color: e.color || null,
            date: e.date,
            comment: e.comment,
        }));
        return {
            tracking_code: trackingCode,
            status: latest.label,
            statusLabel: master?.label || latest.label,
            statusColor: master?.color || latest.color || null,
            status_code: null,
            history,
        };
    }

    async getParcelInfo(trackingCode, supabase) {
        return this.trackParcel(trackingCode, undefined, supabase);
    }

    async createDeliveryNote() {
        const res = await this.dashboardFetch('/index/DeliveryNotes/AddNewAction', {
            headers: { 'Referer': `${this.dashboardBaseUrl}/index/DeliveryNotes/AddNew` },
        });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`Forcelog createDeliveryNote HTTP ${res.status}: ${t.substring(0, 200)}`);
        }
        const text = await res.text();
        const m = text.match(/BL-[0-9-]+/);
        if (!m) {
            throw new Error('Forcelog: référence BL introuvable après création.');
        }
        return { reference: m[0], provider_response: { html_length: text.length } };
    }

    async addParcelsToNote(deliveryNoteRef, parcelCodes) {
        const codes = Array.isArray(parcelCodes) ? parcelCodes.filter(Boolean) : [];
        if (!deliveryNoteRef) throw new Error('Forcelog: référence BL requise.');
        if (codes.length === 0) {
            return { success: true, reference: deliveryNoteRef, parcel_codes: [], inserted: 0 };
        }
        const inserted = [];
        const failed = [];
        for (const code of codes) {
            // BL Edit page checkbox uses name="parcels_code[]" (snake_case) — verified empirically.
            // The camelCase "parcelsCode[]" is silently ignored by AddToNote even though the server
            // still returns the generic dataTableReload script (false-positive signal).
            const body = new URLSearchParams();
            body.append('parcels_code[]', code);
            const res = await this.dashboardFetch(`/index/DeliveryNotes/AddToNote/Ref/${encodeURIComponent(deliveryNoteRef)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Accept': '*/*',
                    'Referer': `${this.dashboardBaseUrl}/index/DeliveryNotes/Edit/Ref/${encodeURIComponent(deliveryNoteRef)}`,
                    'Origin': this.dashboardBaseUrl,
                },
                body: body.toString(),
            });
            const txt = await res.text();
            if (/window\.location\s*=\s*"[^"]*\/index\/login"/i.test(txt)) {
                failed.push({ code, error: 'Forcelog session expired (redirected to login)' });
                continue;
            }
            const errMatch = txt.match(/smNotif\(\s*""\s*,\s*"([^"]*)"\s*,\s*"error"/);
            if (errMatch) {
                failed.push({ code, error: errMatch[1] });
                continue;
            }
            // Require explicit "Ajouté avec succès <b>F-XXX</b>" notif containing the parcel code
            // — dataTableReload alone is returned even on no-op requests.
            const successRe = new RegExp(`smNotif\\(\\s*""\\s*,\\s*"[^"]*${code.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[^"]*"\\s*,\\s*"success"`);
            if (res.ok && successRe.test(txt)) {
                inserted.push(code);
            } else {
                failed.push({ code, error: `HTTP ${res.status}: ${txt.substring(0, 200)}` });
            }
        }
        if (inserted.length === 0 && failed.length > 0) {
            throw new Error(`Forcelog: aucun colis ajouté. Échecs: ${JSON.stringify(failed).substring(0, 400)}`);
        }
        return { success: true, reference: deliveryNoteRef, parcel_codes: inserted, inserted: inserted.length, failed };
    }

    async finalizeDeliveryNote(deliveryNoteRef) {
        if (!deliveryNoteRef) throw new Error('Forcelog: référence BL requise.');
        const res = await this.dashboardFetch(`/index/DeliveryNotes/Save/Ref/${encodeURIComponent(deliveryNoteRef)}`, {
            headers: { 'Referer': `${this.dashboardBaseUrl}/index/DeliveryNotes` },
        });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`Forcelog finalize HTTP ${res.status}: ${t.substring(0, 200)}`);
        }
        return { success: true, reference: deliveryNoteRef };
    }

    async deleteNote(reference) {
        if (!reference || !/^BL-/.test(reference)) return { success: true, reference };
        try {
            const res = await this.dashboardFetch(`/index/DeliveryNotes/Delete/Ref/${encodeURIComponent(reference)}`, {
                headers: { 'Referer': `${this.dashboardBaseUrl}/index/DeliveryNotes` },
            });
            return { success: res.ok || res.status === 302, reference };
        } catch (err) {
            return { success: false, reference, error: err.message };
        }
    }

    async deleteParcel(parcelCode) {
        if (!parcelCode) return { success: true };
        try {
            const res = await this.dashboardFetch(`/index/Parcels/Delete/ParcelCode/${encodeURIComponent(parcelCode)}`, {
                headers: { 'Referer': `${this.dashboardBaseUrl}/index/ParcelsPickUp` },
            });
            return { success: res.ok || res.status === 302, parcel_code: parcelCode };
        } catch (err) {
            return { success: false, parcel_code: parcelCode, error: err.message };
        }
    }

    async reopenNote(deliveryNoteRef) {
        if (!deliveryNoteRef) throw new Error('Forcelog: référence BL requise.');
        const res = await this.dashboardFetch(`/index/DeliveryNotes/Open/Ref/${encodeURIComponent(deliveryNoteRef)}/Type/InPg`, {
            headers: { 'Referer': `${this.dashboardBaseUrl}/index/DeliveryNotes/Edit/Ref/${encodeURIComponent(deliveryNoteRef)}` },
        });
        return { success: res.ok, reference: deliveryNoteRef };
    }

    async getPrintUrl(deliveryNoteRef, labelFormat, _printType, _options) {
        const fmt = String(labelFormat || '').toLowerCase();
        const isRealBL = deliveryNoteRef && /^BL-/.test(String(deliveryNoteRef));
        if (!isRealBL) {
            throw new Error("Forcelog: référence BL manquante ou invalide pour l'impression.");
        }
        // Four Forcelog PDF formats, all session-gated.
        let path;
        if (fmt === 'a4' || fmt === 'note-a4') {
            path = `/index/PDF/DeliveryNoteA4_NEW/Ref/${encodeURIComponent(deliveryNoteRef)}`;
        } else if (fmt === 'a4x8' || fmt === 'a4-8' || fmt === 'note-a4x8' || fmt === 'labels-a4x8') {
            path = `/index/PDF/DeliveryNoteA4_8_NEW/Ref/${encodeURIComponent(deliveryNoteRef)}`;
        } else if (fmt === 'sticker' || fmt === 'stickers' || fmt === 'square' || fmt === 'note-stickers') {
            path = `/index/PDF/DeliveryNoteSquare_NEW/Ref/${encodeURIComponent(deliveryNoteRef)}`;
        } else {
            // Default 'bl' / 'bordereau' / 'note' → main bon de livraison list PDF.
            path = `/index/PDF/DeliveryNote/Ref/${encodeURIComponent(deliveryNoteRef)}`;
        }
        const res = await this.dashboardFetch(path, { redirect: 'follow' });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`Forcelog PDF HTTP ${res.status}: ${t.substring(0, 200)}`);
        }
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        return `data:application/pdf;base64,${base64}`;
    }
}

class SenditAdapter {
    constructor(credentials) {
        this.apiBaseUrl = credentials.api_base_url || 'https://app.sendit.ma/api/v1';
        this.publicKey = credentials.api_public_key || '';
        this.secretKey = credentials.api_secret_key || '';
        this.pickupDistrictId = credentials.sendit_pickup_district_id || null;
        // allow_open hardcoded to 1: Sendit's API ignores the field and always stores 1 regardless of
        // what we send (verified across POST/PUT with int/bool/string/omitted). Keep DB column unused.
        this.allowOpen = 1;
        this.allowTry = credentials.sendit_allow_try === true ? 1 : 0;
        // Pickup contact (required by Sendit POST /pickups). Stored on the provider row
        // via the admin Permissions modal. Fallback to businesses row if not set.
        this.pickupName = (credentials.sendit_pickup_name || '').toString().trim() || null;
        this.pickupPhone = (credentials.sendit_pickup_phone || '').toString().trim() || null;
        this.pickupAddress = (credentials.sendit_pickup_address || '').toString().trim() || null;
        this.businessId = credentials['DigiCom Business'] || null;
        this.token = null;
    }

    async fetchPickupContact(supabase) {
        // Prefer provider-row overrides (sendit_pickup_name/phone/address set in admin UI).
        if (this.pickupName && this.pickupPhone && this.pickupAddress) {
            return {
                name: this.pickupName.substring(0, 100),
                phone: this.pickupPhone.substring(0, 30),
                address: this.pickupAddress.substring(0, 200),
            };
        }
        // Fallback to the business row (name, business_phone, legal_address + legal_city).
        let fallback = { name: 'DigiCom', phone: '0000000000', address: 'Adresse non renseignée' };
        if (supabase && this.businessId) {
            const { data } = await supabase
                .from('businesses')
                .select('name, business_phone, legal_address, legal_city')
                .eq('id', this.businessId)
                .maybeSingle();
            const rawPhone = String(data?.business_phone || '').replace(/\D/g, '');
            const phone = /^0\d{9}$/.test(rawPhone)
                ? rawPhone
                : rawPhone
                    ? (rawPhone.startsWith('212') ? '0' + rawPhone.substring(3) : rawPhone)
                    : '0000000000';
            const addressParts = [data?.legal_address, data?.legal_city].filter(Boolean).map(String);
            fallback = {
                name: (data?.name || 'DigiCom').toString(),
                phone,
                address: addressParts.join(', ') || 'Adresse non renseignée',
            };
        }
        return {
            name: (this.pickupName || fallback.name).substring(0, 100),
            phone: (this.pickupPhone || fallback.phone).substring(0, 30),
            address: (this.pickupAddress || fallback.address).substring(0, 200),
        };
    }

    async ensureToken() {
        if (this.token) return;
        if (!this.publicKey || !this.secretKey) {
            throw new Error('Sendit: clé publique et clé privée requises.');
        }
        const r = await fetch(`${this.apiBaseUrl}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ public_key: this.publicKey, secret_key: this.secretKey }),
        });
        const t = await r.text();
        let j;
        try { j = JSON.parse(t); } catch { throw new Error(`Sendit login: réponse invalide (HTTP ${r.status}): ${t.substring(0, 200)}`); }
        if (!r.ok || !j?.success || !j?.data?.token) {
            throw new Error(`Sendit login échoué: ${j?.message || t.substring(0, 200)}`);
        }
        this.token = j.data.token;
    }

    async apiFetch(path, method, jsonBody, _retried) {
        await this.ensureToken();
        const init = {
            method: method || 'GET',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/json',
            },
        };
        if (jsonBody !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(jsonBody);
        }
        const res = await fetch(`${this.apiBaseUrl}${path}`, init);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch {
            return { ok: res.ok, status: res.status, data: null, raw: text };
        }
        // 401 → token expired, re-login once
        if (res.status === 401 && !_retried) {
            this.token = null;
            return this.apiFetch(path, method, jsonBody, true);
        }
        return { ok: res.ok, status: res.status, data };
    }

    async resolveMasterStatus(rawStatus, supabase) {
        if (!rawStatus || !supabase) return null;
        try {
            const { data: rpcMatch } = await supabase.rpc('match_package_status', { p_status_value: rawStatus });
            if (rpcMatch && rpcMatch[0]) return rpcMatch[0];
        } catch (_) { /* RPC optional */ }
        const { data: exact } = await supabase
            .from('package_statuses')
            .select('id, code, label, color')
            .contains('delivery_service_statuses', JSON.stringify([rawStatus]))
            .limit(1)
            .maybeSingle();
        return exact || null;
    }

    async createParcel(parcelData, supabase) {
        console.log('=== SENDIT createParcel START ===');
        if (!this.pickupDistrictId) {
            throw new Error('Sendit: district de ramassage non configuré. Renseignez-le dans la page Delivery Services (Permissions).');
        }
        // Resolve destination district
        let districtId = null;
        if (parcelData.master_city_id && supabase) {
            const { data: mapping } = await supabase
                .from('provider_cities')
                .select('provider_city_id')
                .eq('master_city_id', parcelData.master_city_id)
                .eq('provider_type', 'sendit')
                .maybeSingle();
            if (mapping?.provider_city_id) {
                const n = parseInt(mapping.provider_city_id, 10);
                if (Number.isFinite(n)) districtId = n;
            }
        }
        if (!districtId) {
            throw new Error('Sendit: district de destination introuvable pour cette ville. Mappez-la dans la page Cities.');
        }

        // Phone normalization (0XXXXXXXXX, 10 digits starting with 0).
        let phone = String(parcelData.receiver_phone || parcelData.customer_phone || '').replace(/\D/g, '');
        if (phone.startsWith('212')) phone = '0' + phone.substring(3);
        if (!/^0\d{9}$/.test(phone)) {
            throw new Error(`Sendit: format téléphone invalide "${phone}". Attendu 10 chiffres commençant par 0.`);
        }

        const amount = Number(parcelData.cash_on_delivery || parcelData.cod_amount || 0);
        const body = {
            pickup_district_id: this.pickupDistrictId,
            district_id: districtId,
            name: String(parcelData.receiver_name || parcelData.customer_name || '').substring(0, 100),
            amount: amount,
            address: String(parcelData.receiver_address || parcelData.delivery_address || '').substring(0, 200),
            phone,
            comment: String(parcelData.delivery_note || '').substring(0, 200),
            reference: String(parcelData.order_num || parcelData.reference || '').substring(0, 50),
            allow_open: this.allowOpen,
            allow_try: this.allowTry,
            // Stock management disabled per project policy.
            products_from_stock: 0,
        };

        // Exchange mode — Sendit uses delivery_exchange_id pointing at the old parcel code.
        if (parcelData.replace_parcel_code || parcelData.old_parcel_code) {
            body.option_exchange = 1;
            body.delivery_exchange_id = String(parcelData.replace_parcel_code || parcelData.old_parcel_code);
        }

        const resp = await this.apiFetch('/deliveries', 'POST', body);
        if (!resp.ok || !resp.data?.success || !resp.data?.data?.code) {
            const msg = resp.data?.message || resp.data?.error || JSON.stringify(resp.data || resp.raw || {}).substring(0, 300);
            throw new Error(`Sendit: création échouée (HTTP ${resp.status}): ${msg}`);
        }
        const tracking = resp.data.data.code;
        console.log('=== SENDIT createParcel END ===', tracking);
        return {
            tracking_code: tracking,
            external_id: tracking,
            provider_response: resp.data.data,
        };
    }

    async trackParcel(trackingCode, _externalId, supabase) {
        if (!trackingCode) throw new Error('Tracking code required');
        const resp = await this.apiFetch(`/deliveries/${encodeURIComponent(trackingCode)}`, 'GET');
        if (!resp.ok || !resp.data?.success || !resp.data?.data) return null;
        const d = resp.data.data;
        const rawStatus = d.status || '';
        const master = await this.resolveMasterStatus(rawStatus, supabase);
        // Sendit returns `audits` — an array of {event, user, created_at, data: {...}}.
        // Build history entries from audits where data.status is present and distinct.
        const audits = Array.isArray(d.audits) ? d.audits : [];
        const history = [];
        let lastStatus = null;
        for (const a of audits) {
            const s = a?.data?.status;
            if (!s || s === lastStatus) continue;
            lastStatus = s;
            const entryMaster = await this.resolveMasterStatus(s, supabase);
            history.push({
                status: s,
                statusLabel: entryMaster?.label || s,
                statusColor: entryMaster?.color || null,
                statusId: entryMaster?.id || null,
                color: entryMaster?.color || null,
                date: a?.created_at || '',
                comment: a?.event || '',
            });
        }
        // Fallback: if audits don't include status, at least surface the latest.
        if (history.length === 0 && rawStatus) {
            history.push({
                status: rawStatus,
                statusLabel: master?.label || rawStatus,
                statusColor: master?.color || null,
                statusId: master?.id || null,
                color: master?.color || null,
                date: d.last_action_at || '',
                comment: '',
            });
        }
        return {
            tracking_code: trackingCode,
            status: rawStatus,
            statusLabel: master?.label || rawStatus,
            statusColor: master?.color || null,
            status_code: null,
            history,
        };
    }

    async getParcelInfo(trackingCode, supabase) {
        return this.trackParcel(trackingCode, undefined, supabase);
    }

    async createDeliveryNote() {
        // Sendit's POST /pickups requires parcel codes at creation time. We can't create an
        // empty pickup, so return a placeholder draft reference. The real pickup (P-XXXXXXX)
        // is created by the first addParcelsToNote call, which will swap the reference on
        // the delivery_notes row via the wizard client.
        const draft = `SENDIT-DRAFT-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
        return { reference: draft, provider_response: { draft: true } };
    }

    async addParcelsToNote(deliveryNoteRef, parcelCodes, supabase) {
        const codes = Array.isArray(parcelCodes) ? parcelCodes.filter(Boolean) : [];
        if (!deliveryNoteRef) throw new Error('Sendit: référence BL requise.');
        if (codes.length === 0) {
            return { success: true, reference: deliveryNoteRef, parcel_codes: [], inserted: 0 };
        }
        const isDraft = /^SENDIT-DRAFT-/i.test(deliveryNoteRef);

        if (isDraft) {
            // First add → create a real pickup with all codes in one shot.
            const contact = await this.fetchPickupContact(supabase);
            const body = {
                district_id: this.pickupDistrictId,
                name: contact.name,
                phone: contact.phone,
                address: contact.address,
                note: '',
                deliveries: codes.join(','),
            };
            const resp = await this.apiFetch('/pickups', 'POST', body);
            // Sendit wraps: {success, message, data: {code, ...}}. Some endpoints also return
            // the bare object — handle both.
            const newCode = resp.data?.data?.code || resp.data?.code;
            if (!resp.ok || !newCode) {
                const msg = resp.data?.message || resp.data?.error || JSON.stringify(resp.data || {}).substring(0, 300);
                throw new Error(`Sendit: création pickup échouée (HTTP ${resp.status}): ${msg}`);
            }
            return {
                success: true,
                reference: newCode,
                parcel_codes: codes,
                inserted: codes.length,
                previous_reference: deliveryNoteRef,  // client should update external_id
                changed_reference: true,
            };
        }

        // Real pickup exists — read current codes, merge with new, PUT.
        const getResp = await this.apiFetch(`/pickups/${encodeURIComponent(deliveryNoteRef)}`, 'GET');
        if (!getResp.ok) {
            throw new Error(`Sendit: pickup ${deliveryNoteRef} introuvable (HTTP ${getResp.status}).`);
        }
        const pickupObj = getResp.data?.data || getResp.data || {};
        const current = pickupObj?.deliveries || {};
        const existingCodes = Object.keys(current);
        const merged = Array.from(new Set([...existingCodes, ...codes]));
        const putResp = await this.apiFetch(`/pickups/${encodeURIComponent(deliveryNoteRef)}`, 'PUT', {
            deliveries: merged.join(','),
        });
        if (!putResp.ok) {
            const msg = putResp.data?.message || JSON.stringify(putResp.data || {}).substring(0, 300);
            throw new Error(`Sendit: mise à jour pickup échouée (HTTP ${putResp.status}): ${msg}`);
        }
        return {
            success: true,
            reference: deliveryNoteRef,
            parcel_codes: codes,
            inserted: codes.length,
        };
    }

    async finalizeDeliveryNote(deliveryNoteRef) {
        // Sendit has no explicit finalize endpoint — pickups are picked up by warehouse staff.
        // If the ref is still a draft (no parcels were added), return a soft failure.
        if (/^SENDIT-DRAFT-/i.test(deliveryNoteRef)) {
            return { success: false, reference: deliveryNoteRef, error: 'Aucun colis ajouté — ramassage non créé côté Sendit.' };
        }
        return { success: true, reference: deliveryNoteRef };
    }

    async deleteNote(reference) {
        if (!reference || /^SENDIT-DRAFT-/i.test(reference)) {
            // Draft — nothing to delete server-side.
            return { success: true, reference };
        }
        try {
            const resp = await this.apiFetch(`/pickups/${encodeURIComponent(reference)}`, 'DELETE');
            return { success: !!(resp.ok && resp.data?.success), reference };
        } catch (err) {
            return { success: false, reference, error: err.message };
        }
    }

    async deleteParcel(parcelCode) {
        if (!parcelCode) return { success: true };
        try {
            const resp = await this.apiFetch(`/deliveries/${encodeURIComponent(parcelCode)}`, 'DELETE');
            return { success: !!(resp.ok && resp.data?.success), parcel_code: parcelCode };
        } catch (err) {
            return { success: false, parcel_code: parcelCode, error: err.message };
        }
    }

    async getPrintUrl(deliveryNoteRef, _labelFormat, _printType, _options) {
        // Sendit exposes only A4 label batch printing via the API (`POST /deliveries/getlabels`).
        // Thermal 10×10 and BL pickup-form PDFs are dashboard-only; open the dashboard instead.
        const opts = _options || {};
        let codes = Array.isArray(opts.parcel_codes) ? opts.parcel_codes.filter(Boolean) : [];

        // If no codes passed, try fetching from the Sendit pickup (real ref) or our local DB (draft).
        if (codes.length === 0 && deliveryNoteRef && !/^SENDIT-DRAFT-/i.test(deliveryNoteRef)) {
            const r = await this.apiFetch(`/pickups/${encodeURIComponent(deliveryNoteRef)}`, 'GET');
            const pickup = r.data?.data || r.data || {};
            if (r.ok && pickup?.deliveries) codes = Object.keys(pickup.deliveries);
        }
        if (codes.length === 0 && opts.supabase && opts.noteId) {
            // Fallback: load parcel codes from our local DB for this delivery note.
            const { data: localParcels } = await opts.supabase
                .from('company_parcels')
                .select('tracking_code')
                .eq('company_delivery_note_id', opts.noteId);
            codes = (localParcels || []).map((p) => p.tracking_code).filter(Boolean);
        }
        if (codes.length === 0) {
            throw new Error('Sendit: aucun colis à imprimer.');
        }
        const resp = await this.apiFetch('/deliveries/getlabels', 'POST', {
            codesToPrint: codes.join(','),
            printFormat: 1,
        });
        // Sendit's getlabels response doesn't use the standard wrapper — it returns
        // `{filePrint: true, fileUrl}` at the top level. Accept both shapes.
        const fileUrl = resp.data?.fileUrl || resp.data?.data?.fileUrl;
        if (!resp.ok || !fileUrl) {
            const msg = resp.data?.message || JSON.stringify(resp.data || {}).substring(0, 300);
            throw new Error(`Sendit: impression échouée (HTTP ${resp.status}): ${msg}`);
        }
        return fileUrl;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Digylog adapter — Bearer auth + Sendit-style draft→BL upgrade flow.
// API base: https://api.digylog.com/api/v2/seller
// Tracking codes look like "S1036052CA". BL is created by PUT /orders/send and
// is immutable afterward, so subsequent adds must spawn a new note (same as
// Sendit's pickup model).
// ─────────────────────────────────────────────────────────────────────────────
export class DigylogAdapter {
    constructor(credentials) {
        this.apiBaseUrl = (credentials.api_base_url || 'https://api.digylog.com/api/v2/seller').replace(/\/+$/, '');
        this.token = credentials.api_key || credentials.api_secret_key || '';
        this.networkId = credentials.digylog_network_id ? Number(credentials.digylog_network_id) : null;
        this.storeName = (credentials.digylog_store_name || '').toString().trim() || null;
        this.defaultPort = Number(credentials.digylog_default_port) === 1 ? 1 : 2;
        this.allowOpen = credentials.digylog_allow_open === true ? 1 : 0;
        this.providerId = credentials.id || null;
        this.businessId = credentials['DigiCom Business'] || null;
    }

    async apiFetch(path, method, jsonBody) {
        if (!this.token) throw new Error('Digylog: token API requis (api_secret_key).');
        const init = {
            method: method || 'GET',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Referer': 'https://apiseller.digylog.com',
                'Accept': 'application/json',
            },
        };
        if (jsonBody !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(jsonBody);
        }
        const res = await fetch(`${this.apiBaseUrl}${path}`, init);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch {
            return { ok: res.ok, status: res.status, data: null, raw: text };
        }
        return { ok: res.ok, status: res.status, data };
    }

    async resolveMasterStatus(rawStatus, supabase) {
        if (!rawStatus || !supabase) return null;
        try {
            const { data: rpcMatch } = await supabase.rpc('match_package_status', { p_status_value: rawStatus });
            if (rpcMatch && rpcMatch[0]) return rpcMatch[0];
        } catch (_) { /* RPC optional */ }
        const { data: exact } = await supabase
            .from('package_statuses')
            .select('id, code, label, color')
            .contains('delivery_service_statuses', JSON.stringify([rawStatus]))
            .limit(1)
            .maybeSingle();
        return exact || null;
    }

    // Build ONE Digylog order object (shared by single + batch). Resolves city +
    // phone + refs; throws on bad city/phone so the caller records a per-parcel error.
    // `num` (= order_num, i.e. order.id) is the batch reconciliation key.
    async buildOrder(parcelData, supabase) {
        // Destination city — Digylog accepts the NAME (no IDs in /cities response).
        let cityName = '';
        if (parcelData.master_city_id && supabase) {
            const { data: mapping } = await supabase
                .from('provider_cities')
                .select('provider_city_name')
                .eq('master_city_id', parcelData.master_city_id)
                .eq('provider_type', 'digylog')
                .maybeSingle();
            cityName = String(mapping?.provider_city_name || '').trim();
        }
        if (!cityName) cityName = String(parcelData.city_name || '').trim();
        if (!cityName) {
            throw new Error('Digylog: ville de destination introuvable. Mappez-la dans la page Cities.');
        }

        // Phone normalization (10 digits starting with 05/06/07/08).
        let phone = String(parcelData.receiver_phone || parcelData.customer_phone || '').replace(/\D/g, '');
        if (phone.startsWith('212')) phone = '0' + phone.substring(3);
        if (!/^0[5678]\d{8}$/.test(phone)) {
            throw new Error(`Digylog: téléphone invalide "${phone}". Attendu 10 chiffres commençant par 05/06/07/08.`);
        }

        const isExchange = !!(parcelData.replace_parcel_code || parcelData.old_parcel_code || parcelData.replaceable);
        const items = Array.isArray(parcelData.items) ? parcelData.items : [];
        // refs[].designation is required for mode=1 (Standard, what DigiCom uses).
        // Exchange flag goes on order.type, not on the refs shape.
        const refs = items
            .filter((i) => Number(i.quantity) > 0)
            .map((i) => ({
                designation: String(i.name || i.product?.name || i.code || 'Produit').substring(0, 200),
                quantity: Number(i.quantity) || 1,
            }));
        if (refs.length === 0) {
            refs.push({
                designation: String(parcelData.product_info || parcelData.designation || 'Produit').substring(0, 200),
                quantity: 1,
            });
        }

        return {
            num: String(parcelData.order_num || parcelData.reference || '').substring(0, 50),
            type: isExchange ? 2 : 1,
            name: String(parcelData.receiver_name || parcelData.customer_name || '').substring(0, 100),
            phone,
            address: String(parcelData.receiver_address || parcelData.delivery_address || '').substring(0, 200),
            city: cityName,
            price: Number(parcelData.cash_on_delivery || parcelData.cod_amount || 0),
            openproduct: this.allowOpen,
            port: this.defaultPort,
            note: String(parcelData.delivery_note || '').substring(0, 200),
            refs,
            pickup: 0,
        };
    }

    async createParcel(parcelData, supabase) {
        console.log('=== DIGYLOG createParcel START ===');
        if (!this.networkId) {
            throw new Error('Digylog: réseau non configuré (Permissions > Réseau Digylog).');
        }
        if (!this.storeName) {
            throw new Error('Digylog: boutique non configurée (Permissions > Boutique Digylog).');
        }

        const order = await this.buildOrder(parcelData, supabase);

        const body = {
            mode: 1,
            network: this.networkId,
            store: this.storeName,
            status: 0, // add only — PUT /orders/send creates the BL.
            checkDuplicate: 1,
            orders: [order],
        };

        const resp = await this.apiFetch('/orders', 'POST', body);
        if (!resp.ok || !Array.isArray(resp.data) || !resp.data[0]?.tracking) {
            const msg = (resp.data && (resp.data.message || resp.data.error)) || JSON.stringify(resp.data || resp.raw || {}).substring(0, 300);
            throw new Error(`Digylog: création échouée (HTTP ${resp.status}): ${msg}`);
        }
        const created = resp.data[0];
        const tracking = created.tracking;
        console.log('=== DIGYLOG createParcel END ===', tracking);
        return {
            tracking_code: tracking,
            external_id: tracking,
            provider_response: created,
        };
    }

    // Batch create up to 100 parcels via POST /orders (orders[] array). Returns an
    // array index-aligned to `parcelDataArray`, matched back by `num` (= order.id),
    // so any submitted order missing from the response (e.g. a checkDuplicate
    // rejection) is marked failed. checkDuplicate=1 also makes a re-sent order.id
    // idempotent, so a retried batch won't double-create on Digylog.
    async createParcelsBatch(parcelDataArray, supabase) {
        if (!this.networkId) {
            throw new Error('Digylog: réseau non configuré (Permissions > Réseau Digylog).');
        }
        if (!this.storeName) {
            throw new Error('Digylog: boutique non configurée (Permissions > Boutique Digylog).');
        }
        console.log('=== DIGYLOG createParcelsBatch START ===', Array.isArray(parcelDataArray) ? parcelDataArray.length : 0);
        const arr = Array.isArray(parcelDataArray) ? parcelDataArray : [];
        const results = new Array(arr.length).fill(null);
        const orders = [];
        const numToIndex = new Map();
        for (let i = 0; i < arr.length; i++) {
            try {
                const order = await this.buildOrder(arr[i], supabase);
                orders.push(order);
                numToIndex.set(String(order.num), i);
            } catch (e) {
                results[i] = { error: e.message };
            }
        }
        if (orders.length === 0) {
            return results.map((r) => r || { error: 'Digylog: aucun colis valide' });
        }

        const body = {
            mode: 1,
            network: this.networkId,
            store: this.storeName,
            status: 0,
            checkDuplicate: 1,
            orders,
        };

        const resp = await this.apiFetch('/orders', 'POST', body);
        if (!resp.ok || !Array.isArray(resp.data)) {
            const msg = (resp.data && (resp.data.message || resp.data.error)) || JSON.stringify(resp.data || resp.raw || {}).substring(0, 300);
            throw new Error(`Digylog: création batch échouée (HTTP ${resp.status}): ${msg}`);
        }

        const seen = new Set();
        for (const row of resp.data) {
            const num = String(row?.num ?? '');
            if (!numToIndex.has(num)) continue;
            const idx = numToIndex.get(num);
            seen.add(num);
            if (row?.tracking) {
                results[idx] = { tracking_code: row.tracking, external_id: row.tracking, provider_response: row };
            } else {
                results[idx] = { error: `Digylog: ${row?.message || row?.error || 'création échouée pour cette commande'}` };
            }
        }
        // Submitted orders absent from the response (duplicate rejected, etc.).
        for (const [num, idx] of numToIndex.entries()) {
            if (!seen.has(num) && results[idx] === null) {
                results[idx] = { error: 'Digylog: commande absente de la réponse (doublon rejeté ou erreur).' };
            }
        }
        return results;
    }

    async trackParcel(trackingCode, _externalId, supabase) {
        if (!trackingCode) throw new Error('Tracking code required');
        // /historics returns the audit log keyed by tracking code.
        const resp = await this.apiFetch(`/historics?trackings=${encodeURIComponent(trackingCode)}`, 'GET');
        const root = resp.data || {};
        const audits = Array.isArray(root[trackingCode]) ? root[trackingCode] : [];
        const history = [];
        let lastStatus = null;
        for (const a of audits) {
            const s = a?.['new value'] || a?.newValue || '';
            if (!s || s === lastStatus) continue;
            lastStatus = s;
            const entryMaster = await this.resolveMasterStatus(s, supabase);
            history.push({
                status: s,
                statusLabel: entryMaster?.label || s,
                statusColor: entryMaster?.color || null,
                statusId: entryMaster?.id || null,
                color: entryMaster?.color || null,
                date: a?.date || '',
                comment: a?.type || '',
                hub: a?.location || '',
            });
        }
        const latest = history.length ? history[history.length - 1] : null;
        return {
            tracking_code: trackingCode,
            status: latest?.status || '',
            statusLabel: latest?.statusLabel || latest?.status || '',
            statusColor: latest?.statusColor || null,
            status_code: null,
            history,
        };
    }

    async getParcelInfo(trackingCode, supabase) {
        return this.trackParcel(trackingCode, undefined, supabase);
    }

    async createDeliveryNote() {
        // Digylog has no "create empty BL" endpoint. Returning a draft; addParcelsToNote
        // will call PUT /orders/send with the full code list to spawn the real BL.
        const draft = `DIGYLOG-DRAFT-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
        return { reference: draft, provider_response: { draft: true } };
    }

    async addParcelsToNote(deliveryNoteRef, parcelCodes, supabase) {
        const codes = Array.isArray(parcelCodes) ? parcelCodes.filter(Boolean) : [];
        if (!deliveryNoteRef) throw new Error('Digylog: référence BL requise.');
        if (codes.length === 0) {
            return { success: true, reference: deliveryNoteRef, parcel_codes: [], inserted: 0 };
        }
        const isDraft = /^DIGYLOG-DRAFT-/i.test(deliveryNoteRef);
        if (!isDraft) {
            // BL already created — Digylog provides no endpoint to append codes to an existing BL.
            throw new Error('Digylog: ce BL est déjà émis et ne peut pas être modifié. Créez un nouveau bon de livraison.');
        }
        const resp = await this.apiFetch('/orders/send', 'PUT', { orders: codes });
        const blId = resp.data?.bl;
        if (!resp.ok || !blId) {
            const msg = resp.data?.message || JSON.stringify(resp.data || resp.raw || {}).substring(0, 300);
            throw new Error(`Digylog: envoi BL échoué (HTTP ${resp.status}): ${msg}`);
        }
        const newRef = String(blId);
        // Update the delivery note row so the wizard picks up the real ref.
        if (supabase) {
            await supabase.from('company_delivery_notes')
                .update({ reference: newRef, external_id: newRef })
                .eq('reference', deliveryNoteRef);
        }
        return {
            success: true,
            reference: newRef,
            parcel_codes: codes,
            inserted: codes.length,
            changed_reference: true,
            previous_reference: deliveryNoteRef,
        };
    }

    async finalizeDeliveryNote(reference) {
        // No-op — BL is created by PUT /orders/send during addParcelsToNote.
        return { success: true, reference };
    }

    async deleteNote(reference) {
        // Digylog has no endpoint to cancel/delete a BL. Surface gracefully.
        return { success: true, reference, note: 'Digylog ne permet pas la suppression de BL via API.' };
    }

    async deleteParcel(parcelCode) {
        // No DELETE /orders endpoint. The dashboard uses /complaints type=5 for cancellation.
        return { success: true, parcel_code: parcelCode, note: 'Digylog: utilisez le dashboard pour annuler.' };
    }

    async getPrintUrl(deliveryNoteRef, labelFormat, _printType, _options) {
        // labelFormat values:
        //  'a4_4' → 1, 'a4_8' → 2, 'thermal' / 'thermal_100' → 3,
        //  'thermal_70' → 4, 'thermal_60' → 5, 'bl' → GET /bl/:id/pdf
        const fmtRaw = String(labelFormat || 'a4_4').toLowerCase();
        if (fmtRaw === 'bl') {
            const blId = (deliveryNoteRef || '').replace(/^DIGYLOG-DRAFT-.*$/i, '').trim();
            if (!blId) throw new Error('Digylog: BL non émis (référence draft). Validez le BL avant de l\'imprimer.');
            return this.fetchPdfAsDataUrl(`/bl/${encodeURIComponent(blId)}/pdf`, 'GET', null);
        }
        const formatMap = { 'a4_4': 1, 'a4': 1, 'a4_8': 2, 'thermal': 3, 'thermal_100': 3, 'thermal_70': 4, 'thermal_60': 5 };
        const format = formatMap[fmtRaw] || 1;
        const opts = _options || {};
        let codes = Array.isArray(opts.parcel_codes) ? opts.parcel_codes.filter(Boolean) : [];
        if (codes.length === 0 && opts.supabase && opts.noteId) {
            const { data: parcels } = await opts.supabase
                .from('company_parcels')
                .select('tracking_code')
                .eq('delivery_note_id', opts.noteId)
                .is('date_deleted', null);
            codes = (parcels || []).map((p) => p.tracking_code).filter(Boolean);
        }
        const blId = deliveryNoteRef && !/^DIGYLOG-DRAFT-/i.test(deliveryNoteRef) ? String(deliveryNoteRef) : null;
        const body = blId ? { bl: Number(blId), format } : { orders: codes.join(','), format };
        if (!blId && codes.length === 0) {
            throw new Error('Digylog: aucun colis à imprimer.');
        }
        return this.fetchPdfAsDataUrl('/labels', 'POST', body);
    }

    async fetchPdfAsDataUrl(path, method, body) {
        const init = {
            method,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Referer': 'https://apiseller.digylog.com',
                'Accept': 'application/pdf, application/json',
            },
        };
        if (body !== null && body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const res = await fetch(`${this.apiBaseUrl}${path}`, init);
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`Digylog PDF HTTP ${res.status}: ${t.substring(0, 200)}`);
        }
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return `data:application/pdf;base64,${btoa(binary)}`;
    }

    // List helpers (used by Permissions modal to populate dropdowns).
    async listNetworks() {
        const r = await this.apiFetch('/networks', 'GET');
        if (!r.ok) throw new Error(`Digylog /networks HTTP ${r.status}`);
        return Array.isArray(r.data) ? r.data : [];
    }
    async listStores() {
        const r = await this.apiFetch('/stores', 'GET');
        if (!r.ok) throw new Error(`Digylog /stores HTTP ${r.status}`);
        return Array.isArray(r.data) ? r.data : [];
    }
    async listCities() {
        const r = await this.apiFetch('/cities', 'GET');
        if (!r.ok) throw new Error(`Digylog /cities HTTP ${r.status}`);
        return Array.isArray(r.data) ? r.data : [];
    }

    async registerWebhook(webhookUrl) {
        if (!webhookUrl) throw new Error('webhook URL requis');
        const r = await this.apiFetch('/webhook', 'PUT', { url: webhookUrl });
        if (!r.ok) {
            const msg = r.data?.message || JSON.stringify(r.data || r.raw || {}).substring(0, 200);
            throw new Error(`Digylog /webhook HTTP ${r.status}: ${msg}`);
        }
        return { success: true, url: webhookUrl, response: r.data };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delevo Express adapter — dual-auth.
//   • API-Token (header `api-Token`) for /api/client/* (create / track / list).
//   • Laravel session (email/password login → cookie + CSRF) for /client/* dashboard
//     endpoints (BL create / list / print PDFs / delete) — public API doesn't
//     expose these. Tested directly against their stack.
// City accepts a NAME string matching their internal list (107 districts, format
// "Casablanca - Nassim II"). Stored in provider_cities.provider_city_name.
// ─────────────────────────────────────────────────────────────────────────────
class DelvoExpressAdapter {
    constructor(credentials) {
        this.apiBaseUrl = (credentials.api_base_url || 'https://delevoexpress.com').replace(/\/+$/, '');
        this.apiToken = credentials.api_key || '';
        this.email = credentials.api_login || '';
        this.password = credentials.api_password || '';
        this.allowOpen = credentials.delvoexpress_allow_open === true ? 1 : 0;
        this.businessId = credentials['DigiCom Business'] || null;
        // Session cache (populated by ensureSession on first session-call).
        this.cookieHeader = null;
        this.csrfToken = null;
    }

    // ── API-Token calls (public REST) ──────────────────────────────────────
    async apiFetch(path, method, formBody) {
        if (!this.apiToken) throw new Error('Delevo: api_key requis (Api-Token).');
        const init = {
            method: method || 'GET',
            redirect: 'follow',
            headers: {
                'api-Token': this.apiToken,
                'Accept': 'application/json',
            },
        };
        if (formBody && method !== 'GET') {
            init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            init.body = typeof formBody === 'string' ? formBody : new URLSearchParams(formBody).toString();
        }
        const res = await fetch(`${this.apiBaseUrl}/api/client${path}`, init);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { return { ok: res.ok, status: res.status, data: null, raw: text }; }
        return { ok: res.ok, status: res.status, data };
    }

    // ── Session-auth (Laravel cookies + CSRF) ──────────────────────────────
    async ensureSession() {
        if (this.cookieHeader && this.csrfToken) return;
        if (!this.email || !this.password) {
            throw new Error('Delevo: identifiants dashboard (api_login/api_password) requis pour BL/impression.');
        }

        // 1. GET /client/login → form CSRF + initial cookies.
        const loginRes = await fetch(`${this.apiBaseUrl}/client/login`, { redirect: 'manual' });
        const loginHtml = await loginRes.text();
        const cookies = this.parseSetCookies(loginRes.headers);
        const tokenMatch = loginHtml.match(/name="_token"[^>]*value="([^"]+)"/) || loginHtml.match(/_token\s*[=:]\s*["']([^"']+)["']/);
        if (!tokenMatch) throw new Error('Delevo session: CSRF introuvable dans /client/login');
        const csrf = tokenMatch[1];

        // 2. POST /client/login with email + password + _token.
        const body = new URLSearchParams({
            _token: csrf,
            email: this.email,
            password: this.password,
        }).toString();
        const postRes = await fetch(`${this.apiBaseUrl}/client/login`, {
            method: 'POST',
            redirect: 'manual',
            headers: {
                'Cookie': cookies,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${this.apiBaseUrl}/client/login`,
            },
            body,
        });
        // 302 → /client (success). 200 / 422 → invalid creds.
        if (postRes.status !== 302 && postRes.status !== 303) {
            const t = await postRes.text();
            if (t.includes('email') || t.includes('password')) throw new Error('Delevo: email/mot de passe invalides.');
        }
        const merged = this.mergeCookies(cookies, this.parseSetCookies(postRes.headers));

        // 3. Fetch the dashboard once to settle the session token.
        const homeRes = await fetch(`${this.apiBaseUrl}/client`, { headers: { 'Cookie': merged }, redirect: 'manual' });
        const homeHtml = await homeRes.text();
        const homeCookies = this.mergeCookies(merged, this.parseSetCookies(homeRes.headers));
        const csrfMatch = homeHtml.match(/_token["']?\s*[=:]\s*["']([^"']+)["']/);
        this.cookieHeader = homeCookies;
        this.csrfToken = csrfMatch ? csrfMatch[1] : csrf;
    }

    parseSetCookies(headers) {
        // Deno aggregates Set-Cookie via headers.getSetCookie() (or fallback)
        const all = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
        const pairs = [];
        for (const sc of all) {
            const eq = sc.indexOf('=');
            const semi = sc.indexOf(';');
            if (eq > 0) pairs.push(sc.substring(0, semi > 0 ? semi : sc.length));
        }
        return pairs.join('; ');
    }
    mergeCookies(prev, next) {
        if (!prev) return next;
        if (!next) return prev;
        // Index by name; later wins.
        const map = new Map();
        for (const part of [...prev.split('; '), ...next.split('; ')]) {
            const eq = part.indexOf('=');
            if (eq > 0) map.set(part.substring(0, eq), part.substring(eq + 1));
        }
        return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    async sessionFetch(path, method, formBody, _retried) {
        await this.ensureSession();
        const headers = {
            'Cookie': this.cookieHeader,
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-TOKEN': this.csrfToken,
            'Referer': `${this.apiBaseUrl}/client`,
        };
        const init = { method: method || 'GET', redirect: 'manual', headers };
        if (formBody) {
            const body = formBody instanceof URLSearchParams ? formBody : new URLSearchParams(formBody);
            if (!body.has('_token')) body.set('_token', this.csrfToken);
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            init.body = body.toString();
        }
        const res = await fetch(`${this.apiBaseUrl}${path}`, init);
        // Laravel rotates session cookies on every request — harvest them so the next call
        // doesn't 401. Without this, /post/ajax fails right after a successful /post/add.
        const fresh = this.parseSetCookies(res.headers);
        if (fresh) this.cookieHeader = this.mergeCookies(this.cookieHeader, fresh);
        // 401 → session expired. Re-login once.
        if (res.status === 401 && !_retried) {
            this.cookieHeader = null;
            this.csrfToken = null;
            return this.sessionFetch(path, method, formBody, true);
        }
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { return { ok: res.ok, status: res.status, data: null, raw: text }; }
        return { ok: res.ok, status: res.status, data };
    }

    async sessionFetchPdf(path) {
        await this.ensureSession();
        const res = await fetch(`${this.apiBaseUrl}${path}`, {
            method: 'GET',
            redirect: 'manual',
            headers: { 'Cookie': this.cookieHeader, 'Accept': 'application/pdf, application/json' },
        });
        const fresh = this.parseSetCookies(res.headers);
        if (fresh) this.cookieHeader = this.mergeCookies(this.cookieHeader, fresh);
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`Delevo PDF HTTP ${res.status}: ${t.substring(0, 200)}`);
        }
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
        return `data:application/pdf;base64,${btoa(bin)}`;
    }

    async resolveMasterStatus(rawStatus, supabase) {
        if (!rawStatus || !supabase) return null;
        try {
            const { data } = await supabase.rpc('match_package_status', { p_status_value: rawStatus });
            if (data && data[0]) return data[0];
        } catch (_) { /* RPC optional */ }
        const { data } = await supabase
            .from('package_statuses')
            .select('id, code, label, color')
            .contains('delivery_service_statuses', JSON.stringify([rawStatus]))
            .limit(1)
            .maybeSingle();
        return data || null;
    }

    // ── createParcel — public REST (returns code_shippment) ────────────────
    async createParcel(parcelData, supabase) {
        // Resolve destination city — Delevo accepts the full name from their internal list.
        let cityName = '';
        if (parcelData.master_city_id && supabase) {
            const { data: mapping } = await supabase
                .from('provider_cities')
                .select('provider_city_name')
                .eq('master_city_id', parcelData.master_city_id)
                .eq('provider_type', 'delvoexpress')
                .maybeSingle();
            cityName = String(mapping?.provider_city_name || '').trim();
        }
        if (!cityName) cityName = String(parcelData.city_name || '').trim();
        if (!cityName) {
            throw new Error('Delevo: ville introuvable. Mappez-la dans la page Cities.');
        }

        // Phone normalisation (must start with 05/06/07/08, 10 digits).
        let phone = String(parcelData.receiver_phone || parcelData.customer_phone || '').replace(/\D/g, '');
        if (phone.startsWith('212')) phone = '0' + phone.substring(3);
        if (!/^0[5678]\d{8}$/.test(phone)) {
            throw new Error(`Delevo: téléphone invalide "${phone}". Attendu 10 chiffres commençant par 05/06/07/08.`);
        }

        const items = Array.isArray(parcelData.items) ? parcelData.items : [];
        const products = items
            .filter((i) => Number(i.quantity) > 0)
            .map((i) => String(i.name || i.product?.name || i.code || '').trim())
            .filter(Boolean);
        const qtys = items
            .filter((i) => Number(i.quantity) > 0)
            .map((i) => String(Number(i.quantity) || 1));
        const productStr = products.length ? products.join(';') : (parcelData.product_info || 'Produit');
        const qtyStr = qtys.length ? qtys.join(';') : '1';

        const isExchange = !!(parcelData.replace_parcel_code || parcelData.old_parcel_code || parcelData.replaceable);
        const body = new URLSearchParams({
            fullname: String(parcelData.receiver_name || parcelData.customer_name || '').substring(0, 100),
            phone,
            city: cityName,
            address: String(parcelData.receiver_address || parcelData.delivery_address || '').substring(0, 200),
            price: String(Number(parcelData.cash_on_delivery || parcelData.cod_amount || 0)),
            product: productStr.substring(0, 200),
            qty: qtyStr,
            note: String(parcelData.delivery_note || '').substring(0, 200),
            change: isExchange ? '1' : '0',
            openpackage: String(this.allowOpen),
            from_stock: '0',
            internal_id: String(parcelData.order_num || parcelData.reference || '').substring(0, 64),
        });
        if (isExchange) {
            const old = String(parcelData.replace_parcel_code || parcelData.old_parcel_code || '').trim();
            if (!old) throw new Error('Delevo: code du colis à échanger requis (champ coli_exchange).');
            body.set('coli_exchange', old);
        }

        const resp = await this.apiFetch('/post/colis/add-colis', 'POST', body.toString());
        if (!resp.ok || resp.data?.code !== 'ok' || !resp.data?.code_shippment) {
            const msg = resp.data?.message || JSON.stringify(resp.data || resp.raw || {}).substring(0, 300);
            throw new Error(`Delevo: création échouée (HTTP ${resp.status}): ${msg}`);
        }
        const tracking = resp.data.code_shippment;
        return {
            tracking_code: tracking,
            external_id: tracking,
            provider_response: resp.data,
        };
    }

    async trackParcel(trackingCode, _externalId, supabase) {
        if (!trackingCode) throw new Error('Tracking code required');
        // 1. Try the public /api/client/colis/track/{code} first. As of 2026-04, Delvo's
        // own endpoint returns 500 for every parcel — but if they fix it later, we'll pick
        // up real audit events automatically.
        const apiResp = await this.apiFetch(`/colis/track/${encodeURIComponent(trackingCode)}`, 'GET');
        if (apiResp.ok && Array.isArray(apiResp.data?.data) && apiResp.data.data.length > 0) {
            const audits = [...apiResp.data.data].sort((a, b) => Number(a.Date_Evenement || 0) - Number(b.Date_Evenement || 0));
            const history = [];
            let last = null;
            for (const a of audits) {
                const s = a?.status;
                if (!s || s === last) continue;
                last = s;
                const master = await this.resolveMasterStatus(s, supabase);
                history.push({
                    status: s,
                    statusLabel: master?.label || s,
                    statusColor: master?.color || null,
                    statusId: master?.id || null,
                    color: master?.color || null,
                    date: a?.Date_Evenement ? new Date(Number(a.Date_Evenement) * 1000).toISOString() : '',
                    comment: '',
                });
            }
            const latest = history.length ? history[history.length - 1] : null;
            return {
                tracking_code: trackingCode,
                status: latest?.status || '',
                statusLabel: latest?.statusLabel || latest?.status || '',
                statusColor: latest?.statusColor || null,
                status_code: null,
                history,
            };
        }

        // 2. Fallback: dashboard list-colis lookup. The public REST endpoint can't show
        // events, but the dashboard row carries the current status_id / status.name /
        // status_updated_at — enough to surface the real master-mapped status.
        const colis = await this.fetchColisByCode(trackingCode);
        if (!colis || !colis.status?.name) return null;
        const master = await this.resolveMasterStatus(colis.status.name, supabase);
        const eventDate = this.parseDelvoDate(colis.status_updated_at) || this.parseDelvoDate(colis.created_at);
        const history = [{
            status: colis.status.name,
            statusLabel: master?.label || colis.status.name,
            statusColor: master?.color || colis.status.color || null,
            statusId: master?.id || null,
            color: master?.color || colis.status.color || null,
            date: eventDate,
            comment: '',
        }];
        const latest = history[0];
        return {
            tracking_code: trackingCode,
            status: latest.status,
            statusLabel: latest.statusLabel,
            statusColor: latest.statusColor || null,
            status_code: null,
            history,
        };
    }

    async getParcelInfo(trackingCode, supabase) {
        return this.trackParcel(trackingCode, undefined, supabase);
    }

    // Look a parcel up via the dashboard list-colis datatable. Used as fallback when the
    // public REST tracking endpoint is unavailable.
    async fetchColisByCode(code) {
        const body = this.buildColisListDatatableBody({ length: 5, search: code });
        const r = await this.sessionFetch('/client/post/colis/list-colis/ajax', 'POST', body);
        const rows = Array.isArray(r.data?.data) ? r.data.data : [];
        return rows.find((row) => String(row.code) === code) || rows[0] || null;
    }

    // Builds the full jQuery DataTables payload for /post/colis/list-colis/ajax. Empty
    // date_start/date_end filter out everything, so we widen to 2024..now+1y.
    buildColisListDatatableBody({ length = 5, search = '' } = {}) {
        const cols = [
            { data: 'select', name: '', searchable: 'false', orderable: 'false' },
            { data: 'created_at', name: 'colis.created_at', searchable: 'true', orderable: 'true' },
            { data: 'status_updated_at', name: 'colis.status_updated_at', searchable: 'true', orderable: 'true' },
            { data: 'code', name: 'colis.code', searchable: 'true', orderable: 'false' },
            { data: 'internal_id', name: 'colis.internal_id', searchable: 'true', orderable: 'false' },
            { data: 'destination', name: 'colis.destination', searchable: 'true', orderable: 'true' },
            { data: 'contact', name: 'colis.phone', searchable: 'true', orderable: 'false' },
            { data: 'city.name', name: 'city.name', searchable: 'false', orderable: 'false' },
            { data: 'price', name: 'colis.price', searchable: 'false', orderable: 'false' },
            { data: 'coli_status', name: 'status.name', searchable: 'false', orderable: 'true' },
            { data: 'client_invoiced', name: '', searchable: 'false', orderable: 'true' },
            { data: 'action', name: '', searchable: 'false', orderable: 'false' },
        ];
        const body = new URLSearchParams();
        body.set('draw', '1');
        body.set('start', '0');
        body.set('length', String(length));
        body.set('search[value]', String(search || ''));
        body.set('search[regex]', 'false');
        body.set('order[0][column]', '1');
        body.set('order[0][dir]', 'desc');
        cols.forEach((c, i) => {
            body.set(`columns[${i}][data]`, c.data);
            body.set(`columns[${i}][name]`, c.name);
            body.set(`columns[${i}][searchable]`, c.searchable);
            body.set(`columns[${i}][orderable]`, c.orderable);
            body.set(`columns[${i}][search][value]`, '');
            body.set(`columns[${i}][search][regex]`, 'false');
        });
        body.set('city', '');
        body.set('from_stock', '');
        body.set('can_change', '');
        body.set('can_open', '');
        body.set('date_start', '2024-01-01');
        const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        body.set('date_end', farFuture);
        body.set('client_invoiced', '');
        return body;
    }

    // Delvo returns timestamps as either "DD/MM/YYYY HH:mm" (local), ISO strings, or null.
    parseDelvoDate(raw) {
        if (!raw) return '';
        const s = String(raw).trim();
        // ISO already → keep.
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toISOString();
        // "DD/MM/YYYY HH:mm" or "DD/MM/YYYY".
        const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
        if (m) {
            const [_, d, mo, y, hh, mm] = m;
            return new Date(`${y}-${mo}-${d}T${hh || '00'}:${mm || '00'}:00Z`).toISOString();
        }
        const t = Date.parse(s);
        return isNaN(t) ? '' : new Date(t).toISOString();
    }

    async createDeliveryNote() {
        // BL is created lazily by addParcelsToNote (collection-voucher session POST).
        const draft = `DELVO-DRAFT-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
        return { reference: draft, provider_response: { draft: true } };
    }

    async addParcelsToNote(deliveryNoteRef, parcelCodes, supabase) {
        const codes = Array.isArray(parcelCodes) ? parcelCodes.filter(Boolean) : [];
        if (!deliveryNoteRef) throw new Error('Delevo: référence BL requise.');
        if (codes.length === 0) return { success: true, reference: deliveryNoteRef, parcel_codes: [], inserted: 0 };
        const isDraft = /^DELVO-DRAFT-/i.test(deliveryNoteRef);
        if (!isDraft) {
            // Delevo's BL is created in one shot — no append-after-create endpoint.
            throw new Error('Delevo: ce BL est déjà émis. Créez un nouveau bon de livraison.');
        }
        // 1. Snapshot top BL id BEFORE create so we can identify the new one.
        const beforeId = await this.fetchLatestBlId();

        // 2. POST /client/collection-voucher/post/add (session + JSON-string colis).
        const body = new URLSearchParams();
        body.set('colis', JSON.stringify(codes));
        body.set('request_pickup', 'on');
        const addResp = await this.sessionFetch('/client/collection-voucher/post/add', 'POST', body);
        if (!addResp.ok || addResp.data?.code !== 'ok') {
            const msg = addResp.data?.message || JSON.stringify(addResp.data || addResp.raw || {}).substring(0, 300);
            throw new Error(`Delevo: création BL échouée (HTTP ${addResp.status}): ${msg}`);
        }

        // 3. Datatable poll for the new BL — scan top 5 in case of concurrent creates.
        // Each datatable POST also harvests fresh Set-Cookie headers via sessionFetch.
        let newBl = null;
        for (let attempt = 0; attempt < 6 && !newBl; attempt++) {
            const recent = await this.fetchRecentBls(5);
            // Pick the highest-id BL that wasn't there before. Falls back to the first
            // BL if `beforeId` was null (no prior BLs at all).
            for (const r of recent) {
                if (!beforeId || r.id > beforeId) { newBl = r; break; }
            }
            if (!newBl) await new Promise((res) => setTimeout(res, 600));
        }
        if (!newBl) throw new Error('Delevo: BL créé mais introuvable dans la liste — vérifiez le dashboard.');

        // 4. Persist BL identity onto the delivery_note row.
        if (supabase) {
            await supabase.from('company_delivery_notes')
                .update({ reference: newBl.code, external_id: String(newBl.id) })
                .eq('reference', deliveryNoteRef);
        }
        return {
            success: true,
            reference: newBl.code,
            external_id: String(newBl.id),
            parcel_codes: codes,
            inserted: codes.length,
            changed_reference: true,
            previous_reference: deliveryNoteRef,
        };
    }

    async fetchLatestBlId() {
        const r = await this.fetchLatestBl();
        return r?.id || null;
    }
    async fetchLatestBl() {
        const list = await this.fetchRecentBls(1);
        return list[0] || null;
    }
    // Builds the full jQuery DataTables server-side payload for /collection-voucher/post/ajax.
    // Without the columns[] array the Laravel controller 500s.
    buildBlDatatableBody({ length = 5, search = '' } = {}) {
        const cols = [
            { data: 'code', name: 'collection_vouchers.code', searchable: 'true', orderable: 'true' },
            { data: 'colis', name: '', searchable: 'true', orderable: 'true' },
            { data: 'messedColis', name: '', searchable: 'true', orderable: 'true' },
            { data: 'validate', name: 'collection_vouchers.is_validate', searchable: 'true', orderable: 'true' },
            { data: 'created_at', name: 'collection_vouchers.created_at', searchable: 'true', orderable: 'true' },
            { data: 'action', name: '', searchable: 'false', orderable: 'false' },
        ];
        const body = new URLSearchParams();
        body.set('draw', '1');
        body.set('start', '0');
        body.set('length', String(length));
        body.set('search[value]', String(search || ''));
        body.set('search[regex]', 'false');
        body.set('order[0][column]', '4');
        body.set('order[0][dir]', 'desc');
        cols.forEach((c, i) => {
            body.set(`columns[${i}][data]`, c.data);
            body.set(`columns[${i}][name]`, c.name);
            body.set(`columns[${i}][searchable]`, c.searchable);
            body.set(`columns[${i}][orderable]`, c.orderable);
            body.set(`columns[${i}][search][value]`, '');
            body.set(`columns[${i}][search][regex]`, 'false');
        });
        body.set('date_start', '');
        body.set('date_end', '');
        body.set('status', '');
        return body;
    }
    async fetchRecentBls(limit) {
        const body = this.buildBlDatatableBody({ length: limit || 5 });
        const r = await this.sessionFetch('/client/collection-voucher/post/ajax', 'POST', body);
        if (!Array.isArray(r.data?.data)) {
            console.log('Delevo datatable returned non-array:', JSON.stringify(r.data || r.raw || {}).substring(0, 300));
            return [];
        }
        return r.data.data.map((row) => ({ id: Number(row.id), code: String(row.code || '') }));
    }

    async finalizeDeliveryNote(reference) {
        return { success: true, reference };
    }

    async deleteNote(reference) {
        // Delevo blocks deletion when parcels are still attached. We surface their message verbatim.
        if (!reference || /^DELVO-DRAFT-/i.test(reference)) return { success: true, reference };
        // Need the BL id (not the BR-XXX code). Fetch via datatable filter.
        const search = this.buildBlDatatableBody({ length: 5, search: reference });
        const list = await this.sessionFetch('/client/collection-voucher/post/ajax', 'POST', search);
        const row = Array.isArray(list.data?.data) ? list.data.data.find((b) => String(b.code) === reference) : null;
        if (!row?.id) return { success: false, reference, error: 'BL introuvable' };
        const del = await this.sessionFetch(`/client/collection-voucher/delete/${row.id}`, 'POST', new URLSearchParams({ _method: 'DELETE' }));
        return { success: del.data?.code === 'ok', reference, error: del.data?.message };
    }

    async deleteParcel(parcelCode) {
        // Delevo's public API has no parcel-cancel endpoint. Surface gracefully.
        return { success: true, parcel_code: parcelCode, note: 'Delevo: utilisez le dashboard pour annuler un colis.' };
    }

    async getPrintUrl(deliveryNoteRef, labelFormat, _printType, _options) {
        // Format mapping (verified live): A4 → /0/1, thermal 10×10 → /1
        const fmt = String(labelFormat || 'a4').toLowerCase();
        const opts = _options || {};
        if (!deliveryNoteRef || /^DELVO-DRAFT-/i.test(deliveryNoteRef)) {
            throw new Error('Delevo: BL non émis. Validez le BL avant l\'impression.');
        }
        // We need the numeric BL id, not the BR-XXX code. external_id on the note
        // stores the id; if missing, look it up by code.
        let blId = String(opts.external_id || '').trim();
        if (!/^\d+$/.test(blId)) {
            // Try: opts.supabase + opts.noteId.
            if (opts.supabase && opts.noteId) {
                const { data } = await opts.supabase
                    .from('company_delivery_notes')
                    .select('external_id, reference')
                    .eq('id', opts.noteId)
                    .maybeSingle();
                if (data?.external_id && /^\d+$/.test(String(data.external_id))) blId = String(data.external_id);
            }
        }
        if (!/^\d+$/.test(blId)) {
            // Last-resort: datatable lookup by reference.
            const search = this.buildBlDatatableBody({ length: 5, search: deliveryNoteRef });
            const list = await this.sessionFetch('/client/collection-voucher/post/ajax', 'POST', search);
            const row = Array.isArray(list.data?.data) ? list.data.data.find((b) => String(b.code) === deliveryNoteRef) : null;
            if (row?.id) blId = String(row.id);
        }
        if (!/^\d+$/.test(blId)) throw new Error(`Delevo: ID BL introuvable pour ${deliveryNoteRef}.`);

        const path = (fmt.includes('thermal') || fmt === '10x10' || fmt === 'thermal_10')
            ? `/client/collection-voucher/tickets/pdf/${blId}/1`
            : `/client/collection-voucher/tickets/pdf/${blId}/0/1`;
        return this.sessionFetchPdf(path);
    }
}

// Shared caller-authorization guard for the two Coliaty parcel-change-demand
// actions (get_allowed_destination_cities / create_parcel_change_demand):
// resolves the bearer JWT to a user, then requires the target company_parcels
// row (matched by tracking_code + provider_id) to belong to the caller's own
// business ("DigiCom Business" on both users and company_parcels). Throws an
// Error with status_code (401/403) — the callers' existing status_code catch
// blocks already know how to turn that into a Response. Returns the resolved
// { userId, businessId, parcelOrderId } for callers that persist a demand row.
async function assertParcelChangeAccess(req, supabase, providerId, trackingCode) {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
        const err: any = new Error('Authentification requise.');
        err.status_code = 401;
        throw err;
    }
    const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !user) {
        const err: any = new Error('Authentification requise.');
        err.status_code = 401;
        throw err;
    }
    const { data: me } = await supabase
        .from('users')
        .select('"DigiCom Business"')
        .eq('id', user.id)
        .maybeSingle();
    const { data: parcel } = await supabase
        .from('company_parcels')
        .select('"DigiCom Business", order_id')
        .eq('provider_id', providerId)
        .eq('tracking_code', trackingCode)
        .maybeSingle();
    const callerBiz = me?.['DigiCom Business'];
    const parcelBiz = parcel?.['DigiCom Business'];
    if (!callerBiz || !parcelBiz || callerBiz !== parcelBiz) {
        const err: any = new Error('Accès refusé pour ce colis.');
        err.status_code = 403;
        throw err;
    }
    return { userId: user.id, businessId: callerBiz, parcelOrderId: parcel?.order_id ?? null };
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

        const type = String(provider.provider_type || '').toLowerCase();
        const adapter = type === 'coliaty'
            ? new ColiatyAdapter(provider)
            : type === 'ozon'
                ? new OzonAdapter(provider)
                : type === 'quicklivraison'
                    ? new QuickLivraisonAdapter(provider)
                    : type === 'vitex'
                        ? new VitexAdapter(provider)
                        : type === 'forcelog'
                            ? new ForcelogAdapter(provider)
                            : type === 'sendit'
                                ? new SenditAdapter(provider)
                                : type === 'digylog'
                                    ? new DigylogAdapter(provider)
                                    : type === 'delvoexpress'
                                        ? new DelvoExpressAdapter(provider)
                                        : new AmeexAdapter(provider);

        // Adapter initialization

        // Adapter methods (excluding print which returns URL strings)
        let result;
        switch (action) {
            case 'track_parcel':
                console.log('Tracking parcel:', data.tracking_code);
                result = await adapter.trackParcel(data.tracking_code, data.external_id, supabase);
                break;
            case 'get_parcel_info':
                console.log('Getting parcel info:', data.tracking_code);
                result = await adapter.getParcelInfo(data.tracking_code, supabase);
                break;
            case 'get_print_url': {
                console.log('Getting print URL for:', data.delivery_note_ref, 'Format:', data.label_format, 'Type:', data.print_type);
                const link = await adapter.getPrintUrl(
                    data.delivery_note_ref,
                    data.label_format,
                    data.print_type,
                    { supabase, noteId: data.note_id, external_id: data.external_id }
                );
                result = { print_html: link };
                break;
            }
            case 'create_parcel':
                console.log('Creating parcel');
                result = await adapter.createParcel(data, supabase);
                break;
            case 'create_parcels_batch':
                console.log('Creating parcels (batch):', Array.isArray(data?.parcels) ? data.parcels.length : 0);
                if (typeof adapter.createParcelsBatch !== 'function') {
                    throw new Error(`${type} ne supporte pas create_parcels_batch.`);
                }
                // Returns an array index-aligned to data.parcels; each element is
                // { tracking_code, external_id, provider_response } (success) or { error }.
                result = await adapter.createParcelsBatch(data.parcels, supabase);
                break;
            case 'create_delivery_note':
                console.log('Creating delivery note');
                result = await adapter.createDeliveryNote();
                console.log('Delivery note created:', JSON.stringify(result, null, 2));
                break;
            case 'add_parcels_to_delivery_note':
                console.log('Adding parcels to delivery note:', data.delivery_note_ref);
                console.log('Parcel codes:', data.parcel_codes);
                result = await adapter.addParcelsToNote(data.delivery_note_ref, data.parcel_codes, supabase);
                console.log('Parcels added:', JSON.stringify(result, null, 2));
                break;
            case 'remove_parcels_from_delivery_note':
                console.log('Removing parcels from delivery note:', data.delivery_note_ref, data.parcel_codes);
                if (typeof adapter.removeParcelsFromNote !== 'function') {
                    throw new Error(`${type} ne supporte pas remove_parcels_from_delivery_note.`);
                }
                result = await adapter.removeParcelsFromNote(data.delivery_note_ref, data.parcel_codes);
                console.log('Parcels removed:', JSON.stringify(result, null, 2));
                break;
            case 'ignore_parcel_errors':
                console.log('Ignoring parcel errors:', data.error_ids);
                if (typeof adapter.ignoreParcelErrors !== 'function') {
                    throw new Error(`${type} ne supporte pas ignore_parcel_errors.`);
                }
                result = await adapter.ignoreParcelErrors(data.error_ids);
                console.log('Parcel errors ignored:', JSON.stringify(result, null, 2));
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
            case 'list_networks': {
                if (typeof adapter.listNetworks !== 'function') throw new Error(`${type} ne supporte pas list_networks.`);
                result = { items: await adapter.listNetworks() };
                break;
            }
            case 'list_stores': {
                if (typeof adapter.listStores !== 'function') throw new Error(`${type} ne supporte pas list_stores.`);
                result = { items: await adapter.listStores() };
                break;
            }
            case 'list_provider_cities': {
                if (typeof adapter.listCities !== 'function') throw new Error(`${type} ne supporte pas list_provider_cities.`);
                result = { items: await adapter.listCities() };
                break;
            }
            case 'get_allowed_destination_cities': {
                if (typeof adapter.getAllowedDestinationCities !== 'function') throw new Error(`${type} ne supporte pas get_allowed_destination_cities.`);
                if (!data?.tracking_code) throw new Error('Tracking code required');
                console.log('Getting Coliaty allowed destination cities:', data.tracking_code);
                try {
                    await assertParcelChangeAccess(req, supabase, provider_id, data.tracking_code);
                    result = await adapter.getAllowedDestinationCities(data.tracking_code);
                } catch (err: any) {
                    if (typeof err?.status_code === 'number') {
                        return new Response(JSON.stringify({
                            error: err.message,
                            status_code: err.status_code,
                            ...(err.errors ? { errors: err.errors } : {})
                        }), {
                            status: err.status_code,
                            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                        });
                    }
                    throw err;
                }
                break;
            }
            case 'create_parcel_change_demand': {
                if (typeof adapter.createParcelChangeDemand !== 'function') throw new Error(`${type} ne supporte pas create_parcel_change_demand.`);
                if (!data?.tracking_code) throw new Error('Tracking code required');
                if (data.request_type !== 'CORRECT_INFORMATION' && data.request_type !== 'CHANGE_DESTINATION') {
                    throw new Error('request_type must be CORRECT_INFORMATION or CHANGE_DESTINATION');
                }
                if (typeof data.package_phone !== 'string' || !data.package_phone.trim()) {
                    throw new Error('package_phone is required');
                }
                if (typeof data.package_reciever !== 'string' || !data.package_reciever.trim()) {
                    throw new Error('package_reciever is required');
                }
                if (typeof data.package_price !== 'number' || !Number.isFinite(data.package_price) || data.package_price < 0) {
                    throw new Error('package_price must be a non-negative number');
                }
                if (data.request_type === 'CHANGE_DESTINATION') {
                    const cityOk = data.package_city !== undefined && data.package_city !== null
                        && (typeof data.package_city !== 'string' || data.package_city.trim().length > 0);
                    const addressOk = typeof data.package_address === 'string' && data.package_address.trim().length > 0;
                    if (!cityOk || !addressOk) {
                        throw new Error('package_city and package_address are required for CHANGE_DESTINATION');
                    }
                }
                console.log('Creating Coliaty parcel change demand:', data.tracking_code, data.request_type);
                try {
                    const access = await assertParcelChangeAccess(req, supabase, provider_id, data.tracking_code);
                    result = await adapter.createParcelChangeDemand(data.tracking_code, data);

                    // Local demand persistence — FAIL-OPEN: the demand exists at Coliaty
                    // regardless of whether we manage to record it here, so a failure
                    // here must never turn a successful demand into a 400 response.
                    try {
                        let oldValues: Record<string, unknown> = {
                            phone: null, receiver: null, price: null, city: null, address: null, note: null
                        };
                        if (access.parcelOrderId) {
                            const { data: orderRow } = await supabase
                                .from('orders')
                                .select('phone, name, price, address, city:master_cities(name)')
                                .eq('id', access.parcelOrderId)
                                .maybeSingle();
                            if (orderRow) {
                                oldValues = {
                                    phone: orderRow.phone ?? null,
                                    receiver: orderRow.name ?? null,
                                    price: orderRow.price ?? null,
                                    city: (orderRow as any).city?.name ?? null,
                                    address: orderRow.address ?? null,
                                    note: null
                                };
                            }
                        }
                        const newValues: Record<string, unknown> = {
                            phone: data.package_phone,
                            receiver: data.package_reciever,
                            price: data.package_price,
                            note: data.package_note ?? null
                        };
                        if (data.request_type === 'CHANGE_DESTINATION') {
                            // package_city may be a Coliaty city ID — store the human label
                            // (sent by the dialog as package_city_label, never forwarded to Coliaty)
                            // so the tracking-card diff reads « Casablanca », not « 152 ».
                            newValues.city = data.package_city_label ?? data.package_city;
                            newValues.address = data.package_address;
                        }
                        const { error: pcdErr } = await supabase
                            .from('parcel_change_demands')
                            .upsert({
                                'DigiCom Business': access.businessId,
                                order_id: access.parcelOrderId,
                                provider_id,
                                tracking_code: data.tracking_code,
                                ref: result?.demand?.ref,
                                request_type: data.request_type,
                                old_values: oldValues,
                                new_values: newValues,
                                raw: result?.demand ?? null,
                                created_by: access.userId
                            }, { onConflict: 'provider_id,ref' });
                        if (pcdErr) console.error('parcel_change_demands upsert failed:', pcdErr);
                    } catch (persistErr) {
                        console.error('parcel_change_demands persistence failed:', persistErr);
                    }
                } catch (err: any) {
                    if (typeof err?.status_code === 'number') {
                        return new Response(JSON.stringify({
                            error: err.message,
                            status_code: err.status_code,
                            ...(err.errors ? { errors: err.errors } : {})
                        }), {
                            status: err.status_code,
                            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                        });
                    }
                    throw err;
                }
                break;
            }
            case 'register_webhook': {
                if (typeof adapter.registerWebhook !== 'function') throw new Error(`${type} ne supporte pas register_webhook.`);
                // Look up or create a provider_webhooks row, then push the URL to the provider.
                const projectUrl = Deno.env.get('SUPABASE_URL')!;
                let { data: existing } = await supabase
                    .from('provider_webhooks')
                    .select('id, webhook_secret, webhook_url')
                    .eq('provider_id', provider_id)
                    .maybeSingle();
                let secret = existing?.webhook_secret;
                if (!existing) {
                    secret = crypto.randomUUID().replace(/-/g, '');
                    const url = `${projectUrl}/functions/v1/provider-webhook/${provider_id}/${secret}`;
                    const { data: ins, error: insErr } = await supabase
                        .from('provider_webhooks')
                        .insert({
                            provider_id,
                            webhook_secret: secret,
                            webhook_url: url,
                            is_active: true,
                            'DigiCom Business': provider['DigiCom Business'],
                        })
                        .select('id, webhook_secret, webhook_url')
                        .single();
                    if (insErr) throw new Error(`provider_webhooks insert: ${insErr.message}`);
                    existing = ins;
                }
                const webhookUrl = existing.webhook_url || `${projectUrl}/functions/v1/provider-webhook/${provider_id}/${secret}`;
                result = await adapter.registerWebhook(webhookUrl);
                break;
            }
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
