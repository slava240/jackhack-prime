/* JackHack Prime — popup.js */
'use strict';

const $ = id => document.getElementById(id);
const LETTERS = ['A','B','C','D','E','F','G','H'];
const PHASES = { waiting:'Ожидание', question:'Вопрос', minigame:'Мини-игра', result:'Итоги' };

const FEAT_KEYS = [
  'highlightAnswer','autoClick','showOverlay','pingMonitor',
  'historyLog','miniGameHints','soundAlert','eliminationHelper','ghostMode'
];

/* ── Load saved features ── */
chrome.storage.local.get('jhp_features', ({ jhp_features }) => {
  if (!jhp_features) return;
  FEAT_KEYS.forEach(k => {
    const el = $(`f-${k}`);
    if (el && jhp_features[k] !== undefined) el.checked = jhp_features[k];
  });
});

/* ── Save on toggle ── */
FEAT_KEYS.forEach(k => {
  const el = $(`f-${k}`);
  if (!el) return;
  el.addEventListener('change', () => {
    const feats = {};
    FEAT_KEYS.forEach(key => { const e = $(`f-${key}`); if (e) feats[key] = e.checked; });
    chrome.storage.local.set({ jhp_features: feats });
  });
});

/* ── Features accordion ── */
$('feat-header').addEventListener('click', () => {
  $('feat-body').classList.toggle('open');
  $('feat-header').classList.toggle('open');
});

/* ── Render ── */
function render(data) {
  if (!data) return;
  const phase = data.phase || 'waiting';
  const feats = data.features || {};

  $('status-dot').classList.toggle('active', !!data.room || phase !== 'waiting');

  // Room bar
  $('room-bar').classList.toggle('visible', true);
  $('room-code').textContent = data.room || '????';
  const pb = $('phase-badge');
  pb.textContent = PHASES[phase] || phase;
  pb.className = `phase-badge ph-${phase}`;

  // Timer
  const hasTimer = typeof data.timer === 'number';
  $('timer-section').classList.toggle('visible', hasTimer);
  if (hasTimer) {
    $('timer-num').textContent = data.timer + 's';
    const pct = Math.min(100, Math.max(0, (data.timer / (data.timerMax || 30)) * 100));
    $('timer-fill').style.width = pct + '%';
    $('timer-fill').classList.toggle('low', data.timer < 8);
  }

  const showQ  = phase === 'question' && !!data.question;
  const showMG = phase === 'minigame';

  $('waiting-card').style.display  = (!showQ && !showMG && !data.room) ? 'block' : 'none';
  $('q-card').classList.toggle('visible', showQ);
  $('mg-card').classList.toggle('visible', showMG);

  /* Question */
  if (showQ) {
    const cat = $('cat-tag');
    if (data.category) { cat.style.display = 'inline-block'; cat.textContent = data.category; }
    else cat.style.display = 'none';

    $('q-text').textContent = data.question;
    const grid = $('choices-grid');
    grid.innerHTML = '';
    (data.choices || []).forEach((c, i) => {
      const ok = feats.highlightAnswer && i === data.correctIdx;
      const div = document.createElement('div');
      div.className = 'choice' + (ok ? ' correct' : '');
      div.innerHTML = `<span class="cletter">${LETTERS[i]||i+1}</span>${esc(c)}`;
      grid.appendChild(div);
    });
  }

  /* Hints */
  const hints = data.hints || [];
  const showHints = hints.length > 0 && (showQ || showMG);
  $('hints-section').style.display = showHints ? 'block' : 'none';
  if (showHints) {
    $('hints-list').innerHTML = hints.map(h => `<div class="hint-item">${esc(h)}</div>`).join('');
  }

  /* Minigame */
  if (showMG) {
    $('mg-name').textContent = data.lastMinigame || 'Мини-игра';
    $('mg-hints').innerHTML = (data.hints || []).map(h => `<div class="hint-item">${esc(h)}</div>`).join('');
  }

  /* Stats */
  const c = data.statsCorrect || 0, w = data.statsWrong || 0, tot = c + w;
  $('stats-section').style.display = tot > 0 ? 'block' : 'none';
  if (tot > 0) {
    $('st-c').textContent = c; $('st-w').textContent = w;
    $('st-a').textContent = Math.round((c/tot)*100) + '%';
  }

  /* Players */
  const players = data.players || [];
  $('players-section').style.display = players.length ? 'block' : 'none';
  if (players.length) {
    $('player-list').innerHTML = players.map(p =>
      `<div class="player-chip${p === data.myName ? ' me' : ''}">${esc(p)}${p === data.myName ? ' 👤' : ''}</div>`
    ).join('');
  }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Poll storage ── */
setInterval(() => {
  chrome.storage.local.get('jhp_data', ({ jhp_data }) => render(jhp_data));
}, 400);
chrome.storage.local.get('jhp_data', ({ jhp_data }) => render(jhp_data));
