/* KP Tom — página de teste. Usa somente a IFrame Player API oficial + protocolo kp-tom-v1. */
(() => {
  'use strict';
  const NS = 'kp-tom-v1';
  const YT_ORIGINS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com'];
  const $ = (id) => document.getElementById(id);

  let player = null;
  let iframe = null;
  let semi = 0;
  let seq = 0;
  let extStatus = 'idle';
  let lastState = null;
  const pending = new Map();

  // Exposto para automação/diagnóstico (Playwright, console)
  window.kpTest = { get state() { return lastState; }, get status() { return extStatus; }, setPitch: (n) => setPitch(n), player: () => player };

  function log(msg) {
    const t = new Date().toLocaleTimeString('pt-BR');
    const el = $('log');
    el.textContent = `${t}  ${msg}\n` + el.textContent;
  }

  function parseId(s) {
    s = s.trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    try {
      const u = new URL(s);
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1, 12);
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/\/(embed|shorts|live)\/([\w-]{11})/);
      return m ? m[2] : null;
    } catch { return null; }
  }

  // ------------------------------------------------------------ ponte
  function targetOrigin() {
    try { const o = new URL(iframe.src).origin; return YT_ORIGINS.includes(o) ? o : null; } catch { return null; }
  }
  function request(msg, timeout = 2500) {
    const win = iframe && iframe.contentWindow;
    const origin = iframe && targetOrigin();
    if (!win || !origin) return Promise.reject(new Error('iframe do YouTube ainda não existe'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(id); reject(new Error('sem resposta do iframe (extensão ausente, desativada ou sem acesso ao site)')); }, timeout);
      pending.set(id, (m) => { clearTimeout(t); resolve(m); });
      win.postMessage(Object.assign({ ns: NS, id }, msg), origin);
    });
  }

  window.addEventListener('message', (e) => {
    if (!YT_ORIGINS.includes(e.origin)) return;
    if (iframe && e.source !== iframe.contentWindow) return;
    const d = e.data;
    if (!d || typeof d !== 'object' || d.ns !== NS) return;
    if (d.state) { lastState = d.state; render(); }
    if (d.type === 'hello') { setExt('ready'); log(`extensão v${d.state.version} anunciou presença no iframe`); }
    if (d.type === 'denied') { setExt('denied', d.message); log('NEGADO: ' + d.message); }
    if (d.type === 'error') log('ERRO da extensão: ' + d.message);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  });

  async function detect() {
    setExt('detecting');
    try {
      const r = await request({ type: 'ping' }, 1500);
      if (r.type === 'denied') return false;
      setExt('ready');
      return true;
    } catch (e) {
      setExt('absent', e.message);
      return false;
    }
  }

  async function setPitch(n) {
    semi = Math.max(-12, Math.min(12, n));
    $('semi').textContent = (semi > 0 ? '+' : '') + semi;
    if (extStatus !== 'ready' && !(await detect())) { log('tom não aplicado: extensão indisponível'); return; }
    try {
      const r = await request({ type: 'setPitch', semitones: semi }, 4000);
      if (r.type === 'error') log('falha ao aplicar tom: ' + r.message);
      else log(`setPitch(${semi}) → rota=${r.state.graph}, contexto=${r.state.context ? r.state.context.state : '—'}`);
    } catch (e) { log('setPitch sem resposta: ' + e.message); }
  }

  // ------------------------------------------------------------ UI
  function setExt(s, info) {
    extStatus = s;
    const el = $('ext');
    const map = {
      idle: ['aguardando player', 'idle'], detecting: ['detectando…', 'warn'], ready: ['ativa no iframe', 'ok'],
      absent: ['não detectada', 'bad'], denied: ['origem não autorizada', 'bad'],
    };
    el.textContent = map[s][0];
    el.className = 'pill ' + map[s][1];
    const hint = $('hint');
    if (s === 'absent') hint.innerHTML = '⚠ Nenhuma resposta do iframe. Verifique: extensão carregada em <code>chrome://extensions</code> e ativada; “Acesso ao site” = em todos os sites (ou youtube.com); esta página aberta numa aba própria por http://localhost (não file://).';
    else if (s === 'denied') hint.innerHTML = `⚠ A extensão está instalada, mas a origem <code>${location.origin}</code> não está na lista. Abra as opções da extensão, adicione a origem, salve e recarregue.`;
    else hint.textContent = '';
  }

  function render() {
    const s = lastState;
    if (!s) return;
    const proc = $('proc');
    let txt = '—', cls = 'idle';
    if (s.lastError) { txt = 'erro'; cls = 'bad'; }
    else if (s.needsActivation) { txt = 'aguardando ativação de áudio'; cls = 'warn'; }
    else if (s.graph === 'processing') { txt = `transpondo ${s.semitones > 0 ? '+' : ''}${s.semitones} st`; cls = 'ok'; }
    else if (s.graph === 'bypass') { txt = s.adShowing ? 'bypass (anúncio)' : 'bypass (tom 0)'; cls = 'idle'; }
    else txt = 'áudio nativo (sem grafo)';
    proc.textContent = txt; proc.className = 'pill ' + cls;

    const m = s.measured;
    $('meas').textContent = m ? `${m.semitones > 0 ? '+' : ''}${m.semitones.toFixed(2)} st (r=${m.corr})` : (s.graph === 'none' ? '—' : 'medindo… (precisa de áudio tocando)');

    const rows = [
      ['extensão', `v${s.version} · mundo ${s.world}`],
      ['frame / mãe', `${s.frameOrigin} ← ${s.parentOrigin} ${s.allowed ? '✓' : '✗'}`],
      ['elemento video', s.video.found ? `${s.video.tag} · src ${s.video.srcKind}: · ${s.video.paused ? 'pausado' : 'tocando'} · readyState ${s.video.readyState}${s.video.sameAsBound === false ? ' · ELEMENTO NOVO' : ''}` : 'não encontrado'],
      ['AudioContext', s.context ? `${s.context.state} · ${s.context.sampleRate} Hz · base ${s.context.baseLatencyMs} ms · saída ${s.context.outputLatencyMs ?? '—'} ms` : 'não criado'],
      ['AudioWorklet', s.worklet],
      ['rota', s.graph + (s.adShowing ? ' (anúncio)' : '')],
      ['param. pitchSemitones', s.appliedParam == null ? '—' : String(s.appliedParam)],
      ['RMS entrada', s.preRmsDb == null ? '—' : s.preRmsDb + ' dBFS' + (s.preRmsDb < -60 ? ' (silêncio!)' : '')],
      ['RMS saída', s.postRmsDb == null ? '—' : s.postRmsDb + ' dBFS'],
      ['latência processador', s.processorLatencyMs == null ? '—' : s.processorLatencyMs + ' ms (entrada→saída, sem a do dispositivo)'],
      ['último erro', s.lastError || '—'],
    ];
    $('diag').innerHTML = rows.map(([k, v]) => `<dt>${String(k).replace(/</g, '&lt;')}</dt><dd>${String(v).replace(/</g, '&lt;')}</dd>`).join('');
    $('steps').textContent = (s.steps || []).slice().reverse().join('\n');
  }

  // ------------------------------------------------------------ autoteste
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function autoTest() {
    const tb = $('results').querySelector('tbody');
    tb.innerHTML = '';
    if (player.getPlayerState() !== 1) { player.playVideo(); await sleep(2500); }
    const out = [];
    for (const n of [0, 3, -3, 0]) {
      await setPitch(n);
      await sleep(9000);
      const s = lastState || {};
      const m = s.measured;
      const okv = m && Math.abs(m.semitones - n) <= 0.35 && m.corr > 0.5;
      const row = { pedido: n, medido: m ? m.semitones : null, corr: m ? m.corr : null, rota: s.graph, latMs: s.processorLatencyMs, pre: s.preRmsDb, post: s.postRmsDb, ok: !!okv };
      out.push(row);
      tb.insertAdjacentHTML('beforeend', `<tr><td>${n > 0 ? '+' : ''}${n}</td><td>${m ? m.semitones.toFixed(2) : '—'}</td><td>${m ? m.corr : '—'}</td><td>${s.graph}${s.processorLatencyMs != null ? ' · ' + s.processorLatencyMs + ' ms' : ''}</td><td>${s.preRmsDb ?? '—'} / ${s.postRmsDb ?? '—'}</td><td>${okv ? '<b style="color:#4ade80">OK</b>' : '<b style="color:#f87171">FALHA</b>'}</td></tr>`);
    }
    window.kpTest.results = out;
    log('autoteste concluído: ' + (out.every((r) => r.ok) ? 'TODOS OK' : 'há falhas — ver tabela'));
    return out;
  }
  window.kpTest.autoTest = autoTest;

  // ------------------------------------------------------------ player oficial
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('yt', {
      width: '100%', height: '100%', videoId: parseId($('vid').value),
      playerVars: { playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: (e) => {
          iframe = e.target.getIframe();
          log('YT.Player pronto · iframe allow="' + iframe.getAttribute('allow') + '"');
          setTimeout(() => { if (extStatus !== 'ready' && extStatus !== 'denied') detect(); }, 800);
        },
        onStateChange: (e) => {
          const n = { '-1': 'não iniciado', 0: 'FIM (aqui o Karaokê chamaria a próxima)', 1: 'tocando', 2: 'pausado', 3: 'buffer', 5: 'carregado' };
          log('onStateChange → ' + (n[e.data] ?? e.data));
        },
        onError: (e) => log('onError → ' + e.data + (e.data === 153 ? ' (falta Referer: sirva por http://localhost)' : '')),
      },
    });
  };

  document.querySelectorAll('button[data-d]').forEach((b) => b.addEventListener('click', () => setPitch(semi + Number(b.dataset.d))));
  $('reset').onclick = () => setPitch(0);
  $('play').onclick = () => player && player.playVideo();
  $('pause').onclick = () => player && player.pauseVideo();
  $('auto').onclick = () => autoTest();
  $('load').onclick = () => {
    const id = parseId($('vid').value);
    if (!id) return log('ID/URL inválido');
    player.loadVideoById(id);
    log(`loadVideoById(${id}) — tom mantido em ${semi} (no Karaokê: restaurar por música)`);
  };

  if (location.protocol === 'file:') log('⚠ Aberto como file:// — o YouTube recusará (erro 153). Sirva por http://localhost:8080.');
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
})();
