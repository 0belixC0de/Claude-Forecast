/* ═══════════════════════════════════════════
   API – Proxy-First · Alpha Vantage · Finnhub · GNews
   ═══════════════════════════════════════════ */

const API = (() => {

  // ── Keys ────────────────────────────────────────────────────

  const DEFAULT_PROXY = 'https://shiny-paper-eb08.tnclindner.workers.dev';

  const KEYS = {
    proxy: () => localStorage.getItem('cf_proxy') || DEFAULT_PROXY,
    av:    () => localStorage.getItem('cf_av')    || '',
    fh:    () => localStorage.getItem('cf_fh')    || '',
    gn:    () => localStorage.getItem('cf_gn')    || '',
    save(proxy, av, fh, gn) {
      localStorage.setItem('cf_proxy', proxy.trim());
      localStorage.setItem('cf_av',    av.trim());
      localStorage.setItem('cf_fh',    fh.trim());
      localStorage.setItem('cf_gn',    gn.trim());
    },
    clear() { ['cf_proxy','cf_av','cf_fh','cf_gn'].forEach(k => localStorage.removeItem(k)); },
    hasAny:    () => true,
    hasCustom: () => !!(localStorage.getItem('cf_proxy') || localStorage.getItem('cf_av') || localStorage.getItem('cf_fh'))
  };

  // ── Cache ────────────────────────────────────────────────────

  const cache = {
    set(key, data, ttlMin = 5) {
      try { localStorage.setItem('_c_' + key, JSON.stringify({ data, exp: Date.now() + ttlMin * 60000 })); } catch {}
    },
    get(key) {
      try {
        const raw = localStorage.getItem('_c_' + key);
        if (!raw) return null;
        const { data, exp } = JSON.parse(raw);
        if (Date.now() > exp) { localStorage.removeItem('_c_' + key); return null; }
        return data;
      } catch { return null; }
    }
  };

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60)    return 'gerade eben';
    if (s < 3600)  return `vor ${Math.round(s/60)} Min.`;
    if (s < 86400) return `vor ${Math.round(s/3600)} Std.`;
    return `vor ${Math.round(s/86400)} Tagen`;
  }

  function parseAVHistory(data) {
    const series = data['Time Series (Daily)'];
    if (!series) return null;
    const entries = Object.entries(series).slice(0, 120).reverse();
    return {
      dates:   entries.map(([d]) => d),
      prices:  entries.map(([,v]) => parseFloat(v['4. close'])),
      opens:   entries.map(([,v]) => parseFloat(v['1. open'])),
      highs:   entries.map(([,v]) => parseFloat(v['2. high'])),
      lows:    entries.map(([,v]) => parseFloat(v['3. low'])),
      volumes: entries.map(([,v]) => parseInt(v['5. volume']))
    };
  }

  // ── Historical data ──────────────────────────────────────────

  async function fetchHistory(symbol) {
    const ck = `hist_${symbol}`;
    const hit = cache.get(ck);
    if (hit) return hit;

    let result = null;

    // 1. Proxy
    const proxy = KEYS.proxy();
    if (proxy) {
      try {
        const data = await fetchJSON(`${proxy}/history?symbol=${encodeURIComponent(symbol)}`);
        result = parseAVHistory(data);
      } catch (e) { console.warn('proxy /history:', e.message); }
    }

    // 2. Alpha Vantage direct
    if (!result && KEYS.av()) {
      try {
        const data = await fetchJSON(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${KEYS.av()}`);
        result = parseAVHistory(data);
      } catch (e) { console.error('AV:', e.message); }
    }

    if (result) cache.set(ck, result, 30);
    return result;
  }

  // ── Intraday candle (Finnhub) ────────────────────────────────

  async function fetchCandle(symbol, resolution = 'D', from, to) {
    const now  = Math.floor(Date.now() / 1000);
    const f    = from || now - 90 * 86400;
    const t    = to   || now;

    const proxy = KEYS.proxy();
    if (proxy) {
      try {
        const data = await fetchJSON(`${proxy}/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${f}&to=${t}`);
        if (data.s === 'ok') return parseCandle(data);
      } catch (e) { console.warn('proxy /candle:', e.message); }
    }

    if (KEYS.fh()) {
      try {
        const data = await fetchJSON(`https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${f}&to=${t}&token=${KEYS.fh()}`);
        if (data.s === 'ok') return parseCandle(data);
      } catch (e) { console.error('Finnhub candle:', e.message); }
    }
    return null;
  }

  function parseCandle(data) {
    const len = data.t.length;
    const dates  = data.t.map(ts => new Date(ts * 1000).toISOString().split('T')[0]);
    return {
      dates,
      timestamps: data.t.map(ts => ts * 1000),
      prices:  data.c,
      opens:   data.o,
      highs:   data.h,
      lows:    data.l,
      volumes: data.v
    };
  }

  // ── Live quote ───────────────────────────────────────────────

  async function fetchQuote(symbol) {
    const proxy = KEYS.proxy();
    if (proxy) {
      try {
        const d = await fetchJSON(`${proxy}/quote?symbol=${encodeURIComponent(symbol)}`);
        if (d.c) return { price: d.c, change: d.d, changePercent: d.dp, high: d.h, low: d.l, open: d.o, prevClose: d.pc };
      } catch (e) { console.warn('proxy /quote:', e.message); }
    }
    if (KEYS.fh()) {
      try {
        const d = await fetchJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${KEYS.fh()}`);
        if (d.c) return { price: d.c, change: d.d, changePercent: d.dp, high: d.h, low: d.l, open: d.o, prevClose: d.pc };
      } catch (e) { console.error('Finnhub quote:', e.message); }
    }
    return null;
  }

  // ── Market overview ──────────────────────────────────────────

  const MARKET_SYMS = [
    { symbol: 'SPY',  label: 'S&P 500' },
    { symbol: 'QQQ',  label: 'NASDAQ'  },
    { symbol: 'EWG',  label: 'DAX'     },
    { symbol: 'GLD',  label: 'Gold'    },
    { symbol: 'BINANCE:BTCUSDT', label: 'BTC' },
  ];

  async function fetchMarket() {
    return Promise.all(MARKET_SYMS.map(async m => {
      const q = await fetchQuote(m.symbol).catch(() => null);
      return { ...m, price: q?.price || null, changePercent: q?.changePercent || null };
    }));
  }

  // ── Symbol search ────────────────────────────────────────────

  async function searchSymbol(query) {
    const proxy = KEYS.proxy();
    if (proxy) {
      try {
        const d = await fetchJSON(`${proxy}/search?q=${encodeURIComponent(query)}`);
        if (d.result) return d.result.filter(r => r.type === 'Common Stock' || r.type === 'EQS').slice(0, 6).map(r => ({ symbol: r.symbol, name: r.description }));
      } catch {}
    }
    if (KEYS.fh()) {
      try {
        const d = await fetchJSON(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${KEYS.fh()}`);
        if (d.result) return d.result.filter(r => r.type === 'Common Stock' || r.type === 'EQS').slice(0, 6).map(r => ({ symbol: r.symbol, name: r.description }));
      } catch {}
    }
    return demoSuggestions(query);
  }

  // ── News ─────────────────────────────────────────────────────

  async function fetchNews(symbol, name) {
    const ck = `news_${symbol}`;
    const hit = cache.get(ck);
    if (hit) return hit;

    const q = encodeURIComponent(`${name || symbol} Aktie`);
    let articles = null;

    const proxy = KEYS.proxy();
    if (proxy) {
      try {
        const d = await fetchJSON(`${proxy}/news?q=${q}`);
        if (d.articles) articles = d.articles.map(mapArticle);
      } catch {}
    }
    if (!articles && KEYS.gn()) {
      try {
        const d = await fetchJSON(`https://gnews.io/api/v4/search?q=${q}&lang=de&max=6&token=${KEYS.gn()}`);
        if (d.articles) articles = d.articles.map(mapArticle);
      } catch {}
    }

    const result = articles || demoNews(symbol);
    if (articles) cache.set(ck, result, 15);
    return result;
  }

  function mapArticle(a) {
    return { title: a.title, description: a.description, url: a.url, source: a.source?.name || '–', publishedAt: a.publishedAt, timeAgo: timeAgo(a.publishedAt) };
  }

  // ── Sentiment ────────────────────────────────────────────────

  const POS = ['stark','gewinn','wachstum','stieg','rekord','positiv','bullish','übertrifft','kaufen','anstieg','erhöht','strong','beat','surge','gain','profit','growth','record','buy','upgrade','rise','rally','outperform'];
  const NEG = ['verlust','rückgang','sank','schwach','bearish','verkaufen','krise','risiko','enttäuscht','verfehlt','einbruch','loss','decline','fall','miss','weak','sell','downgrade','cut','crisis','crash','drop'];

  function analyzeSentiment(articles) {
    const scored = articles.map(a => {
      const text = ((a.title||'') + ' ' + (a.description||'')).toLowerCase();
      let p = 0, n = 0;
      POS.forEach(w => { if (text.includes(w)) p++; });
      NEG.forEach(w => { if (text.includes(w)) n++; });
      return { ...a, sentiment: p+n > 0 ? p/(p+n) : 0.5 };
    });
    return { articles: scored, overall: scored.length ? scored.reduce((a,b) => a+b.sentiment,0)/scored.length : 0.5 };
  }

  // ── Demo fallbacks ───────────────────────────────────────────

  const POPULAR = [
    {symbol:'AAPL',  name:'Apple Inc.'},{symbol:'MSFT', name:'Microsoft Corp.'},
    {symbol:'GOOGL', name:'Alphabet Inc.'},{symbol:'AMZN',name:'Amazon.com Inc.'},
    {symbol:'TSLA',  name:'Tesla Inc.'},{symbol:'NVDA', name:'NVIDIA Corp.'},
    {symbol:'META',  name:'Meta Platforms Inc.'},{symbol:'SAP', name:'SAP SE'},
    {symbol:'BAYN',  name:'Bayer AG'},{symbol:'BMW',  name:'BMW AG'},
    {symbol:'SIE',   name:'Siemens AG'},{symbol:'ALV', name:'Allianz SE'},
    {symbol:'VOW3',  name:'Volkswagen AG'},{symbol:'DTE',name:'Deutsche Telekom AG'},
    {symbol:'DBK',   name:'Deutsche Bank AG'},{symbol:'NFLX',name:'Netflix Inc.'},
    {symbol:'AMD',   name:'Advanced Micro Devices'},{symbol:'INTC',name:'Intel Corp.'},
  ];

  function demoSuggestions(q) {
    const qL = q.toLowerCase();
    return POPULAR.filter(s => s.symbol.toLowerCase().includes(qL) || s.name.toLowerCase().includes(qL)).slice(0,6);
  }

  function demoNews(symbol) {
    return [
      {title:`${symbol}: Quartalsergebnisse übertreffen Erwartungen`,description:'Umsatz und Gewinn lagen deutlich über den Analystenschätzungen.',url:'#',source:'Demo',publishedAt:new Date(Date.now()-2*3600000).toISOString(),timeAgo:'vor 2 Std.'},
      {title:`Analysten erhöhen Kursziel für ${symbol}`,description:'Mehrere Investmenthäuser passen Kurszielvorgaben nach oben an.',url:'#',source:'Demo',publishedAt:new Date(Date.now()-5*3600000).toISOString(),timeAgo:'vor 5 Std.'},
      {title:`${symbol} plant Expansion in neue Märkte`,description:'Management bestätigt strategische Investitionen für kommendes Geschäftsjahr.',url:'#',source:'Demo',publishedAt:new Date(Date.now()-9*3600000).toISOString(),timeAgo:'vor 9 Std.'},
      {title:`Makrodaten belasten Tech-Sektor – ${symbol} im Fokus`,description:'Zinsentwicklung und geopolitische Risiken sorgen für Unsicherheit.',url:'#',source:'Demo',publishedAt:new Date(Date.now()-14*3600000).toISOString(),timeAgo:'vor 14 Std.'},
      {title:`${symbol}: Langfristiger Wachstumstrend intakt`,description:'Trotz kurzfristiger Schwankungen bleibt das fundamentale Bild positiv.',url:'#',source:'Demo',publishedAt:new Date(Date.now()-26*3600000).toISOString(),timeAgo:'vor 1 Tag'},
    ];
  }

  return { KEYS, MARKET_SYMS, fetchHistory, fetchCandle, fetchQuote, fetchMarket, searchSymbol, fetchNews, analyzeSentiment, demoSuggestions };
})();
