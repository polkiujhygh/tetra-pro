// E2E test: Trojan-over-WebSocket (default password "netra") against the local port.
import crypto from 'node:crypto';
import WebSocket from 'ws';

const PASS = 'netra';
const sha224hex = crypto.createHash('sha224').update(PASS).digest('hex');

function buildTrojanHeader(domain, port, payload) {
  const enc = new TextEncoder();
  const d = enc.encode(domain);
  const p = enc.encode(payload);
  // [56-byte sha224 hex][CR LF][SOCKS5: cmd=1][addrType=3 domain][len][domain][port BE][payload]
  const head = [
    ...enc.encode(sha224hex), // 56-byte password hash
    0x0d, 0x0a,               // CRLF
    0x01,                     // command: CONNECT
    0x03, d.length, ...d,     // address type: domain
    (port >> 8) & 0xff, port & 0xff,
  ];
  const out = new Uint8Array(head.length + p.length);
  out.set(head, 0);
  out.set(p, head.length);
  return out;
}

const ws = new WebSocket('ws://127.0.0.1:3000/tr', { handshakeTimeout: 10000 });
const chunks = [];
const timer = setTimeout(() => finish('timeout'), 20000);

function finish(reason) {
  clearTimeout(timer);
  const all = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const ascii = all.toString('latin1');
  const ok = ascii.includes('HTTP/1.1') || ascii.includes('HTTP/1.0');
  console.log('---');
  console.log('reason:', reason, '| bytes:', all.length, '| TROJAN OK:', ok ? 'YES' : 'NO');
  process.exit(ok ? 0 : 1);
}

ws.on('open', () => {
  console.log('WS handshake OK');
  ws.send(buildTrojanHeader('example.com', 80,
    'GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\nUser-Agent: netra-test\r\n\r\n'));
});
ws.on('message', (data) => chunks.push(data));
ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
ws.on('close', () => finish('closed'));
