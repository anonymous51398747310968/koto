'use strict';
const VERSION = 'e3cf90e9032c8365';
const ROOT = self.registration.scope;
const pending = new Map();
let manifestPromise;

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function manifest() {
  if (!manifestPromise) manifestPromise = fetch(new URL('manifest.json?v=' + VERSION, ROOT))
    .then(response => { if (!response.ok) throw new Error('Manifest unavailable'); return response.json(); })
    .catch(error => { manifestPromise = null; throw error; });
  return manifestPromise;
}

async function packageBlob(name) {
  const url = new URL(name, ROOT).href;
  if (pending.has(url)) return pending.get(url);
  const promise = (async () => {
    let cache;
    try { cache = await caches.open('koto-packs-' + VERSION); } catch {}
    const cached = cache && await cache.match(url);
    if (cached) return cached.blob();
    const response = await fetch(url);
    if (!response.ok) throw new Error('Package unavailable: ' + name);
    const blob = await response.blob();
    // Storage can be unavailable or full (e.g. private browsing). Playback still works.
    if (cache) try { await cache.put(url, new Response(blob)); } catch {}
    return blob;
  })();
  pending.set(url, promise);
  try { return await promise; } finally { pending.delete(url); }
}

async function assetResponse(request, name) {
  try {
    const entry = (await manifest()).assets[name];
    if (!entry) return new Response('Asset not found', {status:404});
    const pack = await packageBlob(entry.pack);
    if (pack.size < entry.offset + entry.length) throw new Error('Incomplete package');
    const bytes = pack.slice(entry.offset, entry.offset + entry.length, entry.type);
    const headers = {'Content-Type':entry.type, 'Accept-Ranges':'bytes', 'Cache-Control':'no-cache'};
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, {status:416, headers:{'Content-Range':'bytes */' + bytes.size}});
      const start = match[1] ? Number(match[1]) : Math.max(0, bytes.size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.size - 1) : bytes.size - 1;
      if (start > end || start >= bytes.size) return new Response(null, {status:416, headers:{'Content-Range':'bytes */' + bytes.size}});
      headers['Content-Range'] = `bytes ${start}-${end}/${bytes.size}`;
      headers['Content-Length'] = String(end - start + 1);
      return new Response(bytes.slice(start,end + 1,entry.type), {status:206,headers});
    }
    headers['Content-Length'] = String(bytes.size);
    return new Response(bytes, {headers});
  } catch (error) {
    console.error('koto package:', error);
    return new Response('Could not load game package. Please reload.', {status:503});
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.href.startsWith(ROOT)) return;
  const name = decodeURIComponent(url.pathname.slice(new URL(ROOT).pathname.length));
  if (name.startsWith('assets/')) event.respondWith(assetResponse(event.request,name));
});
