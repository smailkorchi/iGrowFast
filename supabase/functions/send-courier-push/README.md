# send-courier-push

Edge function that delivers Web Push notifications to couriers when a new
row is inserted into `public.courier_notifications`.

## Deployment

### 1. Set secrets

```bash
supabase functions secrets set \
  VAPID_SUBJECT="mailto:team@yourdomain.com" \
  VAPID_PUBLIC_KEY="BCqmIAuDYtNPSgqdA0uU-HcYWWDaejN9ImCL6V1q_cjje3XlUN6c_qs3lSKVZrn40aiQPtyolrXYC7SVI5GBH_U" \
  VAPID_PRIVATE_KEY="htK9SrfdmjJAIxw4XWlvXEHOcEZpt5AkCEIRH0i2GP0"
```

The same `VAPID_PUBLIC_KEY` is shipped in the client at
`src/lib/notifications.ts` — if you rotate, update both sides.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
by Supabase Edge Runtime.

### 2. Deploy

```bash
supabase functions deploy send-courier-push --no-verify-jwt
```

The `--no-verify-jwt` flag is required because the function is invoked
by a Database Webhook, not by an authenticated user.

### 3. Wire the Database Webhook

In Supabase Studio:

1. **Database → Webhooks → Create a new hook**
2. **Name:** `courier-notification-push`
3. **Table:** `courier_notifications`
4. **Events:** `INSERT`
5. **Type:** `HTTP Request`
6. **Method:** `POST`
7. **URL:** `https://<your-project-ref>.supabase.co/functions/v1/send-courier-push`
8. **HTTP Headers:**
   - `Content-Type: application/json`
   - `Authorization: Bearer <your-service-role-key>` (if your project
     requires auth on function calls)
9. **Save**

From this point on, every time a new row lands in `courier_notifications`
the webhook fires and the function pushes to every active device of the
target courier.

## Testing

```bash
# Insert a test notification (replace courier_id with a real UUID)
supabase db execute "
  INSERT INTO courier_notifications (courier_id, \"DigiCom Business\", type, title, body, target_url)
  VALUES (
    'YOUR-COURIER-UUID',
    'YOUR-BUSINESS-UUID',
    'test',
    'Test notification',
    'This is a test from the edge function',
    '/courier/orders'
  );
"
```

Within a second, every device the courier has subscribed should receive
the push — even if the browser is closed.

## Troubleshooting

- **Nothing happens:** Check the webhook log in Studio and the function
  log (`supabase functions logs send-courier-push`).
- **410 Gone:** Normal — the subscription was revoked on the device.
  The function auto-marks it as `revoked_at` so future pushes skip it.
- **iOS not receiving:** The courier must have added DigiCom to the Home
  Screen via Safari's Share sheet and opened it from that icon. Regular
  Safari tabs cannot receive Web Push on iOS.
- **Service worker not registered:** Open DevTools → Application →
  Service Workers. `sw.js` should be listed as `activated and running`.
