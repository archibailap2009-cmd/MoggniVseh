// Батлы с друзьями: комната по ссылке, любое число людей (до 10), общий рейтинг.
// Подключается в index.html ПОСЛЕ app.js.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var room = null;          // код комнаты, в которой мы сейчас
  var pending = null;       // код из ссылки, куда нас позвали, но мы ещё не вошли
  var scanForRoom = false;  // следующий скан отправить в комнату
  var timer = null;
  var memPid = null;

  var MSG = {
    bad_nick: "Введи ник",
    no_room: "Комната не найдена или уже закрыта",
    room_full: "В комнате нет мест (максимум 10)",
    rooms_limit: "Слишком много комнат на сегодня, попробуй завтра",
    not_member: "Ты не в этой комнате",
    off: "Сервис временно выключен",
    config: "Ошибка на сервере, попробуй ещё раз"
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function pid() {
    var p = lsGet("mv_pid") || memPid;
    if (!p) {
      p = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      memPid = p;
      lsSet("mv_pid", p);
    }
    return p;
  }

  function api(body) {
    body.pid = pid();
    return fetch("/api/battle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { d._status = r.status; return d; });
    });
  }

  function err(t) {
    var e = $("berr");
    e.textContent = t || "";
    e.style.display = t ? "block" : "none";
  }

  function nick() {
    var n = $("bnick").value.replace(/[<>]/g, "").trim().slice(0, 16);
    if (n) lsSet("mv_nick", n);
    return n;
  }

  function roomUrl() { return location.origin + "/?battle=" + room; }

  // ---------- экраны ----------
  function showSetup(joinMode) {
    $("bsetup").style.display = "block";
    $("broom").style.display = "none";
    $("bjoinnote").style.display = joinMode ? "block" : "none";
    $("bjoin").style.display = joinMode ? "block" : "none";
    $("bmake").style.display = joinMode ? "none" : "block";
    if (!$("bnick").value) $("bnick").value = lsGet("mv_nick") || "";
    err("");
    stopPoll();
  }

  function showRoom() {
    $("bsetup").style.display = "none";
    $("broom").style.display = "block";
    $("bcode").textContent = room;
    poll();
    startPoll();
  }

  function setRoom(id) {
    room = id;
    pending = null;
    lsSet("mv_room", id);
    showRoom();
  }

  function leaveRoom() {
    room = null;
    scanForRoom = false;
    $("bnote").style.display = "none";
    lsDel("mv_room");
    stopPoll();
    showSetup(false);
  }

  // ---------- действия ----------
  window.battleCreate = function () {
    err("");
    var n = nick();
    if (!n) { err(MSG.bad_nick); return; }
    var b = $("bmake"); b.disabled = true;
    api({ action: "create", nick: n }).then(function (d) {
      if (d.id) setRoom(d.id); else err(MSG[d.error] || "Не получилось создать комнату");
    }).catch(function () { err("Нет связи с сервером"); })
      .then(function () { b.disabled = false; });
  };

  window.battleJoin = function () {
    err("");
    var n = nick();
    if (!n) { err(MSG.bad_nick); return; }
    var b = $("bjoin"); b.disabled = true;
    api({ action: "join", id: pending, nick: n }).then(function (d) {
      if (d.ok) setRoom(pending); else err(MSG[d.error] || "Не получилось войти");
    }).catch(function () { err("Нет связи с сервером"); })
      .then(function () { b.disabled = false; });
  };

  window.battleShare = function () {
    var url = roomUrl();
    if (navigator.share) {
      navigator.share({ title: "MOGGNI VSEH", text: "Заходи в батл, посмотрим, кто моггает", url: url })
        .catch(function () {}); // человек закрыл меню, это не ошибка
    } else {
      window.battleCopy();
    }
  };

  window.battleCopy = function () {
    var url = roomUrl(), b = $("bcopy");
    function done() {
      b.textContent = "Скопировано";
      setTimeout(function () { b.textContent = "Копировать ссылку"; }, 1500);
    }
    function fallback() {
      var t = document.createElement("textarea");
      t.value = url; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      document.body.removeChild(t);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, fallback);
    } else fallback();
  };

  window.battleStartScan = function () {
    scanForRoom = true;
    $("bnote").style.display = "block";
    go("home");
  };

  window.battleCancelScan = function () {
    scanForRoom = false;
    $("bnote").style.display = "none";
  };

  window.battleLeave = function () { leaveRoom(); };

  // хуки для app.js
  window.battleScanPayload = function (o) {
    if (scanForRoom && room) { o.room = room; o.pid = pid(); }
    return o;
  };
  window.battleAfterScan = function () {
    if (!scanForRoom) return;
    scanForRoom = false;
    $("bnote").style.display = "none";
    go("battle");
  };

  // ---------- опрос и рейтинг ----------
  function startPoll() {
    stopPoll();
    timer = setInterval(function () {
      if (!document.hidden) poll();
    }, 4000);
  }
  function stopPoll() { if (timer) { clearInterval(timer); timer = null; } }

  function poll() {
    if (!room) return;
    var asked = room;
    api({ action: "state", id: asked }).then(function (d) {
      if (asked !== room) return;
      if (d.error === "no_room" || d.error === "not_member") { leaveRoom(); err(MSG[d.error]); return; }
      if (d.players) draw(d);
    }).catch(function () {});
  }

  function draw(d) {
    var ready = d.players.filter(function (p) { return p.ready; })
      .sort(function (a, b) { return b.index - a.index; });
    var wait = d.players.filter(function (p) { return !p.ready; });
    var box = $("blist");
    box.innerHTML = "";
    ready.concat(wait).forEach(function (p, i) {
      var row = document.createElement("div"); row.className = "lb";
      var n = document.createElement("b"); n.textContent = p.ready ? (i < 9 ? "0" : "") + (i + 1) : "--";
      var av = document.createElement("div"); av.className = "av";
      var mid = document.createElement("div");
      mid.appendChild(document.createTextNode(p.nick + (p.me ? " (ты)" : "")));
      var sub = document.createElement("div"); sub.className = "mut";
      sub.textContent = p.ready ? p.tier : "ждёт скан";
      mid.appendChild(sub);
      var sc = document.createElement("span"); sc.className = "sc";
      sc.textContent = p.ready ? p.index.toFixed(1) : "...";
      row.appendChild(n); row.appendChild(av); row.appendChild(mid); row.appendChild(sc);
      box.appendChild(row);
    });
    $("bcount").textContent = d.players.length + " / " + d.max;
    var me = d.players.filter(function (p) { return p.me; })[0];
    $("bscan").textContent = me && me.ready ? "Пересканировать" : "Сканировать для батла";
    var top = ready[0];
    $("bwin").textContent = top ? (top.me ? "ТЫ ВСЕХ ЗАМОГГАЛ" : "ВПЕРЕДИ " + top.nick.toUpperCase()) : "";
  }

  // ---------- вход на вкладку ----------
  window.battleEnter = function () {
    if (pending && pending !== room) {
      bm("friend");
      showSetup(true);
      return;
    }
    if (room) {
      bm("friend");
      showRoom();
      return;
    }
    // был ли вход в комнату раньше
    var saved = lsGet("mv_room");
    if (saved && /^[A-Z2-9]{6}$/.test(saved)) {
      room = saved;
      bm("friend");
      showRoom();
      return;
    }
    showSetup(false);
  };

  window.addEventListener("hashchange", function () {
    if (location.hash !== "#battle") stopPoll();
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && room && location.hash === "#battle") poll();
  });

  // ---------- ссылка ?battle=КОД ----------
  var m = /[?&]battle=([A-Za-z0-9]{6})/.exec(location.search);
  if (m) {
    pending = m[1].toUpperCase();
    try { history.replaceState(null, "", location.pathname + "#battle"); } catch (e) {}
    go("battle");
  } else if (location.hash === "#battle") {
    window.battleEnter();
  }
})();
