// node monitor.js
import fs from "fs";
import "dotenv/config";
import fetch from "node-fetch";

/* ========= 讀設定 ========= */
const INTERVAL_SEC = Number(process.env.INTERVAL_SEC || 60);
const ONLY_USDT = (process.env.ONLY_USDT || "true") === "true";
const TOP_N = Number(process.env.TOP_N || 60);
const MIN_QUOTE_VOLUME_USD = Number(process.env.MIN_QUOTE_VOLUME_USD || 3_000_000);

const MIN_VOL_SURGE = Number(process.env.MIN_VOL_SURGE || 2.0);
const MIN_MOMENTUM_15M = Number(process.env.MIN_MOMENTUM_15M || 0.2);
const MAX_FUNDING_HOT = Number(process.env.MAX_FUNDING_HOT || 0.05);
const MIN_OI_GROWTH = Number(process.env.MIN_OI_GROWTH || 1.0);

/* ========= Telegram ========= */
const ENABLE_TELEGRAM = (process.env.ENABLE_TELEGRAM || "false") === "true";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

async function sendTelegram(msg) {
  if (!ENABLE_TELEGRAM || !BOT_TOKEN || !CHAT_ID) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = { chat_id: CHAT_ID, text: msg, parse_mode: "Markdown" };
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    console.error("Telegram 推播失敗：", e.message);
  }
}

/* ========= 幣安 Public API ========= */
const SPOT_TICKER_24H = "https://api.binance.com/api/v3/ticker/24hr";
const SPOT_KLINES = "https://api.binance.com/api/v3/klines";
const FUT_PREMIUM = "https://fapi.binance.com/fapi/v1/premiumIndex";
const FUT_OI_HIST = "https://fapi.binance.com/futures/data/openInterestHist";

const j = (u) =>
  fetch(u).then((r) => {
    if (!r.ok) throw new Error(`${u} ${r.status}`);
    return r.json();
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const pct = (a, b) => (b === 0 ? 0 : ((a - b) / b) * 100);

/* ========= 資料抓取 ========= */
async function fetch24hAll() {
  const rows = await j(SPOT_TICKER_24H);
  let list = rows.filter((x) => {
    const okUsdt = !ONLY_USDT || x.symbol.endsWith("USDT");
    const okPx = Number(x.lastPrice) > 0.01;
    const okVol = Number(x.quoteVolume) >= MIN_QUOTE_VOLUME_USD;
    return okUsdt && okPx && okVol;
  });
  list.sort((a, b) => Number(b.priceChangePercent) - Number(a.priceChangePercent));
  return list.slice(0, TOP_N);
}

async function fetchKlines(symbol, interval = "5m", limit = 36) {
  const url = `${SPOT_KLINES}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  return j(url);
}

async function fetchFunding(symbolPerp) {
  try {
    return await j(`${FUT_PREMIUM}?symbol=${symbolPerp}`);
  } catch {
    return null;
  }
}

async function fetchOpenInterestChange(symbolPerp) {
  try {
    const qs = new URLSearchParams({ symbol: symbolPerp, period: "1h", limit: "5" }).toString();
    const rows = await j(`${FUT_OI_HIST}?${qs}`);
    if (!rows.length) return { oiGrowthPct: 0, lastOiUsd: 0 };
    const first = Number(rows[0].sumOpenInterestValue);
    const last = Number(rows.at(-1).sumOpenInterestValue);
    return { oiGrowthPct: pct(last, first), lastOiUsd: last };
  } catch {
    return { oiGrowthPct: 0, lastOiUsd: 0 };
  }
}

/* ========= 評分邏輯 ========= */
function assessSignals({ volSurge, momentum15m, fundingPct, oiGrowthPct }) {
  const bullish = volSurge >= MIN_VOL_SURGE && momentum15m >= MIN_MOMENTUM_15M && (fundingPct == null || fundingPct <= MAX_FUNDING_HOT) && oiGrowthPct >= MIN_OI_GROWTH;

  // 暴跌徵兆：量價背離（爆量但動能<=0）或 funding 過熱 + OI 掉頭
  const bearish = (volSurge >= MIN_VOL_SURGE && momentum15m <= 0) || (fundingPct != null && fundingPct >= MAX_FUNDING_HOT && oiGrowthPct <= 0);

  return { bullish, bearish };
}

/* ========= 主要掃描 ========= */
async function scanOnce() {
  const t0 = Date.now();
  const rows = await fetch24hAll();
  const signals = [];

  for (const x of rows) {
    const symbol = x.symbol;

    // 5m K 線 36 根 ≈ 3 小時
    let kl;
    try {
      kl = await fetchKlines(symbol, "5m", 36);
    } catch {
      continue;
    }

    const closes = kl.map((k) => Number(k[4]));
    const vols = kl.map((k) => Number(k[5]));
    const last = closes.at(-1);

    // 爆量倍率：最近一根 vs 前 12 根平均（約 1 小時）
    const baseVol = avg(vols.slice(-13, -1)) || 0;
    const recentVol = vols.at(-1) || 0;
    const volSurge = baseVol > 0 ? recentVol / baseVol : 0;

    // 15 分鐘動能：最近 3 根相對 3 根前
    const ref = closes.at(-4);
    const momentum15m = ref && ref > 0 ? ((last - ref) / ref) * 100 : 0;

    // 永續資料（若無合約則 funding 可能為 null）
    const perp = symbol; // 大多相同；個別不一致再擴充映射表
    const funding = await fetchFunding(perp);
    const fundingPct = funding && funding.lastFundingRate != null ? Number(funding.lastFundingRate) * 100 : null;

    // OI 近 4 小時變化（用 1h period 5 筆）
    const { oiGrowthPct, lastOiUsd } = await fetchOpenInterestChange(perp);

    const { bullish, bearish } = assessSignals({ volSurge, momentum15m, fundingPct, oiGrowthPct });

    if (bullish || bearish) {
      signals.push({
        Symbol: symbol,
        Price: Number(x.lastPrice),
        "24h%": Number(Number(x.priceChangePercent).toFixed(2)),
        "5m量倍數": Number(volSurge.toFixed(2)),
        "15m動能%": Number(momentum15m.toFixed(2)),
        "Funding%": fundingPct != null ? Number(fundingPct.toFixed(3)) : "-",
        "OI近4h增長%": Number(oiGrowthPct.toFixed(2)),
        "OI價值(USD)": Number(lastOiUsd.toFixed(0)),
        Type: bullish ? "🚀 起漲徵兆" : "⚠️ 暴跌徵兆",
        Time: new Date().toISOString(),
      });
    }

    // 節流，避免打太快
    await sleep(80);
  }

  // 排序：起漲放前（爆量+動能），暴跌放後（funding 熱度 + OI 走弱）
  const up = signals.filter((s) => s.Type.includes("起漲")).sort((a, b) => b["5m量倍數"] - a["5m量倍數"] || b["15m動能%"] - a["15m動能%"]);
  const dn = signals.filter((s) => s.Type.includes("暴跌")).sort((a, b) => (b["Funding%"] === "-" ? -1 : b["Funding%"]) - (a["Funding%"] === "-" ? -1 : a["Funding%"]) || a["OI近4h增長%"] - b["OI近4h增長%"]);

  console.clear();
  console.log(`[${new Date().toLocaleString()}] 扫描完成 ${Date.now() - t0}ms | 候選數：${rows.length}`);

  if (up.length) {
    console.log("\n🚀 起漲徵兆");
    console.table(up);
  } else {
    console.log("\n🚀 起漲徵兆：目前無");
  }

  if (dn.length) {
    console.log("\n⚠️ 暴跌徵兆");
    console.table(dn);
  } else {
    console.log("\n⚠️ 暴跌徵兆：目前無");
  }

  // === 儲存訊號到 JSON ===
  try {
    if (signals.length) {
      const dataToSave = signals.map((s) => ({
        time: s.Time,
        symbol: s.Symbol,
        type: s.Type,
        price: s.Price,
        volSurge: s["5m量倍數"],
        momentum15m: s["15m動能%"],
        fundingPct: s["Funding%"],
        oiGrowthPct: s["OI近4h增長%"],
      }));

      // 若已存在檔案則讀舊資料並追加，否則建立新陣列
      let existing = [];
      if (fs.existsSync("signals.json")) {
        try {
          existing = JSON.parse(fs.readFileSync("signals.json", "utf-8"));
          if (!Array.isArray(existing)) existing = [];
        } catch {
          existing = [];
        }
      }
      existing.push(...dataToSave);
      // 僅保留最近 5000 筆訊號
      if (existing.length > 5000) {
        existing = existing.slice(-5000);
      }

      // 寫回檔案（格式化成漂亮 JSON）
      fs.writeFileSync("signals.json", JSON.stringify(existing, null, 2));
      console.log(`📁 已更新 signals.json，共 ${existing.length} 筆訊號`);
    }
  } catch (err) {
    console.error("寫入 signals.json 失敗：", err.message);
  }

  // 推播摘要
  if ((up.length || dn.length) && ENABLE_TELEGRAM) {
    const lines = [];
    up.slice(0, 10).forEach((o) => lines.push(`🚀 *${o.Symbol}* | 量×${o["5m量倍數"]} | 動能 ${o["15m動能%"]}%`));
    dn.slice(0, 10).forEach((o) => lines.push(`⚠️ *${o.Symbol}* | Funding ${o["Funding%"]}% | OI ${o["OI近4h增長%"]}%`));
    lines.push("\n規則建議：突破近高小倉試單；止損 -0.8%~-1.0%；止盈 +1%~+2%。");
    await sendTelegram(lines.join("\n"));
  }
}

await sendTelegram("✅ 測試推播成功！你的交易雷達已啟動。");
/* ========= 主循環 ========= */
(async () => {
  while (true) {
    try {
      await scanOnce();
    } catch (e) {
      console.error("Scan error:", e.message);
    }
    await sleep(INTERVAL_SEC * 1000);
  }
})();
