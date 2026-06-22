/**
 * Claude Forecast – Cloudflare Worker API-Proxy
 *
 * Deployment: https://dash.cloudflare.com → Workers → Worker erstellen
 * → Code einfügen → Deployen → URL kopieren → in Website-Einstellungen eintragen
 *
 * Die echten API-Keys werden NICHT in dieses Repository eingecheckt.
 * Füge deine Keys direkt im Cloudflare Dashboard ein (oder nutze wrangler secrets).
 *
 * Endpunkte:
 *   GET /history?symbol=AAPL  → Alpha Vantage Tageskurse
 *   GET /quote?symbol=AAPL    → Finnhub Live-Kurs
 *   GET /search?q=apple       → Finnhub Suche
 *   GET /news?q=Apple+Aktie   → GNews Nachrichten
 */

const AV_KEY = 'DEIN_ALPHA_VANTAGE_KEY';
const FH_KEY = 'DEIN_FINNHUB_KEY';
const GN_KEY = 'DEIN_GNEWS_KEY';

// Nur Anfragen von dieser Domain erlauben
const ALLOWED_ORIGIN = 'https://0belixc0de.github.io';

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';

    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }), origin);
    }

    if (request.method !== 'GET') {
      return corsResponse(new Response('Method Not Allowed', { status: 405 }), origin);
    }

    const { pathname, searchParams } = new URL(request.url);

    // Eingaben bereinigen
    const symbol = sanitize(searchParams.get('symbol') || '');
    const query  = sanitize(searchParams.get('q')      || '');

    let upstreamUrl;

    if (pathname === '/history' && symbol) {
      upstreamUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${AV_KEY}`;
    } else if (pathname === '/quote' && symbol) {
      upstreamUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FH_KEY}`;
    } else if (pathname === '/search' && query) {
      upstreamUrl = `https://finnhub.io/api/v1/search?q=${query}&token=${FH_KEY}`;
    } else if (pathname === '/news' && query) {
      upstreamUrl = `https://gnews.io/api/v4/search?q=${query}&lang=de&max=6&token=${GN_KEY}`;
    } else {
      return corsResponse(new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }), origin);
    }

    try {
      const upstream = await fetch(upstreamUrl, { cf: { cacheTtl: 60, cacheEverything: true } });
      const body     = await upstream.text();
      return corsResponse(
        new Response(body, { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } }),
        origin
      );
    } catch (err) {
      return corsResponse(
        new Response(JSON.stringify({ error: err.message }), { status: 502, headers: { 'Content-Type': 'application/json' } }),
        origin
      );
    }
  }
};

function corsResponse(response, origin) {
  const r = new Response(response.body, response);
  // Nur erlaubte Origin oder localhost für Entwicklung
  const allowed = origin === ALLOWED_ORIGIN || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
  r.headers.set('Access-Control-Allow-Origin', allowed ? origin : ALLOWED_ORIGIN);
  r.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  r.headers.set('Vary', 'Origin');
  return r;
}

function sanitize(str) {
  // Nur alphanumerische Zeichen, Punkt, Bindestrich, Plus, Leerzeichen erlauben
  return encodeURIComponent(str.replace(/[^a-zA-Z0-9 .+\-äöüÄÖÜß]/g, '').slice(0, 100));
}
