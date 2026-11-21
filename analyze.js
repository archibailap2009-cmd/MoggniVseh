// Serverless-функция Vercel: принимает фото, спрашивает Claude, возвращает оценку.
// Ключ API берётся только из переменной окружения ANTHROPIC_API_KEY (никогда не кладём его в код).

const TIERS = [
  { name: "Sub 3", range: "0–2", max: 2, advice: "ВОЗЬМИ СЕБЯ В РУКИ, РЯДОВОЙ" },
  { name: "LTN", range: "2–4", max: 4, advice: "СОБЕРИСЬ, РЯДОВОЙ" },
  { name: "MTN", range: "4–6", max: 6, advice: "ЕСТЬ НАД ЧЕМ РАБОТАТЬ" },
  { name: "HTN", range: "6–7.5", max: 7.5, advice: "ДЕРЖИ СТРОЙ" },
  { name: "Chadlite", range: "7.5–9", max: 9, advice: "ПОЧТИ НА ВЕРШИНЕ" },
  { name: "True Adam", range: "9–10", max: 10, advice: "ЛЕГЕНДА. ДЕРЖИ ПЛАНКУ" },
];

const SYSTEM = `Ты — ИИ сайта MOGGNI VSEH, мемного «сканера» лица в стиле лукс-максинг-юмора.
По фото оцени «труадамность» человека и верни ТОЛЬКО JSON без пояснений и без ```:

{
  "tier": "Sub 3 | Sub 5 | LTN | MTN | HTN | Chadlite | Chad | True Adam",
  "index": число от 0 до 10 с одним знаком после запятой,
  "caps": "короткая фраза капсом, например: СОБЕРИСЬ, РЯДОВОЙ",
  "description": "2–3 предложения: что видно на снимке (свет, ракурс, стрижка, выражение лица, осанка)",
  "range": "в каком диапазоне индекса человек может оказаться при прокачке, например 5.5–7",
  "tips": ["3–5 коротких безобидных советов"]
}

Правила:
- Тон: мемный, дерзкий, «сигма», но без унижений. Подкалывай, не добивай.
- Оценивай только то, что видно: стрижка, брови, щетина, кожа, осанка, свет, ракурс, выражение лица.
- Не делай выводов о расе, национальности, здоровье, инвалидности, возрасте или чём-то личном.
- Советы только безопасные: стрижка, борода, уход за кожей, сон, осанка, спорт, одежда, свет и ракурс для фото, мьюинг как мем. Никаких операций, стероидов, жёстких диет.
- Не ставь всем подряд высокие или низкие оценки: большинство должно попадать в 3–7, True Adam (9+) очень редко.
- Если на фото нет человека или лица, верни tier "—", index 0 и шуточный caps вроде «ГДЕ ЛИЦО?».
- Если на фото явно ребёнок, верни {"error":"minor"}.;

function clip(v, n) {
  return String(v == null ? "" : v).slice(0, n);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (process.env.ANALYSIS_ENABLED === "false") return res.status(503).json({ error: "off" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "config" });

  const image = req.body && req.body.image;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image || "");
  if (!m) return res.status(400).json({ error: "bad_image" });
  if (m[2].length > 3000000) return res.status(413).json({ error: "too_big" });

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
    return res.status(502).json({ error: "upstream" });
  }

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.error("anthropic error", r.status);
    if (r.status === 429) return res.status(429).json({ error: "busy" });
    if (/credit balance/i.test(body)) return res.status(402).json({ error: "limit" });
    return res.status(502).json({ error: "upstream" });
  }

  const data = await r.json();
  // Для шагов 3–4 (бюджет и Telegram): сколько токенов ушло на этот запрос
  console.log("usage", JSON.stringify(data.usage || {}));

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

  if (out.error === "no_face") {
    return res.status(422).json({ error: "no_face" });
  }

  let index = Number(out.index);
  if (!isFinite(index)) return res.status(502).json({ error: "parse" });
  index = Math.round(Math.min(10, Math.max(0, index)) * 10) / 10;
  const tier = TIERS.find((t) => index < t.max) || TIERS[TIERS.length - 1];

  const tips = (Array.isArray(out.tips) ? out.tips : [])
    .slice(0, 4)
    .map((t) => ({ title: clip(t && t.title, 40), text: clip(t && t.text, 140) }));

  return res.status(200).json({
    index,
    tier: tier.name,
    range: tier.range,
    advice: tier.advice,
    description: clip(out.description, 300),
    tips,
  });
};
