// F2: end-to-end realtime test — subscribe to whatsapp.worker_health INSERT via the PUBLIC
// api.igrowfast.com websocket path, insert a row via ssh psql, expect the event. Exit 0 = PASS.
import { execSync } from 'node:child_process';

const ANON = process.env.IGF_ANON_KEY, SVC = process.env.IGF_SERVICE_KEY;
if (!ANON || !SVC) { console.error('missing keys in env'); process.exit(2); }

const url = `wss://api.igrowfast.com/realtime/v1/websocket?apikey=${ANON}&vsn=1.0.0`;
const ws = new WebSocket(url);
const WID = 'f2-ws-test';
let joined = false, inserted = false;

const bail = (msg, code) => { console.error(msg); try { cleanup(); } catch {} process.exit(code); };
const cleanup = () => execSync(`ssh igf "docker exec -i supabase-db psql -U postgres -d postgres -c \\"delete from whatsapp.worker_health where worker_id='${WID}'\\"" >/dev/null 2>&1`);
const timer = setTimeout(() => bail('FAIL: no postgres_changes event within 40s', 1), 40000);

ws.onopen = () => {
  ws.send(JSON.stringify({
    topic: 'realtime:f2', event: 'phx_join', ref: '1',
    payload: { config: { postgres_changes: [{ event: 'INSERT', schema: 'whatsapp', table: 'worker_health' }] }, access_token: SVC },
  }));
  setInterval(() => ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' })), 25000);
};
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.event === 'phx_reply' && msg.ref === '1' && msg.payload?.status === 'ok') joined = true;
  if (msg.event === 'system' && msg.payload?.status === 'ok' && joined && !inserted) {
    inserted = true;
    console.log('subscribed; inserting row...');
    execSync(`ssh igf "docker exec -i supabase-db psql -U postgres -d postgres -c \\"insert into whatsapp.worker_health (worker_id, hostname, version, started_at) values ('${WID}','f2','1',now())\\""`);
  }
  if (msg.event === 'postgres_changes') {
    const rec = msg.payload?.data?.record;
    if (rec?.worker_id === WID) {
      clearTimeout(timer);
      console.log(`PASS: received INSERT event for ${rec.worker_id} on whatsapp.worker_health via public WS path`);
      cleanup(); process.exit(0);
    }
  }
  if (msg.event === 'system' && msg.payload?.status === 'error') bail(`FAIL: subscription error: ${JSON.stringify(msg.payload)}`, 1);
};
ws.onerror = (e) => bail(`FAIL: ws error ${e.message || e}`, 1);
