// Netra Panel — Node.js server adapter.
//
// Bridges a plain Node.js HTTP(S) server to the Cloudflare-Workers-style
// default export inside worker.js:
//   export default { async fetch(request, env, ctx) { ... } }
//
// Provides:
//   - WHATWG Request/Response conversion (Node 18+ globals)
//   - WebSocket upgrade bridging via `ws` + WebSocketPair shim
//   - "cloudflare:sockets" shim (see shims/cf-sockets.mjs, wired by loader.mjs)
//   - File-backed KV namespace (see shims/kv.mjs)
import http from 'node:http';
import { Readable } from 'node:stream';
import { WebSocketServer } from 'ws';

import { createKV } from './shims/kv.mjs';
import { WebSocketPair, setActiveWS } from './shims/ws-pair.mjs';

// ---- globals expected by the worker runtime -------------------------------
globalThis.WebSocketPair = WebSocketPair;

// Node's Response rejects status 101, but the worker returns
// `new Response(null, { status: 101, webSocket })` for WebSocket upgrades
// (Cloudflare Workers semantics). Wrap Response so 101 becomes valid and the
// `webSocket` marker is preserved on the instance.
class WorkersCompatibleResponse extends Response {
  constructor(body, init) {
    if (init && init.status === 101) {
      super(body ?? null, { ...init, status: 200 });
      this.webSocket = init.webSocket ?? null;
    } else {
      super(body, init);
    }
  }
}
globalThis.Response = WorkersCompatibleResponse;

// ---- worker import (loader.mjs maps "cloudflare:sockets") ------------------
const worker = await import('./worker.js');
const fetchHandler = worker.default.fetch;

// ---- environment ----------------------------------------------------------
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const kv = createKV();
const env = {
  kv,
  // optional Cloudflare/WARP integration (same names as worker vars)
  CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID || '',
  CF_EMAIL: process.env.CF_EMAIL || '',
  CF_API_TOKEN: process.env.CF_API_TOKEN || '',
  // optional overrides (same names as worker vars)
  UUID: process.env.UUID || '',
  TR_PASS: process.env.TR_PASS || '',
  SUB_PATH: process.env.SUB_PATH || '',
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

// ---- helpers ---------------------------------------------------------------
function buildURL(req) {
  const proto =
    req.headers['x-forwarded-proto']?.split(',')[0].trim() ||
    (req.socket.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host || 'localhost';
  return `${proto}://${host}${req.url}`;
}

function buildHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (key === 'host' || key === 'connection' || key === 'content-length') continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.append(key, value);
  }
  return headers;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function toFetchRequest(req, { skipBody = false } = {}) {
  const url = buildURL(req);
  const headers = buildHeaders(req);
  const method = req.method || 'GET';
  // WebSocket upgrades hand the socket over to `ws`, so the request stream
  // never emits 'end' — never try to read a body there.
  const hasBody = !['GET', 'HEAD'].includes(method) && !skipBody;
  const body = hasBody ? await readBody(req) : undefined;
  return new Request(url, {
    method,
    headers,
    body: body && body.length ? new Uint8Array(body) : undefined,
    duplex: 'half',
  });
}

async function sendResponse(res, workerRes) {
  if (!workerRes || typeof workerRes.status !== 'number') {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal error: empty worker response');
    return;
  }
  const headers = {};
  workerRes.headers.forEach((value, key) => {
    // node joins duplicate header names with ", " which is fine for our use
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  });
  res.writeHead(workerRes.status, headers);

  if (!workerRes.body) {
    res.end();
    return;
  }
  try {
    const nodeStream = Readable.fromWeb(workerRes.body);
    nodeStream.pipe(res);
    nodeStream.on('error', () => res.destroy());
  } catch {
    const buf = await workerRes.arrayBuffer();
    res.end(Buffer.from(buf));
  }
}

// ---- WebSocket bridging -----------------------------------------------------
const wss = new WebSocketServer({ noServer: true, maxPayload: 0 });

function handleUpgrade(req, socket, head) {
  wss.handleUpgrade(req, socket, head, async (ws) => {
    try {
      ws.binaryType = 'arraybuffer';
      setActiveWS(ws);
      const request = await toFetchRequest(req, { skipBody: true });
      const response = await fetchHandler(request, env, ctx);
      const isUpgrade = response && response.webSocket !== undefined;
      if (!isUpgrade) {
        // handler refused the upgrade (e.g. invalid path) — report and close
        const status = response ? response.status : 500;
        let body = '';
        try { body = response ? await response.text() : 'no response'; } catch { /* noop */ }
        console.error(`[ws] upgrade rejected with status ${status}: ${body.slice(0, 200)}`);
        try { ws.close(1011, 'upgrade rejected'); } catch { socket.destroy(); }
      }
      // on successful upgrade everything is already wired through the WebSocketPair shim
    } catch (err) {
      console.error('[ws] handler error:', err);
      try { ws.close(1011, 'internal error'); } catch { socket.destroy(); }
    }
  });
}

// ---- HTTP server ------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  if ((req.headers.upgrade || '').toLowerCase() === 'websocket') {
    // fall-through protection: websocket requests must go through 'upgrade'
    res.writeHead(426).end();
    return;
  }
  try {
    const request = await toFetchRequest(req);
    const response = await fetchHandler(request, env, ctx);
    await sendResponse(res, response);
  } catch (err) {
    console.error('[http] handler error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    try { res.end(`Internal error: ${err?.message || err}`); } catch { /* noop */ }
  }
});

server.on('upgrade', (req, socket, head) => {
  if ((req.headers.upgrade || '').toLowerCase() === 'websocket') {
    handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Netra Panel (Node port) listening on http://${HOST}:${PORT}`);
  console.log(`Open the panel at: http://localhost:${PORT}/<securePath>/panel  (default secure path: "netra")`);
  console.log(`KV store file: ${process.env.KV_PATH || 'data/kv.json'}`);
});

process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
