var $ = function (id) { return document.getElementById(id); };
var photoData = null;
var msgs = {
  no_face: "Лицо не найдено. Загрузи чёткое фото лица",
  limit: "На сегодня всё, общий лимит закончился. Заходи позже",
  daily_limit: "Твой лимит сканов на сегодня закончился. Приходи завтра",
  minor: "Не могу оценить это фото. Загрузи своё фото, 18+",
  busy: "Много запросов, попробуй через минуту",
  off: "Сервис временно выключен",
  bad_image: "Не получилось обработать фото",
  too_big: "Фото слишком большое"
};

function go(id) {
  if (!$(id)) id = "home";
  document.querySelectorAll(".scr").forEach(function (s) { s.classList.toggle("on", s.id === id); });
  document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("on", t.dataset.t === id); });
  if (location.hash !== "#" + id) location.hash = id;
  window.scrollTo(0, 0);
  if (id === "battle" && window.battleEnter) battleEnter();
  if (id === "friends" && window.friendsEnter) friendsEnter();
  if (id === "settings" && window.profileEnter) profileEnter();
}
document.querySelectorAll(".tab").forEach(function (t) { t.onclick = function () { go(t.dataset.t); }; });
window.addEventListener("hashchange", function () { go(location.hash.slice(1)); });

function showErr(t) { var e = $("err"); e.textContent = t; e.style.display = "block"; }

function loadPhoto(e) {
  var f = e.target.files[0];
  if (!f) return;
  $("err").style.display = "none";
  var url = URL.createObjectURL(f), img = new Image();
  img.onload = function () {
    var k = Math.min(1, 768 / Math.max(img.width, img.height));
    var c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    photoData = c.toDataURL("image/jpeg", 0.85);
    $("ph").innerHTML = '<img alt="" src="' + photoData + '">';
    URL.revokeObjectURL(url);
  };
  img.onerror = function () { showErr("Не получилось открыть фото"); };
  img.src = url;
  e.target.value = "";
}
$("file").onchange = loadPhoto;
$("cam").onchange = loadPhoto;

function render(d) {
  $("tier").textContent = d.tier;
  $("adv").textContent = d.advice;
  $("score").textContent = d.index.toFixed(1);
  $("sbar").style.width = d.index * 10 + "%";
  $("dTier").textContent = d.tier;
  $("dRange").textContent = d.range;
  $("desc").textContent = d.description;
  var box = $("tips");
  box.innerHTML = "";
  d.tips.forEach(function (t, i) {
    var row = document.createElement("div"); row.className = "tip";
    var n = document.createElement("b"); n.textContent = "0" + (i + 1);
    var w = document.createElement("div"); w.textContent = t.title;
    var m = document.createElement("div"); m.className = "mut"; m.textContent = t.text;
    w.appendChild(m); row.appendChild(n); row.appendChild(w); box.appendChild(row);
  });
  $("res").style.display = "block";
  var a = $("acc"); a.classList.remove("open"); a.style.display = "block";
}

async function scan() {
  $("err").style.display = "none";
  if (!photoData) { showErr("Сначала выбери или сделай фото"); return; }
  var btn = $("scanbtn");
  btn.disabled = true; btn.textContent = "Сканирую...";
  try {
    var r = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(window.battleScanPayload ? battleScanPayload({ image: photoData }) : { image: photoData })
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok || d.error) { showErr(msgs[d.error] || ("Что-то пошло не так (" + r.status + (d.error ? " " + d.error : "") + "), попробуй ещё раз")); return; }
    render(d); saveScan(d);
    if (window.battleAfterScan) battleAfterScan();
  } catch (e) {
    showErr("Нет связи с сервером");
  } finally {
    btn.disabled = false; btn.textContent = "Анализ";
  }
}


function bm(m) {
  var o = m === "open";
  $("bopen").style.display = o ? "block" : "none";
  $("bfriend").style.display = o ? "none" : "block";
  $("bo").classList.toggle("on", o);
  $("bf").classList.toggle("on", !o);
}

function theme() {
  var r = document.documentElement,
    d = r.getAttribute("data-theme") === "dark" || (!r.getAttribute("data-theme") && matchMedia("(prefers-color-scheme:dark)").matches);
  r.setAttribute("data-theme", d ? "light" : "dark");
}

go(location.hash.slice(1) || "home");
var CV = window.CONSENT_V || 1;

function consentId() {
  try {
    var c = JSON.parse(localStorage.getItem("mv_consent") || "null");
    if (c && c.id) return c.id;
  } catch (e) {}
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

function sendConsent(rec) {
  return fetch("/api/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: rec.v, id: rec.id }),
    keepalive: true
  }).then(function (r) {
    if (r.ok) {
      rec.sent = 1;
      try { localStorage.setItem("mv_consent", JSON.stringify(rec)); } catch (e) {}
    }
  }).catch(function () {});
}

function acceptGate() {
  $("gateok").disabled = true;
  var rec = { v: CV, id: consentId() };
  try { localStorage.setItem("mv_consent", JSON.stringify(rec)); } catch (e) {}
  sendConsent(rec);
  var g = $("gate");
  if (g) g.remove();
  window.scrollTo(0, 0);
}

// если запись о согласии раньше не дошла до сервера, пробуем ещё раз
(function () {
  try {
    var c = JSON.parse(localStorage.getItem("mv_consent") || "null");
    if (c && c.v === CV && !c.sent) sendConsent(c);
  } catch (e) {}
})();
// ---- Календарь прогресса (всё хранится в браузере) ----
var PKEY = "mv_progress";
var MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
var calY = new Date().getFullYear(), calM = new Date().getMonth();

function pload() {
  try {
    var p = JSON.parse(localStorage.getItem(PKEY) || "null");
    if (p && typeof p === "object") {
      p.marks = p.marks || {};
      p.scans = Array.isArray(p.scans) ? p.scans : [];
      return p;
    }
  } catch (e) {}
  return { marks: {}, scans: [] };
}
function psave(p) { try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) {} }

function dkey(d) {
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}

function streak(marks) {
  var d = new Date();
  if (!marks[dkey(d)]) d.setDate(d.getDate() - 1); // сегодня ещё можно успеть отметить
  var n = 0;
  while (marks[dkey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function growth(scans) {
  var from = Date.now() - 30 * 86400000;
  var s = scans.filter(function (x) { return x.t >= from && isFinite(Number(x.i)); });
  if (s.length < 2) return null;
  return Number(s[s.length - 1].i) - Number(s[0].i);
}

function saveScan(d) {
  var p = pload();
  p.scans.push({ d: dkey(new Date()), t: Date.now(), i: d.index, tier: d.tier });
  p.scans = p.scans.slice(-200);
  psave(p);
  drawProgress();
}

function drawProgress() {
  var p = pload(), today = dkey(new Date());
  $("pStreak").textContent = streak(p.marks);
  var g = growth(p.scans);
  $("pGrow").textContent = g === null ? "-" : (g > 0 ? "+" : "") + g.toFixed(1);
  $("pMonth").textContent = MONTHS[calM] + " " + calY;

  var days = new Date(calY, calM + 1, 0).getDate();
  var off = (new Date(calY, calM, 1).getDay() + 6) % 7; // понедельник = 0
  var last = {};
  p.scans.forEach(function (x) { last[x.d] = Number(x.i); }); // последний скан за день

  var h = "";
  for (var i = 0; i < off; i++) h += '<span class="cd e"></span>';
  for (var n = 1; n <= days; n++) {
    var k = dkey(new Date(calY, calM, n));
    var cls = "cd" + (p.marks[k] ? " on" : "") + (k === today ? " today" : "") + (k > today ? " fut" : "");
    var sc = isFinite(last[k]) ? "<small>" + last[k].toFixed(1) + "</small>" : "";
    h += '<button class="' + cls + '"' + (k > today ? " disabled" : "") + ' data-k="' + k + '"><b>' + n + "</b>" + sc + "</button>";
  }
  $("pGrid").innerHTML = h;
  $("pBtn").textContent = p.marks[today] ? "Снять отметку за сегодня" : "Отметить сегодня";
}

function toggleMark(k) {
  var p = pload();
  if (p.marks[k]) delete p.marks[k]; else p.marks[k] = 1;
  psave(p);
  drawProgress();
}
function markToday() { toggleMark(dkey(new Date())); }

function shiftMonth(s) {
  calM += s;
  if (calM < 0) { calM = 11; calY--; } else if (calM > 11) { calM = 0; calY++; }
  drawProgress();
}

$("pGrid").onclick = function (e) {
  var b = e.target.closest ? e.target.closest("button.cd") : null;
  if (b && !b.disabled) toggleMark(b.dataset.k);
};
document.addEventListener("visibilitychange", function () { if (!document.hidden) drawProgress(); });

drawProgress();
