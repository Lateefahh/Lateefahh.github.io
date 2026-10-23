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
    ["What is the capital of Nigeria?", ["Lagos", "Abuja", "Kano", "Ibadan"], 1],
    ["Which planet is closest to the Sun?", ["Venus", "Earth", "Mercury", "Mars"], 2],
    ["What is the largest hot desert in the world?", ["Gobi", "Kalahari", "Sahara", "Arabian"], 2],
    ["How many sides does a hexagon have?", ["5", "6", "7", "8"], 1],
    ["Who wrote the Harry Potter books?", ["J.K. Rowling", "Roald Dahl", "Suzanne Collins", "Stephen King"], 0],
    ["At what temperature does water boil at sea level?", ["90°C", "100°C", "110°C", "120°C"], 1],
    ["Which is the most populous country in Africa?", ["Egypt", "Ethiopia", "Nigeria", "South Africa"], 2],
    ["Which element has the symbol 'O'?", ["Gold", "Oxygen", "Silver", "Iron"], 1],
    ["How many legs does a spider have?", ["6", "8", "10", "12"], 1],
    ["Who released the album 'Thriller'?", ["Prince", "Michael Jackson", "Stevie Wonder", "Whitney Houston"], 1],
    ["In which city is the Eiffel Tower?", ["Rome", "London", "Paris", "Madrid"], 2],
    ["What's the largest organ of the human body?", ["Liver", "Brain", "Skin", "Heart"], 2],
    ["What is the tallest animal in the world?", ["Elephant", "Giraffe", "Camel", "Ostrich"], 1],
    ["What is the square root of 81?", ["7", "8", "9", "10"], 2],
    ["On which continent is Egypt?", ["Asia", "Africa", "Europe", "South America"], 1],
    ["Which sport is played at Wimbledon?", ["Golf", "Cricket", "Tennis", "Rugby"], 2],
    ["What does 'www' stand for in a website address?", ["World Wide Web", "Wide World Web", "Web World Wide", "World Web Wide"], 0],
    ["Which is the smallest planet in our solar system?", ["Mars", "Mercury", "Uranus", "Venus"], 1],
    ["What is the main language spoken in Mexico?", ["Portuguese", "Spanish", "English", "French"], 1],
    ["How many hours are in a week?", ["148", "158", "168", "178"], 2],
    ["Who was the first person to walk on the Moon?", ["Buzz Aldrin", "Neil Armstrong", "Yuri Gagarin", "Michael Collins"], 1],
    ["'An ___ a day keeps the doctor away' — which fruit?", ["Banana", "Apple", "Orange", "Grape"], 1],
    ["What is the national animal of Scotland?", ["Lion", "Unicorn", "Stag", "Eagle"], 1],
    ["Which ocean lies between Africa and Australia?", ["Atlantic", "Pacific", "Indian", "Arctic"], 2],
    ["What color is a ruby?", ["Blue", "Green", "Red", "Purple"], 2],
    ["Which music genre did Bob Marley make famous worldwide?", ["Jazz", "Reggae", "Afrobeat", "Blues"], 1],
    ["Which Nigerian star calls himself 'Odogwu'?", ["Wizkid", "Davido", "Burna Boy", "Rema"], 2],
    ["Which Nigerian artist sang 'Calm Down'?", ["Rema", "Asake", "Tems", "CKay"], 0],
    ["What is the currency of Nigeria?", ["Cedi", "Naira", "Rand", "Shilling"], 1],
    ["Accra is the capital of which country?", ["Ghana", "Kenya", "Senegal", "Togo"], 0],
    ["How many players per team are on a basketball court?", ["4", "5", "6", "7"], 1],
    ["Which country won the 2022 FIFA World Cup?", ["France", "Brazil", "Argentina", "Croatia"], 2],
    ["What is the longest bone in the human body?", ["Femur", "Spine", "Skull", "Humerus"], 0],
    ["What do caterpillars turn into?", ["Bees", "Butterflies", "Beetles", "Dragonflies"], 1],
    ["Which company makes the iPhone?", ["Samsung", "Google", "Apple", "Nokia"], 2],
    ["What's the name of the cowboy in Toy Story?", ["Buzz", "Woody", "Rex", "Hamm"], 1],
    ["Which planet is famous for its big rings?", ["Jupiter", "Saturn", "Mars", "Mercury"], 1],
    ["How many colors are in a rainbow?", ["5", "6", "7", "8"], 2],
    ["What is 12 × 12?", ["124", "144", "132", "148"], 1],
    ["Which country is famous for maple syrup?", ["USA", "Canada", "Norway", "Sweden"], 1],
    ["Who painted 'The Starry Night'?", ["Monet", "Van Gogh", "Picasso", "Rembrandt"], 1],
    ["Which is the largest continent?", ["Africa", "Asia", "North America", "Europe"], 1],
    ["What do bees collect from flowers to make honey?", ["Nectar", "Sap", "Dew", "Seeds"], 0],
    ["What is the capital of Japan?", ["Osaka", "Kyoto", "Tokyo", "Seoul"], 2],
    ["How many sides does an octagon have?", ["6", "7", "8", "10"], 2],
    ["Which famous ship sank on its first voyage in 1912?", ["Lusitania", "Titanic", "Britannic", "Queen Mary"], 1],
    ["Which superhero is the king of Wakanda?", ["Black Panther", "Iron Man", "Thor", "Captain America"], 0],
    ["What is the fear of spiders called?", ["Claustrophobia", "Arachnophobia", "Acrophobia", "Agoraphobia"], 1],
    ["On what date is Valentine's Day?", ["Feb 12", "Feb 14", "Feb 16", "Mar 14"], 1],
    ["How many teeth does an adult human usually have?", ["28", "30", "32", "36"], 2],
    ["In which country is the Taj Mahal?", ["Pakistan", "India", "Bangladesh", "Nepal"], 1],
    ["Which animal is called the 'King of the Jungle'?", ["Tiger", "Lion", "Elephant", "Gorilla"], 1],
    ["What's the main ingredient in jollof rice?", ["Beans", "Rice", "Yam", "Plantain"], 1],
    ["Which country gave the world pizza?", ["France", "Greece", "Italy", "USA"], 2],
    ["How many weeks are in a year?", ["50", "52", "54", "56"], 1],
    ["Who is known as the 'Queen of Pop'?", ["Beyoncé", "Madonna", "Rihanna", "Lady Gaga"], 1],
    ["What is the closest star to Earth?", ["Sirius", "Polaris", "The Sun", "Alpha Centauri"], 2],
    ["What is a baby kangaroo called?", ["Cub", "Joey", "Kit", "Calf"], 1],
    ["What is the capital of Kenya?", ["Mombasa", "Nairobi", "Kampala", "Addis Ababa"], 1],
    ["How many Grand Slam tennis tournaments are there each year?", ["3", "4", "5", "6"], 1],
    ["Which vitamin does your skin make from sunlight?", ["Vitamin A", "Vitamin C", "Vitamin D", "Vitamin K"], 2],
    ["Who came up with the theory of relativity?", ["Isaac Newton", "Albert Einstein", "Charles Darwin", "Nikola Tesla"], 1],
    ["Which of these birds can't fly?", ["Penguin", "Parrot", "Pigeon", "Sparrow"], 0],
    ["What's the hottest planet in our solar system?", ["Mercury", "Venus", "Mars", "Jupiter"], 1],
    ["How many zeros are in one million?", ["5", "6", "7", "9"], 1],
  ];
  const TRIVIA_N = 10;
  // Pick questions you haven't seen yet this session; start over once they've all been used.
  function triviaPick(rand, seen) {
    let pool = range(TRIVIA.length).filter((q) => !seen.includes(q));
    if (pool.length < TRIVIA_N) { seen = []; pool = range(TRIVIA.length); }
    const qs = shuffle(pool, rand).slice(0, TRIVIA_N);
    return { qs, seen: seen.concat(qs) };
  }
  const trivia = {
    id: "trivia", name: "Trivia Duel", icon: "🧠", tag: "Questions", blurb: `10 questions from a bank of ${TRIVIA.length}. Both answer, then see who was right.`,
    init: (rand, seen = []) => Object.assign(triviaPick(rand, seen), { i: 0, ans: [null, null], score: [0, 0], round: 0 }),
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
        Object.assign(s, trivia.init(rand, s.seen || []), { round: s.round + 1 });
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

  // ---------- 11. Battleship ----------
  const BS = 8, SHIPS = [4, 3, 3, 2];
  function randomFleet(rand) {
    const taken = new Set(), fleet = [];
    for (const len of SHIPS) {
      for (;;) {
        const horiz = rand() < 0.5;
        const r = Math.floor(rand() * (horiz ? BS : BS - len + 1)), c = Math.floor(rand() * (horiz ? BS - len + 1 : BS));
        const cells = range(len).map((k) => (horiz ? r * BS + c + k : (r + k) * BS + c));
        if (cells.some((x) => taken.has(x))) continue;
        cells.forEach((x) => taken.add(x));
        fleet.push(cells);
        break;
      }
    }
    return fleet;
  }
  const sunk = (ship, shots) => ship.every((x) => shots.includes(x));
  const battleship = {
    id: "ships", name: "Battleship", icon: "🚢", tag: "Strategy", blurb: "Hide your fleet, then take turns firing. Sink all their ships!",
    init: (rand) => ({ phase: "place", fleets: [randomFleet(rand), randomFleet(rand)], ready: [false, false], shots: [[], []], turn: 0, winner: null, score: [0, 0], round: 0 }),
    apply(s, a, p, rand) {
      if (a.k === "shuffle") {
        if (s.phase !== "place" || s.ready[p]) return false;
        s.fleets[p] = randomFleet(rand);
      } else if (a.k === "ready") {
        if (s.phase !== "place" || s.ready[p]) return false;
        s.ready[p] = true;
        if (s.ready[0] && s.ready[1]) s.phase = "play";
      } else if (a.k === "fire") {
        if (s.phase !== "play" || s.turn !== p || s.shots[p].includes(a.i) || a.i < 0 || a.i >= BS * BS) return false;
        s.shots[p].push(a.i);
        if (s.fleets[1 - p].every((ship) => sunk(ship, s.shots[p]))) { s.phase = "over"; s.winner = p; s.score[p]++; }
        else s.turn = 1 - p;
      } else if (a.k === "again") {
        if (a.round !== s.round || s.phase !== "over") return false;
        const score = s.score;
        Object.assign(s, battleship.init(rand), { score, turn: (s.round + 1) % 2, round: s.round + 1 });
      } else return false;
    },
    render(s, ctx) {
      const me = ctx.me, them = 1 - me;
      const mineShips = new Set(s.fleets[me].flat()), theirShips = new Set(s.fleets[them].flat());
      const theirSunk = new Set(s.fleets[them].filter((sh) => sunk(sh, s.shots[me])).flat());
      const sunkCount = (fleet, shots) => fleet.filter((sh) => sunk(sh, shots)).length;
      const myGrid = `<div class="bs">${range(BS * BS).map((i) => {
        const hit = s.shots[them].includes(i);
        return `<div class="bs-cell ${mineShips.has(i) ? "ship" : ""} ${hit ? (mineShips.has(i) ? "hit" : "miss") : ""}">${hit ? (mineShips.has(i) ? "🔥" : "•") : ""}</div>`;
      }).join("")}</div>`;
      if (s.phase === "place") {
        return `<div class="g">${scores(ctx, s.score)}
          <p class="msg-line">${s.ready[me] ? `Ready! Waiting for ${nm(ctx, them)} to place their ships…` : "Here's your secret fleet. Shuffle until you like it, then tap Ready."}</p>
          ${s.ready[them] && !s.ready[me] ? `<p class="muted" style="margin:0">${esc(ctx.names[them])} is ready ✓</p>` : ""}
          <div class="board-col"><b>Your waters</b>${myGrid}</div>
          ${s.ready[me] ? "" : `<div class="row"><button class="btn" ${A({ k: "shuffle" })}>🔀 Shuffle ships</button><button class="btn primary" ${A({ k: "ready" })}>✅ Ready</button></div>`}</div>`;
      }
      const enemy = `<div class="bs enemy">${range(BS * BS).map((i) => {
        const shot = s.shots[me].includes(i), hit = shot && theirShips.has(i);
        const reveal = s.phase === "over" && theirShips.has(i) && !shot;
        return `<button ${A({ k: "fire", i })} class="bs-cell ${hit ? "hit" : shot ? "miss" : ""} ${theirSunk.has(i) ? "sunk" : ""} ${reveal ? "ship" : ""}"
          ${shot || s.phase !== "play" || s.turn !== me ? "disabled" : ""} aria-label="fire">${hit ? "💥" : shot ? "•" : ""}</button>`;
      }).join("")}</div>`;
      const msg = s.phase === "over" ? `${who(ctx, s.winner)} sank the whole fleet! 🏆`
        : s.turn === me ? "Your turn — tap a square on their waters to fire 🎯" : `${nm(ctx, them)} is aiming… 😬`;
      return `<div class="g">${scores(ctx, s.score, s.phase === "play" ? s.turn : null)}
        <p class="msg-line ${s.phase === "over" ? "win" : ""}">${msg}</p>
        <div class="boards">
          <div class="board-col"><b>Their waters · sunk ${sunkCount(s.fleets[them], s.shots[me])}/${SHIPS.length}</b>${enemy}</div>
          <div class="board-col"><span class="muted">Your waters · lost ${sunkCount(s.fleets[me], s.shots[them])}/${SHIPS.length}</span>${myGrid.replace('class="bs"', 'class="bs mine"')}</div>
        </div>
        ${s.phase === "over" ? `<button class="btn primary" ${A({ k: "again", round: s.round })}>New battle</button>` : ""}</div>`;
    },
  };

  // ---------- 12. Dots & Boxes ----------
  const DB = 4; // boxes per side
  const H_EDGES = (DB + 1) * DB; // horizontal edges come first, then vertical
  const boxEdges = (r, c) => [r * DB + c, (r + 1) * DB + c, H_EDGES + r * (DB + 1) + c, H_EDGES + r * (DB + 1) + c + 1];
  const dots = {
    id: "dots", name: "Dots & Boxes", icon: "🟦", tag: "Strategy", blurb: "Draw lines; close a box to claim it and go again.",
    init: () => ({ edges: Array(H_EDGES * 2).fill(null), boxes: Array(DB * DB).fill(null), turn: 0, score: [0, 0], wins: [0, 0], round: 0 }),
    apply(s, a, p) {
      if (a.k === "line") {
        if (s.turn !== p || s.edges[a.e] !== null || a.e < 0 || a.e >= s.edges.length || !s.boxes.includes(null)) return false;
        s.edges[a.e] = p;
        let closed = 0;
        for (let r = 0; r < DB; r++) for (let c = 0; c < DB; c++) {
          const b = r * DB + c;
          if (s.boxes[b] === null && boxEdges(r, c).every((e) => s.edges[e] !== null)) { s.boxes[b] = p; s.score[p]++; closed++; }
        }
        if (!closed) s.turn = 1 - p;
        if (!s.boxes.includes(null) && s.score[0] !== s.score[1]) s.wins[s.score[0] > s.score[1] ? 0 : 1]++;
      } else if (a.k === "again") {
        if (a.round !== s.round || s.boxes.includes(null)) return false;
        Object.assign(s, dots.init(), { wins: s.wins, turn: (s.round + 1) % 2, round: s.round + 1 });
      } else return false;
    },
    render(s, ctx) {
      const done = !s.boxes.includes(null);
      const off = done || s.turn !== ctx.me;
      const cells = [];
      for (let R = 0; R <= DB * 2; R++) for (let C = 0; C <= DB * 2; C++) {
        const r = R >> 1, c = C >> 1;
        if (R % 2 === 0 && C % 2 === 0) cells.push(`<div class="dot"></div>`);
        else if (R % 2 === 0 || C % 2 === 0) {
          const e = R % 2 === 0 ? r * DB + c : H_EDGES + r * (DB + 1) + c;
          const o = s.edges[e];
          cells.push(`<button class="edge ${R % 2 === 0 ? "h" : "v"} ${o !== null ? "p" + o : ""}" ${A({ k: "line", e })} ${o !== null || off ? "disabled" : ""} aria-label="line"></button>`);
        } else {
          const o = s.boxes[r * DB + c];
          cells.push(`<div class="box ${o !== null ? "p" + o : ""}">${o !== null ? esc(ctx.names[o].slice(0, 1).toUpperCase()) : ""}</div>`);
        }
      }
      const [x, y] = s.score;
      const msg = done ? (x === y ? "It's a tie! 🤝" : `${who(ctx, x > y ? 0 : 1)} claimed the most boxes! 🎉`)
        : s.turn === ctx.me ? "Your turn — tap between two dots" : `${nm(ctx, s.turn)} is drawing a line…`;
      return `<div class="g">${scores(ctx, s.score, done ? null : s.turn)}
        <span class="badge">Games won — ${esc(ctx.names[0])}: ${s.wins[0]} · ${esc(ctx.names[1])}: ${s.wins[1]}</span>
        <p class="msg-line ${done && x !== y ? "win" : ""}">${msg}</p>
        <div class="dots">${cells.join("")}</div>
        ${done ? `<button class="btn primary" ${A({ k: "again", round: s.round })}>Play again</button>` : ""}</div>`;
    },
  };

  // ---------- 13. Word Duel (Wordle race) ----------
  const WD_WORDS = ["HEART", "SMILE", "HAPPY", "DREAM", "SWEET", "HONEY", "CANDY", "BEACH", "OCEAN", "PIZZA", "MUSIC", "DANCE", "PARTY",
    "SUNNY", "CLOUD", "STORM", "PLANT", "GRAPE", "LEMON", "MANGO", "PEACH", "APPLE", "BREAD", "TOAST", "CHAIR", "TABLE", "HOUSE", "PHONE",
    "MOVIE", "NIGHT", "LIGHT", "WATER", "RIVER", "BRAVE", "CHARM", "TRUST", "FAITH", "SPARK", "FLAME", "QUIET", "PEACE", "LAUGH", "STORY",
    "WORLD", "EARTH", "SPACE", "ROBOT", "TIGER", "ZEBRA", "HORSE", "MOUSE", "BUNNY", "PANDA", "KOALA", "SNAKE", "EAGLE", "TULIP", "DAISY",
    "BLOOM", "FROST", "GHOST", "MAGIC", "CROWN", "JEWEL", "PEARL", "CORAL", "OLIVE", "SUGAR", "SPICE", "CREAM", "SALAD", "JUICE", "BERRY",
    "MELON", "CHEST", "SHINE", "PLANE", "TRAIN", "CLOCK", "GLASS", "PAINT", "BRUSH", "SHIRT", "SHOES", "WATCH", "RADIO", "TOWEL", "PILOT"];
  const WD_MAX = 6;
  function wdMarks(guess, ans) {
    const res = Array(5).fill("b"), left = {};
    for (let i = 0; i < 5; i++) { if (guess[i] === ans[i]) res[i] = "g"; else left[ans[i]] = (left[ans[i]] || 0) + 1; }
    for (let i = 0; i < 5; i++) if (res[i] !== "g" && left[guess[i]] > 0) { res[i] = "y"; left[guess[i]]--; }
    return res;
  }
  const wdDone = (s, p) => s.guesses[p].includes(s.word) || s.guesses[p].length >= WD_MAX;
  const wordDuel = {
    id: "wordle", name: "Word Duel", icon: "🟩", tag: "Words", blurb: "Same secret 5-letter word for both. Fewest guesses wins!",
    init: (rand) => ({ word: WD_WORDS[Math.floor(rand() * WD_WORDS.length)], guesses: [[], []], score: [0, 0], scored: false, round: 0 }),
    apply(s, a, p, rand) {
      if (a.k === "guess") {
        const g = String(a.text || "").toUpperCase().replace(/[^A-Z]/g, "");
        if (g.length !== 5 || wdDone(s, p)) return false;
        s.guesses[p].push(g);
        if (wdDone(s, 0) && wdDone(s, 1) && !s.scored) {
          s.scored = true;
          const n = [0, 1].map((q) => (s.guesses[q].includes(s.word) ? s.guesses[q].length : 99));
          if (n[0] !== n[1]) s.score[n[0] < n[1] ? 0 : 1]++;
        }
      } else if (a.k === "next") {
        if (a.round !== s.round || !s.scored) return false;
        Object.assign(s, { word: WD_WORDS[Math.floor(rand() * WD_WORDS.length)], guesses: [[], []], scored: false, round: s.round + 1 });
      } else return false;
    },
    render(s, ctx) {
      const me = ctx.me, them = 1 - me;
      const board = (p, mini) => `<div class="wd ${mini ? "mini" : ""}">${range(WD_MAX).map((r) => {
        const g = s.guesses[p][r], m = g && wdMarks(g, s.word);
        return `<div class="wd-row">${range(5).map((i) => `<div class="tile ${m ? m[i] : ""}">${g && !mini ? g[i] : ""}</div>`).join("")}</div>`;
      }).join("")}</div>`;
      const letters = {};
      s.guesses[me].forEach((g) => wdMarks(g, s.word).forEach((m, i) => {
        const rank = { g: 3, y: 2, b: 1 };
        if (!letters[g[i]] || rank[m] > rank[letters[g[i]]]) letters[g[i]] = m;
      }));
      const kb = `<div class="wd-keys">${"QWERTYUIOPASDFGHJKLZXCVBNM".split("").map((l) => `<span class="${letters[l] || ""}">${l}</span>`).join("")}</div>`;
      const solved = (p) => s.guesses[p].includes(s.word);
      let msg;
      if (s.scored) {
        const n = [0, 1].map((q) => (solved(q) ? s.guesses[q].length : 99));
        msg = `<p class="msg-line ${n[0] !== n[1] ? "win" : ""}">The word was <b>${s.word}</b> — ${n[0] === n[1] ? (n[0] === 99 ? "nobody got it 😅" : "it's a tie! 🤝") : `${who(ctx, n[0] < n[1] ? 0 : 1)} won with fewer guesses! 🎉`}</p>`;
      } else if (wdDone(s, me)) msg = `<p class="msg-line">${solved(me) ? `Solved in ${s.guesses[me].length}! 🎉` : "Out of guesses 😬"} Waiting for ${nm(ctx, them)}…</p>`;
      else msg = `<p class="msg-line">Guess the 5-letter word. 🟩 right spot · 🟨 wrong spot</p>`;
      const input = !wdDone(s, me) ? `<form data-form="guess" class="form-row"><input name="text" id="wd-guess" maxlength="5" placeholder="5-letter word" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.2em"><button class="btn primary">Guess</button></form>` : "";
      return `<div class="g">${scores(ctx, s.score)}${msg}
        <div class="boards"><div class="board-col"><b>You · ${s.guesses[me].length}/${WD_MAX}</b>${board(me)}</div>
          <div class="board-col"><span class="muted">${esc(ctx.names[them])} · ${s.guesses[them].length}/${WD_MAX}</span>${board(them, true)}</div></div>
        ${input}${s.guesses[me].length && !s.scored ? kb : ""}
        ${s.scored ? `<button class="btn primary" ${A({ k: "next", round: s.round })}>Next word</button>` : ""}</div>`;
    },
  };

  // ---------- 14. Reaction Race ----------
  const reaction = {
    id: "react", name: "Reaction Race", icon: "⚡", tag: "Quick", blurb: "Tap the moment it turns green. Fastest fingers win!",
    init: () => ({ phase: "idle", delay: 0, times: [null, null], score: [0, 0], best: [null, null], round: 0 }),
    apply(s, a, p, rand) {
      if (a.k === "start") {
        if (a.round !== s.round || (s.phase === "wait" && !a.force)) return false;
        Object.assign(s, { phase: "wait", delay: 1500 + Math.floor(rand() * 3500), times: [null, null], round: s.round + 1 });
      } else if (a.k === "tap") {
        if (s.phase !== "wait" || a.round !== s.round || s.times[p] !== null) return false;
        s.times[p] = Math.max(-1, Math.min(10000, Math.round(+a.ms || 0)));
        if (s.times[p] > 0 && (s.best[p] === null || s.times[p] < s.best[p])) s.best[p] = s.times[p];
        if (s.times[0] !== null && s.times[1] !== null) {
          s.phase = "done";
          const ok = s.times.map((t) => t > 0);
          if (ok[0] && ok[1] && s.times[0] !== s.times[1]) s.score[s.times[0] < s.times[1] ? 0 : 1]++;
          else if (ok[0] !== ok[1]) s.score[ok[0] ? 0 : 1]++;
        }
      } else return false;
    },
    render(s, ctx) {
      const me = ctx.me, them = 1 - me;
      const fmt = (t) => (t === null ? "—" : t < 0 ? "too early! 🙈" : t + " ms");
      let pad, info = "";
      if (s.phase === "idle") pad = `<button class="pad idle" ${A({ k: "start", round: s.round })}>Tap to start ⚡</button>`;
      else if (s.phase === "wait") {
        pad = `<button class="pad wait" data-react="${s.round}">Wait for green…</button>`;
        info = `<p class="muted" style="margin:0">${s.times[them] !== null ? `${esc(ctx.names[them])} has tapped ✓` : "&nbsp;"}</p>
          <button class="btn small ghost" ${A({ k: "start", round: s.round, force: true })}>↻ Restart round</button>`;
      } else {
        const [x, y] = s.times, ok = [x > 0, y > 0];
        const w = ok[0] && ok[1] ? (x === y ? null : x < y ? 0 : 1) : ok[0] !== ok[1] ? (ok[0] ? 0 : 1) : null;
        pad = `<button class="pad idle" ${A({ k: "start", round: s.round })}>Go again ⚡</button>`;
        info = `<div class="answers"><div class="answer p0"><small>${esc(ctx.names[0])}</small>${fmt(x)}</div><div class="answer p1"><small>${esc(ctx.names[1])}</small>${fmt(y)}</div></div>
          <p class="msg-line ${w !== null ? "win" : ""}">${w === null ? "No winner this time!" : `${who(ctx, w)} ${w === me ? "were" : "was"} faster! ⚡`}</p>`;
      }
      return {
        top: `<div class="g">${scores(ctx, s.score)}<span class="badge">Best — ${esc(ctx.names[0])}: ${fmt(s.best[0])} · ${esc(ctx.names[1])}: ${fmt(s.best[1])}</span></div>`,
        pad: `<div class="g" style="margin-top:12px">${pad}</div>`,
        info: `<div class="g" style="margin-top:12px">${info}</div>`,
      };
    },
    after(root, s, ctx) {
      root._rx = { s, ctx };
      const pad = root.querySelector("[data-react]");
      if (s.phase === "wait" && root._rxRound !== s.round) {
        // Each screen runs its own countdown, so network lag doesn't matter: only your own reaction time counts.
        root._rxRound = s.round; root._rxGo = 0;
        clearTimeout(root._rxTimer);
        root._rxTimer = setTimeout(() => { root._rxGo = performance.now(); const p = root.querySelector("[data-react]"); if (p) { p.classList.add("go"); p.textContent = "TAP! 👆"; } }, s.delay);
      }
      if (pad && s.times[ctx.me] !== null) { pad.disabled = true; pad.textContent = s.times[ctx.me] < 0 ? "Too early! 🙈" : `${s.times[ctx.me]} ms — waiting…`; pad.classList.remove("go"); }
      else if (pad && root._rxGo) { pad.classList.add("go"); pad.textContent = "TAP! 👆"; }
      if (root._rxBound) return;
      root._rxBound = true;
      root.addEventListener("pointerdown", (e) => {
        const p = e.target.closest("[data-react]");
        if (!p || p.disabled) return;
        e.preventDefault();
        const { s: cur, ctx: c } = root._rx;
        if (cur.phase !== "wait" || cur.times[c.me] !== null) return;
        c.act({ k: "tap", round: cur.round, ms: root._rxGo ? performance.now() - root._rxGo : -1 });
      });
    },
  };

  // ---------- 15. Truth or Dare ----------
  const TRUTHS = [
    "What was your very first impression of me?", "What's a song that makes you think of me?", "When did you first realize you liked me?",
    "What's the most embarrassing thing you've done to impress someone?", "What's one thing you've never told me?", "What's your favorite thing I do for you?",
    "What's your biggest turn-off?", "What's a habit of mine you secretly find cute?", "If we could go anywhere tomorrow, where would you take me?",
    "What's the last thing that made you blush?", "What's something you're insecure about?", "What's your most-used excuse to get out of plans?",
    "What's your favorite photo of us and why?", "Who was your first crush?", "What's a dream you've never told anyone?",
    "What's the silliest thing you've cried about?", "What do you think about right before you fall asleep?", "What's your favorite memory of us?",
    "What's one thing you'd change about our first date?", "What's the weirdest thing you've googled lately?", "What's your secret guilty pleasure?",
    "If you had to describe me in three words, what would they be?", "What's something you want us to try together?", "What's the biggest lie you've told your parents?",
    "When was the last time you stalked someone's social media?", "What's one thing you love about yourself?", "What's your most irrational fear?",
    "What did you dream about last night?", "What's a compliment you'll never forget?", "What's one thing you're proud of me for?",
  ];
  const DARES = [
    "Sing the chorus of a love song to me right now 🎤", "Do your best impression of me", "Show me the last photo in your camera roll",
    "Do 10 jumping jacks while saying something you love about me", "Talk in an accent for the next 3 minutes", "Blow me 5 different kinds of kisses 😘",
    "Show me your best dance move for 15 seconds", "Make the funniest face you can and hold it for 10 seconds", "Read your last sent text out loud",
    "Give me a 30-second pickup line performance", "Put on the silliest thing you can find nearby", "Tell me a joke — if I don't laugh, do another dare",
    "Speak only in questions until your next turn", "Draw a portrait of me in 30 seconds and show it", "Serenade me with a made-up song about my name",
    "Do your best runway walk across the room", "Show me the oldest photo of yourself on your phone", "Let me pick your profile picture for a day",
    "Do a dramatic movie-scene confession of love", "Hold a plank for 30 seconds while telling me about your day", "Try to lick your elbow on camera",
    "Send me a voice note saying something sweet right now", "Describe our future house in a dramatic narrator voice", "Do your best animal impression — I guess the animal",
    "Balance something on your head for 20 seconds", "Rap 4 lines about how cute I am", "Show me what's in your fridge and rate it",
    "Make a heart with your hands and hold it to the camera for 10 seconds", "Do a magic trick (or pretend really hard)", "Write my name with your nose in the air",
  ];
  const truthOrDare = {
    id: "tod", name: "Truth or Dare", icon: "🔥", tag: "Couples", blurb: "Take turns choosing truth or dare. No chickening out 😏",
    init: (rand) => ({ turn: 0, kind: null, card: null, t: shuffle(range(TRUTHS.length), rand), d: shuffle(range(DARES.length), rand), ti: 0, di: 0, n: 0, done: [0, 0] }),
    apply(s, a, p) {
      if (a.k === "pick") {
        if (p !== s.turn || a.n !== s.n) return false;
        if (a.kind === "truth") { s.card = s.t[s.ti % s.t.length]; s.ti++; }
        else if (a.kind === "dare") { s.card = s.d[s.di % s.d.length]; s.di++; }
        else return false;
        s.kind = a.kind;
      } else if (a.k === "done") {
        if (a.n !== s.n || s.card === null) return false;
        s.done[s.turn]++; s.turn = 1 - s.turn; s.card = null; s.kind = null; s.n++;
      } else return false;
    },
    render(s, ctx) {
      const mine = s.turn === ctx.me;
      let body;
      if (s.card === null) {
        body = mine ? `<p class="msg-line">Your turn — truth or dare?</p>
            <div class="row"><button class="choice" ${A({ k: "pick", kind: "truth", n: s.n })}>🤫 Truth</button><button class="choice" ${A({ k: "pick", kind: "dare", n: s.n })}>🔥 Dare</button></div>`
          : `<p class="msg-line">${nm(ctx, s.turn)} is choosing truth or dare…</p>`;
      } else {
        const text = s.kind === "truth" ? TRUTHS[s.card] : DARES[s.card];
        body = `<div class="tod-card ${s.kind}"><small>${s.kind === "truth" ? "🤫 TRUTH" : "🔥 DARE"} for ${mine ? "you" : esc(ctx.names[s.turn])}</small><p>${esc(text)}</p></div>
          <div class="row"><button class="btn primary" ${A({ k: "done", n: s.n })}>✅ Done — ${mine ? `${esc(ctx.names[1 - ctx.me])}'s` : "your"} turn</button>
          ${mine ? `<button class="btn ghost" ${A({ k: "pick", kind: s.kind, n: s.n })}>🔄 Different one</button>` : ""}</div>`;
      }
      return `<div class="g"><span class="badge">Completed — ${esc(ctx.names[0])}: ${s.done[0]} · ${esc(ctx.names[1])}: ${s.done[1]}</span>${body}</div>`;
    },
  };

  // ---------- 16. Never Have I Ever ----------
  const NHIE = [
    "Never have I ever stalked an ex on social media", "Never have I ever fallen asleep during a movie date", "Never have I ever sung in the shower",
    "Never have I ever lied about my age", "Never have I ever cried at a cartoon", "Never have I ever sent a text to the wrong person",
    "Never have I ever eaten food off the floor", "Never have I ever pretended to like a gift", "Never have I ever had a crush on a teacher",
    "Never have I ever been on a blind date", "Never have I ever forgotten someone's name right after meeting them", "Never have I ever ghosted someone",
    "Never have I ever laughed so hard I snorted", "Never have I ever practiced a kiss on my hand", "Never have I ever re-gifted a present",
    "Never have I ever cheated in a board game", "Never have I ever lied to get out of a date", "Never have I ever danced alone in my room",
    "Never have I ever binge-watched a whole season in one day", "Never have I ever had a crush on a cartoon character", "Never have I ever been jealous of a friend's partner",
    "Never have I ever written a love letter", "Never have I ever fallen in public", "Never have I ever said 'I love you' first",
    "Never have I ever snooped through someone's phone", "Never have I ever gotten lost in my own city", "Never have I ever eaten a whole pizza by myself",
    "Never have I ever been told I snore", "Never have I ever had a dream about you", "Never have I ever pretended to be sick to skip school or work",
    "Never have I ever talked to myself in the mirror", "Never have I ever sent a risky text and regretted it", "Never have I ever kept a secret from my best friend",
    "Never have I ever walked into a glass door", "Never have I ever cried at a wedding", "Never have I ever googled myself",
  ];
  const neverHave = {
    id: "nhie", name: "Never Have I Ever", icon: "🙈", tag: "Couples", blurb: "Answer secretly, reveal together. Prepare for confessions!",
    init: (rand) => ({ order: shuffle(range(NHIE.length), rand), i: 0, ans: [null, null], have: [0, 0] }),
    apply(s, a, p) {
      if (a.k === "answer") {
        if (a.i !== s.i || s.ans[p] !== null) return false;
        s.ans[p] = !!a.have;
        if (a.have) s.have[p]++;
      } else if (a.k === "next") {
        if (a.i !== s.i) return false;
        s.i = (s.i + 1) % s.order.length; s.ans = [null, null];
      } else return false;
    },
    render(s, ctx) {
      const both = !s.ans.includes(null), mine = s.ans[ctx.me], them = 1 - ctx.me;
      let body;
      if (both) {
        body = `<div class="answers">${[0, 1].map((p) => `<div class="answer p${p}"><small>${esc(ctx.names[p])}</small>${s.ans[p] ? "🙋 I have!" : "🙅 Never"}</div>`).join("")}</div>
          <p class="msg-line">${s.ans[0] && s.ans[1] ? "You've BOTH done it 😂 Tell the story!" : s.ans[0] || s.ans[1] ? `Ooh, ${nm(ctx, s.ans[0] ? 0 : 1)} has some explaining to do 👀` : "Innocent angels, both of you 😇"}</p>
          <button class="btn primary" ${A({ k: "next", i: s.i })}>Next one</button>`;
      } else {
        body = mine === null
          ? `<div class="row"><button class="choice" ${A({ k: "answer", i: s.i, have: true })}>🙋 I have</button><button class="choice" ${A({ k: "answer", i: s.i, have: false })}>🙅 Never</button></div>`
          : `<p class="msg-line">Answer locked 🔒 Waiting for ${nm(ctx, them)}…</p>`;
        if (mine === null && s.ans[them] !== null) body += `<p class="muted" style="margin:0">${esc(ctx.names[them])} has answered ✓</p>`;
      }
      return `<div class="g"><span class="badge">"I have" count — ${esc(ctx.names[0])}: ${s.have[0]} · ${esc(ctx.names[1])}: ${s.have[1]}</span>
        <p class="big-q">${esc(NHIE[s.order[s.i]])}…</p>${body}</div>`;
    },
  };

  // ---------- 17. Emoji Riddles ----------
  const EMOJI = [
    ["🦁👑", "the lion king", "Movie"], ["❄️👸", "frozen", "Movie"], ["🕷️🧑", "spiderman", "Movie"], ["🚢🧊💔", "titanic", "Movie"],
    ["🧙‍♂️💍🌋", "lord of the rings", "Movie"], ["🐠🔍", "finding nemo", "Movie"], ["🦇🧑", "batman", "Movie"], ["👻🚫🔫", "ghostbusters", "Movie"],
    ["🧸🤠🚀", "toy story", "Movie"], ["🏠⬆️🎈", "up", "Movie"], ["🧜‍♀️", "the little mermaid", "Movie"], ["🦖🏝️", "jurassic park", "Movie"],
    ["👸🐸", "the princess and the frog", "Movie"], ["🍫🏭", "charlie and the chocolate factory", "Movie"], ["👽📞🏠", "et", "Movie"],
    ["🐼🥋", "kung fu panda", "Movie"], ["⭐⚔️", "star wars", "Movie"], ["🧛‍♂️🌙💘", "twilight", "Movie"], ["🐝🎬", "bee movie", "Movie"],
    ["💍💍💍💍⚰️", "four weddings and a funeral", "Movie"], ["🌧️☔🐱🐶", "raining cats and dogs", "Saying"], ["🍰🚶‍♂️", "piece of cake", "Saying"],
    ["🧊🔨", "break the ice", "Saying"], ["🐘🏠", "elephant in the room", "Saying"], ["⏰💸", "time is money", "Saying"],
    ["🍎👁️", "apple of my eye", "Saying"], ["❤️💔", "heartbreak", "Word"], ["🌙🍯", "honeymoon", "Word"], ["🦋🦋🤰", "butterflies in my stomach", "Saying"],
    ["☀️🌻", "sunflower", "Word"], ["🔥🪰", "firefly", "Word"], ["⭐🐟", "starfish", "Word"], ["🌈🐟", "rainbow fish", "Word"],
    ["🎂🎉", "birthday party", "Word"], ["🍿🎬", "movie night", "Word"], ["🏖️📚", "beach read", "Word"], ["💤🥱", "sleepy", "Word"],
    ["🎤🎶👑", "karaoke king", "Word"], ["🥶🍦", "ice cream", "Word"], ["🍕❤️", "pizza lover", "Word"],
  ];
  const emojiRiddles = {
    id: "emoji", name: "Emoji Riddles", icon: "🎬", tag: "Questions", blurb: "Guess the movie or phrase from emojis. Both can score!",
    init: (rand) => ({ order: shuffle(range(EMOJI.length), rand), i: 0, solved: [false, false], tries: [0, 0], revealed: false, hint: false, score: [0, 0] }),
    apply(s, a, p) {
      if (a.k === "guess") {
        if (+a.i !== s.i || s.solved[p] || s.revealed) return false;
        const g = String(a.text || "").trim();
        if (!g) return false;
        s.tries[p]++;
        if (norm(g).replace(/^the/, "") === norm(EMOJI[s.order[s.i]][1]).replace(/^the/, "")) { s.solved[p] = true; s.score[p]++; }
      } else if (a.k === "hint") {
        if (a.i !== s.i) return false;
        s.hint = true;
      } else if (a.k === "reveal") {
        if (a.i !== s.i) return false;
        s.revealed = true;
      } else if (a.k === "next") {
        if (a.i !== s.i) return false;
        Object.assign(s, { i: (s.i + 1) % s.order.length, solved: [false, false], tries: [0, 0], revealed: false, hint: false });
      } else return false;
    },
    render(s, ctx) {
      const [em, ans, cat] = EMOJI[s.order[s.i]];
      const me = ctx.me, them = 1 - me, over = s.revealed || (s.solved[0] && s.solved[1]);
      const hint = `${cat} · ${ans.split(" ").length} word${ans.includes(" ") ? "s" : ""} · starts with “${ans[0].toUpperCase()}”`;
      let body;
      if (over) body = `<p class="msg-line ${s.solved.some(Boolean) ? "win" : ""}">It's <b>${esc(ans)}</b>! ${s.solved[0] && s.solved[1] ? "You both got it 💞" : ""}</p>
          <button class="btn primary" ${A({ k: "next", i: s.i })}>Next riddle</button>`;
      else {
        body = s.solved[me] ? `<p class="msg-line win">You got it! 🎉 Waiting for ${nm(ctx, them)}…</p>`
          : `<form data-form="guess" class="form-row"><input type="hidden" name="i" value="${s.i}"><input name="text" id="emoji-guess" maxlength="60" placeholder="Your guess…" autocomplete="off"><button class="btn primary">Guess</button></form>
             ${s.tries[me] ? `<p class="muted" style="margin:0">Not quite — ${s.tries[me]} tr${s.tries[me] === 1 ? "y" : "ies"} so far</p>` : ""}`;
        body += `<p class="muted" style="margin:0">${s.solved[them] ? `${esc(ctx.names[them])} solved it ✓` : s.tries[them] ? `${esc(ctx.names[them])} has tried ${s.tries[them]}×` : "&nbsp;"}</p>
          <div class="row">${s.hint ? "" : `<button class="btn small ghost" ${A({ k: "hint", i: s.i })}>💡 Hint</button>`}<button class="btn small ghost" ${A({ k: "reveal", i: s.i })}>🏳️ Reveal answer</button></div>`;
      }
      return `<div class="g">${scores(ctx, s.score)}<div class="emoji-q confetti">${em}</div>
        ${s.hint || over ? `<span class="badge">${esc(over ? cat : hint)}</span>` : ""}${body}</div>`;
    },
  };

  window.Games = {
    list: [ticTacToe, connectFour, battleship, dots, rps, reaction, memory, slide, wordDuel, drawGuess, hangman, emojiRiddles,
      trivia, wyr, knowMe, truthOrDare, neverHave],
    rng,
    esc,
  };
})();
