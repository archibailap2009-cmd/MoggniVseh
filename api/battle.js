// Serverless-функция Vercel: комнаты для батлов (создать, войти, посмотреть состояние).
// Хранит только ники, тир и индекс. Фото сюда не попадают. Комната живёт 24 часа.

const crypto = require("crypto");

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const MAX_PLAYERS = 10; // потолок людей в комнате
const ROOMS_PER_DAY = 10; // сколько комнат можно создать с одного IP в сутки
const TTL = 86400; // 24 часа
const FR_TTL = 15552000; // список друзей хранится ~180 дней с последнего батла
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // без похожих символов (0/O, 1/I/L)

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

// HGETALL в Upstash приходит плоским массивом [поле, значение, ...]; на всякий случай поддерживаем и объект
function toObj(v) {
  if (!v) return {};
  if (Array.isArray(v)) {
    const o = {};
    for (let i = 0; i + 1 < v.length; i += 2) o[v[i]] = v[i + 1];
    return o;
  }
  return v;
}

function cleanNick(v) {
  return String(v == null ? "" : v)
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .trim()
    .slice(0, 16);
}

function makeId() {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHA[crypto.randomInt(ALPHA.length)];
  return s;
}

const ID_RE = /^[A-Z2-9]{6}$/;
const PID_RE = /^[A-Za-z0-9_-]{8,64}$/;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (process.env.ANALYSIS_ENABLED === "false") return res.status(503).json({ error: "off" });
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: "config" });

  const b = req.body || {};
  const action = String(b.action || "");
  const pid = String(b.pid || "");
  if (!PID_RE.test(pid)) return res.status(400).json({ error: "bad_pid" });

  try {
    // ---------- Список друзей: все, с кем был в одной комнате ----------
    if (action === "friends") {
      const [mem] = await redis([["SMEMBERS", "mv:fr:" + pid]]);
      const ids = [pid].concat(Array.isArray(mem) ? mem.slice(0, 200) : []);
      const [nicks, bests] = await redis([["HMGET", "mv:nick"].concat(ids), ["HMGET", "mv:best"].concat(ids)]);
      const players = ids.map((id, i) => {
        let bst = null;
        try {
          bst = bests && bests[i] ? JSON.parse(bests[i]) : null;
        } catch (e) {}
        return {
          nick: cleanNick(nicks && nicks[i]) || (id === pid ? "ты" : "???"),
          ready: bst ? 1 : 0,
          index: bst ? Number(bst.i) : null,
          tier: bst ? String(bst.tier || "") : "",
          me: id === pid,
        };
      });
      return res.status(200).json({ players: players });
    }

    // ---------- Создать комнату ----------
    if (action === "create") {
      const nick = cleanNick(b.nick);
      if (!nick) return res.status(400).json({ error: "bad_nick" });

      const ip = String(
        req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown"
      ).trim();
      const who = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
      const day = new Date().toISOString().slice(0, 10);
      const limKey = "mv:rooms:" + who + ":" + day;
      const [n] = await redis([["INCR", limKey], ["EXPIRE", limKey, 172800]]);
      if (Number(n) > ROOMS_PER_DAY) return res.status(429).json({ error: "rooms_limit" });

      for (let tries = 0; tries < 5; tries++) {
        const id = makeId();
        const key = "mv:b:" + id;
        const [fresh] = await redis([["HSETNX", key, "created", String(Date.now())]]);
        if (Number(fresh) !== 1) continue; // такой код уже занят, пробуем другой
        await redis([
          ["HSET", key, "p:" + pid, JSON.stringify({ nick: nick, ready: 0 })],
          ["EXPIRE", key, TTL],
          ["HSET", "mv:nick", pid, nick],
        ]);
        return res.status(200).json({ id: id });
      }
      return res.status(500).json({ error: "config" });
    }

    // ---------- Дальше нужен код комнаты ----------
    const id = String(b.id || "").toUpperCase();
    if (!ID_RE.test(id)) return res.status(400).json({ error: "no_room" });
    const key = "mv:b:" + id;
    const [raw] = await redis([["HGETALL", key]]);
    const h = toObj(raw);
    if (!h.created) return res.status(404).json({ error: "no_room" });
    const fields = Object.keys(h).filter((k) => k.indexOf("p:") === 0);

    // ---------- Войти в комнату ----------
    if (action === "join") {
      if (h["p:" + pid]) return res.status(200).json({ ok: true }); // уже внутри
      const nick = cleanNick(b.nick);
      if (!nick) return res.status(400).json({ error: "bad_nick" });
      if (fields.length >= MAX_PLAYERS) return res.status(409).json({ error: "room_full" });
      const others = fields.map((k) => k.slice(2));
      const cmds = [
        ["HSET", key, "p:" + pid, JSON.stringify({ nick: nick, ready: 0 })],
        ["EXPIRE", key, TTL],
        ["HSET", "mv:nick", pid, nick],
      ];
      others.forEach((o) => {
        cmds.push(["SADD", "mv:fr:" + pid, o]);
        cmds.push(["SADD", "mv:fr:" + o, pid]);
        cmds.push(["EXPIRE", "mv:fr:" + o, FR_TTL]);
      });
      cmds.push(["EXPIRE", "mv:fr:" + pid, FR_TTL]);
      await redis(cmds);
      return res.status(200).json({ ok: true });
    }

    // ---------- Состояние комнаты (его опрашивает сайт) ----------
    if (action === "state") {
      if (!h["p:" + pid]) return res.status(403).json({ error: "not_member" });
      const players = fields.map((k) => {
        let p = {};
        try {
          p = JSON.parse(h[k]);
        } catch (e) {}
        return {
          nick: cleanNick(p.nick) || "???",
          ready: p.ready ? 1 : 0,
          index: p.ready ? Number(p.index) : null,
          tier: p.ready ? String(p.tier || "") : "",
          advice: p.ready ? String(p.advice || "") : "",
          me: k === "p:" + pid,
        };
      });
      return res.status(200).json({ players: players, max: MAX_PLAYERS });
    }

    return res.status(400).json({ error: "bad_action" });
  } catch (e) {
    console.error("battle error", e.message);
    return res.status(500).json({ error: "config" });
  }
};
