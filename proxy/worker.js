// Chip Swap 用の中継 (Cloudflare Workers)
// chiptune.app の一覧 API と曲ファイル (gifx.co) は chiptune.app と localhost からしか読めないため、
// GitHub Pages の公開ページからはこの中継を通して読む。
//   GET /api/browse?path=...   → https://chiptune.app/api/browse?path=...
//   GET /api/search?query=...  → https://chiptune.app/api/search?query=...
//   GET /music/<path>          → https://gifx.co/music/<path>
// それ以外の URL・許可していないサイトからの利用は断る (誰でも使える中継にしないため)。

const ALLOWED_ORIGINS = [
  'https://zitnei.github.io',
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

const isAllowed = (origin) => ALLOWED_ORIGINS.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)));

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (origin && !isAllowed(origin)) return new Response('forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });

    let target;
    if (url.pathname === '/api/browse' || url.pathname === '/api/search') {
      target = 'https://chiptune.app' + url.pathname + url.search;
    } else if (url.pathname.startsWith('/music/')) {
      target = 'https://gifx.co' + url.pathname;
    } else {
      return new Response('not found', { status: 404 });
    }

    // 曲ファイルは変わらないので長めにキャッシュ、一覧は短め
    const isFile = url.pathname.startsWith('/music/');
    const cache = caches.default;
    const cacheKey = new Request(target);
    let res = await cache.match(cacheKey);
    if (!res) {
      const upstream = await fetch(target, { headers: { 'User-Agent': 'ChipSwap-Proxy', Origin: 'https://chiptune.app' } });
      if (!upstream.ok) return new Response('upstream ' + upstream.status, { status: upstream.status, headers: origin ? cors(origin) : {} });
      res = new Response(upstream.body, upstream);
      res.headers.set('Cache-Control', isFile ? 'public, max-age=604800' : 'public, max-age=3600');
      res.headers.delete('Set-Cookie');
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    res = new Response(res.body, res);
    if (origin) for (const [k, v] of Object.entries(cors(origin))) res.headers.set(k, v);
    return res;
  },
};
