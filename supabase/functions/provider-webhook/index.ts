// @ts-nocheck - Deno runtime types not recognized by VSCode
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Extract provider ID and secret from URL path
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const webhookSecret = pathParts[pathParts.length - 1];
        const providerId = pathParts[pathParts.length - 2];

        if (!providerId || !webhookSecret) {
            return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Initialize Supabase
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Parse Payload
        const contentType = req.headers.get('content-type') || '';
        let payload: any = {};
        if (contentType.includes('application/json')) {
            payload = await req.json();
        } else if (contentType.includes('form') || contentType.includes('multipart')) {
            const formData = await req.formData();
            for (const [key, value] of formData.entries()) {
                try { payload[key] = JSON.parse(value as string); } catch { payload[key] = value; }
            }
        } else {
            const text = await req.text();
            try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
        }

        console.log(`Webhook triggered for Provider ${providerId}. Payload:`, payload);

        // Validate Webhook and get Business ID
        const { data: webhookConfig, error: webhookError } = await supabase
            .from('provider_webhooks')
            .select('*, "DigiCom Business"')
            .eq('webhook_secret', webhookSecret)
            .eq('provider_id', providerId)
            .eq('is_active', true)
            .single();

        if (webhookError || !webhookConfig) {
            console.error('Webhook auth failed');
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const businessId = webhookConfig['DigiCom Business'];

        // Identify Tracking Code
        const trackingCode = payload.CODE || payload.tracking_number || payload.barcode || payload.ref;
        if (!trackingCode) {
            return new Response(JSON.stringify({ error: 'No tracking code' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Log entry with Business ID
        const { data: logEntry } = await supabase.from('webhook_logs').insert({
            provider_id: providerId,
            tracking_code: trackingCode,
            payload: payload,
            processed: false,
            'DigiCom Business': businessId
        }).select().single();

        // Update last received
        await supabase.from('provider_webhooks').update({ last_received_at: new Date().toISOString() }).eq('id', webhookConfig.id);

        // Find Order scoped to Business ID
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id')
            .eq('tracking_number', trackingCode)
            .eq('DigiCom Business', businessId)
            .single();

        if (orderError || !order) {
            console.error('Order not found or access denied');
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: 'Order not found or access denied' }).eq('id', logEntry.id);
            return new Response(JSON.stringify({ status: 'logged', message: 'Order not found' }), { status: 200 });
        }

        // Map Status using package_statuses.delivery_service_statuses
        const incomingStatus = payload.STATUT || payload.status;
        if (!incomingStatus) {
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: 'Status missing in payload' }).eq('id', logEntry.id);
            return new Response(JSON.stringify({ error: 'Status missing' }), { status: 200 });
        }

        // Find matching package status
        const { data: matchedStatus, error: matchError } = await supabase
            .from('package_statuses')
            .select('id, code, category')
            .contains('delivery_service_statuses', [incomingStatus])
            .limit(1)
            .maybeSingle();

        if (matchError || !matchedStatus) {
            console.warn(`No mapping found for status: ${incomingStatus}`);
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: `Mapping missing for: ${incomingStatus}` }).eq('id', logEntry.id);
            return new Response(JSON.stringify({ status: 'logged', message: 'No mapping found' }), { status: 200 });
        }

        // Update Order scoped to Business ID
        const updateData: any = {
            package_status_id: matchedStatus.id,
            updated_at: new Date().toISOString()
        };

        if (matchedStatus.category === 'delivered') {
            updateData.delivered = true;
            updateData.date_livraison = new Date().toISOString();
        }

        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', order.id)
            .eq('DigiCom Business', businessId);

        if (updateError) {
            console.error('Order update failed');
            if (logEntry) await supabase.from('webhook_logs').update({ error_message: updateError.message }).eq('id', logEntry.id);
            return new Response(JSON.stringify({ error: 'Update failed' }), { status: 500 });
        }

        // Mark Success
        if (logEntry) await supabase.from('webhook_logs').update({ processed: true }).eq('id', logEntry.id);

        return new Response(JSON.stringify({ status: 'success', status_mapped: matchedStatus.code }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (e) {
        console.error('Fatal error', e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});
