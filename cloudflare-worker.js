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
 *   GET /news?symbol=AAPL     → Finnhub Unternehmensnachrichten (kein extra Key nötig)
 */

const AV_KEY = 'DEIN_ALPHA_VANTAGE_KEY';
const FH_KEY = 'DEIN_FINNHUB_KEY';

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

    /* ── /news  →  Finnhub company news (kein extra Key nötig) ── */
    if (pathname === '/news') {
      // symbol-Parameter bevorzugen; fallback: erstes Wort aus q (Name → Ticker)
      const sym = symbol || (searchParams.get('q') || '').trim().split(/\s+/)[0].toUpperCase();

      if (!sym) {
        return corsResponse(json({ articles: [] }), origin);
      }

      const now  = new Date();
      const to   = now.toISOString().split('T')[0];
      const from = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];

      try {
        const r    = await fetch(
          `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${from}&to=${to}&token=${FH_KEY}`,
          { cf: { cacheTtl: 900, cacheEverything: true } }
        );
        const data = await r.json();

        const articles = Array.isArray(data) && data.length > 0
          ? data.slice(0, 6).map(a => ({
              title:       a.headline,
              description: a.summary,
              url:         a.url,
              source:      { name: a.source },
              publishedAt: new Date(a.datetime * 1000).toISOString(),
            }))
          : [];

        return corsResponse(
          new Response(JSON.stringify({ articles }), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' }
          }),
          origin
        );
      } catch (e) {
        return corsResponse(json({ articles: [] }), origin);
      }
    }

    /* ── alle anderen Endpunkte ───────────────────────────────── */

    let upstreamUrl;

    if (pathname === '/history' && symbol) {
      upstreamUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${AV_KEY}`;
    } else if (pathname === '/quote' && symbol) {
      upstreamUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FH_KEY}`;
    } else if (pathname === '/search' && query) {
      upstreamUrl = `https://finnhub.io/api/v1/search?q=${query}&token=${FH_KEY}`;
    } else if (pathname === '/candle' && symbol) {
      const res  = sanitize(searchParams.get('resolution') || 'D');
      const from = sanitize(searchParams.get('from') || '');
      const to   = sanitize(searchParams.get('to')   || '');
      upstreamUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=${res}&from=${from}&to=${to}&token=${FH_KEY}`;
    } else if (pathname === '/intraday' && symbol) {
      upstreamUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=5min&outputsize=compact&apikey=${AV_KEY}`;
    } else {
      return corsResponse(
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }),
        origin
      );
    }

    try {
      const upstream = await fetch(upstreamUrl, { cf: { cacheTtl: 60, cacheEverything: true } });
      const body     = await upstream.text();
      return corsResponse(
        new Response(body, {
          status: upstream.status,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
        }),
        origin
      );
    } catch (e) {
      return corsResponse(
        new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { 'Content-Type': 'application/json' } }),
        origin
      );
    }
  }
};

/* ─── Helpers ───────────────────────────────────────────────── */

function json(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

function corsResponse(response, origin) {
  const r = new Response(response.body, response);
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
