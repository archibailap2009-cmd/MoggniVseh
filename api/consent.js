// Пишет запись о согласии с дисклеймером.
// Фото тут нет: только время (по часам сервера), версия текста, случайный id посетителя, хеш IP и начало User-Agent.
const crypto = require("crypto");

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: "config" });

  const body = req.body || {};
  const v = Number(body.v);
  const id = String(body.id || "");
  if (!isFinite(v) || v < 1 || v > 999 || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    return res.status(400).json({ error: "bad" });
  }

  const ip = String(
    req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown"
  ).trim();
  // IP смешиваем с секретом, чтобы хеш нельзя было просто подобрать перебором адресов
  const who = crypto.createHash("sha256").update(ip + "|" + REDIS_TOKEN).digest("hex").slice(0, 16);
  const ua = String(req.headers["user-agent"] || "").slice(0, 120);

  const rec = JSON.stringify({ t: new Date().toISOString(), v: v, id: id, ip: who, ua: ua });
  try {
    const r = await fetch(REDIS_URL + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + REDIS_TOKEN, "content-type": "application/json" },
      body: JSON.stringify([
        ["LPUSH", "mv:consents", rec],
        ["LTRIM", "mv:consents", 0, 49999],
      ]),
    });
    if (!r.ok) throw new Error("redis " + r.status);
  } catch (e) {
    console.error("consent not saved", e.message);
    return res.status(500).json({ error: "save" });
  }
  return res.status(200).json({ ok: true });
};
