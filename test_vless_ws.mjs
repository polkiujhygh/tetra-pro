// E2E test: real VLESS-over-WebSocket request against the local Node port.
// Builds a VLESS header for the default UUID, targets example.com:80 with an
// HTTP GET payload, and checks that proxied HTTP response bytes come back.
import WebSocket from 'ws';

const UUID = '89b3cbba-e6ac-4850-94af-061316b04020';
const uuidBytes = Uint8Array.from(
  UUID.replace(/-/g, '').match(/../g).map((h) => parseInt(h, 16))
);

function buildVlessHeader(domain, port, payload) {
  const enc = new TextEncoder();
  const dBytes = enc.encode(domain);
  const head = new Uint8Array([
    0x00, // version
    ...uuidBytes, // 16-byte UUID
    0x00, // option length
    0x01, // command: TCP
    (port >> 8) & 0xff, port & 0xff, // port big-endian
    0x02, // address type: domain
    dBytes.length,
    ...dBytes,
  ]);
  const pBytes = enc.encode(payload);
  const out = new Uint8Array(head.length + pBytes.length);
  out.set(head, 0);
  out.set(pBytes, head.length);
  return out;
}

const ws = new WebSocket('ws://127.0.0.1:3000/vl', { handshakeTimeout: 10000 });
const chunks = [];
let opened = false;

const timer = setTimeout(() => finish('timeout'), 20000);

function finish(reason) {
  clearTimeout(timer);
  const all = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const ascii = all.toString('latin1');
  const ok = ascii.includes('HTTP/1.1') || ascii.includes('HTTP/1.0');
  console.log('---');
  console.log('reason:', reason);
  console.log('bytes received:', all.length);
  console.log('PROXY OK:', ok ? 'YES - got HTTP response through the tunnel' : 'NO');
  console.log('first 200 bytes:', JSON.stringify(ascii.slice(0, 200)));
  process.exit(ok ? 0 : 1);
}

ws.on('open', () => {
  opened = true;
  console.log('WS handshake: OK (101 upgrade succeeded)');
  const header = buildVlessHeader(
    'example.com', 80,
    'GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\nUser-Agent: netra-test\r\n\r\n'
  );
  ws.send(header);
});

ws.on('message', (data) => {
  chunks.push(data);
});

ws.on('error', (err) => {
  console.error('WS error:', err.message);
  if (!opened) process.exit(1);
});

ws.on('close', () => finish('socket closed'));
