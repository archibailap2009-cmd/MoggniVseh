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

const SYSTEM = `Ты MOGGNI VSEH — мемный сервис «оценки внешности» для развлечения. Тебе дают фото.
Ответь ТОЛЬКО JSON, без пояснений и без markdown.
Если на фото нет одного чёткого человеческого лица, ответь {"error":"no_face"}.
Иначе ответь так:
{"index": число от 0 до 10 с одним знаком после запятой,
 "description": "2 коротких предложения по-русски о том, что видно на снимке: свет, ракурс, выражение лица, причёска",
 "tips": [ровно 4 объекта {"title":"1-3 слова","text":"одно короткое предложение"}]}
Правила: тон шуточный, как в мемах про «мьюинг» и «моггинг», но без унижения человека. Это игра: у большинства людей индекс 3–7, значения от 9 встречаются крайне редко.
Не упоминай расу, этничность, инвалидность, шрамы, болезни и вес.
Советы только безобидные: уход за кожей, борода и бритьё, причёска, осанка, сон, вода, спорт, мьюинг (положение языка, как мем), одежда, свет и ракурс для фото.
Никаких операций, препаратов, самоповреждения и «боунсмешинга».`;

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
