// ══════════════════════════════════════════════════════════════
// SID FIRE — Service Worker v10 (offline-first corrigido)
// ══════════════════════════════════════════════════════════════
//
// PROBLEMA ANTERIOR: c.addAll([]) — cache vazio no install.
// O app só entrava no cache se o usuário navegasse online primeiro.
// Se fechasse o browser antes de uma segunda visita, ficava sem cache.
//
// SOLUÇÃO: pré-cacheia o index.html + assets críticos no install,
// garantindo que o app funcione SEMPRE offline após a 1ª abertura.
// Usa stale-while-revalidate para navegação: serve cache instantâneo
// e atualiza em background quando há rede.
// ══════════════════════════════════════════════════════════════

const CACHE = 'fire-guard-v12';

// Assets obrigatórios pré-cacheados no install (app shell)
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Hosts CDN — cache-first (lazy na 1ª visita)
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// Hosts de API — nunca interceptar (deixa ir para a rede)
const BYPASS_HOSTS = [
  'supabase.co',
  'supabase.io',
];

const OFFLINE_HTML = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fire Guard — Offline</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0F172A;color:#F1F5F9;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-height:100svh;gap:20px;text-align:center;padding:32px}
.logo{font-size:72px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
h1{font-size:26px;font-weight:800;color:#D4A853}
p{font-size:15px;color:#94A3B8;max-width:300px;line-height:1.6}
.badge{display:inline-flex;align-items:center;gap:8px;background:#1E293B;
  border:1px solid #334155;border-radius:999px;padding:8px 18px;font-size:13px;color:#94A3B8}
.dot{width:8px;height:8px;border-radius:50%;background:#EF4444;animation:blink 1.2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
button{margin-top:8px;padding:14px 32px;background:#D4A853;color:#1E293B;
  border:none;border-radius:14px;font-size:15px;font-weight:800;cursor:pointer}
</style></head><body>
<div class="logo">🔥💧</div>
<h1>Fire Guard</h1>
<div class="badge"><span class="dot"></span> Sem conexão</div>
<p>Você está offline. Os dados locais ainda estão disponíveis — recarregue quando voltar a conectar.</p>
<button onclick="location.reload()">Tentar novamente</button>
</body></html>`;

// ── INSTALL: pré-cacheia o app shell ─────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // allSettled: falha em um asset não cancela os outros
      Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Falha ao pré-cachear:', url, err)
          )
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpa caches antigos ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE).map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── FETCH: estratégia por tipo de recurso ────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Só GET
  if (req.method !== 'GET') return;

  // Só http/https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // APIs externas — passa direto para a rede, sem interceptar
  if (BYPASS_HOSTS.some(h => url.hostname.includes(h))) return;

  // ── CDN: Cache-First (lazy cache na 1ª visita) ──────────────
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(req).then(cached => {
          if (cached) return cached;
          return fetch(req).then(res => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // ── Navegação + Estáticos: Stale-While-Revalidate ──────────
  // Serve do cache instantaneamente (funciona offline)
  // Atualiza em background quando tem rede (mantém fresco)
  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(cached => {
        // Tenta rede em background
        const networkPromise = fetch(req)
          .then(res => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);

        if (cached) {
          // Cache hit: serve agora, atualiza silenciosamente
          networkPromise; // fire-and-forget
          return cached;
        }

        // Cache miss: aguarda rede ou serve offline
        return networkPromise.then(res => {
          if (res) return res;
          // Sem rede e sem cache: página offline (só para navigate)
          if (req.mode === 'navigate') {
            return new Response(OFFLINE_HTML, {
              headers: { 'Content-Type': 'text/html;charset=utf-8' }
            });
          }
          return new Response('', { status: 503 });
        });
      })
    )
  );
});
