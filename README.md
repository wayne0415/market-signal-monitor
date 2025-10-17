# 📘 使用說明書 — Market Signal Monitor

這是一個自動監控加密貨幣市場訊號的工具，會即時分析 **量（Volume）**、**價（Momentum）**、**倉（Open Interest）**、**Funding Rate（情緒成本）** 四大關鍵指標，並透過 Telegram 傳送起漲與暴跌警示。

---

## 🚀 一、安裝步驟

1. **確認已安裝 Node.js 18+**

   ```bash
   node -v
   ```

   若沒有，請前往 [nodejs.org](https://nodejs.org) 下載安裝。

2. **安裝依賴套件**

   ```bash
   npm install
   ```

3. **建立 `.env` 檔案**
   在專案根目錄建立 `.env` 檔，範例內容如下：
   ```env
   INTERVAL_SEC=60
   ONLY_USDT=true
   TOP_N=60
   MIN_QUOTE_VOLUME_USD=3000000
   MIN_VOL_SURGE=2.0
   MIN_MOMENTUM_15M=0.2
   MAX_FUNDING_HOT=0.05
   MIN_OI_GROWTH=1.0
   ENABLE_TELEGRAM=true
   TELEGRAM_BOT_TOKEN=你的BotToken
   TELEGRAM_CHAT_ID=你的ChatID
   ```

---

## 📊 二、啟動程式

執行：

```bash
node monitor.js
```

看到以下訊息表示運行成功：

```
[時間] 扫描完成 15137ms | 候選數：60
🚀 起漲徵兆：目前無
⚠️ 暴跌徵兆：目前無
```

若 Telegram 收到「✅ 測試推播成功」代表連線正常。

---

## 💾 三、訊號紀錄

每次觸發訊號後，程式會自動更新 `signals.json` 檔案，格式如下：

```json
[
  {
    "time": "2025-10-18T02:36:57Z",
    "symbol": "BTCUSDT",
    "type": "🚀 起漲徵兆",
    "price": 67650.5,
    "volSurge": 2.7,
    "momentum15m": 0.32,
    "fundingPct": 0.01,
    "oiGrowthPct": 1.5
  }
]
```

系統會自動只保留**最近 5000 筆**資料。

---

## ⚙️ 四、參數調整建議

| 參數               | 作用         | 調整方向                       |
| ------------------ | ------------ | ------------------------------ |
| `MIN_VOL_SURGE`    | 爆量倍率     | 小 = 更敏感；大 = 只抓強勢爆量 |
| `MIN_MOMENTUM_15M` | 價格動能     | 小 = 提早偵測；大 = 確認走勢   |
| `MAX_FUNDING_HOT`  | 資金費率上限 | 小 = 保守；大 = 放寬           |
| `MIN_OI_GROWTH`    | 倉位增長率   | 小 = 寬鬆；大 = 嚴格           |

---

## 💡 五、進階應用

- **可視化網頁**：前端可用 `fetch('signals.json')` 讀取資料動態顯示。
- **自動紀錄回測結果**：可擴充 CSV 輸出或串接 Google Sheet。
- **Telegram 指令**：未來可新增 `/top` 查詢即時最強幣種。

---

## ✅ 六、常見問題

**Q:** Telegram 沒收到訊息？  
**A:** 檢查 `.env` 中的 `TELEGRAM_BOT_TOKEN` 與 `TELEGRAM_CHAT_ID` 是否正確，並確認你有按過 bot 的「Start」。

**Q:** 為什麼沒有訊號？  
**A:** 可降低門檻：

```
MIN_VOL_SURGE=1.5
MIN_MOMENTUM_15M=0.1
```

---

## 🧠 七、關鍵觀念

高品質訊號 = **量放大** + **價上升** + **倉增加** + **Funding 未過熱**  
這四項同時成立 → 代表主力資金正在進場。

---

> 作者：Wayne  
> 版本：v1.0.0  
> 最後更新：2025/10/18
