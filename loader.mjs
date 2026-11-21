// Resolve hook: "cloudflare:sockets" -> shims/cf-sockets.mjs
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:sockets') {
    return {
      url: pathToFileURLish('./shims/cf-sockets.mjs'),
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}

import { pathToFileURL } from 'node:url';
function pathToFileURLish(rel) {
  return pathToFileURL(new URL(rel, import.meta.url).pathname).href;
}
