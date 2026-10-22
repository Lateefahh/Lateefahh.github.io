/*
 * The 10 games.
 *
 * Every game is a small, deterministic state machine so that both browsers stay
 * in sync just by applying the same actions in the same way:
 *
 *   init(rand)              -> fresh state (rand is a seeded RNG shared by both sides)
 *   apply(s, a, p, rand)    -> mutate state `s` for action `a` by player `p` (0 = host, 1 = guest).
 *                              Return false to reject an invalid action.
 *   render(s, ctx)          -> HTML string, or {section: html} so unchanged parts aren't re-drawn
 *   after(root, s, ctx)     -> optional hook for canvas drawing / timers
 *
 * In the HTML, `data-act` buttons and `data-form` forms become actions automatically.
 */
(function () {
  // ---------- helpers ----------
  function rng(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const A = (obj) => `data-act="${esc(JSON.stringify(obj))}"`;
  const who = (ctx, p) => `<b class="c${p}">${p === ctx.me ? "You" : esc(ctx.names[p])}</b>`;
  const nm = (ctx, p) => `<b class="c${p}">${esc(ctx.names[p])}</b>`;
  function scores(ctx, score, turn) {
    return `<div class="scores">${[0, 1]
      .map((p) => `<div class="score p${p} ${turn === p ? "turn" : ""}">${esc(ctx.names[p])}${p === ctx.me ? " (you)" : ""} <b>${score[p]}</b></div>`)
      .join("")}</div>`;
  }
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

  // ---------- 1. Tic-Tac-Toe ----------
  const LINES3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const ticTacToe = {
    id: "ttt", name: "Tic-Tac-Toe", icon: "❌", tag: "Classic", blurb: "Three in a row wins. Loser starts next.",
    init: () => ({ b: Array(9).fill(null), turn: 0, starter: 0, score: [0, 0], win: null, line: null, round: 0 }),
    apply(s, a, p) {
      if (a.k === "move") {
        if (s.win !== null || s.turn !== p || s.b[a.i] !== null) return false;
        s.b[a.i] = p;
        const line = LINES3.find((l) => l.every((i) => s.b[i] === p));
        if (line) { s.win = p; s.line = line; s.score[p]++; }
        else if (s.b.every((c) => c !== null)) s.win = "draw";
        else s.turn = 1 - p;
      } else if (a.k === "again") {
        if (a.round !== s.round || s.win === null) return false;
        s.starter = s.win === "draw" ? 1 - s.starter : 1 - s.win;
        Object.assign(s, { b: Array(9).fill(null), turn: s.starter, win: null, line: null, round: s.round + 1 });
      } else return false;
    },
    render(s, ctx) {
      const mark = (v) => (v === 0 ? '<span class="c0">✕</span>' : v === 1 ? '<span class="c1">◯</span>' : "");
      const msg = s.win === "draw" ? "It's a draw! 🤝" : s.win !== null ? `${who(ctx, s.win)} won! 🎉`
        : s.turn === ctx.me ? "Your turn" : `Waiting for ${nm(ctx, s.turn)}…`;
      return `<div class="g">${scores(ctx, s.score, s.win === null ? s.turn : null)}
        <p class="msg-line ${s.win !== null && s.win !== "draw" ? "win" : ""}">${msg}</p>
        <div class="ttt">${s.b.map((v, i) => `<button ${A({ k: "move", i })} class="${s.line && s.line.includes(i) ? "win" : ""}"
          ${v !== null || s.win !== null || s.turn !== ctx.me ? "disabled" : ""}>${mark(v)}</button>`).join("")}</div>
        ${s.win !== null ? `<button class="btn primary" ${A({ k: "again", round: s.round })}>Play again</button>` : ""}
      </div>`;
    },
  };

  // ---------- 2. Connect Four ----------
  const C4W = 7, C4H = 6;
  function c4Win(b, idx, p) {
    const r0 = Math.floor(idx / C4W), c0 = idx % C4W;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells = [idx];
      for (const sgn of [1, -1]) {
        let r = r0 + dr * sgn, c = c0 + dc * sgn;
        while (r >= 0 && r < C4H && c >= 0 && c < C4W && b[r * C4W + c] === p) { cells.push(r * C4W + c); r += dr * sgn; c += dc * sgn; }
      }
      if (cells.length >= 4) return cells;
    }
    return null;
  }
  const connectFour = {
    id: "c4", name: "Connect Four", icon: "🔴", tag: "Classic", blurb: "Drop discs and line up four before they do.",
    init: () => ({ b: Array(C4W * C4H).fill(null), turn: 0, starter: 0, score: [0, 0], win: null, line: null, last: null, round: 0 }),
    apply(s, a, p) {
      if (a.k === "drop") {
        if (s.win !== null || s.turn !== p) return false;
        let idx = -1;
        for (let r = C4H - 1; r >= 0; r--) if (s.b[r * C4W + a.c] === null) { idx = r * C4W + a.c; break; }
        if (idx < 0) return false;
        s.b[idx] = p; s.last = idx;
        const line = c4Win(s.b, idx, p);
        if (line) { s.win = p; s.line = line; s.score[p]++; }
        else if (s.b.every((c) => c !== null)) s.win = "draw";
        else s.turn = 1 - p;
      } else if (a.k === "again") {
        if (a.round !== s.round || s.win === null) return false;
        s.starter = 1 - s.starter;
        Object.assign(s, { b: Array(C4W * C4H).fill(null), turn: s.starter, win: null, line: null, last: null, round: s.round + 1 });
      } else return false;
    },
    render(s, ctx) {
      const msg = s.win === "draw" ? "Board full — draw! 🤝" : s.win !== null ? `${who(ctx, s.win)} connected four! 🎉`
        : s.turn === ctx.me ? `Your turn — tap a column` : `Waiting for ${nm(ctx, s.turn)}…`;
      const off = s.win !== null || s.turn !== ctx.me;
      return `<div class="g">${scores(ctx, s.score, s.win === null ? s.turn : null)}
        <p class="msg-line ${s.win !== null && s.win !== "draw" ? "win" : ""}">${msg}</p>
        <div class="c4">${s.b.map((v, i) => `<button ${A({ k: "drop", c: i % C4W })} ${off ? "disabled" : ""} aria-label="column ${i % C4W + 1}"
          class="${v !== null ? "p" + v : ""} ${s.line && s.line.includes(i) ? "win" : ""} ${s.last === i ? "last" : ""}"></button>`).join("")}</div>
        ${s.win !== null ? `<button class="btn primary" ${A({ k: "again", round: s.round })}>Play again</button>` : ""}
      </div>`;
    },
  };

  // ---------- 3. Rock Paper Scissors ----------
  const RPS = { r: "🪨", p: "📄", s: "✂️" };
  const BEATS = { r: "s", p: "r", s: "p" };
  const rps = {
    id: "rps", name: "Rock Paper Scissors", icon: "✂️", tag: "Quick", blurb: "Pick in secret, reveal together. First to 5?",
    init: () => ({ picks: [null, null], score: [0, 0], round: 0 }),
    apply(s, a, p) {
      if (a.k === "pick") {
        if (s.picks[p] !== null || !RPS[a.v]) return false;
        s.picks[p] = a.v;
        if (s.picks[0] && s.picks[1]) {
          const [x, y] = s.picks;
          if (BEATS[x] === y) s.score[0]++; else if (BEATS[y] === x) s.score[1]++;
        }
      } else if (a.k === "next") {
        if (a.round !== s.round || !(s.picks[0] && s.picks[1])) return false;
        s.picks = [null, null]; s.round++;
      } else if (a.k === "reset") {
        Object.assign(s, rps.init()); s.round = a.round + 1;
      } else return false;
    },
    render(s, ctx) {
      const both = s.picks[0] && s.picks[1];
      const mine = s.picks[ctx.me], them = 1 - ctx.me;
      let body;
      if (both) {
        const [x, y] = s.picks;
        const w = BEATS[x] === y ? 0 : BEATS[y] === x ? 1 : null;
        body = `<div class="row confetti" style="font-size:4rem"><span>${RPS[s.picks[ctx.me]]}</span><span class="muted" style="font-size:1.5rem;align-self:center">vs</span><span>${RPS[s.picks[them]]}</span></div>
          <p class="msg-line ${w !== null ? "win" : ""}">${w === null ? "Tie! 😅" : `${who(ctx, w)} win${w === ctx.me ? "" : "s"} this round!`}</p>
          <button class="btn primary" ${A({ k: "next", round: s.round })}>Next round</button>`;
      } else {
        body = `<p class="msg-line">${mine ? `You picked ${RPS[mine]} — waiting for ${nm(ctx, them)}…` : "Make your pick!"}
          ${s.picks[them] ? `<br><small class="muted">${esc(ctx.names[them])} has picked ✓</small>` : ""}</p>
          <div class="row">${Object.keys(RPS).map((k) => `<button class="choice ${mine === k ? "picked" : ""}" style="min-width:90px;flex:0;font-size:2.6rem"
            ${A({ k: "pick", v: k })} ${mine ? "disabled" : ""}>${RPS[k]}</button>`).join("")}</div>`;
      }
      return `<div class="g">${scores(ctx, s.score)}${body}
        <button class="btn small ghost" ${A({ k: "reset", round: s.round })}>Reset score</button></div>`;
    },
  };

  // ---------- 4. Memory Match ----------
  const MEM_EMOJI = ["🍓", "🌻", "🐶", "🍕", "🌙", "🎧", "🦋", "🍩", "🐱", "🌈", "🎈", "🍒"];
  function memDeal(rand) {
    const picks = shuffle(MEM_EMOJI, rand).slice(0, 8);
    return shuffle(picks.concat(picks), rand);
  }
  const memory = {
    id: "mem", name: "Memory Match", icon: "🃏", tag: "Puzzle", blurb: "Take turns flipping cards. Find a pair, go again!",
    init: (rand) => ({ cards: memDeal(rand), got: Array(16).fill(null), open: [], mismatch: false, turn: 0, score: [0, 0], seq: 0, round: 0 }),
    apply(s, a, p, rand) {
      if (a.k === "flip") {
        if (s.turn !== p || s.got[a.i] !== null) return false;
        if (s.mismatch) { s.open = []; s.mismatch = false; }
        if (s.open.includes(a.i)) return false;
        s.open.push(a.i); s.seq++;
        if (s.open.length === 2) {
          const [x, y] = s.open;
          if (s.cards[x] === s.cards[y]) { s.got[x] = s.got[y] = p; s.score[p]++; s.open = []; }
          else { s.mismatch = true; s.turn = 1 - p; }
        }
      } else if (a.k === "hide") {
        if (!s.mismatch || a.seq !== s.seq) return false;
        s.open = []; s.mismatch = false;
      } else if (a.k === "again") {
        if (a.round !== s.round || s.got.includes(null)) return false;
        const score = s.score;
        Object.assign(s, memory.init(rand), { score, turn: (s.round + 1) % 2, round: s.round + 1 });
      } else return false;
    },
    render(s, ctx) {
      const done = !s.got.includes(null);
      const pairs = [0, 1].map((p) => s.got.filter((g) => g === p).length / 2);
      const msg = done ? (pairs[0] === pairs[1] ? "Tie game! 🤝" : `${who(ctx, pairs[0] > pairs[1] ? 0 : 1)} found the most pairs! 🎉`)
        : s.turn === ctx.me ? (s.mismatch ? "No match for them — your turn!" : "Your turn — flip two cards") : `${nm(ctx, s.turn)} is flipping…`;
      return `<div class="g">${scores(ctx, s.score, done ? null : s.turn)}
        <p class="msg-line ${done ? "win" : ""}">${msg}</p>
        <div class="mem">${s.cards.map((c, i) => {
          const up = s.got[i] !== null || s.open.includes(i);
          return `<button ${A({ k: "flip", i })} class="${up ? "up" : ""} ${s.got[i] !== null ? "got" + s.got[i] : ""}"
            ${s.got[i] !== null || s.turn !== ctx.me || done ? "disabled" : ""}>${up ? c : ""}</button>`;
        }).join("")}</div>
        ${done ? `<button class="btn primary" ${A({ k: "again", round: s.round })}>Deal again</button>` : ""}</div>`;
    },
    after(root, s, ctx) {
      // The player whose turn it now is hides a mismatched pair after a moment.
      if (s.mismatch && s.turn === ctx.me && root._memSeq !== s.seq) {
        root._memSeq = s.seq;
        const seq = s.seq;
        setTimeout(() => ctx.act({ k: "hide", seq }), 1300);
      }
    },
  };

  // ---------- 5. Sliding Puzzle Race ----------
  const SOLVED = [1, 2, 3, 4, 5, 6, 7, 8, 0];
  const neighbors = (i) => [i - 3, i + 3, i % 3 ? i - 1 : -1, i % 3 < 2 ? i + 1 : -1].filter((j) => j >= 0 && j < 9);
  function scramble(rand) {
    let b, prev;
    do {
      b = SOLVED.slice(); prev = -1;
      for (let n = 0; n < 80; n++) {
        const z = b.indexOf(0);
        const opts = neighbors(z).filter((j) => j !== prev);
        const j = opts[Math.floor(rand() * opts.length)];
        [b[z], b[j]] = [b[j], b[z]]; prev = z;
      }
    } while (b.join() === SOLVED.join());
    return b;
  }
  const slide = {
    id: "slide", name: "Sliding Puzzle Race", icon: "🧩", tag: "Puzzle", blurb: "Same scrambled puzzle for both — who solves it first?",
    init: (rand) => { const b = scramble(rand); return { boards: [b.slice(), b.slice()], moves: [0, 0], winner: null, wins: [0, 0], round: 0 }; },
    apply(s, a, p, rand) {
      if (a.k === "move") {
        if (s.winner !== null) return false;
        const b = s.boards[p], z = b.indexOf(0);
        if (!neighbors(z).includes(a.i)) return false;
        [b[z], b[a.i]] = [b[a.i], b[z]]; s.moves[p]++;
        if (b.join() === SOLVED.join()) { s.winner = p; s.wins[p]++; }
      } else if (a.k === "again") {
        if (a.round !== s.round || s.winner === null) return false;
        const b = scramble(rand);
        Object.assign(s, { boards: [b.slice(), b.slice()], moves: [0, 0], winner: null, round: s.round + 1 });
      } else return false;
    },
    render(s, ctx) {
      const me = ctx.me, them = 1 - me;
      const mine = s.boards[me], solved = (b) => b.join() === SOLVED.join();
      const msg = s.winner !== null ? `${who(ctx, s.winner)} solved it first! 🏆` : "Tap a tile next to the gap to slide it. Get 1–8 in order!";
      return `<div class="g">${scores(ctx, s.wins)}
        <p class="msg-line ${s.winner !== null ? "win" : ""}">${msg}</p>
        <div class="boards">
          <div class="board-col"><b>You · ${s.moves[me]} moves</b>
            <div class="slide ${solved(mine) ? "solved" : ""}">${mine.map((v, i) => v === 0 ? `<div class="blank"></div>`
              : `<button ${A({ k: "move", i })} ${s.winner !== null ? "disabled" : ""}>${v}</button>`).join("")}</div></div>
          <div class="board-col"><span class="muted">${esc(ctx.names[them])} · ${s.moves[them]} moves</span>
            <div class="slide mini ${solved(s.boards[them]) ? "solved" : ""}">${s.boards[them].map((v) => `<div class="${v ? "" : "blank"}">${v || ""}</div>`).join("")}</div></div>
        </div>
        ${s.winner !== null ? `<button class="btn primary" ${A({ k: "again", round: s.round })}>New race</button>` : ""}</div>`;
    },
  };

  // ---------- 6. Draw & Guess ----------
  const DRAW_WORDS = ["cat", "pizza", "rainbow", "house", "sun", "tree", "heart", "car", "fish", "guitar", "flower", "moon", "banana",
    "bicycle", "cake", "snowman", "butterfly", "airplane", "dog", "ice cream", "umbrella", "camera", "phone", "book", "glasses", "rocket",
    "turtle", "castle", "kiss", "ring", "beach", "mountain", "pineapple", "spider", "clock", "crown", "ghost", "robot", "donut", "dragon",
    "lamp", "shoe", "sandwich", "elephant", "bridge", "candle", "balloon", "key", "star", "popcorn", "teddy bear", "volcano", "snail"];
  const COLORS = ["#222222", "#ff5c8a", "#ff8a3d", "#ffd23f", "#3ec98a", "#3d8bff", "#8d5cff", "#8b5a2b", "#ffffff"];
  const drawUI = { c: COLORS[0], w: 6 };
  const pickWord = (rand, used) => {
    const left = DRAW_WORDS.filter((w) => !used.includes(w));
    return (left.length ? left : DRAW_WORDS)[Math.floor(rand() * (left.length || DRAW_WORDS.length))];
  };
  const drawGuess = {
    id: "draw", name: "Draw & Guess", icon: "🎨", tag: "Creative", blurb: "One draws a secret word, the other guesses. Swap!",
    init: (rand) => { const w = pickWord(rand, []); return { drawer: 0, word: w, used: [w], strokes: [], clears: 0, guesses: [], solved: false, revealed: false, score: [0, 0], round: 0 }; },
    apply(s, a, p, rand) {
      if (a.k === "stroke") {
        if (p !== s.drawer || s.solved || !Array.isArray(a.pts)) return false;
        s.strokes.push({ pts: a.pts, c: a.c, w: a.w });
      } else if (a.k === "clear") {
        if (p !== s.drawer) return false;
        s.strokes = []; s.clears++;
      } else if (a.k === "guess") {
        const g = String(a.text || "").trim().slice(0, 40);
        if (p === s.drawer || s.solved || !g) return false;
        s.guesses.push(g);
        if (norm(g) === norm(s.word)) { s.solved = true; s.score[0]++; s.score[1]++; }
      } else if (a.k === "reveal") {
        if (s.solved) return false;
        s.solved = true; s.revealed = true;
      } else if (a.k === "skip") {
        if (p !== s.drawer || s.solved) return false;
        s.word = pickWord(rand, s.used); s.used.push(s.word); s.strokes = []; s.clears++; s.guesses = [];
      } else if (a.k === "next") {
        if (a.round !== s.round || !s.solved) return false;
        const w = pickWord(rand, s.used);
        Object.assign(s, { drawer: 1 - s.drawer, word: w, strokes: [], clears: s.clears + 1, guesses: [], solved: false, revealed: false, round: s.round + 1 });
        s.used.push(w);
      } else return false;
    },
    render(s, ctx) {
      const drawing = s.drawer === ctx.me;
      const blanks = s.word.split("").map((c) => (c === " " ? "&nbsp;" : "_")).join(" ");
      let head;
      if (s.solved) head = `<p class="msg-line ${s.revealed ? "" : "win"}">${s.revealed ? "The word was" : "Got it! 🎉 The word was"} <b>${esc(s.word)}</b></p>`;
      else if (drawing) head = `<p class="msg-line">Draw this: <span class="word">${esc(s.word.toUpperCase())}</span></p>`;
      else head = `<p class="msg-line">${nm(ctx, s.drawer)} is drawing… <span class="word">${blanks}</span></p>`;
      const palette = drawing && !s.solved ? `<div class="palette">${COLORS.map((c) => `<button class="swatch ${drawUI.c === c ? "on" : ""}" data-color="${c}" style="background:${c}" aria-label="color"></button>`).join("")}
        <button class="btn small ghost" data-width="4">thin</button><button class="btn small ghost" data-width="12">thick</button>
        <button class="btn small" ${A({ k: "clear" })}>🧽 Clear</button><button class="btn small ghost" ${A({ k: "skip" })}>Skip word</button></div>` : "";
      let foot;
      if (s.solved) foot = `<button class="btn primary" ${A({ k: "next", round: s.round })}>Next round — ${p2(ctx, 1 - s.drawer)} draw${1 - s.drawer === ctx.me ? "" : "s"}</button>`;
      else if (drawing) foot = `<button class="btn small ghost" ${A({ k: "reveal" })}>Give up & reveal</button>`;
      else foot = `<form data-form="guess" class="form-row"><input name="text" id="draw-guess" placeholder="Type your guess…" autocomplete="off" maxlength="40"><button class="btn primary">Guess</button></form>`;
      return {
        head: `<div class="g">${scores(ctx, s.score, s.drawer)}${head}</div>`,
        board: `<div class="g"><div class="draw-wrap"><canvas class="draw-canvas" width="800" height="600" data-round="${s.round}"></canvas>${palette}</div></div>`,
        foot: `<div class="g" style="margin-top:10px">${s.guesses.length ? `<div class="guesses">${s.guesses.map((g) => `<span>${esc(g)}</span>`).join("")}</div>` : ""}${foot}</div>`,
      };
    },
    after(root, s, ctx) {
      const cv = root.querySelector("canvas.draw-canvas");
      if (!cv) return;
      const g = cv.getContext("2d");
      cv._s = s; cv._ctx = ctx;
      cv.classList.toggle("can", s.drawer === ctx.me && !s.solved);
      const line = (pts, c, w) => {
        g.strokeStyle = c; g.fillStyle = c; g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round";
        g.beginPath();
        g.moveTo(pts[0][0] * 800, pts[0][1] * 600);
        for (const [x, y] of pts.slice(1)) g.lineTo(x * 800, y * 600);
        if (pts.length === 1) g.lineTo(pts[0][0] * 800 + 0.1, pts[0][1] * 600);
        g.stroke();
      };
      if (cv._clears !== s.clears || (cv._drawn || 0) > s.strokes.length) {
        g.clearRect(0, 0, 800, 600); cv._drawn = 0; cv._clears = s.clears;
      }
      for (let i = cv._drawn || 0; i < s.strokes.length; i++) line(s.strokes[i].pts, s.strokes[i].c, s.strokes[i].w);
      cv._drawn = s.strokes.length;

      if (!root._drawBound) {
        root._drawBound = true;
        root.addEventListener("click", (e) => {
          const sw = e.target.closest("[data-color]"), wd = e.target.closest("[data-width]");
          if (sw) { drawUI.c = sw.dataset.color; root.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("on", x === sw)); }
          if (wd) drawUI.w = +wd.dataset.width;
        });
      }
      if (cv._bound) return;
      cv._bound = true;
      let cur = null, last = 0;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)]; };
      const flush = (force) => {
        if (!cur || (cur.length < 2 && !force)) return;
        cv._ctx.act({ k: "stroke", pts: cur, c: drawUI.c, w: drawUI.w });
        cur = [cur[cur.length - 1]]; last = performance.now();
      };
      cv.addEventListener("pointerdown", (e) => {
        if (cv._s.drawer !== cv._ctx.me || cv._s.solved) return;
        cv.setPointerCapture(e.pointerId);
        cur = [pos(e)]; last = performance.now();
        line(cur, drawUI.c, drawUI.w);
      });
      cv.addEventListener("pointermove", (e) => {
        if (!cur) return;
        const p = pos(e);
        line([cur[cur.length - 1], p], drawUI.c, drawUI.w);
        cur.push(p);
        if (performance.now() - last > 60) flush();
      });
      const end = () => { if (!cur) return; flush(true); cur = null; };
      cv.addEventListener("pointerup", end);
      cv.addEventListener("pointercancel", end);
    },
  };
  const p2 = (ctx, p) => (p === ctx.me ? "you" : esc(ctx.names[p]));

  // ---------- 7. Hangman ----------
  const HANG_WORDS = ["SUNFLOWER", "CHOCOLATE", "ADVENTURE", "PINEAPPLE", "MOONLIGHT", "BUTTERFLY", "HONEYMOON", "SWEETHEART", "PANCAKES",
    "TREASURE", "STARGAZING", "VALENTINE", "SURPRISE", "CUDDLES", "ROLLERCOASTER", "PASSPORT", "MILKSHAKE", "FIREWORKS", "SPAGHETTI",
    "CAMPFIRE", "DINOSAUR", "WATERMELON", "KARAOKE", "SNOWFLAKE", "LIGHTHOUSE", "POPCORN", "PAJAMAS", "BUBBLEGUM"];
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const MAX_WRONG = 6;
  const hangman = {
    id: "hang", name: "Hangman", icon: "🔤", tag: "Words", blurb: "Set a secret word for your partner to guess, letter by letter.",
    init: () => ({ setter: 0, word: null, guessed: [], wrong: 0, status: "set", score: [0, 0], round: 0 }),
    apply(s, a, p, rand) {
      if (a.k === "set") {
        if (p !== s.setter || s.status !== "set") return false;
        let w = a.random ? HANG_WORDS[Math.floor(rand() * HANG_WORDS.length)]
          : String(a.word || "").toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
        if (!/[A-Z]/.test(w)) return false;
        s.word = w; s.status = "play";
      } else if (a.k === "letter") {
        if (p === s.setter || s.status !== "play" || s.guessed.includes(a.l) || !LETTERS.includes(a.l)) return false;
        s.guessed.push(a.l);
        if (!s.word.includes(a.l)) s.wrong++;
        if (s.wrong >= MAX_WRONG) { s.status = "lost"; s.score[s.setter]++; }
        else if (s.word.split("").every((c) => c === " " || s.guessed.includes(c))) { s.status = "won"; s.score[1 - s.setter]++; }
      } else if (a.k === "next") {
        if (a.round !== s.round || (s.status !== "won" && s.status !== "lost")) return false;
        Object.assign(s, { setter: 1 - s.setter, word: null, guessed: [], wrong: 0, status: "set", round: s.round + 1 });
      } else return false;
    },
    render(s, ctx) {
      const setting = s.setter === ctx.me, guesser = 1 - s.setter;
      let body;
      if (s.status === "set") {
        body = setting
          ? `<p class="msg-line">Pick a secret word for ${nm(ctx, guesser)} to guess</p>
             <form data-form="set" class="form-row"><input name="word" id="hang-word" type="password" placeholder="Secret word…" maxlength="24" autocomplete="off"><button class="btn primary">Set</button></form>
             <button class="btn ghost" ${A({ k: "set", random: true })}>🎲 Use a random word</button>`
          : `<p class="msg-line">${nm(ctx, s.setter)} is choosing a secret word… 🤫</p>`;
      } else {
        const showAll = setting || s.status !== "play";
        const word = `<div class="hang-word">${s.word.split(" ").map((w) => `<div class="hw">${w.split("").map((c) =>
          `<span>${s.guessed.includes(c) || showAll ? `<span class="${s.guessed.includes(c) ? "" : "muted"}">${c}</span>` : ""}</span>`).join("")}</div>`).join("")}</div>`;
        const lives = `<div class="lives">${"❤️".repeat(MAX_WRONG - s.wrong)}${"🖤".repeat(s.wrong)}</div>`;
        const msg = s.status === "won" ? `<p class="msg-line win">${who(ctx, guesser)} guessed it! 🎉</p>`
          : s.status === "lost" ? `<p class="msg-line">Out of hearts! ${who(ctx, s.setter)} win${s.setter === ctx.me ? "" : "s"} this one 😈</p>`
          : setting ? `<p class="msg-line">${nm(ctx, guesser)} is guessing your word…</p>` : `<p class="msg-line">Guess a letter!</p>`;
        const keys = `<div class="keys">${LETTERS.map((l) => {
          const used = s.guessed.includes(l);
          return `<button ${A({ k: "letter", l })} class="${used ? (s.word.includes(l) ? "hit" : "miss") : ""}" ${used || setting || s.status !== "play" ? "disabled" : ""}>${l}</button>`;
        }).join("")}</div>`;
        body = `${msg}${lives}${word}${keys}${s.status !== "play" ? `<button class="btn primary" ${A({ k: "next", round: s.round })}>Next round — ${p2(ctx, guesser)} pick${guesser === ctx.me ? "" : "s"} the word</button>` : ""}`;
      }
      return `<div class="g">${scores(ctx, s.score)}${body}</div>`;
    },
  };

  // ---------- 8. Trivia Duel ----------
  const TRIVIA = [
    ["What is the largest planet in our solar system?", ["Saturn", "Jupiter", "Neptune", "Earth"], 1],
    ["How many hearts does an octopus have?", ["1", "2", "3", "5"], 2],
    ["Which country gifted the Statue of Liberty to the USA?", ["France", "England", "Spain", "Italy"], 0],
    ["What is the hardest natural substance?", ["Gold", "Iron", "Diamond", "Quartz"], 2],
    ["Which planet is known as the Red Planet?", ["Venus", "Mars", "Mercury", "Jupiter"], 1],
    ["What's the capital of Australia?", ["Sydney", "Melbourne", "Canberra", "Perth"], 2],
    ["How many bones are in the adult human body?", ["186", "206", "226", "256"], 1],
    ["What is the main ingredient in guacamole?", ["Avocado", "Tomato", "Lime", "Pepper"], 0],
    ["Which ocean is the largest?", ["Atlantic", "Indian", "Arctic", "Pacific"], 3],
    ["Who painted the Mona Lisa?", ["Van Gogh", "Picasso", "Leonardo da Vinci", "Michelangelo"], 2],
    ["What's the fastest land animal?", ["Cheetah", "Lion", "Pronghorn", "Greyhound"], 0],
    ["How many continents are there?", ["5", "6", "7", "8"], 2],
    ["What gas do plants absorb from the air?", ["Oxygen", "Carbon dioxide", "Nitrogen", "Helium"], 1],
    ["Which language has the most native speakers?", ["English", "Spanish", "Hindi", "Mandarin Chinese"], 3],
    ["What is the smallest prime number?", ["0", "1", "2", "3"], 2],
    ["In which country did sushi originate?", ["China", "Japan", "Korea", "Thailand"], 1],
    ["Which instrument has 88 keys?", ["Organ", "Accordion", "Piano", "Harp"], 2],
    ["What's the longest river in Africa?", ["Congo", "Niger", "Zambezi", "Nile"], 3],
    ["How many minutes are in a day?", ["1,240", "1,440", "1,640", "2,400"], 1],
    ["Which animal is known for changing its color?", ["Chameleon", "Frog", "Iguana", "Gecko"], 0],
    ["Who wrote 'Romeo and Juliet'?", ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"], 1],
    ["What is the freezing point of water in °F?", ["0°F", "32°F", "50°F", "100°F"], 1],
    ["Which is the tallest mountain on Earth?", ["K2", "Kilimanjaro", "Mount Everest", "Denali"], 2],
    ["What color do you get mixing blue and yellow?", ["Purple", "Orange", "Green", "Brown"], 2],
    ["How many players are on a soccer team on the field?", ["9", "10", "11", "12"], 2],
    ["What does a bee make?", ["Milk", "Honey", "Silk", "Wax only"], 1],
    ["Which country is home to the kangaroo?", ["New Zealand", "South Africa", "Australia", "Brazil"], 2],
    ["What's the chemical symbol for gold?", ["Go", "Gd", "Au", "Ag"], 2],
    ["Which is the largest mammal?", ["Elephant", "Blue whale", "Giraffe", "Hippo"], 1],
    ["What is the capital of Canada?", ["Toronto", "Vancouver", "Montreal", "Ottawa"], 3],
    ["How many days are in a leap year?", ["364", "365", "366", "367"], 2],
    ["Which country has the most pyramids?", ["Egypt", "Sudan", "Mexico", "Peru"], 1],
    ["What is the currency of Japan?", ["Yuan", "Won", "Yen", "Ringgit"], 2],
    ["Which organ pumps blood around the body?", ["Lungs", "Liver", "Heart", "Kidneys"], 2],
    ["What's the most-spoken language in Brazil?", ["Spanish", "Portuguese", "English", "French"], 1],
    ["How many strings does a standard guitar have?", ["4", "5", "6", "8"], 2],
    ["What year did humans first land on the Moon?", ["1965", "1969", "1972", "1959"], 1],
    ["Which fruit has its seeds on the outside?", ["Kiwi", "Strawberry", "Raspberry", "Fig"], 1],
    ["What's the largest country by area?", ["Canada", "China", "USA", "Russia"], 3],
    ["Which bird is a symbol of peace?", ["Eagle", "Dove", "Swan", "Owl"], 1],
  ];
  const TRIVIA_N = 10;
  const trivia = {
    id: "trivia", name: "Trivia Duel", icon: "🧠", tag: "Questions", blurb: "10 questions. Both answer, then see who was right.",
    init: (rand) => ({ qs: shuffle(range(TRIVIA.length), rand).slice(0, TRIVIA_N), i: 0, ans: [null, null], score: [0, 0], round: 0 }),
    apply(s, a, p, rand) {
      if (a.k === "answer") {
        if (s.i >= s.qs.length || s.ans[p] !== null || a.i !== s.i) return false;
        s.ans[p] = a.c;
        if (s.ans[0] !== null && s.ans[1] !== null) {
          const right = TRIVIA[s.qs[s.i]][2];
          [0, 1].forEach((q) => { if (s.ans[q] === right) s.score[q]++; });
        }
      } else if (a.k === "next") {
        if (a.i !== s.i || s.ans.includes(null)) return false;
        s.i++; s.ans = [null, null];
      } else if (a.k === "again") {
        if (a.round !== s.round || s.i < s.qs.length) return false;
        Object.assign(s, trivia.init(rand), { round: s.round + 1 });
      } else return false;
    },
    render(s, ctx) {
      if (s.i >= s.qs.length) {
        const [x, y] = s.score;
        return `<div class="g">${scores(ctx, s.score)}<div style="font-size:4rem" class="confetti">🏆</div>
          <p class="msg-line win">${x === y ? "Perfect tie — you two are a match! 💞" : `${who(ctx, x > y ? 0 : 1)} won the trivia duel!`}</p>
          <button class="btn primary" ${A({ k: "again", round: s.round })}>Play again</button></div>`;
      }
      const [q, opts, right] = TRIVIA[s.qs[s.i]];
      const both = !s.ans.includes(null), mine = s.ans[ctx.me], them = 1 - ctx.me;
      return `<div class="g">${scores(ctx, s.score)}<span class="badge">Question ${s.i + 1} of ${s.qs.length}</span>
        <p class="big-q">${esc(q)}</p>
        <div class="row">${opts.map((o, c) => {
          let cls = !both && mine === c ? "picked" : "";
          if (both) cls = c === right ? "right" : s.ans.includes(c) ? "wrong" : "";
          const tags = both ? [0, 1].filter((p) => s.ans[p] === c).map((p) => `<span class="c${p}">${p === ctx.me ? "you" : esc(ctx.names[p])}</span>`).join("") : "";
          return `<button class="choice ${cls}" ${A({ k: "answer", i: s.i, c })} ${mine !== null ? "disabled" : ""}>${esc(o)}${tags ? `<div class="who">${tags}</div>` : ""}</button>`;
        }).join("")}</div>
        <p class="msg-line">${both ? "" : mine !== null ? `Locked in! Waiting for ${nm(ctx, them)}…` : s.ans[them] !== null ? `${nm(ctx, them)} has answered ✓` : ""}</p>
        ${both ? `<button class="btn primary" ${A({ k: "next", i: s.i })}>${s.i + 1 < s.qs.length ? "Next question" : "See results"}</button>` : ""}</div>`;
    },
  };

  // ---------- 9. Would You Rather ----------
  const WYR = [
    ["Travel the world together for a year", "Build your dream home together"],
    ["Always have to sing instead of talk", "Always have to dance when you walk"],
    ["Have a cozy night in", "Have a wild night out"],
    ["Go on a beach vacation", "Go on a mountain getaway"],
    ["Be able to teleport", "Be able to read minds"],
    ["Only eat pizza forever", "Only eat tacos forever"],
    ["Have breakfast in bed every day", "Have a massage every week"],
    ["Relive your first date", "Skip ahead and see your 50th anniversary"],
    ["Live in a big city", "Live in the countryside"],
    ["Never use social media again", "Never watch TV/movies again"],
    ["Have a pet dog", "Have a pet cat"],
    ["Get a handwritten love letter", "Get a surprise gift"],
    ["Be famous", "Be rich but unknown"],
    ["Watch the sunrise together", "Watch the sunset together"],
    ["Go skydiving", "Go deep-sea diving"],
    ["Cook dinner together", "Order takeout and cuddle"],
    ["Know the future", "Change the past"],
    ["Have no phone for a month", "Have no coffee/tea for a month"],
    ["Road trip with no plan", "Fully planned luxury trip"],
    ["Always be 10 minutes late", "Always be 20 minutes early"],
    ["Slow dance in the kitchen", "Karaoke duet in public"],
    ["Live in a treehouse", "Live on a houseboat"],
    ["Have a matching tattoo", "Have matching outfits for a day"],
    ["Fight one horse-sized duck", "Fight 100 duck-sized horses"],
    ["Be the funny one", "Be the smart one"],
    ["Have summer all year", "Have winter all year"],
    ["Get a long hug", "Get a long kiss"],
    ["Go to a concert", "Go to a comedy show"],
    ["Speak every language", "Play every instrument"],
    ["Stay in a castle", "Stay in a glass igloo under the northern lights"],
    ["Have a small wedding", "Have a huge party wedding"],
    ["Always say what you think", "Never speak again"],
    ["Text all day", "Call for an hour at night"],
    ["Win the lottery", "Live twice as long"],
    ["Picnic in the park", "Fancy restaurant dinner"],
    ["Have a rewind button", "Have a pause button for life"],
    ["Be invisible", "Be able to fly"],
    ["Eat dessert first", "Skip dessert forever"],
    ["Get matching pajamas", "Get matching phone cases"],
    ["Movie marathon all weekend", "Game marathon all weekend"],
  ];
  const wyr = {
    id: "wyr", name: "Would You Rather", icon: "🤔", tag: "Questions", blurb: "Pick secretly, then see if you think alike.",
    init: (rand) => ({ order: shuffle(range(WYR.length), rand), i: 0, picks: [null, null], same: 0, total: 0 }),
    apply(s, a, p) {
      if (a.k === "pick") {
        if (a.i !== s.i || s.picks[p] !== null) return false;
        s.picks[p] = a.c;
        if (s.picks[0] !== null && s.picks[1] !== null) { s.total++; if (s.picks[0] === s.picks[1]) s.same++; }
      } else if (a.k === "next") {
        if (a.i !== s.i) return false;
        s.i = (s.i + 1) % s.order.length; s.picks = [null, null];
      } else return false;
    },
    render(s, ctx) {
      const [x, y] = WYR[s.order[s.i]];
      const both = !s.picks.includes(null), mine = s.picks[ctx.me], them = 1 - ctx.me;
      return `<div class="g"><span class="badge">💞 You've matched ${s.same} of ${s.total}</span>
        <p class="big-q">Would you rather…</p>
        <div class="row">${[x, y].map((o, c) => {
          const tags = both ? [0, 1].filter((p) => s.picks[p] === c).map((p) => `<span class="c${p}">${p === ctx.me ? "you" : esc(ctx.names[p])}</span>`).join("") : "";
          return `<button class="choice ${mine === c ? "picked" : ""}" ${A({ k: "pick", i: s.i, c })} ${mine !== null ? "disabled" : ""}>${esc(o)}${tags ? `<div class="who">${tags}</div>` : ""}</button>`;
        }).join(`<span class="muted" style="align-self:center">or</span>`)}</div>
        <p class="msg-line ${both && s.picks[0] === s.picks[1] ? "win" : ""}">${both ? (s.picks[0] === s.picks[1] ? "Same answer! 💕" : "Opposites attract 😜")
          : mine !== null ? `Waiting for ${nm(ctx, them)}…` : s.picks[them] !== null ? `${nm(ctx, them)} has picked ✓` : ""}</p>
        <button class="btn ${both ? "primary" : "ghost small"}" ${A({ k: "next", i: s.i })}>${both ? "Next question" : "Skip"}</button></div>`;
    },
  };

  // ---------- 10. How Well Do You Know Me? ----------
  const KNOW = [
    "What is {n}'s favorite food?", "What is {n}'s dream travel destination?", "What is {n}'s biggest fear?",
    "What's {n}'s favorite movie?", "What would {n} order at a coffee shop?", "What's {n}'s go-to karaoke song?",
    "What was {n}'s first impression of their partner?", "What's {n}'s favorite way to spend a lazy Sunday?",
    "What's {n}'s love language?", "What's {n}'s favorite color?", "What's the best gift {n} has ever received?",
    "What's {n}'s most-used emoji?", "If {n} could have any superpower, what would it be?", "What's {n}'s comfort snack?",
    "What's {n}'s favorite memory together?", "What's {n}'s pet peeve?", "What job would {n} have in another life?",
    "What's {n}'s favorite season?", "Which celebrity would {n} want to have dinner with?", "What's {n}'s hidden talent?",
    "What song reminds {n} of their partner?", "What's {n}'s favorite date idea?", "What's {n}'s guilty-pleasure TV show?",
    "What's something {n} wants to learn?", "What's {n}'s favorite thing about their partner?", "Cats or dogs — what would {n} say?",
    "What's {n}'s ideal pizza topping?", "What's {n} most proud of?", "Where does {n} want to live in 10 years?",
    "What's the first thing {n} notices about a person?",
  ];
  const knowMe = {
    id: "know", name: "How Well Do You Know Me?", icon: "💘", tag: "Questions", blurb: "One answers about themselves, the other guesses. Match = point!",
    init: (rand) => ({ order: shuffle(range(KNOW.length), rand), i: 0, subject: 0, ans: [null, null], judged: null, score: [0, 0] }),
    apply(s, a, p) {
      if (a.k === "answer") {
        const t = String(a.text || "").trim().slice(0, 120);
        if (+a.i !== s.i || s.ans[p] !== null || !t) return false;
        s.ans[p] = t;
      } else if (a.k === "judge") {
        if (a.i !== s.i || p !== s.subject || s.ans.includes(null) || s.judged !== null) return false;
        s.judged = !!a.ok;
        if (a.ok) s.score[1 - s.subject]++;
      } else if (a.k === "next") {
        if (a.i !== s.i) return false;
        s.i = (s.i + 1) % s.order.length; s.subject = 1 - s.subject; s.ans = [null, null]; s.judged = null;
      } else return false;
    },
    render(s, ctx) {
      const subj = s.subject, guesser = 1 - subj, meSubj = subj === ctx.me;
      const q = KNOW[s.order[s.i]].replace("{n}", ctx.names[subj]);
      const both = !s.ans.includes(null), mine = s.ans[ctx.me], them = 1 - ctx.me;
      let body;
      if (!both) {
        body = mine === null
          ? `<p class="muted" style="margin:0">${meSubj ? "Answer honestly about yourself 🤍" : `Guess what ${nm(ctx, subj)} will say!`}</p>
             <form data-form="answer" class="form-row"><input type="hidden" name="i" value="${s.i}"><input name="text" id="know-ans" maxlength="120" placeholder="${meSubj ? "Your answer…" : "Your guess…"}" autocomplete="off"><button class="btn primary">Lock in</button></form>`
          : `<p class="msg-line">Locked in ✓ Waiting for ${nm(ctx, them)}…</p>`;
        if (mine === null && s.ans[them] !== null) body += `<p class="muted" style="margin:0">${esc(ctx.names[them])} has answered ✓</p>`;
      } else {
        body = `<div class="answers">
            <div class="answer p${subj}"><small>${esc(ctx.names[subj])}'s real answer</small>${esc(s.ans[subj])}</div>
            <div class="answer p${guesser}"><small>${esc(ctx.names[guesser])}'s guess</small>${esc(s.ans[guesser])}</div></div>`;
        if (s.judged === null) {
          body += meSubj ? `<p class="msg-line">Did they get it right?</p><div class="row">
              <button class="btn primary" ${A({ k: "judge", i: s.i, ok: true })}>✅ Close enough!</button>
              <button class="btn" ${A({ k: "judge", i: s.i, ok: false })}>❌ Nope</button></div>`
            : `<p class="msg-line">${nm(ctx, subj)} is judging your guess… 🙈</p>`;
        } else {
          body += `<p class="msg-line ${s.judged ? "win" : ""}">${s.judged ? `${who(ctx, guesser)} nailed it! 💘` : "Not quite! 😂"}</p>
            <button class="btn primary" ${A({ k: "next", i: s.i })}>Next question</button>`;
        }
      }
      return `<div class="g">${scores(ctx, s.score)}<span class="badge">About ${meSubj ? "you" : esc(ctx.names[subj])}</span>
        <p class="big-q">${esc(q)}</p>${body}
        ${both ? "" : `<button class="btn small ghost" ${A({ k: "next", i: s.i })}>Skip question</button>`}</div>`;
    },
  };

  window.Games = {
    list: [ticTacToe, connectFour, rps, memory, slide, drawGuess, hangman, trivia, wyr, knowMe],
    rng,
    esc,
  };
})();
