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
      body: JSON.stringify({ image: photoData })
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok || d.error) { showErr(msgs[d.error] || ("Что-то пошло не так (" + r.status + (d.error ? " " + d.error : "") + "), попробуй ещё раз")); return; }
    render(d);
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
