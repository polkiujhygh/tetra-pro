// File-backed implementation of the Cloudflare Workers KV interface.
// API surface used by netra-panel:
//   await kv.get(key, { type: "json" })  -> parsed JSON | string | null
//   await kv.put(key, value)             -> void
// plus optional delete()/list() for completeness.
//
// Storage: single JSON file (path from env KV_PATH, default ./data/kv.json),
// in-memory Map cache + debounced atomic writes.
import fs from 'node:fs';
import path from 'node:path';

const KV_PATH = process.env.KV_PATH || path.join(process.cwd(), 'data', 'kv.json');

let store = new Map();
let writeTimer = null;

function load() {
  try {
    if (fs.existsSync(KV_PATH)) {
      const raw = fs.readFileSync(KV_PATH, 'utf8');
      const obj = JSON.parse(raw || '{}');
      store = new Map(Object.entries(obj));
    }
  } catch (err) {
    console.error('[kv] failed to load store:', err.message);
    store = new Map();
  }
}

function persistNow() {
  try {
    fs.mkdirSync(path.dirname(KV_PATH), { recursive: true });
    const obj = Object.fromEntries(store);
    const tmp = `${KV_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, KV_PATH);
  } catch (err) {
    console.error('[kv] failed to persist store:', err.message);
  }
}

function schedulePersist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    persistNow();
  }, 250);
  // do not keep the process alive just for a pending write
  if (writeTimer.unref) writeTimer.unref();
}

load();

export class FileKV {
  async get(key, opts) {
    const v = store.has(key) ? store.get(key) : null;
    if (v === null || v === undefined) return null;
    if (opts && opts.type === 'json') {
      try { return JSON.parse(v); } catch { return null; }
    }
    if (opts && opts.type === 'arrayBuffer') {
      return new TextEncoder().encode(v).buffer;
    }
    return v;
  }

  async put(key, value) {
    let v = value;
    if (value instanceof ArrayBuffer) v = new TextDecoder().decode(value);
    else if (ArrayBuffer.isView(value)) v = new TextDecoder().decode(value.buffer ?? value);
    else if (typeof value !== 'string') v = String(value);
    store.set(String(key), v);
    schedulePersist();
  }

  async delete(key) {
    store.delete(String(key));
    schedulePersist();
  }

  async list({ prefix = '', limit } = {}) {
    let keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
    if (limit) keys = keys.slice(0, limit);
    return { keys: keys.map((name) => ({ name })) };
  }
}

export function createKV() {
  return new FileKV();
}

export default { FileKV, createKV };
