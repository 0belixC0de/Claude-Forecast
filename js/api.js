/* ═══════════════════════════════════════════
   API-Integration – Alpha Vantage · Finnhub · GNews
   ═══════════════════════════════════════════ */

const API = (() => {

  // ── Key-Verwaltung ───────────────────────────────────────────

  const KEYS = {
    av:  () => localStorage.getItem('cf_av')  || '',
    fh:  () => localStorage.getItem('cf_fh')  || '',
    gn:  () => localStorage.getItem('cf_gn')  || '',
    save: (av, fh, gn) => {
      localStorage.setItem('cf_av', av.trim());
      localStorage.setItem('cf_fh', fh.trim());
      localStorage.setItem('cf_gn', gn.trim());
    },
    clear: () => { localStorage.removeItem('cf_av'); localStorage.removeItem('cf_fh'); localStorage.removeItem('cf_gn'); },
    hasAny: () => !!(localStorage.getItem('cf_av') || localStorage.getItem('cf_fh'))
  };

  // ── Simpler Cache (localStorage + TTL) ──────────────────────

  const cache = {
    set(key, data, ttlMin = 5) {
      localStorage.setItem('cf_cache_' + key, JSON.stringify({ data, exp: Date.now() + ttlMin * 60000 }));
    },
    get(key) {
      try {
        const raw = localStorage.getItem('cf_cache_' + key);
        if (!raw) return null;
        const { data, exp } = JSON.parse(raw);
        if (Date.now() > exp) { localStorage.removeItem('cf_cache_' + key); return null; }
        return data;
      } catch { return null; }
    }
  };

  // ── Hilfsfunktionen ──────────────────────────────────────────

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function formatTimeAgo(isoString) {
    const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
    if (diff < 60)   return 'gerade eben';
    if (diff < 3600) return `vor ${Math.round(diff / 60)} Min.`;
    if (diff < 86400) return `vor ${Math.round(diff / 3600)} Std.`;
    return `vor ${Math.round(diff / 86400)} Tagen`;
  }

  // ── Historische Kurse – Alpha Vantage ────────────────────────

  async function fetchHistory(symbol) {
    const key = KEYS.av();
    if (!key) return null;

    const cacheKey = `hist_${symbol}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const data = await fetchJSON(
        `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${key}`
      );

      const series = data['Time Series (Daily)'];
      if (!series) {
        console.warn('Alpha Vantage:', data['Note'] || data['Information'] || 'Kein Datensatz');
        return null;
      }

      const entries = Object.entries(series).slice(0, 120).reverse();
      const result = {
        dates:  entries.map(([d]) => d),
        prices: entries.map(([, v]) => parseFloat(v['4. close'])),
        highs:  entries.map(([, v]) => parseFloat(v['2. high'])),
        lows:   entries.map(([, v]) => parseFloat(v['3. low'])),
        volumes: entries.map(([, v]) => parseInt(v['5. volume']))
      };

      cache.set(cacheKey, result, 30); // 30-Minuten-Cache
      return result;
    } catch (e) {
      console.error('Alpha Vantage Fehler:', e);
      return null;
    }
  }

  // ── Live-Kurs – Finnhub ──────────────────────────────────────

  async function fetchQuote(symbol) {
    const key = KEYS.fh();
    if (!key) return null;

    try {
      const data = await fetchJSON(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`
      );

      if (!data.c) return null;
      return {
        price:         data.c,
        change:        data.d,
        changePercent: data.dp,
        high:          data.h,
        low:           data.l,
        open:          data.o,
        prevClose:     data.pc
      };
    } catch (e) {
      console.error('Finnhub Quote Fehler:', e);
      return null;
    }
  }

  // ── Aktiensuche – Finnhub ────────────────────────────────────

  async function searchSymbol(query) {
    const key = KEYS.fh();
    if (!key) return demoSuggestions(query);

    try {
      const data = await fetchJSON(
        `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${key}`
      );
      if (!data.result) return demoSuggestions(query);

      return data.result
        .filter(r => r.type === 'Common Stock' || r.type === 'EQS')
        .slice(0, 6)
        .map(r => ({ symbol: r.symbol, name: r.description, type: r.type }));
    } catch (e) {
      console.error('Suche Fehler:', e);
      return demoSuggestions(query);
    }
  }

  // ── Nachrichten – GNews ──────────────────────────────────────

  async function fetchNews(symbol, companyName) {
    const key = KEYS.gn();
    if (!key) return demoNews(symbol);

    const cacheKey = `news_${symbol}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
      const query = encodeURIComponent(`${companyName || symbol} Aktie`);
      const data  = await fetchJSON(
        `https://gnews.io/api/v4/search?q=${query}&lang=de&max=6&token=${key}`
      );

      if (!data.articles) return demoNews(symbol);

      const articles = data.articles.map(a => ({
        title:       a.title,
        description: a.description,
        url:         a.url,
        source:      a.source?.name || 'Unbekannt',
        publishedAt: a.publishedAt,
        timeAgo:     formatTimeAgo(a.publishedAt)
      }));

      cache.set(cacheKey, articles, 15);
      return articles;
    } catch (e) {
      console.error('GNews Fehler:', e);
      return demoNews(symbol);
    }
  }

  // ── Sentiment-Analyse ────────────────────────────────────────
  //
  // Einfache keyword-basierte Analyse – zählt positive/negative Wörter
  // in Titel + Beschreibung und gibt einen Score 0..1 zurück.

  const POS_WORDS = [
    'stark', 'gewinn', 'wachstum', 'stieg', 'rekord', 'positiv', 'bullish',
    'übertrifft', 'kaufen', 'anstieg', 'erhöht', 'übertraf', 'zugelegt',
    'strong', 'beat', 'surge', 'gain', 'profit', 'growth', 'record',
    'buy', 'upgrade', 'rise', 'rally', 'boom', 'outperform', 'optimistisch'
  ];

  const NEG_WORDS = [
    'verlust', 'rückgang', 'sank', 'schwach', 'bearish', 'verkaufen',
    'krise', 'risiko', 'enttäuscht', 'verfehlt', 'einbruch', 'warnung',
    'loss', 'decline', 'fall', 'miss', 'weak', 'sell', 'downgrade',
    'cut', 'crisis', 'crash', 'drop', 'risk', 'concern', 'warning'
  ];

  function analyzeSentiment(articles) {
    const scored = articles.map(article => {
      const text = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();
      let pos = 0, neg = 0;
      POS_WORDS.forEach(w => { if (text.includes(w)) pos++; });
      NEG_WORDS.forEach(w => { if (text.includes(w)) neg++; });

      let score = 0.5;
      if (pos + neg > 0) score = pos / (pos + neg);
      return { ...article, sentiment: score };
    });

    const overall = scored.length > 0
      ? scored.reduce((a, b) => a + b.sentiment, 0) / scored.length
      : 0.5;

    return { articles: scored, overall };
  }

  // ── Demo-Fallbacks ───────────────────────────────────────────

  const POPULAR = [
    { symbol: 'AAPL',  name: 'Apple Inc.' },
    { symbol: 'MSFT',  name: 'Microsoft Corp.' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.' },
    { symbol: 'AMZN',  name: 'Amazon.com Inc.' },
    { symbol: 'TSLA',  name: 'Tesla Inc.' },
    { symbol: 'NVDA',  name: 'NVIDIA Corp.' },
    { symbol: 'META',  name: 'Meta Platforms Inc.' },
    { symbol: 'SAP',   name: 'SAP SE' },
    { symbol: 'BAYN',  name: 'Bayer AG' },
    { symbol: 'BMW',   name: 'Bayerische Motoren Werke AG' },
    { symbol: 'SIE',   name: 'Siemens AG' },
    { symbol: 'ALV',   name: 'Allianz SE' },
    { symbol: 'VOW3',  name: 'Volkswagen AG' },
    { symbol: 'DTE',   name: 'Deutsche Telekom AG' },
    { symbol: 'DBK',   name: 'Deutsche Bank AG' },
    { symbol: 'BAS',   name: 'BASF SE' },
    { symbol: 'AMZN',  name: 'Amazon.com Inc.' },
    { symbol: 'NFLX',  name: 'Netflix Inc.' },
    { symbol: 'AMD',   name: 'Advanced Micro Devices' },
  ];

  function demoSuggestions(query) {
    const q = query.toLowerCase();
    return POPULAR.filter(s =>
      s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    ).slice(0, 6);
  }

  function demoNews(symbol) {
    const items = [
      { title: `${symbol}: Quartalsergebnisse übertreffen Markterwartungen`, hours: 2, desc: 'Umsatz und Gewinn lagen über den Analystenschätzungen. Aktie reagiert vorbörslich positiv.' },
      { title: `Analysten erhöhen Kursziel für ${symbol} auf neuen Wert`, hours: 5, desc: 'Nach starken Zahlen korrigieren mehrere Banken ihre Kurszielvorgaben nach oben.' },
      { title: `${symbol}: Expansion in neue Märkte geplant`, hours: 9, desc: 'Das Management bestätigte Pläne für strategische Wachstumsinvestitionen.' },
      { title: `Wirtschaftsdaten belasten Tech-Sektor – ${symbol} im Fokus`, hours: 14, desc: 'Höhere Zinsen und geopolitische Unsicherheiten drücken auf die Stimmung.' },
      { title: `${symbol}: Langfristiger Wachstumstrend laut Experten intakt`, hours: 26, desc: 'Trotz kurzfristiger Schwankungen bleibt das fundamentale Bild positiv.' },
      { title: `Marktausblick: Wie positionieren sich Fonds bei ${symbol}?`, hours: 36, desc: 'Institutionelle Anleger erhöhten zuletzt ihre Positionen.' },
    ];

    return items.map((it, i) => ({
      title:       it.title,
      description: it.desc,
      url:         '#',
      source:      'Demo News',
      publishedAt: new Date(Date.now() - it.hours * 3600000).toISOString(),
      timeAgo:     formatTimeAgo(new Date(Date.now() - it.hours * 3600000).toISOString())
    }));
  }

  return { KEYS, fetchHistory, fetchQuote, searchSymbol, fetchNews, analyzeSentiment, demoSuggestions };
})();
