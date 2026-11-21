// Load test: USERS people editing one document at once.
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const HOST = __ENV.HOST || '127.0.0.1:8081';
const USERS = parseInt(__ENV.USERS || '20', 10);
const API = `http://${HOST}/api`;
const WS = `ws://${HOST}/ws/documents`;
const PW = 'StrongPass#2026';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Registering an account that already exists answers 400, which is expected here, not a failure
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 400));

const latency = new Trend('broadcast_latency_ms', true); // time for an edit to reach another user
const sent = new Counter('edits_sent');
const received = new Counter('edits_received');
const connectOk = new Rate('ws_connect_ok');

export const options = {
  setupTimeout: '300s',
  stages: [
    { duration: '10s', target: USERS }, // ramp up
    { duration: '40s', target: USERS }, // steady load
    { duration: '10s', target: 0 }, // ramp down
  ],
  thresholds: {
    broadcast_latency_ms: ['p(95)<200'], // the brief: changes appear within 200 ms
    ws_connect_ok: ['rate>0.99'],
  },
};

// Runs once: creates the users and one shared document
export function setup() {
  const tokens = [];
  for (let i = 0; i < USERS; i++) {
    const email = `load${i}@example.com`;
    const body = JSON.stringify({ email, name: `Load ${i}`, password: PW });
    http.post(`${API}/auth/register/`, body, { headers: JSON_HEADERS }); // 400 if it exists: fine
    const login = http.post(`${API}/auth/login/`, JSON.stringify({ email, password: PW }), {
      headers: JSON_HEADERS,
    });
    const token = login.json('access');
    if (!token) throw new Error(`Login failed for ${email}. Is the server running?`);
    tokens.push(token);
  }
  const auth = { headers: Object.assign({}, JSON_HEADERS, { Authorization: `Bearer ${tokens[0]}` }) };
  const doc = http
    .post(`${API}/documents/`, JSON.stringify({ title: 'Load test', doc_type: 'code' }), auth)
    .json();
  for (let i = 1; i < USERS; i++) {
    http.post(
      `${API}/documents/${doc.id}/members/`,
      JSON.stringify({ email: `load${i}@example.com`, role: 'editor' }),
      auth,
    );
  }
  return { tokens, docId: doc.id };
}

// Runs for every virtual user: connect, send one edit per second, measure what arrives
export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const res = ws.connect(`${WS}/${data.docId}/?token=${token}`, {}, function (socket) {
    let synced = false; // ignore the replay of stored edits right after connecting
    try {
      socket.binaryType = 'arraybuffer'; // older k6 versions need this line
    } catch (e) {
      // read-only in newer k6: binary messages already arrive as ArrayBuffers
    }

    socket.on('open', () => {
      socket.setInterval(() => {
        const text = String(Date.now()); // the "edit" carries its send time
        const frame = new Uint8Array(text.length + 1);
        frame[0] = 0; // message type 0 = document update
        for (let i = 0; i < text.length; i++) frame[i + 1] = text.charCodeAt(i);
        socket.sendBinary(frame.buffer);
        sent.add(1);
      }, 1000);
    });

    socket.on('binaryMessage', (msg) => {
      const bytes = new Uint8Array(msg);
      if (bytes[0] === 2) synced = true;
      if (bytes[0] !== 0 || !synced) return;
      let text = '';
      for (let i = 1; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
      const sentAt = parseInt(text, 10);
      if (!isNaN(sentAt)) {
        latency.add(Date.now() - sentAt);
        received.add(1);
      }
    });

    socket.setTimeout(() => socket.close(), 45000); // stay connected, like a real editing session
  });

  const ok = res && res.status === 101;
  connectOk.add(ok);
  check(res, { 'websocket connected': () => ok });
  sleep(1);
}

// Runs once at the end: removes the test document
export function teardown(data) {
  http.del(`${API}/documents/${data.docId}/`, null, {
    headers: Object.assign({}, JSON_HEADERS, { Authorization: `Bearer ${data.tokens[0]}` }),
  });
}
