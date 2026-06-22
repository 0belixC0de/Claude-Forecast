/* ═══════════════════════════════════════════
   Forecast Engine – reine Mathematik
   ═══════════════════════════════════════════ */

const Forecast = (() => {

  // ── Gleitende Durchschnitte ──────────────────────────────────

  function sma(prices, period) {
    const out = new Array(period - 1).fill(null);
    for (let i = period - 1; i < prices.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += prices[j];
      out.push(sum / period);
    }
    return out;
  }

  function ema(prices, period) {
    if (prices.length < period) return new Array(prices.length).fill(null);
    const k = 2 / (period + 1);
    // seed with SMA of first `period` values
    let seed = 0;
    for (let i = 0; i < period; i++) seed += prices[i];
    seed /= period;

    const out = new Array(period - 1).fill(null);
    out.push(seed);
    for (let i = period; i < prices.length; i++) {
      out.push(prices[i] * k + out[out.length - 1] * (1 - k));
    }
    return out;
  }

  // ── RSI ─────────────────────────────────────────────────────

  function rsi(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const changes = prices.slice(1).map((p, i) => p - prices[i]);

    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) avgGain += changes[i];
      else avgLoss -= changes[i];
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = period; i < changes.length; i++) {
      avgGain = (avgGain * (period - 1) + Math.max(0,  changes[i])) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(0, -changes[i])) / period;
    }

    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  // ── MACD ────────────────────────────────────────────────────

  function macd(prices, fast = 12, slow = 26, signal = 9) {
    const emaFast = ema(prices, fast).filter(v => v !== null);
    const emaSlow = ema(prices, slow).filter(v => v !== null);
    const len = Math.min(emaFast.length, emaSlow.length);

    const macdLine = [];
    for (let i = 0; i < len; i++) {
      macdLine.push(emaFast[emaFast.length - len + i] - emaSlow[emaSlow.length - len + i]);
    }

    const signalLine = ema(macdLine, signal).filter(v => v !== null);
    const macdVal  = macdLine[macdLine.length - 1];
    const sigVal   = signalLine[signalLine.length - 1];

    return {
      macd:      macdVal,
      signal:    sigVal,
      histogram: macdVal - sigVal,
      bullish:   macdVal > sigVal
    };
  }

  // ── Bollinger Bands ──────────────────────────────────────────

  function bollingerBands(prices, period = 20, mult = 2) {
    const smaVals = sma(prices, period);
    const mid = smaVals[smaVals.length - 1];
    if (!mid) return null;

    const slice = prices.slice(-period);
    const variance = slice.reduce((a, p) => a + (p - mid) ** 2, 0) / period;
    const std = Math.sqrt(variance);

    return {
      upper: mid + mult * std,
      middle: mid,
      lower: mid - mult * std,
      bandwidth: (2 * mult * std) / mid * 100,
      position: (prices[prices.length - 1] - (mid - mult * std)) / (2 * mult * std)
    };
  }

  // ── Lineare Regression ───────────────────────────────────────

  function linearRegression(prices) {
    const n  = prices.length;
    const xm = (n - 1) / 2;
    const ym = prices.reduce((a, b) => a + b, 0) / n;

    let ssxy = 0, ssxx = 0, ssyy = 0;
    for (let i = 0; i < n; i++) {
      ssxy += (i - xm) * (prices[i] - ym);
      ssxx += (i - xm) ** 2;
      ssyy += (prices[i] - ym) ** 2;
    }

    const slope     = ssxy / ssxx;
    const intercept = ym - slope * xm;
    const r2        = ssyy > 0 ? (ssxy ** 2) / (ssxx * ssyy) : 0;

    return {
      slope,
      intercept,
      r2,
      predict: (offset) => intercept + slope * (n - 1 + offset)
    };
  }

  // ── Annualisierte Volatilität ────────────────────────────────

  function volatility(prices) {
    if (prices.length < 2) return 0;
    const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
    const mean    = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance * 252) * 100;
  }

  // ── Hauptprognose ────────────────────────────────────────────
  //
  // Kombiniert vier Signale:
  //   40 % Lineare Regression   (Trendrichtung der letzten 30 Tage)
  //   30 % Momentum             (RSI + MACD)
  //   20 % Mean Reversion       (Bollinger-Band-Position)
  //   10 % Nachrichten-Sentiment (0..1 Input)
  //
  // Gibt einen Preis-Array für die nächsten `days` Handelstage zurück.

  function generate(prices, sentimentScore = 0.5, days = 7) {
    if (prices.length < 60) return null;

    const last      = prices[prices.length - 1];
    const recent30  = prices.slice(-30);
    const rsiVal    = rsi(prices);
    const macdData  = macd(prices);
    const bb        = bollingerBands(prices);
    const vol       = volatility(recent30);
    const reg       = linearRegression(recent30);

    // --- Signal 1: Trend (normalisiert auf -1..+1) ---
    const trendRaw   = (reg.slope / last) * 100;
    const trendScore = Math.max(-1, Math.min(1, trendRaw * 8));

    // --- Signal 2: Momentum ---
    let momentumScore = 0;
    if (rsiVal !== null) {
      if      (rsiVal > 70) momentumScore -= 0.6;
      else if (rsiVal < 30) momentumScore += 0.6;
      else                  momentumScore  = (rsiVal - 50) / 60;
    }
    if (macdData) {
      momentumScore = momentumScore * 0.6 + (macdData.bullish ? 0.4 : -0.4);
    }
    momentumScore = Math.max(-1, Math.min(1, momentumScore));

    // --- Signal 3: Mean Reversion (Bollinger-Position) ---
    let bbScore = 0;
    if (bb) {
      // Position > 0.8 → überkauft (negativ); < 0.2 → überverkauft (positiv)
      bbScore = (0.5 - bb.position) * 0.8;
      bbScore = Math.max(-1, Math.min(1, bbScore));
    }

    // --- Signal 4: Sentiment (-1..+1) ---
    const sentScore = (sentimentScore - 0.5) * 2;

    // --- Gewichtete Kombination ---
    const combined =
      0.40 * trendScore +
      0.30 * momentumScore +
      0.20 * bbScore +
      0.10 * sentScore;

    // Erwartete tägliche Rendite aus Volatilität und kombiniertem Score
    const dailyVol    = (vol / 100) / Math.sqrt(252);
    const dailyReturn = combined * dailyVol * 2;

    // Kursziel und Forecast-Pfad
    const forecastPrices = [];
    for (let i = 1; i <= days; i++) {
      forecastPrices.push(last * Math.pow(1 + dailyReturn, i));
    }

    const targetPrice   = forecastPrices[forecastPrices.length - 1];
    const totalReturn   = (targetPrice / last - 1) * 100;

    // Konfidenz: R², Signalübereinstimmung, Magnitude
    const agreeing      = [trendScore, momentumScore, sentScore].filter(s => s * combined > 0).length;
    const confBase      = 0.40 + reg.r2 * 0.25 + (agreeing / 3) * 0.20 + Math.abs(combined) * 0.15;
    const confidence    = Math.round(Math.max(30, Math.min(92, confBase * 100)));

    // Empfehlung
    let recommendation;
    if      (combined >  0.20) recommendation = 'KAUFEN';
    else if (combined < -0.20) recommendation = 'VERKAUFEN';
    else                       recommendation = 'HALTEN';

    return {
      targetPrice,
      totalReturn,
      confidence,
      recommendation,
      forecastPrices,
      factors: {
        regression: Math.round(reg.r2 * 100),
        trend:      Math.round((trendScore   + 1) / 2 * 100),
        momentum:   Math.round((momentumScore + 1) / 2 * 100),
        sentiment:  Math.round(sentimentScore * 100)
      },
      raw: { rsiVal, macdData, bb, vol, reg, combined }
    };
  }

  // ── Demo-Daten ───────────────────────────────────────────────

  function demoData(days = 120, startPrice = 182, seed = 42) {
    // Deterministischer Pseudo-Zufallszahlengenerator (LCG)
    let s = seed;
    const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };

    const prices = [startPrice];
    const dates  = [];
    let date = new Date();
    date.setDate(date.getDate() - days - 30);

    while (dates.length < days) {
      date.setDate(date.getDate() + 1);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue; // Wochenende überspringen
      dates.push(date.toISOString().split('T')[0]);

      const trend    =  0.00035;
      const noise    = (rand() - 0.5) * 0.022;
      const mean_rev = -0.08 * ((prices[prices.length - 1] - startPrice * 1.05) / startPrice);
      prices.push(prices[prices.length - 1] * (1 + trend + noise + mean_rev));
    }

    return { prices: prices.slice(0, dates.length), dates };
  }

  return { sma, ema, rsi, macd, bollingerBands, linearRegression, volatility, generate, demoData };
})();
