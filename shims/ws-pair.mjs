// WebSocketPair shim for Node.js.
//
// Cloudflare Workers semantics:
//   const pair = new WebSocketPair();
//   const [client, server] = Object.values(pair);
//   server.accept();
//   server.addEventListener("message"|"close"|"error", fn)
//   server.send(data); server.close(code, reason); server.readyState
//
// The "server" side is backed by a real `ws` WebSocket from the HTTP upgrade
// event. Two buffering layers make the async worker handshake race-free:
//   1. pre-pair capture  — events between the 101 handshake and the worker
//      calling `new WebSocketPair()` (it awaits KV/settings first)
//   2. listener queue    — events arriving after accept() but before the
//      worker attaches addEventListener("message"|"close"|"error")
import { EventEmitter } from 'node:events';

let activeWS = null;
let capturing = false;
let captureBuffer = [];

/**
 * Set the real `ws` WebSocket for the next WebSocketPair construction and
 * start capturing its events into the pre-pair buffer.
 */
export function setActiveWS(ws) {
  activeWS = ws;
  capturing = true;
  captureBuffer = [];
  ws.on('message', (data) => { if (capturing) captureBuffer.push({ type: 'message', args: [data] }); });
  ws.on('close', (code, reason) => { if (capturing) captureBuffer.push({ type: 'close', args: [code, reason] }); });
  ws.on('error', (err) => { if (capturing) captureBuffer.push({ type: 'error', args: [err] }); });
}

function makeServerSide(real) {
  const listeners = new Map(); // type -> Set<fn>
  const queue = [];            // buffered {type, event} waiting for a listener
  let accepted = false;
  const state = { binaryType: 'blob' };

  function hasListener(type) {
    return (listeners.get(type)?.size || 0) > 0;
  }

  function deliver(type, event) {
    for (const fn of listeners.get(type) || []) {
      try { fn.call(null, event); } catch (err) { console.error('[ws-pair] listener error:', err); }
    }
  }

  // Deliver buffered events, but only as far as listeners exist; the rest
  // stays queued. This is what makes accept() -> attach-later race-free.
  function maybeFlush() {
    if (!accepted) return;
    while (queue.length && hasListener(queue[0].type)) {
      const { type, event } = queue.shift();
      deliver(type, event);
    }
  }

  function receive(type, event) {
    if (!accepted || !hasListener(type)) queue.push({ type, event });
    deliver(type, event);
    maybeFlush();
  }

  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  emitter.on('message', (data) => receive('message', { data, isTrusted: true }));
  emitter.on('close', (code, reason) =>
    receive('close', { code, reason: reason ? String(reason) : '', wasClean: true, isTrusted: true }));
  emitter.on('error', (err) =>
    receive('error', { message: err?.message || 'ws error', error: err, isTrusted: true }));

  if (real) {
    // 1. replay events captured before the pair was constructed
    capturing = false;
    const buffered = captureBuffer;
    captureBuffer = [];
    for (const { type, args } of buffered) emitter.emit(type, ...args);
    // 2. bridge all future events of the real socket into the shim
    real.on('message', (data) => emitter.emit('message', data));
    real.on('close', (code, reason) => emitter.emit('close', code, reason));
    real.on('error', (err) => emitter.emit('error', err));
  }

  const server = {
    accept() {
      accepted = true;
      maybeFlush();
    },
    get readyState() {
      return real ? real.readyState : 3;
    },
    get binaryType() { return state.binaryType; },
    set binaryType(v) {
      state.binaryType = v;
      if (real && v === 'arraybuffer') real.binaryType = 'arraybuffer';
    },
    send(data) {
      if (!real || real.readyState !== 1) return;
      real.send(data);
    },
    close(code, reason) {
      try { real && real.close(code, reason); } catch { /* noop */ }
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      maybeFlush();
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent() { return true; },
  };

  return server;
}

export class WebSocketPair {
  constructor() {
    const real = activeWS;
    activeWS = null;
    this[0] = { readyState: 1 }; // client side (returned in Response, unused by the worker)
    this[1] = makeServerSide(real);
  }
}

export default WebSocketPair;
