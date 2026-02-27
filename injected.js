/**
 * JackHack Prime — injected.js
 * Runs in PAGE context. WebSocket intercept + in-game overlay (screenshot style).
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════ */
  const state = {
    room: null, myName: null, phase: 'waiting',
    question: null, choices: [], correctIdx: null, category: null,
    timer: null, timerMax: 30, players: [], lastMinigame: null,
    history: [], statsCorrect: 0, statsWrong: 0, ping: null, hints: [],
  };

  const features = {
    highlightAnswer: true, autoClick: false, showOverlay: true,
    pingMonitor: true, historyLog: true, miniGameHints: true,
    soundAlert: true, eliminationHelper: true, ghostMode: false,
  };

  let autoClickTimer = null;

  /* ── Broadcast ── */
  function broadcast() {
    window.dispatchEvent(new CustomEvent('JHP_DATA', {
      detail: JSON.parse(JSON.stringify({ ...state, features }))
    }));
  }

  /* ── Feature sync from popup ── */
  window.addEventListener('JHP_FEATURES', (e) => {
    Object.assign(features, e.detail);
    const r = document.getElementById('jhp-root');
    if (r) r.style.display = features.showOverlay ? 'block' : 'none';
    renderOverlay(); broadcast();
  });

  /* ── Ping ── */
  setInterval(() => {
    if (!features.pingMonitor) return;
    const t0 = performance.now();
    fetch(location.origin + '/favicon.ico', { mode: 'no-cors', cache: 'no-store' })
      .then(() => { state.ping = Math.round(performance.now() - t0); renderOverlay(); broadcast(); })
      .catch(() => {});
  }, 3000);

  /* ── Sound ── */
  function playAlert(type) {
    if (!features.soundAlert) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = type === 'correct' ? 1040 : 520;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    } catch {}
  }

  /* ── Hints ── */
  function eliminationHints(question, choices) {
    if (!features.eliminationHelper || !choices.length) return [];
    const hints = [], q = question.toLowerCase();
    const nums = choices.map(c => parseFloat(String(c).replace(/[^0-9.-]/g, '')));
    if (nums.every(n => !isNaN(n)) && nums.length >= 3) {
      const sorted = [...nums].sort((a, b) => a - b);
      hints.push('📊 Числа: ' + sorted.join(' / ') + ' — медиана обычно ближе к правде');
    }
    if (/когда|год|в каком/i.test(q))       hints.push('📅 Временной — исключай крайние даты');
    if (/сколько|количество/i.test(q))       hints.push('🔢 Не самый большой и не самый маленький');
    if (/страна|город|где|столица/i.test(q)) hints.push('🌍 Гео — думай о крупных местах');
    if (choices.length === 2)                hints.push('✌️ Да/Нет — доверяй первому инстинкту');
    return hints;
  }

  function minigameHints(name) {
    const n = (name || '').toLowerCase();
    const map = {
      scramble: ['🔤 Ищи гласные посередине слова', 'Пробуй суффиксы -ция, -ость, -ние'],
      word:     ['📝 Скорость важнее точности', 'Набирай короткие слова первыми'],
      number:   ['🔢 Округляй до круглых чисел', 'Ближе к середине диапазона'],
      math:     ['➕ Умножение → сложение', 'Округляй для скорости'],
      typing:   ['⌨️ Плавный темп, без рывков'],
      matching: ['🔗 Начни с пар, в которых уверен', 'Исключай методом'],
      order:    ['📋 Сначала крайние значения', 'Потом расставляй средние'],
      draw:     ['🎨 Схематично, не детально', 'Добавь текстовую подпись'],
    };
    for (const [k, v] of Object.entries(map)) if (n.includes(k)) return v;
    return ['⚡ Концентрируйся и действуй быстро!'];
  }

  /* ── Auto-click ── */
  function scheduleAutoClick() {
    if (!features.autoClick || state.correctIdx === null) return;
    clearTimeout(autoClickTimer);
    autoClickTimer = setTimeout(() => {
      const btns = document.querySelectorAll('button, [role="button"], .choice, .answer');
      const t = btns[state.correctIdx];
      if (t) { t.click(); showToast('🤖 Авто-клик: вариант ' + (state.correctIdx + 1), 'green'); }
    }, 800);
  }

  /* ── WS parser ── */
  function dig(obj, ...keys) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const k of keys) if (obj[k] !== undefined) return obj[k];
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) continue;
      const f = dig(v, ...keys); if (f !== undefined) return f;
    }
  }

  function parseMsg(raw) {
    let data; try { data = JSON.parse(raw); } catch { return; }
    const body = data.body ?? data;

    const roomId = data.roomid || data.roomId || body.roomid || body.roomId;
    if (roomId) state.room = roomId;
    const nm = body.name || body.username || body.playerName;
    if (nm && !state.myName) state.myName = nm;

    const plist = dig(body, 'players', 'playerList', 'Entities');
    if (Array.isArray(plist) && plist.length)
      state.players = plist.map(p => p.name || p.Name || p.username || p).filter(x => typeof x === 'string');

    const timerVal = dig(body, 'timer', 'timeLeft', 'countdown', 'TimeLeft', 'time');
    if (typeof timerVal === 'number' && timerVal > 0) {
      if (timerVal > (state.timer || 0)) state.timerMax = timerVal;
      state.timer = timerVal;
    }

    const qText   = dig(body, 'question','Question','prompt','Prompt','text','questionText');
    const choices  = dig(body, 'choices','Choices','answers','Answers','options','Options');
    const correct  = dig(body, 'correctAnswer','correct','CorrectAnswer','correctIndex','answer');
    const category = dig(body, 'category','Category','subject','type');

    if (qText && qText !== state.question) {
      if (state.question && features.historyLog) {
        state.history.unshift({ q: state.question, choices: [...state.choices], correctIdx: state.correctIdx });
        if (state.history.length > 20) state.history.pop();
      }
      state.phase = 'question'; state.question = qText; state.category = category || null;
      state.choices = Array.isArray(choices)
        ? choices.map(c => typeof c === 'object' ? (c.text ?? c.value ?? JSON.stringify(c)) : String(c)) : [];
      state.correctIdx = null;
      state.hints = eliminationHints(qText, state.choices);
      playAlert('question'); broadcast(); renderOverlay(); return;
    }

    if (correct !== undefined && state.question) {
      let idx = typeof correct === 'number' ? correct
              : state.choices.findIndex(c => c.toLowerCase() === String(correct).toLowerCase());
      if (idx >= 0) {
        state.correctIdx = idx; playAlert('correct');
        scheduleAutoClick(); broadcast(); renderOverlay(); return;
      }
    }

    const mg = dig(body, 'minigame','miniGame','Minigame','challenge','subGame');
    if (mg) {
      state.phase = 'minigame';
      state.lastMinigame = typeof mg === 'string' ? mg : (mg.type || mg.name || 'minigame');
      state.hints = minigameHints(state.lastMinigame);
      broadcast(); renderOverlay(); return;
    }

    if (features.ghostMode) {
      const oa = body.answer ?? body.choice ?? body.selection;
      const pn = body.playerName || body.name;
      if (oa !== undefined && pn && pn !== state.myName)
        showToast(`👻 ${pn}: вариант ${oa}`, 'purple');
    }
    broadcast();
  }

  /* ══════════════════════════════════════════════════
     IN-GAME OVERLAY  —  screenshot-faithful
  ══════════════════════════════════════════════════ */
  const CSS = `
    #jhp-root{position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;
      font-family:'Helvetica Neue','Segoe UI',system-ui,sans-serif;}

    /* top bar */
    #jhp-topbar{
      display:inline-flex;align-items:center;gap:0;
      background:#2a2a2a;color:#fff;font-size:13px;font-weight:500;
      border-radius:8px;padding:6px 14px;margin:8px 0 0 10px;
      pointer-events:auto;cursor:grab;user-select:none;
      box-shadow:0 2px 8px rgba(0,0,0,.45);
    }
    #jhp-topbar:active{cursor:grabbing;}
    #jhp-topbar .s{color:rgba(255,255,255,.25);margin:0 7px;}
    #jhp-topbar .ping{color:#06d6a0;}
    #jhp-topbar .nm{color:#ffd166;}
    #jhp-close{
      margin-left:10px;background:rgba(255,255,255,.12);border:none;
      color:#fff;border-radius:5px;width:18px;height:18px;font-size:10px;
      line-height:18px;text-align:center;cursor:pointer;pointer-events:auto;padding:0;
    }
    #jhp-close:hover{background:rgba(255,60,60,.55);}

    /* main row: timer + qa */
    #jhp-panel{display:flex;align-items:flex-start;gap:8px;margin:8px 0 0 10px;}

    #jhp-timer{
      background:#2a2a2a;color:#fff;border-radius:10px;
      min-width:88px;min-height:88px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,.4);flex-shrink:0;transition:background .3s;
    }
    #jhp-timer.low{background:#6b1a1a;}
    #jhp-tnum{font-size:36px;font-weight:900;line-height:1;}
    #jhp-tlbl{font-size:10.5px;color:rgba(255,255,255,.5);text-align:center;margin-top:4px;line-height:1.25;}

    #jhp-qa{display:flex;flex-direction:column;gap:7px;min-width:260px;max-width:420px;}

    .jhp-b{
      background:#d9d9d9;border:2px solid transparent;border-radius:10px;
      padding:10px 16px;font-size:13px;font-weight:500;color:#1a1a1a;
      text-align:center;line-height:1.4;box-shadow:0 1px 4px rgba(0,0,0,.2);
      transition:border-color .25s,background .25s;word-break:break-word;
    }
    .jhp-b.qb{background:#e0e0e0;font-weight:600;font-size:14px;}
    .jhp-b.ok{border-color:#4caf50!important;background:#d7f0d8!important;}
    .jhp-b.ok::before{content:'✓ ';color:#2e7d32;font-weight:900;}

    /* hints */
    #jhp-hints{margin:6px 0 0 10px;display:flex;flex-direction:column;gap:4px;max-width:520px;}
    .jhp-hint{
      background:rgba(255,220,80,.13);border:1px solid rgba(255,220,80,.28);
      border-radius:7px;padding:5px 12px;font-size:11.5px;color:#ffe082;
    }

    /* minigame */
    #jhp-mg{
      margin:8px 0 0 10px;background:#2a2a2a;border-radius:10px;
      padding:10px 14px;font-size:13px;color:#c688e0;font-weight:700;
      box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:4px;max-width:460px;
    }
    .jhp-mh{font-size:11.5px;color:rgba(255,255,255,.6);font-weight:400;}

    /* toasts */
    #jhp-toasts{position:fixed;bottom:20px;right:16px;z-index:2147483647;
      display:flex;flex-direction:column;gap:6px;pointer-events:none;}
    .jhp-toast{padding:8px 14px;border-radius:9px;font-size:12px;font-weight:600;
      color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3);
      animation:jIn .2s ease,jOut .3s ease 2.7s forwards;}
    .jhp-toast.green{background:rgba(6,214,160,.92);color:#000;}
    .jhp-toast.purple{background:rgba(123,45,139,.92);}
    .jhp-toast.red{background:rgba(220,50,50,.92);}
    .jhp-toast.blue{background:rgba(17,138,178,.92);}
    @keyframes jIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    @keyframes jOut{to{opacity:0;transform:translateY(-6px)}}
  `;

  let overlayBuilt = false;
  function buildOverlay() {
    if (overlayBuilt || !document.body) return;
    overlayBuilt = true;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'jhp-root';
    root.innerHTML = `
      <div id="jhp-topbar">
        <span>JackHack Prime</span>
        <span class="s">|</span>
        <span>ping <span class="ping" id="jhp-ping">…</span> ms</span>
        <span class="s">|</span>
        <span class="nm" id="jhp-name">*nickname*</span>
        <button id="jhp-close">✕</button>
      </div>
      <div id="jhp-panel" style="display:none">
        <div id="jhp-timer">
          <div id="jhp-tnum">—</div>
          <div id="jhp-tlbl">секунд<br>осталось</div>
        </div>
        <div id="jhp-qa"></div>
      </div>
      <div id="jhp-hints"></div>
      <div id="jhp-mg" style="display:none"></div>
    `;
    document.body.appendChild(root);

    const toasts = document.createElement('div');
    toasts.id = 'jhp-toasts';
    document.body.appendChild(toasts);

    /* Close button */
    document.getElementById('jhp-close').addEventListener('click', e => {
      e.stopPropagation();
      ['jhp-panel','jhp-hints','jhp-mg'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      showToast('🙈 Оверлей скрыт — открой popup чтобы вернуть', 'blue');
    });

    /* Draggable */
    const handle = document.getElementById('jhp-topbar');
    let mx = 0, my = 0;
    handle.addEventListener('mousedown', e => {
      if (e.target.id === 'jhp-close') return;
      mx = e.clientX; my = e.clientY;
      const move = ev => {
        root.style.left = Math.max(0, (parseInt(root.style.left)||0) + ev.clientX - mx) + 'px';
        root.style.top  = Math.max(0, (parseInt(root.style.top )||0) + ev.clientY - my) + 'px';
        mx = ev.clientX; my = ev.clientY;
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function e(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function renderOverlay() {
    buildOverlay();
    const root = document.getElementById('jhp-root');
    if (!root) return;
    root.style.display = features.showOverlay ? 'block' : 'none';
    if (!features.showOverlay) return;

    // Top bar data
    const pingEl = document.getElementById('jhp-ping');
    if (pingEl) pingEl.textContent = state.ping !== null ? state.ping : '…';
    const nameEl = document.getElementById('jhp-name');
    if (nameEl) nameEl.textContent = state.myName ? `*${state.myName}*` : '*nickname*';

    const panel  = document.getElementById('jhp-panel');
    const qa     = document.getElementById('jhp-qa');
    const hints  = document.getElementById('jhp-hints');
    const mg     = document.getElementById('jhp-mg');
    const timer  = document.getElementById('jhp-timer');
    const tnum   = document.getElementById('jhp-tnum');

    if (typeof state.timer === 'number') {
      tnum.textContent = state.timer;
      timer.classList.toggle('low', state.timer <= 5);
    }

    if (state.phase === 'question' && state.question) {
      panel.style.display = 'flex';
      mg.style.display    = 'none';

      qa.innerHTML = `<div class="jhp-b qb">${e(state.question)}</div>`;
      (state.choices || []).forEach((c, i) => {
        const ok = features.highlightAnswer && i === state.correctIdx;
        qa.innerHTML += `<div class="jhp-b${ok?' ok':''}">${e(c)}</div>`;
      });

      hints.style.display = 'flex';
      hints.innerHTML = (state.hints || []).map(h => `<div class="jhp-hint">${e(h)}</div>`).join('');

    } else if (state.phase === 'minigame') {
      panel.style.display = 'none';
      hints.style.display = 'none';
      mg.style.display    = 'flex';
      mg.innerHTML = `<div>🎮 Мини-игра: ${e(state.lastMinigame || '?')}</div>` +
        (state.hints || []).map(h => `<div class="jhp-mh">${e(h)}</div>`).join('');
    } else {
      panel.style.display = 'none';
      hints.style.display = 'none';
      mg.style.display    = 'none';
    }
  }

  function showToast(msg, color = 'blue') {
    buildOverlay();
    const c = document.getElementById('jhp-toasts');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `jhp-toast ${color}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  /* ── WebSocket patch ── */
  const OrigWS = window.WebSocket;
  class JHPSocket extends OrigWS {
    constructor(url, protocols) {
      super(url, protocols);
      this.addEventListener('message', ev => { try { parseMsg(ev.data); } catch {} });
      const orig = this.send.bind(this);
      this.send = d => {
        try { const j = JSON.parse(d);
          if (j.name || j.username) state.myName = j.name || j.username;
          if (j.roomid || j.roomId) state.room   = j.roomid || j.roomId;
        } catch {}
        return orig(d);
      };
    }
  }
  window.WebSocket = JHPSocket;
  Object.defineProperty(window.WebSocket, 'name', { value: 'WebSocket' });

  // Countdown tick
  setInterval(() => {
    if (typeof state.timer === 'number' && state.timer > 0) {
      state.timer = Math.max(0, state.timer - 1);
      renderOverlay(); broadcast();
    }
  }, 1000);

  if (document.body) buildOverlay();
  else document.addEventListener('DOMContentLoaded', buildOverlay);

  console.log('[JackHack Prime] Active ✅');
  broadcast();
})();
