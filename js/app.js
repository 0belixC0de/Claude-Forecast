/* ═══════════════════════════════════════════
   App Controller
   ═══════════════════════════════════════════ */

const App = (() => {

  // ── State ────────────────────────────────────────────────────

  const S = {
    symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', sector: 'Technology',
    allDates: [], allPrices: [], allOpens: [], allHighs: [], allLows: [],
    period: '1M', chartType: 'line', forecastDays: 7,
    lang: localStorage.getItem('cf_lang') || 'de',
    forecast: null, chart: null, refreshTimer: null, lastPrice: null,
    isOwner: false
  };

  // ── i18n ─────────────────────────────────────────────────────

  function t(key) { return LANG[S.lang]?.[key] || LANG.de[key] || key; }

  function applyLang() {
    document.documentElement.lang = S.lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    document.getElementById('langToggle').textContent = S.lang === 'de' ? 'EN' : 'DE';
  }

  // ── Watchlist ────────────────────────────────────────────────

  const WL = {
    _key: () => `cf_wl_${Auth.username() || '_guest'}`,
    get: () => { try { return JSON.parse(localStorage.getItem(WL._key()) || '[]'); } catch { return []; } },
    has: sym => WL.get().some(s => s.symbol === sym),
    add(sym, name) {
      const list = WL.get();
      if (!list.find(s => s.symbol === sym)) { list.push({ symbol: sym, name }); localStorage.setItem(WL._key(), JSON.stringify(list)); }
    },
    remove(sym) { localStorage.setItem(WL._key(), JSON.stringify(WL.get().filter(s => s.symbol !== sym))); }
  };

  // ── Auth / Login ──────────────────────────────────────────────

  function showLoginScreen() {
    const el = document.getElementById('loginScreen');
    el.removeAttribute('hidden');
    requestAnimationFrame(() => el.classList.add('visible'));
  }

  function hideLoginScreen() {
    const el = document.getElementById('loginScreen');
    el.classList.remove('visible');
    setTimeout(() => { el.hidden = true; }, 250);
  }

  function bindAuth() {
    // Tab switching
    document.getElementById('loginTabs').addEventListener('click', e => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      document.querySelectorAll('.login-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab.dataset.tab));
      document.getElementById('authLogin').hidden    = tab.dataset.tab !== 'login';
      document.getElementById('authRegister').hidden = tab.dataset.tab !== 'register';
    });

    // Login
    async function doLogin() {
      const user = document.getElementById('loginUser').value.trim();
      const pass = document.getElementById('loginPass').value;
      const err  = document.getElementById('loginError');
      err.hidden = true;
      if (!user || !pass) { err.textContent = 'Bitte alle Felder ausfüllen'; err.hidden = false; return; }
      const res = await Auth.login(user, pass);
      if (res.ok) { S.isOwner = false; hideLoginScreen(); applyOwnerMode(); updateDemoBanner(); setTimeout(() => { if (S.chart) { S.chart.resize(); updateChart(); } }, 300); }
      else { err.textContent = res.msg; err.hidden = false; }
    }
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    ['loginUser','loginPass'].forEach(id =>
      document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); })
    );

    // Register
    async function doRegister() {
      const user  = document.getElementById('regUser').value.trim();
      const pass  = document.getElementById('regPass').value;
      const pass2 = document.getElementById('regPass2').value;
      const err   = document.getElementById('regError');
      err.hidden = true;
      if (!user || !pass || !pass2) { err.textContent = 'Bitte alle Felder ausfüllen'; err.hidden = false; return; }
      if (pass !== pass2) { err.textContent = 'Passwörter stimmen nicht überein'; err.hidden = false; return; }
      const res = await Auth.register(user, pass);
      if (res.ok) { S.isOwner = false; hideLoginScreen(); applyOwnerMode(); updateDemoBanner(); setTimeout(() => { if (S.chart) { S.chart.resize(); updateChart(); } }, 300); }
      else { err.textContent = res.msg; err.hidden = false; }
    }
    document.getElementById('registerBtn').addEventListener('click', doRegister);

    // Admin toggle
    document.getElementById('adminToggle').addEventListener('click', () => {
      const form = document.getElementById('adminForm');
      form.hidden = !form.hidden;
      const hint = document.getElementById('adminHint');
      const hasSetup = !!localStorage.getItem('cf_admin_hash');
      hint.textContent = hasSetup ? '' : 'Erstes Mal: Lege hier dein Admin-Passwort fest.';
      hint.hidden = hasSetup;
    });

    // Admin login
    async function doAdminLogin() {
      const pass = document.getElementById('adminPass').value;
      const err  = document.getElementById('adminError');
      err.hidden = true;
      if (!pass) { err.textContent = 'Passwort eingeben'; err.hidden = false; return; }
      const res = await Auth.loginAdmin(pass);
      if (res.ok) { S.isOwner = true; hideLoginScreen(); applyOwnerMode(); updateDemoBanner(); setTimeout(() => { if (S.chart) { S.chart.resize(); updateChart(); } }, 300); }
      else { err.textContent = res.msg; err.hidden = false; }
    }
    document.getElementById('adminLoginBtn').addEventListener('click', doAdminLogin);
    document.getElementById('adminPass').addEventListener('keydown', e => { if (e.key === 'Enter') doAdminLogin(); });
  }

  // ── Init ─────────────────────────────────────────────────────

  async function init() {
    // App always boots in the background
    S.isOwner = Auth.isLoggedIn() ? Auth.isAdmin() : false;
    applyLang();
    initChart();
    bindUI();
    loadModalKeys();
    updateDemoBanner();
    loadMarketBar();
    renderWatchlist();
    loadStock(S.symbol, S.name, S.exchange, S.sector);
    startAutoRefresh();

    if (!Auth.isLoggedIn()) {
      showLoginScreen();
      bindAuth();
    } else {
      applyOwnerMode();
    }
  }

  // ── Events ───────────────────────────────────────────────────

  function applyOwnerMode() {
    document.getElementById('settingsBtn').hidden = !S.isOwner;
    // User badge
    const badge = document.getElementById('userBadge');
    const name  = Auth.username();
    if (name) {
      badge.textContent = S.isOwner ? `👑 ${name}` : name;
      badge.className   = 'user-badge' + (S.isOwner ? ' admin-badge' : '');
      badge.hidden      = false;
    }
    document.getElementById('logoutBtn').hidden = false;
  }

  function bindUI() {
    // Search
    document.getElementById('searchBtn').addEventListener('click', doSearch);
    document.getElementById('stockSearch').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    document.getElementById('stockSearch').addEventListener('input', debounce(doSuggest, 280));
    document.addEventListener('click', e => { if (!e.target.closest('.search-wrapper')) hideSug(); });

    // Language
    document.getElementById('langToggle').addEventListener('click', () => {
      S.lang = S.lang === 'de' ? 'en' : 'de';
      localStorage.setItem('cf_lang', S.lang);
      applyLang();
      updateDemoBanner();
    });

    // Chart type
    document.getElementById('chartTypeToggle').addEventListener('click', e => {
      const btn = e.target.closest('.type-btn');
      if (!btn) return;
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.chartType = btn.dataset.type;
      rebuildChart();
      updateChart();
    });

    // Period
    document.getElementById('periodTabs').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.period = btn.dataset.period;
      updateChart();
    });

    // Forecast period
    document.getElementById('fcPeriodTabs').addEventListener('click', e => {
      const btn = e.target.closest('.fc-tab');
      if (!btn) return;
      document.querySelectorAll('.fc-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.forecastDays = parseInt(btn.dataset.days);
      if (S.allPrices.length) {
        S.forecast = Forecast.generate(S.allPrices, S.forecast?.sentimentScore ?? 0.5, S.forecastDays);
        updateForecastCard(S.forecast);
        updateChart();
      }
    });

    // Watchlist toggle button
    document.getElementById('watchlistToggleBtn').addEventListener('click', () => {
      if (WL.has(S.symbol)) { WL.remove(S.symbol); } else { WL.add(S.symbol, S.name); }
      updateWatchlistBtn();
      renderWatchlist();
    });

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', openModal);
    document.getElementById('openSetup').addEventListener('click', e => { e.preventDefault(); openModal(); });
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('settingsModal').addEventListener('click', e => { if (e.target === document.getElementById('settingsModal')) closeModal(); });
    document.getElementById('saveKeys').addEventListener('click', saveKeys);
    document.getElementById('clearKeys').addEventListener('click', clearKeys);

    // Admin password change
    document.getElementById('changeAdminPassBtn').addEventListener('click', async () => {
      const pw  = document.getElementById('newAdminPass').value;
      const msg = document.getElementById('adminPassMsg');
      const res = await Auth.changeAdminPassword(pw);
      msg.textContent = res.ok ? '✓ Passwort gespeichert' : res.msg;
      msg.style.color = res.ok ? 'var(--accent)' : '#f87171';
      msg.hidden = false;
      if (res.ok) { document.getElementById('newAdminPass').value = ''; setTimeout(() => { msg.hidden = true; }, 2500); }
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
      Auth.clearSession();
      location.reload();
    });
  }

  // ── Load stock ───────────────────────────────────────────────

  async function loadStock(symbol, name, exchange = '', sector = '') {
    showLoading(t('loading'));
    try {
      let hist = await API.fetchHistory(symbol);
      if (!hist) {
        const seed = symbol.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
        hist = Forecast.demoData(120, seed % 300 + 50, seed);
      }

      S.symbol   = symbol;
      S.name     = name;
      S.exchange = exchange;
      S.sector   = sector;
      S.allDates  = hist.dates;
      S.allPrices = hist.prices;
      S.allOpens  = hist.opens  || hist.prices;
      S.allHighs  = hist.highs  || hist.prices;
      S.allLows   = hist.lows   || hist.prices;

      const quote = await API.fetchQuote(symbol);
      const price = quote?.price ?? S.allPrices[S.allPrices.length - 1];
      const chg   = quote?.change ?? (price - S.allPrices[S.allPrices.length - 2]);
      const chgPct = quote?.changePercent ?? (chg / S.allPrices[S.allPrices.length - 2] * 100);

      const rawNews = await API.fetchNews(symbol, name);
      const { articles, overall } = API.analyzeSentiment(rawNews);

      const p4c = [...S.allPrices];
      if (quote?.price) p4c[p4c.length - 1] = quote.price;
      S.forecast = Forecast.generate(p4c, overall, S.forecastDays);
      if (S.forecast) S.forecast.sentimentScore = overall;

      document.title = `${symbol} – Claude Forecast`;
      updateHeader(name, symbol, exchange, sector);
      updatePrice(price, chg, chgPct);
      updateWatchlistBtn();
      rebuildChart();
      updateChart();
      updateIndicators(p4c);
      updateForecastCard(S.forecast);
      updateNews(articles, overall);
      updateDemoBanner();
    } catch (e) { console.error('loadStock:', e); }
    hideLoading();
  }

  // ── Chart ────────────────────────────────────────────────────

  function rebuildChart() {
    if (S.chart) { S.chart.destroy(); S.chart = null; }
    initChart();
  }

  function initChart() {
    const ctx = document.getElementById('stockChart').getContext('2d');
    const isCandle = S.chartType === 'candlestick';

    if (isCandle) {
      S.chart = new Chart(ctx, {
        type: 'candlestick',
        data: { datasets: [{
          label: t('leg_price'),
          data: [],
          color: { up: '#4ade80', down: '#f87171', unchanged: '#9b9188' }
        }]},
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: { duration: 400 },
          plugins: { legend: { display: false }, tooltip: { ...tooltipStyle() } },
          scales: {
            x: { type: 'time', time: { unit: 'day', tooltipFormat: 'dd.MM.yyyy' }, grid: { color: '#403c33' }, ticks: { color: '#6b6560', font: { size: 11 }, maxTicksLimit: 8 } },
            y: { position: 'right', grid: { color: '#403c33' }, ticks: { color: '#6b6560', font: { size: 11 }, callback: v => `$${v.toFixed(0)}` } }
          }
        }
      });
    } else {
      const grad = ctx => {
        const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
        g.addColorStop(0, 'rgba(212,136,74,.18)');
        g.addColorStop(1, 'rgba(212,136,74,0)');
        return g;
      };
      S.chart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [
          { label: t('leg_price'),    data: [], borderColor: '#d4884a', backgroundColor: grad, fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
          { label: t('leg_sma20'),   data: [], borderColor: '#c8a060', borderDash: [6,4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.35 },
          { label: t('leg_sma50'),   data: [], borderColor: '#8b7aaf', borderDash: [6,4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.35 },
          { label: t('leg_forecast'), data: [], borderColor: '#d4884a', borderDash: [4,4], borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#d4884a', pointBorderColor: '#1c1917', pointBorderWidth: 1.5, fill: false, tension: 0.3, spanGaps: false },
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          animation: { duration: 500, easing: 'easeInOutQuart' },
          plugins: { legend: { display: false }, tooltip: tooltipStyle() },
          scales: {
            x: { grid: { color: '#403c33' }, ticks: { color: '#6b6560', maxTicksLimit: 8, maxRotation: 0, font: { size: 11 } } },
            y: { position: 'right', grid: { color: '#403c33' }, ticks: { color: '#6b6560', font: { size: 11 }, callback: v => `$${v.toFixed(0)}` } }
          }
        }
      });
    }
  }

  function tooltipStyle() {
    return {
      backgroundColor: '#302d27',
      borderColor: '#504c43',
      borderWidth: 1,
      titleColor: '#f5f0eb',
      bodyColor: '#9b9188',
      padding: 10,
      callbacks: {
        label: ctx => {
          if (ctx.raw === null || ctx.raw === undefined) return null;
          if (typeof ctx.raw === 'object') {
            const r = ctx.raw;
            return [`O: $${r.o?.toFixed(2)}`, `H: $${r.h?.toFixed(2)}`, `L: $${r.l?.toFixed(2)}`, `C: $${r.c?.toFixed(2)}`];
          }
          return `${ctx.dataset.label}: $${Number(ctx.raw).toFixed(2)}`;
        }
      }
    };
  }

  function updateChart() {
    if (!S.chart) return;
    const isCandle = S.chartType === 'candlestick';
    // Daily data sliced by period
    const PERIOD_DAYS = { '1W': 5, '1M': 22, '3M': 66, '6M': 130, '1J': 999 };
    const limit  = PERIOD_DAYS[S.period] || 22;
    const n      = Math.min(limit, S.allDates.length);
    const dates  = S.allDates.slice(-n);
    const prices = S.allPrices.slice(-n);
    const opens  = S.allOpens.slice(-n);
    const highs  = S.allHighs.slice(-n);
    const lows   = S.allLows.slice(-n);

    if (isCandle) {
      S.chart.data.datasets[0].data = dates.map((d,i) => ({
        x: new Date(d).getTime(),
        o: opens[i], h: highs[i], l: lows[i], c: prices[i]
      }));
      S.chart.update('active');
      return;
    }

    // Line chart
    const sma20Full = Forecast.sma(S.allPrices, 20).slice(-n);
    const sma50Full = Forecast.sma(S.allPrices, 50).slice(-n);

    const fcPrices = S.forecast?.forecastPrices || [];
    const fcDays   = fcPrices.length;
    const fcLabels = [];
    const lastDate = new Date(dates[dates.length - 1]);
    for (let d = 0; fcLabels.length < fcDays; ) {
      d++;
      const nd = new Date(lastDate);
      nd.setDate(nd.getDate() + d);
      if (nd.getDay() === 0 || nd.getDay() === 6) continue;
      fcLabels.push(nd.toISOString().split('T')[0]);
    }

    const fcData = [...new Array(n - 1).fill(null), prices[n - 1], ...fcPrices];

    S.chart.data.labels   = [...dates, ...fcLabels];
    S.chart.data.datasets[0].data = [...prices, ...new Array(fcDays).fill(null)];
    S.chart.data.datasets[1].data = [...sma20Full, ...new Array(fcDays).fill(null)];
    S.chart.data.datasets[2].data = [...sma50Full, ...new Array(fcDays).fill(null)];
    S.chart.data.datasets[3].data = fcData;
    S.chart.update('active');
  }

  // ── Header / Price ───────────────────────────────────────────

  function updateHeader(name, symbol, exchange, sector) {
    document.getElementById('stockName').textContent     = name;
    document.getElementById('stockSymbol').textContent   = symbol;
    document.getElementById('stockExchange').textContent = exchange || '–';
    document.getElementById('stockSector').textContent   = sector   || '–';
  }

  function updatePrice(price, change, pct) {
    const el = document.getElementById('currentPrice');
    const prev = S.lastPrice; S.lastPrice = price;
    el.textContent = `$${price.toFixed(2)}`;
    const up = change >= 0;
    const chgEl = document.getElementById('priceChange');
    chgEl.textContent = `${up ? '▲' : '▼'} $${Math.abs(change).toFixed(2)}  ${up ? '+' : ''}${pct.toFixed(2)}%`;
    chgEl.className   = 'price-change ' + (up ? 'positive' : 'negative');
    if (prev !== null && prev !== price) {
      el.classList.remove('flash-up','flash-down');
      void el.offsetWidth;
      el.classList.add(price > prev ? 'flash-up' : 'flash-down');
    }
    document.getElementById('lastUpdated').textContent = t('updatedAt') + ' ' + new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  function updateWatchlistBtn() {
    const btn = document.getElementById('watchlistToggleBtn');
    const inList = WL.has(S.symbol);
    btn.textContent = inList ? t('watchlistInList') : t('watchlistAddCurrent');
    btn.classList.toggle('in-list', inList);
  }

  // ── Indicators ───────────────────────────────────────────────

  function updateIndicators(prices) {
    const rsiV = Forecast.rsi(prices);
    const macdV = Forecast.macd(prices);
    const bb    = Forecast.bollingerBands(prices);
    const vol   = Forecast.volatility(prices.slice(-30));
    const s20   = Forecast.sma(prices, 20); const last20 = s20[s20.length-1];
    const s50   = Forecast.sma(prices, 50); const last50 = s50[s50.length-1];
    const last  = prices[prices.length-1];

    if (rsiV !== null) {
      set('rsiValue', rsiV.toFixed(1));
      document.getElementById('rsiCursor').style.left = `calc(${rsiV.toFixed(1)}% - 2px)`;
      const lbl = rsiV > 70 ? [t('rsi_overbought'),'neg'] : rsiV < 30 ? [t('rsi_oversold'),'pos'] : [t('rsi_neutral'),'neu'];
      setLbl('rsiLabel', lbl[0], lbl[1]);
    }
    if (macdV) {
      set('macdValue', (macdV.macd >= 0 ? '+' : '') + macdV.macd.toFixed(2));
      setLbl('macdLabel', macdV.bullish ? t('macd_bull') : t('macd_bear'), macdV.bullish ? 'pos' : 'neg');
    }
    if (last20) { set('sma20Value', `$${last20.toFixed(2)}`); setLbl('sma20Label', last > last20 ? t('above_sma') : t('below_sma'), last > last20 ? 'pos' : 'neg'); }
    if (last50) { set('sma50Value', `$${last50.toFixed(2)}`); setLbl('sma50Label', last > last50 ? t('above_sma') : t('below_sma'), last > last50 ? 'pos' : 'neg'); }
    if (bb) {
      const pos = bb.position > .85 ? [t('bb_upper'),'neg'] : bb.position < .15 ? [t('bb_lower'),'pos'] : [t('bb_mid'),'neu'];
      set('bbValue', pos[0]); setLbl('bbLabel', `Breite: ${bb.bandwidth.toFixed(1)}%`, pos[1]);
    }
    set('volValue', vol.toFixed(1) + '%');
    const vl = vol < 15 ? [t('vol_low'),'pos'] : vol < 30 ? [t('vol_mod'),'neu'] : [t('vol_high'),'neg'];
    setLbl('volLabel', vl[0], vl[1]);
  }

  // ── Forecast card ────────────────────────────────────────────

  function updateForecastCard(fc) {
    if (!fc) return;
    const recEl = document.getElementById('recValue');
    recEl.textContent = fc.recommendation === 'KAUFEN' ? t('rec_buy') : fc.recommendation === 'VERKAUFEN' ? t('rec_sell') : t('rec_hold');
    recEl.className   = 'fc-rec ' + (fc.recommendation === 'KAUFEN' ? 'buy' : fc.recommendation === 'VERKAUFEN' ? 'sell' : 'hold');
    set('targetPrice', `$${fc.targetPrice.toFixed(2)}`);
    const up = fc.totalReturn >= 0;
    const dEl = document.getElementById('targetDelta');
    dEl.textContent = `${up ? '▲' : '▼'} ${up ? '+' : ''}${fc.totalReturn.toFixed(2)}%`;
    dEl.className   = 'fc-delta ' + (up ? 'positive' : 'negative');
    set('confPct', `${fc.confidence}%`);
    document.getElementById('confFill').style.width = `${fc.confidence}%`;
    setFac('Reg',   fc.factors.regression);
    setFac('Trend', fc.factors.trend);
    setFac('Mom',   fc.factors.momentum);
    setFac('Sent',  fc.factors.sentiment);
  }

  function setFac(id, pct) {
    const fill = document.getElementById('fac' + id + 'Fill');
    const pctEl = document.getElementById('fac' + id + 'Pct');
    if (fill)  { fill.style.width = `${pct}%`; fill.style.background = pct >= 60 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#f87171'; }
    if (pctEl) pctEl.textContent = `${pct}%`;
  }

  // ── News ─────────────────────────────────────────────────────

  function updateNews(articles, overall) {
    const badge = document.getElementById('sentimentBadge');
    const emoji = overall > .6 ? '😊' : overall < .4 ? '😟' : '😐';
    const lbl   = overall > .6 ? t('sent_positive') : overall < .4 ? t('sent_negative') : t('sent_neutral');
    const col   = overall > .6 ? '#4ade80' : overall < .4 ? '#f87171' : '#fbbf24';
    badge.textContent = `${emoji} ${lbl}`;
    badge.style.color = col;
    badge.style.borderColor = col + '44';

    document.getElementById('newsList').innerHTML = articles.map(a => {
      const sc = a.sentiment > .6 ? 'positive' : a.sentiment < .4 ? 'negative' : 'neutral';
      const isReal = a.url && a.url !== '#';
      const tag  = isReal ? 'a' : 'div';
      const attr = isReal ? ` href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"` : '';
      return `<${tag} class="news-item"${attr}>
        <div class="news-top"><span class="news-dot ${sc}"></span><span class="news-title">${escH(a.title)}</span></div>
        <div class="news-meta"><span>${escH(a.source)}</span><span>·</span><span>${escH(a.timeAgo)}</span></div>
      </${tag}>`;
    }).join('');
  }

  // ── Watchlist render ─────────────────────────────────────────

  function renderWatchlist() {
    const list = WL.get();
    const el   = document.getElementById('watchlistItems');
    if (!list.length) {
      el.innerHTML = `<p class="wl-empty">${t('watchlistEmpty')}</p>`;
      return;
    }
    el.innerHTML = list.map(s => `
      <div class="wl-item" data-sym="${esc(s.symbol)}" data-name="${esc(s.name)}">
        <span class="wl-sym">${escH(s.symbol)}</span>
        <span class="wl-name">${escH(s.name)}</span>
        <span class="wl-price" id="wlp_${s.symbol}">–</span>
        <span class="wl-chg"  id="wlc_${s.symbol}">–</span>
        <button class="wl-rm" data-sym="${esc(s.symbol)}" title="${t('watchlistRemove')}">×</button>
      </div>`).join('');

    el.querySelectorAll('.wl-item').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.classList.contains('wl-rm')) return;
        loadStock(row.dataset.sym, row.dataset.name);
      });
    });
    el.querySelectorAll('.wl-rm').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        WL.remove(btn.dataset.sym);
        updateWatchlistBtn();
        renderWatchlist();
      });
    });

    // Fetch prices asynchronously
    list.forEach(async s => {
      const q = await API.fetchQuote(s.symbol).catch(() => null);
      if (q) {
        const pe = document.getElementById('wlp_' + s.symbol);
        const ce = document.getElementById('wlc_' + s.symbol);
        if (pe) pe.textContent = `$${q.price.toFixed(2)}`;
        if (ce) {
          const up = q.changePercent >= 0;
          ce.textContent = `${up ? '+' : ''}${q.changePercent.toFixed(2)}%`;
          ce.className   = 'wl-chg ' + (up ? 'pos' : 'neg');
        }
      }
    });
  }

  // ── Market bar ───────────────────────────────────────────────

  async function loadMarketBar() {
    const items = await API.fetchMarket();
    const el    = document.getElementById('marketItems');
    el.innerHTML = items.map(m => {
      const up  = (m.changePercent || 0) >= 0;
      const prc = m.price ? `$${m.price.toFixed(2)}` : '–';
      const chg = m.changePercent != null ? `${up ? '+' : ''}${m.changePercent.toFixed(2)}%` : '';
      return `<div class="market-item" data-sym="${esc(m.symbol)}" title="${m.label}">
        <span class="mi-name">${m.label}</span>
        <span class="mi-val">${prc}</span>
        ${chg ? `<span class="mi-chg ${up ? 'pos' : 'neg'}">${chg}</span>` : ''}
      </div>`;
    }).join('');

    el.querySelectorAll('.market-item').forEach(item => {
      item.addEventListener('click', () => {
        const sym = item.dataset.sym;
        const found = API.MARKET_SYMS.find(m => m.symbol === sym);
        if (found) loadStock(sym, found.label);
      });
    });
  }

  // ── Search ───────────────────────────────────────────────────

  function doSearch() {
    const val = document.getElementById('stockSearch').value.trim().toUpperCase();
    if (!val) return;
    hideSug();
    loadStock(val, val);
  }

  async function doSuggest() {
    const val = document.getElementById('stockSearch').value.trim();
    if (!val) { hideSug(); return; }
    const results = API.KEYS.hasAny() ? await API.searchSymbol(val) : API.demoSuggestions(val);
    if (!results.length) { hideSug(); return; }
    const box = document.getElementById('suggestions');
    box.innerHTML = results.map(r => `<div class="sug-item" data-sym="${esc(r.symbol)}" data-name="${esc(r.name)}"><span class="sug-sym">${escH(r.symbol)}</span><span class="sug-name">${escH(r.name)}</span></div>`).join('');
    box.querySelectorAll('.sug-item').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('stockSearch').value = el.dataset.sym;
        hideSug();
        loadStock(el.dataset.sym, el.dataset.name);
      });
    });
    box.hidden = false;
  }

  function hideSug() { document.getElementById('suggestions').hidden = true; }

  // ── Auto-refresh ─────────────────────────────────────────────

  function startAutoRefresh() {
    clearInterval(S.refreshTimer);
    S.refreshTimer = setInterval(async () => {
      const q = await API.fetchQuote(S.symbol);
      if (q) {
        updatePrice(q.price, q.change, q.changePercent);
        if (S.allPrices.length) { S.allPrices[S.allPrices.length-1] = q.price; updateChart(); }
      }
      renderWatchlist();
    }, 60000);
  }

  // ── Settings ─────────────────────────────────────────────────

  function openModal() {
    document.getElementById('settingsModal').hidden = false;
    document.body.style.overflow = 'hidden';
    const adminSection = document.getElementById('adminPanelSection');
    adminSection.hidden = !S.isOwner;
    if (S.isOwner) {
      const users = Auth.listUsers();
      const el = document.getElementById('userListEl');
      el.innerHTML = users.length
        ? users.map(u => `<div class="user-list-item"><span>${escH(u)}</span><button class="ul-rm" data-name="${esc(u)}">Entfernen</button></div>`).join('')
        : '<span style="color:var(--muted);font-size:.85rem">Noch keine Nutzer registriert.</span>';
      el.querySelectorAll('.ul-rm').forEach(btn => {
        btn.addEventListener('click', () => {
          Auth.removeUser(btn.dataset.name);
          openModal(); // re-render
        });
      });
    }
  }
  function closeModal() { document.getElementById('settingsModal').hidden = true;  document.body.style.overflow=''; }
  function loadModalKeys() {
    document.getElementById('proxyUrl').value = API.KEYS.proxy();
    document.getElementById('avKey').value    = API.KEYS.av();
    document.getElementById('fhKey').value    = API.KEYS.fh();
    document.getElementById('gnKey').value    = API.KEYS.gn();
  }
  function saveKeys() {
    API.KEYS.save(document.getElementById('proxyUrl').value, document.getElementById('avKey').value, document.getElementById('fhKey').value, document.getElementById('gnKey').value);
    closeModal(); updateDemoBanner();
    loadStock(S.symbol, S.name, S.exchange, S.sector);
  }
  function clearKeys() { API.KEYS.clear(); loadModalKeys(); updateDemoBanner(); }
  function updateDemoBanner() {
    const hide = !S.isOwner || API.KEYS.hasCustom();
    document.getElementById('demoBanner').classList.toggle('hidden', hide);
  }

  // ── Loading ───────────────────────────────────────────────────

  function showLoading(text) { document.getElementById('loadingText').textContent = text; document.getElementById('loadingOverlay').hidden = false; }
  function hideLoading()     { document.getElementById('loadingOverlay').hidden = true; }

  // ── Helpers ───────────────────────────────────────────────────

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function set(id, val)     { const el = document.getElementById(id); if (el) el.textContent = val; }
  function setLbl(id, text, cls) { const el = document.getElementById(id); if (!el) return; el.textContent = text; el.className = 'ind-sub ' + (cls||''); }
  function esc(s)  { return String(s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
