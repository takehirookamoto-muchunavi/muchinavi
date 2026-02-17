// MuchiNavi Service Worker
const CACHE_NAME = 'muchinavi-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: キャッシュにコアファイルを保存
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: ネットワークファースト（APIはキャッシュしない）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API・POSTリクエストはネットワーク直接
  if (url.pathname.startsWith('/api') || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 成功 → キャッシュを更新して返す
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        // オフライン → キャッシュから返す
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // オフラインフォールバック
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return new Response(
              '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MuchiNavi</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f7;color:#1d1d1f;text-align:center;padding:20px}.box{max-width:400px}h1{font-size:48px;margin-bottom:16px}p{color:#6e6e73;line-height:1.6}</style></head><body><div class="box"><h1>📡</h1><h2>オフラインです</h2><p>インターネット接続を確認して、もう一度お試しください。</p></div></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          }
        });
      })
  );
});
