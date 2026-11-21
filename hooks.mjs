// Module resolution hook: maps the Cloudflare-only specifier
// "cloudflare:sockets" to our Node.js shim implementation.
// Enabled via: node --import ./hooks.mjs server.js
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
