// Node.js implementation of Cloudflare's `connect()` API from "cloudflare:sockets".
//
// Supported usage in worker.js:
//   connect({ hostname, port })            -> plain TCP
//   connect({ hostname, port }, { secureTransport: "on"|"starttls"|"off", allowUntrusted })
//
// The returned Socket mimics the Cloudflare Socket interface:
//   .readable  -> ReadableStream (web)
//   .writable  -> WritableStream (web)
//   .closed    -> Promise<void>
//   .close()   -> void
//   .write()   -> Promise<void>
import net from 'node:net';
import tls from 'node:tls';
import { Readable, Writable } from 'node:stream';

function parseAddress(address) {
  if (typeof address === 'string') {
    const clean = address.replace(/^\[|\]$/g, '');
    const idx = clean.lastIndexOf(':');
    return { hostname: clean.slice(0, idx), port: Number(clean.slice(idx + 1)) };
  }
  return { hostname: address.hostname, port: Number(address.port) };
}

export function connect(address, options = {}) {
  const { hostname, port } = parseAddress(address);
  const secureTransport = options.secureTransport || 'off';

  let sock;
  if (secureTransport === 'on') {
    sock = tls.connect({
      host: hostname,
      port,
      servername: net.isIP(hostname) ? undefined : hostname,
      rejectUnauthorized: !options.allowUntrusted,
    });
  } else {
    sock = net.connect({ host: hostname, port });
  }

  sock.setNoDelay(true);

  let settled = false;
  const closed = new Promise((resolve, reject) => {
    sock.once('close', () => {
      if (!settled) { settled = true; resolve(); }
    });
    sock.once('error', (err) => {
      if (!settled) { settled = true; reject(err); }
    });
  });

  const socket = {
    readable: Readable.toWeb(sock),
    writable: Writable.toWeb(sock),
    closed,
    close() {
      try { sock.destroy(); } catch { /* noop */ }
    },
    write(data) {
      return new Promise((resolve, reject) => {
        sock.write(data, (err) => (err ? reject(err) : resolve()));
      });
    },
  };

  return socket;
}

export default connect;
