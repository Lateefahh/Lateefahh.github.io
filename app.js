/*
 * Rooms, video calling and game syncing.
 *
 * Connection: PeerJS (WebRTC). The room creator registers a peer id built from the
 * room code; the partner connects to it. Video/audio flows over a media call and
 * everything else (game moves, chat, hearts) over a data channel.
 */
(function () {
  const { list: GAMES, rng, esc } = window.Games;
  const PREFIX = "ustwo-love-room-";
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const $ = (s) => document.querySelector(s);

  const st = {
    peer: null, conn: null, call: null, localStream: null,
    host: false, code: null, names: ["", ""], me: 0,
    gameId: null, gs: null, retries: 0, leaving: false,
  };
  const other = () => 1 - st.me;
  const rand32 = () => (Math.random() * 4294967296) >>> 0;
  const connected = () => !!(st.conn && st.conn.open);

  // ---------- peer config (overridable for self-hosting: ?peerhost=..&peerport=..&peerpath=..&peersecure=0) ----------
  function peerOptions() {
    const q = new URLSearchParams(location.search);
    const o = { debug: 1 };
    if (q.get("peerhost")) {
      o.host = q.get("peerhost");
      o.port = +(q.get("peerport") || 443);
      o.path = q.get("peerpath") || "/";
      o.secure = q.get("peersecure") !== "0";
    }
    return o;
  }

  // ---------- lobby ----------
  const params = new URLSearchParams(location.search);
  const invitedCode = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  try { $("#name").value = localStorage.getItem("ustwo-name") || ""; } catch (e) { /* storage blocked */ }
  if (invitedCode) {
    $("#lobby-create").hidden = true;
    $("#lobby-invited").hidden = false;
    $("#invited-code").textContent = invitedCode;
  }

  function myName() {
    const n = $("#name").value.trim().slice(0, 20);
    if (!n) { lobbyStatus("Type your name first 💕"); $("#name").focus(); return null; }
    try { localStorage.setItem("ustwo-name", n); } catch (e) { /* ignore */ }
    return n;
  }
  const lobbyStatus = (t) => { $("#lobby-status").textContent = t; };
  function setLobbyBusy(b) { document.querySelectorAll("#lobby button").forEach((x) => (x.disabled = b)); }

  $("#btn-create").addEventListener("click", () => { const n = myName(); if (n) { unlockAudio(); createRoom(n); } });
  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#join-code").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const n = myName();
    if (!n) return;
    if (code.length < 4) return lobbyStatus("Enter the room code your partner sent you");
    unlockAudio();
    joinRoom(n, code);
  });
  $("#btn-join-invite").addEventListener("click", () => { const n = myName(); if (n) { unlockAudio(); joinRoom(n, invitedCode); } });

  async function getMedia() {
    lobbyStatus("Asking for camera & microphone…");
    try { return await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: true }); } catch (e) { /* try audio only */ }
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); toast("No camera found — joining with audio only"); return s; } catch (e) { /* none */ }
    toast("Camera/mic blocked — you can still play games 🎮");
    return placeholderStream();
  }
  function placeholderStream() {
    const c = document.createElement("canvas");
    c.width = 320; c.height = 240;
    const g = c.getContext("2d");
    g.fillStyle = "#241a31"; g.fillRect(0, 0, 320, 240);
    g.font = "64px sans-serif"; g.textAlign = "center"; g.fillText("💞", 160, 140);
    return c.captureStream ? c.captureStream(1) : new MediaStream();
  }

  function peerMissing() {
    if (window.Peer) return false;
    lobbyStatus("The video-call part didn't load. Check your internet, then refresh the page.");
    setLobbyBusy(false);
    return true;
  }

  async function createRoom(name) {
    if (peerMissing()) return;
    setLobbyBusy(true);
    st.host = true; st.me = 0; st.names[0] = name;
    st.localStream = await getMedia();
    const tryOpen = (attempt) => {
      const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
      lobbyStatus("Creating your room…");
      const peer = new Peer(PREFIX + code, peerOptions());
      peer.on("open", () => { st.peer = peer; st.code = code; enterRoom(); });
      peer.on("error", (err) => {
        if (err.type === "unavailable-id" && attempt < 5) { peer.destroy(); tryOpen(attempt + 1); return; }
        if (!st.peer) { lobbyStatus("Couldn't create a room: " + err.type + ". Check your internet and try again."); setLobbyBusy(false); return; }
        handlePeerError(err);
      });
      peer.on("connection", (conn) => {
        if (connected()) { conn.on("open", () => { conn.send({ t: "full" }); setTimeout(() => conn.close(), 500); }); return; }
        setupConn(conn);
      });
      peer.on("call", (call) => { call.answer(st.localStream); setupCall(call); });
      peer.on("disconnected", () => keepAlive(peer));
    };
    tryOpen(0);
  }

  async function joinRoom(name, code) {
    if (peerMissing()) return;
    setLobbyBusy(true);
    st.host = false; st.me = 1; st.names[1] = name; st.code = code;
    st.localStream = await getMedia();
    lobbyStatus("Connecting to room " + code + "…");
    const peer = new Peer(peerOptions());
    st.peer = peer;
    peer.on("open", () => connectToHost());
    peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        if ($("#room").hidden) { lobbyStatus("Room " + code + " isn't open. Ask your partner to create it (or check the code)."); setLobbyBusy(false); }
        else scheduleRetry();
        return;
      }
      if ($("#room").hidden) { lobbyStatus("Connection problem: " + err.type); setLobbyBusy(false); return; }
      handlePeerError(err);
    });
    peer.on("disconnected", () => keepAlive(peer));
  }

  // Reconnect to the signaling server if it drops after we were in a room (calls already open keep working).
  function keepAlive(peer) {
    if (st.leaving || peer.destroyed || st.peer !== peer || $("#room").hidden) return;
    setTimeout(() => { if (peer.disconnected && !peer.destroyed) peer.reconnect(); }, 2000);
  }

  function connectToHost() {
    const conn = st.peer.connect(PREFIX + st.code, { reliable: true });
    setupConn(conn);
    conn.on("open", () => {
      if ($("#room").hidden) enterRoom();
      const call = st.peer.call(PREFIX + st.code, st.localStream);
      if (call) setupCall(call);
    });
  }
  function scheduleRetry() {
    if (st.host || st.leaving || st.retries > 20) return;
    st.retries++;
    setTimeout(() => { if (!connected() && !st.leaving) connectToHost(); }, 3000);
  }
  function handlePeerError(err) {
    console.warn("peer error", err);
    if (err.type === "network" || err.type === "server-error" || err.type === "socket-error") toast("Connection hiccup — retrying…");
  }

  // ---------- data connection ----------
  function setupConn(conn) {
    conn.on("open", () => {
      st.conn = conn; st.retries = 0;
      conn.send({ t: "hello", name: st.names[st.me] });
      setConnUI(true);
    });
    conn.on("data", onData);
    conn.on("close", () => {
      if (st.conn !== conn) return;
      st.conn = null;
      setConnUI(false);
      if (!st.leaving) { sys(`${st.names[other()] || "Your partner"} disconnected`); toast("Your partner disconnected — they can rejoin with the same link"); }
      showRemote(null);
      scheduleRetry();
    });
    conn.on("error", (e) => console.warn("conn error", e));
  }
  const send = (m) => { if (connected()) st.conn.send(m); };

  function onData(m) {
    if (!m || typeof m !== "object") return;
    switch (m.t) {
      case "hello":
        st.names[other()] = String(m.name || "Partner").slice(0, 20);
        $("#remote-name").textContent = st.names[other()];
        sys(`${st.names[other()]} joined 💖`);
        if (st.host) send({ t: "sync", id: st.gameId, gs: st.gs });
        paint();
        break;
      case "full":
        lobbyStatus("That room already has two people in it.");
        toast("That room already has two people in it.");
        break;
      case "sync":
        st.gameId = m.id || null; st.gs = m.gs || null;
        saveCarry();
        resetStage(); paint();
        break;
      case "select":
        applySelect(m.id, m.r, m.carry);
        break;
      case "act":
        if (m.id === st.gameId && st.gs) applyAction(m.a, other());
        break;
      case "chat":
        chatLine(String(m.text).slice(0, 200), false);
        break;
      case "heart":
        floatHearts();
        break;
    }
  }

  // ---------- media call ----------
  function setupCall(call) {
    st.call = call;
    call.on("stream", (stream) => showRemote(stream));
    call.on("close", () => { if (st.call === call) showRemote(null); });
    call.on("error", (e) => console.warn("call error", e));
  }
  function showRemote(stream) {
    const v = $("#remote-video");
    v.srcObject = stream;
    $("#remote-placeholder").hidden = !!stream;
    routeAudio(stream);
    if (stream) v.play().catch(() => toast("Tap anywhere to turn on sound 🔊"));
  }
  document.addEventListener("click", () => {
    const v = $("#remote-video");
    if (v.srcObject && v.paused) v.play().catch(() => {});
    if (audio.ctx && audio.ctx.state !== "running") audio.ctx.resume().catch(() => {});
  });

  // ---------- speaker volume ----------
  // iPhone Safari ignores <video>.volume, so the partner's audio goes through a Web Audio gain node.
  // The video element stays attached (muted) because Chrome won't play a remote WebRTC stream through Web Audio otherwise.
  const audio = { ctx: null, gain: null, src: null, vol: 1, lastVol: 1 };
  try { const v = parseFloat(localStorage.getItem("ustwo-vol")); if (v >= 0 && v <= 1.5) audio.vol = v; } catch (e) { /* storage blocked */ }
  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (audio.ctx || !AC) return;
    try {
      audio.ctx = new AC();
      audio.gain = audio.ctx.createGain();
      audio.gain.gain.value = audio.vol;
      audio.gain.connect(audio.ctx.destination);
      audio.ctx.resume().catch(() => {});
    } catch (e) { audio.ctx = null; }
  }
  function routeAudio(stream) {
    const v = $("#remote-video");
    if (audio.src) { try { audio.src.disconnect(); } catch (e) { /* already gone */ } audio.src = null; }
    if (stream && stream.getAudioTracks().length && audio.ctx) {
      try {
        audio.src = audio.ctx.createMediaStreamSource(stream);
        audio.src.connect(audio.gain);
        v.muted = true;
        if (audio.ctx.state !== "running") audio.ctx.resume().catch(() => {});
        return;
      } catch (e) { audio.src = null; }
    }
    v.muted = false; // fallback: plain element volume (works everywhere except iPhone)
    applyVolume();
  }
  function applyVolume() {
    if (audio.gain) audio.gain.gain.value = audio.vol;
    $("#remote-video").volume = Math.min(1, audio.vol);
    const pct = Math.round(audio.vol * 100);
    $("#vol").value = pct;
    $("#vol-pct").textContent = pct + "%";
    $("#btn-speaker").textContent = pct === 0 ? "🔇" : pct < 50 ? "🔈" : pct <= 100 ? "🔉" : "🔊";
    $("#btn-speaker").classList.toggle("off", pct === 0);
    try { localStorage.setItem("ustwo-vol", String(audio.vol)); } catch (e) { /* ignore */ }
  }
  $("#vol").addEventListener("input", (e) => {
    audio.vol = e.target.value / 100;
    if (audio.vol > 0) audio.lastVol = audio.vol;
    applyVolume();
  });
  $("#btn-speaker").addEventListener("click", () => {
    if (audio.vol > 0) { audio.lastVol = audio.vol; audio.vol = 0; } else audio.vol = audio.lastVol || 1;
    applyVolume();
  });
  applyVolume();

  // ---------- room UI ----------
  function enterRoom() {
    $("#lobby").hidden = true;
    $("#room").hidden = false;
    $("#room-code").textContent = st.code;
    $("#local-video").srcObject = st.localStream;
    history.replaceState(null, "", inviteLink() + keepPeerParams());
    $("#waiting-text").innerHTML = st.host
      ? `Waiting for your partner…<br><small>Send them the invite link (room <b>${st.code}</b>)</small>`
      : "Connecting video…";
    setMediaButtons();
    paint();
    if (st.host) sys(`Room ${st.code} is ready. Tap “Invite” to copy the link 💌`);
  }
  function keepPeerParams() {
    const q = new URLSearchParams(location.search), keep = new URLSearchParams();
    ["peerhost", "peerport", "peerpath", "peersecure"].forEach((k) => q.get(k) && keep.set(k, q.get(k)));
    const s = keep.toString();
    return s ? "&" + s : "";
  }
  const inviteLink = () => location.origin + location.pathname + "?room=" + st.code;

  function setConnUI(on) {
    $("#conn-pill").classList.toggle("on", on);
    $("#conn-text").textContent = on ? `With ${st.names[other()] || "partner"}` : st.host ? "Waiting for partner" : "Reconnecting…";
    if (!on) $("#remote-name").textContent = "";
  }

  $("#btn-copy").addEventListener("click", async () => {
    const link = inviteLink() + keepPeerParams();
    if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      try { await navigator.share({ title: "Come play with me 💞", text: "Join my video & games room!", url: link }); return; } catch (e) { /* fall through */ }
    }
    try { await navigator.clipboard.writeText(link); toast("Invite link copied! Send it to your partner 💌"); }
    catch (e) { prompt("Copy this link and send it to your partner:", link); }
  });

  function tracks(kind) { return st.localStream ? st.localStream.getTracks().filter((t) => t.kind === kind) : []; }
  function setMediaButtons() {
    const mic = tracks("audio"), cam = tracks("video");
    $("#btn-mic").classList.toggle("off", !mic.length || !mic[0].enabled);
    $("#btn-cam").classList.toggle("off", !cam.length || !cam[0].enabled);
  }
  $("#btn-mic").addEventListener("click", () => { tracks("audio").forEach((t) => (t.enabled = !t.enabled)); setMediaButtons(); });
  $("#btn-cam").addEventListener("click", () => { tracks("video").forEach((t) => (t.enabled = !t.enabled)); setMediaButtons(); });
  $("#btn-heart").addEventListener("click", () => { floatHearts(); send({ t: "heart" }); });
  $("#btn-leave").addEventListener("click", () => {
    if (!confirm("Leave the room?")) return;
    st.leaving = true;
    if (st.localStream) st.localStream.getTracks().forEach((t) => t.stop());
    if (st.peer) st.peer.destroy();
    location.href = location.pathname;
  });

  // chat
  $("#chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#chat-input").value.trim();
    if (!text) return;
    $("#chat-input").value = "";
    chatLine(text, true);
    send({ t: "chat", text });
  });
  function chatLine(text, mine) {
    const d = document.createElement("div");
    d.className = "msg" + (mine ? " me" : "");
    d.textContent = text;
    appendLog(d);
  }
  function sys(text) {
    const d = document.createElement("div");
    d.className = "sys";
    d.textContent = text;
    appendLog(d);
  }
  function appendLog(d) { const log = $("#chat-log"); log.appendChild(d); log.scrollTop = log.scrollHeight; }

  let toastTimer;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }
  function floatHearts() {
    const box = $("#hearts");
    for (let i = 0; i < 12; i++) {
      const h = document.createElement("span");
      h.textContent = ["❤️", "💖", "💕", "💗", "😘"][i % 5];
      h.style.left = Math.random() * 95 + "%";
      h.style.animationDelay = Math.random() * 0.8 + "s";
      box.appendChild(h);
      setTimeout(() => h.remove(), 3600);
    }
  }

  // ---------- games ----------
  const gameById = (id) => GAMES.find((g) => g.id === id);
  const stage = $("#stage-body");
  const ctx = () => ({ me: st.me, names: st.names.map((n, i) => n || (i === st.me ? "You" : "Partner")), act });

  function selectGame(id) {
    if (id && !connected()) toast("Your partner isn't here yet — the game will be waiting for them 💌");
    const r = rand32();
    const carry = loadCarry(id); // e.g. which trivia questions you've already played; sent so both sides start identically
    applySelect(id, r, carry);
    send({ t: "select", id, r, carry });
  }
  function applySelect(id, r, carry) {
    const g = gameById(id);
    st.gameId = g ? id : null;
    st.gs = g ? g.init(rng(r), carry) : null;
    saveCarry();
    resetStage(); paint();
  }
  // Games with a carry() keep a little history between visits (in this browser).
  function loadCarry(id) {
    const g = gameById(id);
    if (!g || !g.carry) return undefined;
    try { return JSON.parse(localStorage.getItem("ustwo-carry-" + id)) || undefined; } catch (e) { return undefined; }
  }
  function saveCarry() {
    const g = gameById(st.gameId);
    if (!g || !g.carry || !st.gs) return;
    try { localStorage.setItem("ustwo-carry-" + g.id, JSON.stringify(g.carry(st.gs))); } catch (e) { /* storage blocked */ }
  }
  function act(a) {
    if (!st.gs) return;
    if (!connected()) { toast("Wait for your partner to join first 💕"); return; }
    a = Object.assign({}, a, { r: rand32() });
    if (applyAction(a, st.me)) send({ t: "act", id: st.gameId, a });
  }
  function applyAction(a, p) {
    const g = gameById(st.gameId);
    const next = JSON.parse(JSON.stringify(st.gs)); // plain-data clone; works on older phones without structuredClone
    if (g.apply(next, a, p, rng(a.r >>> 0)) === false) return false;
    st.gs = next;
    saveCarry();
    paint();
    return true;
  }

  function resetStage() {
    clearTimeout(stage._rxTimer);
    clearInterval(stage._chTimer);
    stage.innerHTML = "";
    Object.assign(stage, { _menu: null, _drawBound: false, _memSeq: undefined, _rxRound: undefined, _rxGo: 0, _chTurn: undefined });
  }

  function paint() {
    const g = gameById(st.gameId);
    $("#btn-back").hidden = !g;
    $("#stage-title").textContent = g ? `${g.icon} ${g.name}` : "Pick a game";
    if (!g) {
      const html = `<div class="game-grid">${GAMES.map((x) => `<button class="game-card" data-pick="${x.id}">
        <span class="gi">${x.icon}</span><span class="tag">${esc(x.tag)}</span><b>${esc(x.name)}</b><small>${esc(x.blurb)}</small></button>`).join("")}</div>
        <p class="muted" style="text-align:center;margin-top:16px">Whatever one of you picks opens for both of you.</p>`;
      if (stage._menu !== html) { stage.innerHTML = html; stage._menu = html; }
      return;
    }
    stage._menu = null;
    const c = ctx();
    let out = g.render(st.gs, c);
    if (typeof out === "string") out = { main: out };
    const keys = Object.keys(out);
    stage.querySelectorAll(":scope > [data-sec]").forEach((el) => { if (!keys.includes(el.dataset.sec)) el.remove(); });
    keys.forEach((k, i) => {
      let el = stage.querySelector(`:scope > [data-sec="${k}"]`);
      if (!el) { el = document.createElement("div"); el.dataset.sec = k; stage.appendChild(el); }
      if (stage.children[i] !== el) stage.insertBefore(el, stage.children[i]);
      if (el._html === out[k]) return;
      // keep typing focus / text when a section is redrawn
      const f = document.activeElement && el.contains(document.activeElement) && document.activeElement.id ? document.activeElement : null;
      const saved = f && { id: f.id, v: f.value, s: f.selectionStart };
      el.innerHTML = out[k];
      el._html = out[k];
      if (saved) {
        const n = document.getElementById(saved.id);
        if (n) { n.value = saved.v; n.focus(); try { n.setSelectionRange(saved.s, saved.s); } catch (e) { /* ignore */ } }
      }
    });
    if (g.after) g.after(stage, st.gs, c);
  }

  $("#btn-back").addEventListener("click", () => selectGame(null));
  stage.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) return selectGame(pick.dataset.pick);
    const b = e.target.closest("[data-act]");
    if (b && !b.disabled) act(JSON.parse(b.dataset.act));
  });
  stage.addEventListener("submit", (e) => {
    const f = e.target.closest("[data-form]");
    if (!f) return;
    e.preventDefault();
    const a = { k: f.dataset.form };
    new FormData(f).forEach((v, k) => (a[k] = v));
    f.querySelectorAll("input:not([type=hidden])").forEach((i) => (i.value = ""));
    act(a);
  });

  window.addEventListener("beforeunload", () => { st.leaving = true; if (st.peer) st.peer.destroy(); });
})();
