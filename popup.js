'use strict';
/* JackHack Prime — popup.js */

const $ = id => document.getElementById(id);
const L = ['A','B','C','D','E','F','G','H'];
const FK = ['highlightAnswer','autoClick','showOverlay','pingMonitor','historyLog','miniGameHints','soundAlert','eliminationHelper','ghostMode'];

/* ── TABS ── */
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab,.pg').forEach(e => e.classList.remove('on'));
    t.classList.add('on');
    $(`${t.dataset.tab}-pg`).classList.add('on');
    if (t.dataset.tab === 'irc') setTimeout(() => $('irc-in').focus(), 50);
  });
});

/* ── FEATURES load/save ── */
chrome.storage.local.get('jhp_features', ({ jhp_features }) => {
  if (!jhp_features) return;
  FK.forEach(k => { const e=$(`f-${k}`); if(e&&jhp_features[k]!==undefined) e.checked=jhp_features[k]; });
});
FK.forEach(k => {
  const el = $(`f-${k}`); if (!el) return;
  el.addEventListener('change', () => {
    const f={};
    FK.forEach(key=>{const e=$(`f-${key}`);if(e)f[key]=e.checked;});
    chrome.storage.local.set({jhp_features:f});
  });
});

/* ── GAME render ── */
function ph(p){return{waiting:'Ожидание',question:'Вопрос',minigame:'Мини-игра',result:'Итоги'}[p]||p}
function pc(p){return{waiting:'pw',question:'pq',minigame:'pm',result:'pr'}[p]||'pw'}

function render(data){
  if(!data) return;
  const phase=data.phase||'waiting', feats=data.features||{};
  $('dot').classList.toggle('on', !!data.room||phase!=='waiting');
  $('room-bar').classList.toggle('vis', true);
  $('room-code').textContent=data.room||'????';
  const pb=$('phase-badge'); pb.textContent=ph(phase); pb.className=`pb ${pc(phase)}`;

  const hasT=typeof data.timer==='number';
  $('tmr-sec').style.display=hasT?'block':'none';
  if(hasT){
    $('tmr-num').textContent=data.timer+'s';
    const pct=Math.min(100,Math.max(0,(data.timer/(data.timerMax||30))*100));
    $('tmr-fill').style.width=pct+'%';
    $('tmr-fill').classList.toggle('low',data.timer<=5);
  }

  const isQ=phase==='question'&&!!data.question;
  const isMG=phase==='minigame';
  $('wait-card').style.display=(!isQ&&!isMG&&!data.room)?'block':'none';
  $('q-card').style.display=isQ?'block':'none';
  $('mg-card').style.display=isMG?'block':'none';

  if(isQ){
    const ct=$('cat-tag'); ct.style.display=data.category?'inline-block':'none'; ct.textContent=data.category||'';
    $('q-text').textContent=data.question||'—';
    const ch=$('choices'); ch.innerHTML='';
    (data.choices||[]).forEach((c,i)=>{
      const d=document.createElement('div');
      const ok=feats.highlightAnswer&&i===data.correctIdx;
      d.className='ch'+(ok?' ok':'');
      const s=document.createElement('span'); s.className='cl'; s.textContent=L[i]||i+1;
      d.appendChild(s); d.appendChild(document.createTextNode(c));
      ch.appendChild(d);
    });
  }

  const hints=data.hints||[];
  $('hints-sec').style.display=(hints.length&&(isQ||isMG))?'block':'none';
  const hl=$('hints-list'); hl.innerHTML='';
  hints.forEach(h=>{const d=document.createElement('div');d.className='hi';d.textContent=h;hl.appendChild(d);});

  if(isMG){
    $('mg-name').textContent=data.lastMinigame||'Мини-игра';
    const mh=$('mg-hints'); mh.innerHTML='';
    hints.forEach(h=>{const d=document.createElement('div');d.className='hi';d.textContent=h;mh.appendChild(d);});
  }

  const c=data.statsCorrect||0,w=data.statsWrong||0,tot=c+w;
  $('stats-sec').style.display=tot>0?'flex':'none';
  if(tot>0){$('st-c').textContent=c;$('st-w').textContent=w;$('st-a').textContent=Math.round(c/tot*100)+'%';}

  const pls=data.players||[];
  $('pl-sec').style.display=pls.length?'block':'none';
  const pll=$('pl-list'); pll.innerHTML='';
  pls.forEach(p=>{
    const d=document.createElement('div');
    d.className='pc'+(p===data.myName?' me':'');
    d.textContent=p+(p===data.myName?' 👤':'');
    pll.appendChild(d);
  });
}

setInterval(()=>chrome.storage.local.get('jhp_data',({jhp_data})=>render(jhp_data)), 400);

/* ══════════════════════════════════════════
   IRC CLIENT  (WebSocket → IRC over TLS)
   Server must support WebSocket IRC (RFC 7194)
   Libera.chat: wss://irc.libera.chat:6697
   IRCCloud public gateway, etc.
══════════════════════════════════════════ */
let ws=null, myNick='', curChan='', users=[];

const IRC_SERVERS = {
  'irc.libera.chat':  'wss://irc.libera.chat:6697',
  'irc.freenode.net': 'wss://irc.freenode.net:6697',
  'irc.rizon.net':    'wss://irc.rizon.net:6697',
  'irc.efnet.org':    'wss://irc.efnet.org:6697',
};

function ircStatus(msg, cls=''){
  const el=$('irc-st');
  el.textContent=msg;
  el.className=cls;
}

function ts(){
  const d=new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function addMsg(who, text, whoClass='sy', txtClass='sy'){
  const log=$('irc-log');
  const row=document.createElement('div'); row.className='im';
  row.innerHTML=`<span class="its">${ts()}</span><span class="iw ${whoClass}">${esc(who)}</span><span class="it ${txtClass}">${esc(text)}</span>`;
  log.appendChild(row);
  log.scrollTop=log.scrollHeight;
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function ircSend(line){
  if(ws&&ws.readyState===1) ws.send(line+'\r\n');
}

function connect(){
  const srv=$('srv').value.trim()||'irc.libera.chat';
  const nick=$('nck').value.trim()||'JHPuser'+Math.floor(Math.random()*900+100);
  const chan=($('chn').value.trim()||'#jackbox').replace(/^#*/,'#');
  myNick=nick; curChan=chan;

  const url=IRC_SERVERS[srv]||`wss://${srv}:6697`;
  ircStatus(`Подключение к ${srv}…`,'wait');

  try { ws=new WebSocket(url, ['irc']); } catch(e){ ircStatus('Ошибка: '+e.message,'err'); return; }

  ws.onopen=()=>{
    ircStatus(`Соединено — регистрация…`,'wait');
    ircSend(`NICK ${nick}`);
    ircSend(`USER jhprime 0 * :JackHack Prime User`);
  };

  ws.onclose=()=>{
    ircStatus('Отключено','err');
    $('irc-go').style.display='';
    $('irc-dc').style.display='none';
    $('irc-in').disabled=true;
    $('irc-send').disabled=true;
    addMsg('✕','Соединение закрыто');
    ws=null;
  };

  ws.onerror=()=>ircStatus('Ошибка WebSocket','err');

  ws.onmessage=e=>{
    const lines=e.data.split(/\r?\n/);
    lines.forEach(parseIRC);
  };
}

function parseIRC(raw){
  if(!raw.trim()) return;

  // PING
  if(raw.startsWith('PING')){
    ircSend('PONG'+raw.slice(4));
    return;
  }

  // Parse: [:prefix] CMD [params] [:trailing]
  let prefix='', cmd='', params=[];
  let rest=raw;
  if(rest.startsWith(':')){ const sp=rest.indexOf(' '); prefix=rest.slice(1,sp); rest=rest.slice(sp+1); }
  const trail=rest.indexOf(' :');
  let trailing='';
  if(trail>=0){ trailing=rest.slice(trail+2); rest=rest.slice(0,trail); }
  const parts=rest.trim().split(' ');
  cmd=parts[0]; params=parts.slice(1);
  if(trailing) params.push(trailing);

  const nick=prefix.split('!')[0];

  switch(cmd){
    case '001': // Welcome
      ircStatus(`✅ Подключён как ${myNick} на ${$('srv').value}`,'ok2');
      ircSend(`JOIN ${curChan}`);
      $('irc-go').style.display='none';
      $('irc-dc').style.display='';
      $('irc-in').disabled=false;
      $('irc-send').disabled=false;
      addMsg('→',`Добро пожаловать! Захожу в ${curChan}…`);
      break;
    case 'JOIN':
      if(nick===myNick) addMsg('→',`Вошёл в ${params[0]||curChan}`);
      else addMsg('→',`${nick} зашёл в канал`);
      break;
    case 'PART': case 'QUIT':
      addMsg('←',`${nick} покинул канал`);
      users=users.filter(u=>u!==nick);
      renderUsers();
      break;
    case 'PRIVMSG':{
      const target=params[0], text=params[1]||'';
      if(target===curChan||target===myNick){
        const isMe=nick===myNick;
        addMsg(`<${nick}>`, text, isMe?'me':'ot', '');
      }
      break;
    }
    case 'NOTICE':
      addMsg(`[${nick||'server'}]`, params[1]||'','sy','sy');
      break;
    case '353':{ // NAMES reply
      const names=(params[params.length-1]||'').split(' ').map(n=>n.replace(/^[@+]/,''));
      users=[...new Set([...users,...names])];
      renderUsers();
      break;
    }
    case '366': break; // end of NAMES
    case '332': addMsg('📌','Тема: '+(params[2]||''),'sy','sy'); break;
    case '433': // Nick in use
      myNick=myNick+'_';
      ircSend(`NICK ${myNick}`);
      ircStatus(`Ник занят — пробую ${myNick}`,'wait');
      break;
    case 'NICK':
      if(nick===myNick){ myNick=params[0]; ircStatus(`Ник изменён на ${myNick}`,'ok2'); }
      addMsg('~',`${nick} → ${params[0]}`,'sy','sy');
      break;
    case 'KICK':
      addMsg('⚡',`${nick} кикнул ${params[1]} из ${params[0]}: ${params[2]||''}`,'sy','sy');
      break;
    default:
      // Server numeric messages — show quietly
      if(/^\d+$/.test(cmd) && parseInt(cmd)>400)
        addMsg('!', params.slice(1).join(' '),'sy','er');
      break;
  }
}

function renderUsers(){
  const p=$('usr-panel');
  p.innerHTML='';
  [...new Set(users)].sort((a,b)=>a.localeCompare(b)).forEach(u=>{
    const d=document.createElement('div'); d.className='uu';
    d.textContent=(u===myNick?'▶ ':'')+u;
    p.appendChild(d);
  });
}

function sendMsg(){
  const val=$('irc-in').value.trim();
  if(!val||!ws) return;
  $('irc-in').value='';

  if(val.startsWith('/')){
    const [rawCmd,...args]=val.slice(1).split(' ');
    const cmd=rawCmd.toUpperCase();
    if(cmd==='JOIN'){
      curChan=(args[0]||curChan).replace(/^#*/,'#');
      ircSend(`JOIN ${curChan}`);
      users=[];
    } else if(cmd==='NICK'){
      myNick=args[0]||myNick;
      ircSend(`NICK ${myNick}`);
    } else if(cmd==='ME'){
      ircSend(`PRIVMSG ${curChan} :\u0001ACTION ${args.join(' ')}\u0001`);
      addMsg(`* ${myNick}`,args.join(' '),'me','');
    } else if(cmd==='MSG'||cmd==='QUERY'){
      const target=args[0], txt=args.slice(1).join(' ');
      ircSend(`PRIVMSG ${target} :${txt}`);
      addMsg(`→${target}`,txt,'me','');
    } else if(cmd==='TOPIC'){
      ircSend(`TOPIC ${curChan} :${args.join(' ')}`);
    } else if(cmd==='QUIT'){
      ircSend(`QUIT :${args.join(' ')||'JackHack Prime'}`);
      ws.close();
    } else {
      // Raw command passthrough
      ircSend(rawCmd.toUpperCase()+' '+args.join(' '));
    }
    return;
  }

  ircSend(`PRIVMSG ${curChan} :${val}`);
  addMsg(`<${myNick}>`,val,'me','');
}

$('irc-go').addEventListener('click', connect);
$('irc-dc').addEventListener('click', ()=>{ if(ws){ircSend('QUIT :bye');ws.close();} });
$('irc-send').addEventListener('click', sendMsg);
$('irc-in').addEventListener('keydown', e=>{ if(e.key==='Enter') sendMsg(); });
$('usr-btn').addEventListener('click', ()=>{
  $('usr-panel').classList.toggle('op');
  if($('usr-panel').classList.contains('op')) ircSend(`NAMES ${curChan}`);
});
