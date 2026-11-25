// Serverless-функция Vercel: принимает фото, спрашивает Claude, возвращает оценку.
// Ключ API берётся только из переменной окружения ANTHROPIC_API_KEY (никогда не кладём его в код).

const crypto = require("crypto");

const TIERS = [
  { name: "Sub 3", range: "0–2", max: 2, advice: "ВОЗЬМИ СЕБЯ В РУКИ, РЯДОВОЙ" },
  { name: "LTN", range: "2–4", max: 4, advice: "СОБЕРИСЬ, РЯДОВОЙ" },
  { name: "MTN", range: "4–6", max: 6, advice: "ЕСТЬ НАД ЧЕМ РАБОТАТЬ" },
  { name: "HTN", range: "6–7.5", max: 7.5, advice: "ДЕРЖИ СТРОЙ" },
  { name: "Chadlite", range: "7.5–9", max: 9, advice: "ПОЧТИ НА ВЕРШИНЕ" },
  { name: "True Adam", range: "9–10", max: 10, advice: "ЛЕГЕНДА. ДЕРЖИ ПЛАНКУ" },
];

const SYSTEM = `Ты — ИИ сайта MOGGNI VSEH, мемного «сканера» лица в стиле лукс-максинг-юмора.
По фото оцени «труадамность» человека и верни ТОЛЬКО JSON, без пояснений и без markdown-обёртки:

{
  "index": число от 0 до 10 с одним знаком после запятой,
  "description": "2–3 предложения (до 300 символов): что видно на снимке — свет, ракурс, стрижка, выражение лица, осанка",
  "tips": [
    { "title": "до 4 слов", "text": "один короткий безобидный совет, до 140 символов" }
  ]
}

В tips ровно 3–4 пункта.

Правила:
- Тон: мемный, дерзкий, «сигма», сатирический и едкий, но без мата. Подкалывай, не добивай.
- Оценивай только то, что видно: стрижка, брови, щетина, кожа, осанка, свет, ракурс, выражение лица.
- Не делай выводов о расе, национальности, здоровье, инвалидности или чём-то личном.
- Советы только безопасные: стрижка, борода, уход за кожей, сон, осанка, спорт,поход в зал, армию, одежда, свет и ракурс для фото, мьюинг или боунсмешинг как мем. Никаких операций, стероидов, жёстких диет.
- Не ставь всем подряд высокие или низкие оценки: большинство должно попадать в 3–7, оценка 9+ очень редкая.
- Если на фото нет человека или лица, верни {"error":"no_face"}.
- Если на фото явно человек до 14 лет, верни {"error":"minor"}.`;
// ---- Настройки лимитов (можно менять через переменные окружения в Vercel) ----
function num(v, d) {
  const n = Number(v);
  return v !== undefined && v !== "" && isFinite(n) && n >= 0 ? n : d;
}
const BUDGET_USD = num(process.env.BUDGET_USD, 1); // общий потолок расходов
const DAILY_SCANS = num(process.env.DAILY_SCANS, 5); // сканов на человека в сутки
const PRICE_IN = num(process.env.PRICE_IN_PER_MTOK, 0.1); // $ за 1 млн входных токенов
const PRICE_OUT = num(process.env.PRICE_OUT_PER_MTOK, 0.5); // $ за 1 млн выходных токенов

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

// Команды в Redis (Upstash) пачкой: redis([["GET","k"],["INCR","k2"]]) -> [значение1, значение2]
async function redis(commands) {
  const r = await fetch(REDIS_URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  const rows = await r.json();
  return rows.map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
}

// ---- Telegram-уведомления (работают, только если заданы обе переменные) ----
async function tg(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    console.error("telegram failed"); // токен в лог не пишем
  }
}

// true, если флаг поставили впервые (чтобы не слать одно и то же много раз)
async function once(flag, ttlSeconds) {
  try {
    const [x] = await redis([["SET", flag, "1", "NX", "EX", ttlSeconds]]);
    return x === "OK";
  } catch (e) {
    return false;
  }
}

async function alerts(spentUsd, scans) {
  const pct = (spentUsd / BUDGET_USD) * 100;
  const base = "$" + spentUsd.toFixed(3) + " из $" + BUDGET_USD;
  const month = 2592000;
  if (pct >= 100) {
    if (await once("mv:alert:100", month)) await tg("⛔ Лимит расходов достигнут (" + base + "). Сайт отвечает «лимит».");
  } else if (pct >= 80) {
    if (await once("mv:alert:80", month)) await tg("⚠️ Потрачено 80% бюджета: " + base);
  } else if (pct >= 50) {
    if (await once("mv:alert:50", month)) await tg("ℹ️ Потрачено 50% бюджета: " + base);
  }
  if (scans > 0 && scans % 10 === 0) {
    await tg("📊 Сканов всего: " + scans + ", потрачено " + base);
  }
}

function clip(v, n) {
  return String(v == null ? "" : v).slice(0, n);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (process.env.ANALYSIS_ENABLED === "false") return res.status(503).json({ error: "off" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: "config" });

  const image = req.body && req.body.image;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image || "");
  if (!m) return res.status(400).json({ error: "bad_image" });
  if (m[2].length > 3000000) return res.status(413).json({ error: "too_big" });

  // ---- Кто это: хеш IP (сам IP нигде не храним) ----
  const ip = String(
    req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown"
  ).trim();
  const who = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
  const day = new Date().toISOString().slice(0, 10);
  const scanKey = "mv:scans:" + who + ":" + day;
  const refund = () => redis([["DECR", scanKey]]).catch(() => {});

  // ---- Проверка лимитов ДО запроса к Claude ----
  let spentMicro = 0;
  try {
    const [spent] = await redis([["GET", "mv:spend"]]);
    spentMicro = Number(spent || 0);
    if (spentMicro / 1e6 >= BUDGET_USD) return res.status(402).json({ error: "limit" });

    const [used] = await redis([
      ["INCR", scanKey],
      ["EXPIRE", scanKey, 172800],
    ]);
    if (Number(used) > DAILY_SCANS) {
      await refund();
      return res.status(429).json({ error: "daily_limit" });
    }
  } catch (e) {
    console.error("redis error", e.message);
    return res.status(500).json({ error: "config" });
  }

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 700,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
              { type: "text", text: "Оцени это фото." },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    await refund();
    return res.status(502).json({ error: "upstream" });
  }

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.error("anthropic error", r.status);
    await refund();
    if (r.status === 429) return res.status(429).json({ error: "busy" });
    if (/credit balance/i.test(body)) {
      if (await once("mv:alert:credits", 3600)) await tg("🚨 На счёте Anthropic закончились кредиты. Пополни баланс.");
      return res.status(402).json({ error: "limit" });
    }
    return res.status(502).json({ error: "upstream" });
  }

  const data = await r.json();

  // ---- Учёт расходов: токены × цена. Храним в микродолларах (целое число) ----
  const u = data.usage || {};
  // цена за 1 млн токенов в $ = микродолларов за 1 токен, поэтому делить не нужно
  const micro = Math.ceil((u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT);
  try {
    const [total, count] = await redis([
      ["INCRBY", "mv:spend", micro],
      ["INCR", "mv:scans_total"],
    ]);
    const spentUsd = Number(total) / 1e6;
    console.log("usage", JSON.stringify(u), "cost_usd", micro / 1e6, "total_usd", spentUsd);
    await alerts(spentUsd, Number(count));
  } catch (e) {
    console.error("spend not saved", e.message);
  }

  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  let out;
  try {
    out = JSON.parse(text.slice(a, b + 1));
  } catch (e) {
    return res.status(502).json({ error: "parse" });
  }

  if (out.error === "no_face") return res.status(422).json({ error: "no_face" });
  if (out.error === "minor") return res.status(422).json({ error: "minor" });

  let index = Number(out.index);
  if (!isFinite(index)) return res.status(502).json({ error: "parse" });
  index = Math.round(Math.min(10, Math.max(0, index)) * 10) / 10;
  const tier = TIERS.find((t) => index < t.max) || TIERS[TIERS.length - 1];

  const tips = (Array.isArray(out.tips) ? out.tips : [])
    .slice(0, 4)
    .map((t) => ({ title: clip(t && t.title, 40), text: clip(t && t.text, 140) }));

  // ---- Друзья и батл: запоминаем лучший результат и пишем результат в комнату ----
  // Блок стоит ПОСЛЕ расчёта index и tier, иначе он не видит эти значения.
  const room = req.body && req.body.room, bpid = req.body && req.body.pid;
  if (/^[\w-]{8,64}$/.test(bpid || "")) {
    try {
      const [prev] = await redis([["HGET", "mv:best", bpid]]);
      let best = null;
      try { best = prev ? JSON.parse(prev) : null; } catch (e) {}
      if (!best || index > Number(best.i)) {
        await redis([["HSET", "mv:best", bpid, JSON.stringify({ i: index, tier: tier.name })]]);
      }
    } catch (e) { console.error("best not saved"); }
    if (/^[A-Z2-9]{6}$/.test(room || "")) {
      try {
        const bkey = "mv:b:" + room, field = "p:" + bpid;
        const [cur] = await redis([["HGET", bkey, field]]);
        if (cur) {
          const p = JSON.parse(cur);
          p.ready = 1; p.index = index; p.tier = tier.name; p.advice = tier.advice;
          await redis([["HSET", bkey, field, JSON.stringify(p)], ["EXPIRE", bkey, 86400]]);
        }
      } catch (e) { console.error("battle write failed"); }
    }
  }

  const used = await redis([["GET", scanKey]]).then((x) => Number(x[0] || 0)).catch(() => 0);

  return res.status(200).json({
    index,
    tier: tier.name,
    range: tier.range,
    advice: tier.advice,
    description: clip(out.description, 300),
    tips,
    left: Math.max(0, DAILY_SCANS - used),
  });
};
