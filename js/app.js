/* ═══════════════════════════════════════════
   App Controller – UI-Orchestrierung
   ═══════════════════════════════════════════ */

const App = (() => {

  // ── Anwendungszustand ────────────────────────────────────────

  const state = {
    symbol:      'AAPL',
    name:        'Apple Inc.',
    exchange:    'NASDAQ',
    sector:      'Technologie',
    allDates:    [],
    allPrices:   [],
    period:      '1M',
    forecast:    null,
    chart:       null,
    refreshTimer: null,
    lastPrice:   null
  };

  // ── Initialisierung ──────────────────────────────────────────

  async function init() {
    bindUI();
    loadModalKeys();
    updateDemoBanner();
    initChart();
    await loadStock(state.symbol, state.name, state.exchange, state.sector);
    startAutoRefresh();
  }

  // ── Event-Binding ────────────────────────────────────────────

  function bindUI() {
    // Search
    document.getElementById('searchBtn').addEventListener('click', handleSearch);
    document.getElementById('stockSearch').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleSearch();
    });
    document.getElementById('stockSearch').addEventListener('input', debounce(handleSuggest, 280));
    document.addEventListener('click', e => {
      if (!e.target.closest('.search-wrapper')) hideSuggestions();
    });

    // Period tabs
    document.getElementById('periodTabs').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      state.period = btn.dataset.period;
      updateChart();
    });

    // Settings modal
    document.getElementById('settingsBtn').addEventListener('click', openModal);
    document.getElementById('openSetup').addEventListener('click', e => { e.preventDefault(); openModal(); });
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('settingsModal').addEventListener('click', e => {
      if (e.target === document.getElementById('settingsModal')) closeModal();
    });
    document.getElementById('saveKeys').addEventListener('click', saveKeys);
    document.getElementById('clearKeys').addEventListener('click', clearKeys);
  }

  // ── Haupt-Datenladevorgang ───────────────────────────────────

  async function loadStock(symbol, name, exchange = '', sector = '') {
    showLoading(`Kursdaten für ${symbol} werden geladen…`);

    try {
      // 1. Historische Daten abrufen (Alpha Vantage → Demo-Fallback)
      let histData = await API.fetchHistory(symbol);
      const isDemo = !histData;

      if (isDemo) {
        const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const startPrice = seed % 300 + 50;
        histData = Forecast.demoData(120, startPrice, seed);
      }

      state.allDates  = histData.dates;
      state.allPrices = histData.prices;
      state.symbol    = symbol;
      state.name      = name;
      state.exchange  = exchange;
      state.sector    = sector;

      // 2. Live-Kurs abrufen (Finnhub → Demo-Fallback)
      const quote = await API.fetchQuote(symbol);
      const livePrice = quote?.price ?? state.allPrices[state.allPrices.length - 1];
      const liveChange       = quote?.change ?? (livePrice - state.allPrices[state.allPrices.length - 2]);
      const liveChangePercent = quote?.changePercent ?? (liveChange / state.allPrices[state.allPrices.length - 2] * 100);

      // 3. Nachrichten + Sentiment
      const rawNews = await API.fetchNews(symbol, name);
      const { articles, overall } = API.analyzeSentiment(rawNews);

      // 4. Prognose berechnen
      const prices4cast = [...state.allPrices];
      // letzten Kurs ggf. durch Live-Kurs ersetzen
      if (quote?.price) prices4cast[prices4cast.length - 1] = quote.price;
      state.forecast = Forecast.generate(prices4cast, overall, 7);

      // 5. UI aktualisieren
      updateHeader(name, symbol, exchange, sector);
      updatePrice(livePrice, liveChange, liveChangePercent);
      updateChart();
      updateIndicators(prices4cast);
      updateForecastCard(state.forecast, livePrice);
      updateNews(articles, overall);
      updateDemoBanner();
    } catch (err) {
      console.error('loadStock Fehler:', err);
    }

    hideLoading();
  }

  // ── Chart-Initialisierung ────────────────────────────────────

  function initChart() {
    const ctx = document.getElementById('stockChart').getContext('2d');

    Chart.defaults.color = '#6b7280';

    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Kurs',
            data: [],
            borderColor: '#06b6d4',
            backgroundColor: ctx => {
              const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
              g.addColorStop(0,   'rgba(6,182,212,.18)');
              g.addColorStop(1,   'rgba(6,182,212,0)');
              return g;
            },
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#06b6d4'
          },
          {
            label: 'SMA 20',
            data: [],
            borderColor: '#f59e0b',
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.35
          },
          {
            label: 'SMA 50',
            data: [],
            borderColor: '#8b5cf6',
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.35
          },
          {
            label: 'Prognose',
            data: [],
            borderColor: '#38bdf8',
            borderDash: [8, 5],
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: '#38bdf8',
            pointBorderColor: '#060c1a',
            pointBorderWidth: 1.5,
            fill: false,
            tension: 0.3,
            spanGaps: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: { duration: 600, easing: 'easeInOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a2540',
            borderColor: '#243349',
            borderWidth: 1,
            titleColor: '#e5e7eb',
            bodyColor: '#9ca3af',
            padding: 12,
            callbacks: {
              label: ctx => {
                if (ctx.raw === null) return null;
                const prefix = ctx.dataset.label === 'Prognose' ? '◇ ' : '';
                return `${prefix}${ctx.dataset.label}: $${Number(ctx.raw).toFixed(2)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: '#1e2d45', drawBorder: false },
            ticks: {
              color: '#4b5563',
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8,
              font: { size: 11 }
            }
          },
          y: {
            position: 'right',
            grid: { color: '#1e2d45', drawBorder: false },
            ticks: {
              color: '#4b5563',
              font: { size: 11 },
              callback: v => `$${v.toFixed(0)}`
            }
          }
        }
      }
    });
  }

  // ── Chart befüllen ───────────────────────────────────────────

  function updateChart() {
    if (!state.chart || !state.allPrices.length) return;

    // Zeitraum filtern
    const periodDays = { '1M': 22, '3M': 66, '6M': 132, '1Y': 999 };
    const limit = periodDays[state.period] || 22;
    const sliceLen = Math.min(limit, state.allDates.length);
    const dates  = state.allDates.slice(-sliceLen);
    const prices = state.allPrices.slice(-sliceLen);

    // Indikatoren über alle Preise berechnen, dann auf Zeitraum kürzen
    const sma20Full = Forecast.sma(state.allPrices, 20).slice(-sliceLen);
    const sma50Full = Forecast.sma(state.allPrices, 50).slice(-sliceLen);

    // Prognose-Labels (nächste 7 Handelstage nach dem letzten Datum)
    const forecastLabels = [];
    const lastDate = new Date(dates[dates.length - 1]);
    for (let d = 0; forecastLabels.length < 7; ) {
      d++;
      const nd = new Date(lastDate);
      nd.setDate(nd.getDate() + d);
      if (nd.getDay() === 0 || nd.getDay() === 6) continue;
      forecastLabels.push(nd.toISOString().split('T')[0]);
    }

    // Forecast-Datenpunkte: erstes Element = letzter echter Kurs (Verbindungspunkt)
    const fPrices = state.forecast?.forecastPrices ?? [];
    const forecastData = [
      ...new Array(sliceLen - 1).fill(null),
      prices[prices.length - 1],
      ...fPrices
    ];

    const allLabels = [...dates, ...forecastLabels];

    // Chart-Daten setzen
    state.chart.data.labels   = allLabels;
    state.chart.data.datasets[0].data = [...prices, ...new Array(forecastLabels.length).fill(null)];
    state.chart.data.datasets[1].data = [...sma20Full, ...new Array(forecastLabels.length).fill(null)];
    state.chart.data.datasets[2].data = [...sma50Full, ...new Array(forecastLabels.length).fill(null)];
    state.chart.data.datasets[3].data = forecastData;

    state.chart.update('active');
  }

  // ── Header & Preisanzeige ────────────────────────────────────

  function updateHeader(name, symbol, exchange, sector) {
    document.getElementById('stockName').textContent    = name;
    document.getElementById('stockSymbol').textContent  = symbol;
    document.getElementById('stockExchange').textContent = exchange || '–';
    document.getElementById('stockSector').textContent  = sector   || '–';
    document.title = `${symbol} – Claude Forecast`;
  }

  function updatePrice(price, change, changePct) {
    const priceEl  = document.getElementById('currentPrice');
    const changeEl = document.getElementById('priceChange');
    const timeEl   = document.getElementById('lastUpdated');

    const prev = state.lastPrice;
    state.lastPrice = price;

    priceEl.textContent = `$${price.toFixed(2)}`;

    const up = change >= 0;
    changeEl.textContent = `${up ? '▲' : '▼'} $${Math.abs(change).toFixed(2)}  ${up ? '+' : ''}${changePct.toFixed(2)}%`;
    changeEl.className = 'price-change ' + (up ? 'positive' : 'negative');

    if (prev !== null && prev !== price) {
      priceEl.classList.remove('price-flash-up', 'price-flash-down');
      void priceEl.offsetWidth; // reflow to restart animation
      priceEl.classList.add(price > prev ? 'price-flash-up' : 'price-flash-down');
    }

    timeEl.textContent = 'Aktualisiert: ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ── Technische Indikatoren ───────────────────────────────────

  function updateIndicators(prices) {
    const rsiVal  = Forecast.rsi(prices);
    const macdVal = Forecast.macd(prices);
    const bb      = Forecast.bollingerBands(prices);
    const vol     = Forecast.volatility(prices.slice(-30));
    const sma20   = Forecast.sma(prices, 20);
    const sma50   = Forecast.sma(prices, 50);
    const last    = prices[prices.length - 1];

    // RSI
    if (rsiVal !== null) {
      document.getElementById('rsiValue').textContent = rsiVal.toFixed(1);
      const fill = document.getElementById('rsiFill');
      // Position des Indikators als left-Offset in % (nicht die Breite)
      fill.style.left = `calc(${rsiVal.toFixed(1)}% - 2px)`;
      fill.style.width = '4px';
      const rsiLbl = document.getElementById('rsiLabel');
      if (rsiVal > 70) { rsiLbl.textContent = 'Überkauft – Vorsicht'; rsiLbl.className = 'ind-label negative'; }
      else if (rsiVal < 30) { rsiLbl.textContent = 'Überverkauft – Kaufchance'; rsiLbl.className = 'ind-label positive'; }
      else { rsiLbl.textContent = 'Neutral'; rsiLbl.className = 'ind-label neutral'; }
    }

    // MACD
    if (macdVal) {
      document.getElementById('macdValue').textContent = (macdVal.macd >= 0 ? '+' : '') + macdVal.macd.toFixed(2);
      const macdLbl = document.getElementById('macdLabel');
      macdLbl.textContent = macdVal.bullish ? 'Bullish – Signal überschritten' : 'Bearish – unter Signal-Linie';
      macdLbl.className   = 'ind-label ' + (macdVal.bullish ? 'positive' : 'negative');
    }

    // SMA 20
    const s20 = sma20[sma20.length - 1];
    if (s20) {
      document.getElementById('sma20Value').textContent = `$${s20.toFixed(2)}`;
      const above = last > s20;
      document.getElementById('sma20Label').textContent = above ? 'Kurs über SMA ▲' : 'Kurs unter SMA ▼';
      document.getElementById('sma20Label').className   = 'ind-label ' + (above ? 'positive' : 'negative');
    }

    // SMA 50
    const s50 = sma50[sma50.length - 1];
    if (s50) {
      document.getElementById('sma50Value').textContent = `$${s50.toFixed(2)}`;
      const above = last > s50;
      document.getElementById('sma50Label').textContent = above ? 'Kurs über SMA ▲' : 'Kurs unter SMA ▼';
      document.getElementById('sma50Label').className   = 'ind-label ' + (above ? 'positive' : 'negative');
    }

    // Bollinger Bands
    if (bb) {
      let pos, cls;
      if (bb.position > 0.85)      { pos = 'Oberes Band – überkauft'; cls = 'negative'; }
      else if (bb.position < 0.15) { pos = 'Unteres Band – überverkauft'; cls = 'positive'; }
      else                         { pos = 'Mittleres Band'; cls = 'neutral'; }
      document.getElementById('bbValue').textContent  = pos;
      document.getElementById('bbLabel').textContent  = `Breite: ${bb.bandwidth.toFixed(1)}%`;
      document.getElementById('bbLabel').className    = 'ind-label ' + cls;
    }

    // Volatilität
    const volStr = vol.toFixed(1) + '%';
    document.getElementById('volValue').textContent = volStr;
    const volLbl = document.getElementById('volLabel');
    if (vol < 15)      { volLbl.textContent = 'Niedrig'; volLbl.className = 'ind-label positive'; }
    else if (vol < 30) { volLbl.textContent = 'Moderat'; volLbl.className = 'ind-label neutral'; }
    else               { volLbl.textContent = 'Hoch';    volLbl.className = 'ind-label negative'; }
  }

  // ── Prognose-Karte ───────────────────────────────────────────

  function updateForecastCard(fc, livePrice) {
    if (!fc) return;

    // Empfehlung
    const recEl = document.getElementById('recValue');
    recEl.textContent = fc.recommendation;
    recEl.className   = 'rec-value ' + (fc.recommendation === 'KAUFEN' ? 'buy' : fc.recommendation === 'VERKAUFEN' ? 'sell' : 'hold');

    // Kursziel
    document.getElementById('targetPrice').textContent = `$${fc.targetPrice.toFixed(2)}`;
    const deltaEl = document.getElementById('targetDelta');
    const up = fc.totalReturn >= 0;
    deltaEl.textContent  = `${up ? '▲' : '▼'} ${up ? '+' : ''}${fc.totalReturn.toFixed(2)}%`;
    deltaEl.className    = 'target-delta ' + (up ? 'positive' : 'negative');

    // Konfidenz
    document.getElementById('confPct').textContent    = `${fc.confidence}%`;
    document.getElementById('confFill').style.width   = `${fc.confidence}%`;

    // Faktoren
    setFactor('facReg',   fc.factors.regression);
    setFactor('facTrend', fc.factors.trend);
    setFactor('facMom',   fc.factors.momentum);
    setFactor('facSent',  fc.factors.sentiment);
  }

  function setFactor(id, pct) {
    const bar   = document.getElementById(id + 'Bar');
    const score = document.getElementById(id + 'Score');
    if (bar)   bar.style.width  = `${pct}%`;
    if (score) score.textContent = `${pct}%`;
    const color = pct >= 60 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
    if (bar) bar.style.background = color;
  }

  // ── Nachrichten ──────────────────────────────────────────────

  function updateNews(articles, overall) {
    const list    = document.getElementById('newsList');
    const badgeEl = document.getElementById('sentimentBadge');

    // Gesamtsentiment-Badge
    let emoji, label, color;
    if (overall > 0.6)      { emoji = '😊'; label = 'Positiv';  color = '#10b981'; }
    else if (overall < 0.4) { emoji = '😟'; label = 'Negativ';  color = '#ef4444'; }
    else                    { emoji = '😐'; label = 'Neutral';  color = '#f59e0b'; }
    badgeEl.textContent = `${emoji} ${label}`;
    badgeEl.style.color = color;
    badgeEl.style.borderColor = color + '44';

    list.innerHTML = articles.map(a => {
      const sentClass = a.sentiment > 0.6 ? 'positive' : a.sentiment < 0.4 ? 'negative' : 'neutral';
      const target    = a.url !== '#' ? ' target="_blank" rel="noopener"' : '';
      return `
        <a class="news-item" href="${escapeAttr(a.url)}"${target}>
          <div class="news-top">
            <span class="news-dot ${sentClass}"></span>
            <span class="news-title">${escapeHtml(a.title)}</span>
          </div>
          <div class="news-meta">
            <span>${escapeHtml(a.source)}</span>
            <span>·</span>
            <span>${escapeHtml(a.timeAgo)}</span>
          </div>
        </a>`;
    }).join('');
  }

  // ── Suche ────────────────────────────────────────────────────

  function handleSearch() {
    const val = document.getElementById('stockSearch').value.trim().toUpperCase();
    if (!val) return;
    hideSuggestions();
    loadStock(val, val);
  }

  async function handleSuggest() {
    const val = document.getElementById('stockSearch').value.trim();
    if (val.length < 1) { hideSuggestions(); return; }

    const results = API.KEYS.hasAny()
      ? await API.searchSymbol(val)
      : API.demoSuggestions(val);

    if (!results.length) { hideSuggestions(); return; }

    const box = document.getElementById('suggestions');
    box.innerHTML = results.map(r => `
      <div class="sug-item" data-symbol="${escapeAttr(r.symbol)}" data-name="${escapeAttr(r.name)}">
        <span class="sug-symbol">${escapeHtml(r.symbol)}</span>
        <span class="sug-name">${escapeHtml(r.name)}</span>
      </div>`).join('');

    box.querySelectorAll('.sug-item').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('stockSearch').value = el.dataset.symbol;
        hideSuggestions();
        loadStock(el.dataset.symbol, el.dataset.name);
      });
    });

    box.hidden = false;
  }

  function hideSuggestions() {
    document.getElementById('suggestions').hidden = true;
  }

  // ── Auto-Refresh ─────────────────────────────────────────────

  function startAutoRefresh() {
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(async () => {
      const quote = await API.fetchQuote(state.symbol);
      if (quote) {
        updatePrice(quote.price, quote.change, quote.changePercent);
        // Letzten Preis im Array aktualisieren und Chart refreshen
        if (state.allPrices.length) {
          state.allPrices[state.allPrices.length - 1] = quote.price;
          updateChart();
        }
      }
    }, 60000); // jede Minute
  }

  // ── Einstellungen / Modal ─────────────────────────────────────

  function openModal() {
    document.getElementById('settingsModal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    document.getElementById('settingsModal').hidden = true;
    document.body.style.overflow = '';
  }
  function loadModalKeys() {
    document.getElementById('avKey').value = API.KEYS.av();
    document.getElementById('fhKey').value = API.KEYS.fh();
    document.getElementById('gnKey').value = API.KEYS.gn();
  }
  function saveKeys() {
    API.KEYS.save(
      document.getElementById('avKey').value,
      document.getElementById('fhKey').value,
      document.getElementById('gnKey').value
    );
    closeModal();
    updateDemoBanner();
    loadStock(state.symbol, state.name, state.exchange, state.sector);
  }
  function clearKeys() {
    API.KEYS.clear();
    loadModalKeys();
    updateDemoBanner();
  }

  function updateDemoBanner() {
    const banner = document.getElementById('demoBanner');
    if (API.KEYS.hasAny()) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
    }
  }

  // ── Loading-Overlay ───────────────────────────────────────────

  function showLoading(text = 'Laden…') {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').hidden = false;
  }
  function hideLoading() {
    document.getElementById('loadingOverlay').hidden = true;
  }

  // ── Hilfsfunktionen ──────────────────────────────────────────

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) {
    return String(s ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { init };
})();

// Starten, sobald das DOM bereit ist
document.addEventListener('DOMContentLoaded', App.init);
