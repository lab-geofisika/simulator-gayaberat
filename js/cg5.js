/* =====================================================================
   Simulator Scintrex CG-5 Autograv
   Mengikuti CG-5 Operation Manual (part 867700 Rev. 8) dan SOP Gravimeter lab:
   SETUP MENU (Survey, Autograv, Options, Clock, Dump, Memory, Service),
   mode FUNCT/EDIT, STATION DESIGNATION → LEVELING (ikon senyum ±10″) →
   READ GRAV → FINAL DATA → RECORD, dan dump teks persis format alat.
   ===================================================================== */
'use strict';

(() => {
  /* ---------- Parameter alat (dari file dump alat lab S/N 41223) ---------- */
  const SN = '41223', SW = '4.2';
  const P0 = { gref: 0, gcal: 7979.998, txs: 729.731, tys: 649.316, txo: 19.576, tyo: 23.353, tempco: -0.138, drift: 0.796 };
  const FULL = 536870912, TEMP_SF = 1000 / FULL, TBIAS = 500, TOFF = 0;
  const STEP_COARSE = 20, STEP_FINE = 4;                  // detik busur per klik sekrup kaki
  const FEET = { F: { x: 0, y: 1 }, L: { x: -0.866, y: -0.5 }, R: { x: 0.866, y: -0.5 } };
  const SYSTEMS = ['NSEWm', 'NSEWft', 'XYm', 'XYft', 'UTMm', 'LAT/LONG'];
  const SYS_OK = ['NSEWm', 'XYm', 'LAT/LONG'];
  const ICONS = [
    { k: 'survey', l: 'Survey', i: '⛏' }, { k: 'autograv', l: 'Autograv', i: '⚖' }, { k: 'options', l: 'Options', i: '☑' },
    { k: 'clock', l: 'Clock', i: '◷' }, { k: 'dump', l: 'Dump', i: '🖫' }, { k: 'memory', l: 'Memory', i: '▤' },
    { k: 'service', l: 'Service', i: '⚒' }
  ];
  const MT = { 1: '1abc', 2: '2def', 3: '3ghi', 4: '4jkl', 5: '5mno', 6: '6pqr', 7: '7stu', 8: '8vwx', 9: '9yz', 0: '0 -' };

  let st = null, root = null, fine = false, timer = null, M = null; // M = pengukuran yang sedang berjalan
  const S = () => Field.S, sc = () => Field.sc;
  const esc = Field.esc;
  const pad = Sim.pad, pf = Sim.pf;

  /* =================== Waktu alat =================== */
  const devMs = utc => utc + (Sim.WIB + st.clockOff) * 3600e3;       // jam alat (ditulis seolah UTC)
  const devUtc = utc => devMs(utc) + st.survey.gmt * 3600e3;          // UTC menurut alat
  const dParts = utc => { const d = new Date(devMs(utc)); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }; };
  const dTime = utc => { const p = dParts(utc); return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`; };
  const dDate = utc => { const p = dParts(utc); return `${p.y}/${pad(p.mo)}/${pad(p.d)}`; };
  // DEC.TIME+DATE seperti alat: hari sejak 1900 tanpa hari kabisat + pecahan hari (faktor alat 0.998394)
  function decTime(utc) {
    const p = dParts(utc), doy = Math.floor((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(p.y, 0, 1)) / 864e5);
    return (p.y - 1900) * 365 + doy + (p.h * 3600 + p.mi * 60 + p.s) / 86400 * 0.998394;
  }

  /* =================== State awal =================== */
  function newState(scn, sess) {
    const R = Sim.rng(Sim.hashStr('cg5|' + scn.code));
    return {
      v: 2,
      truth: {
        C: R.range(3400, 4600),                                 // offset bacaan
        resid: R.range(0.25, 0.65) * (R() < 0.75 ? 1 : -1),    // sisa apungan setelah koreksi alat, mGal/hari
        temp0: R.range(-0.5, 0.2)
      },
      power: false, scr: 'off', overlay: null, sel: 0,
      edit: false, field: 0, buf: null, caps: false, mt: null, snap: null, msg: null,
      survey: { id: 'Default', cust: 'Default', oper: 'Default', lat: 0, lon: 0, azi: 0, elev: 0, zone: 0, gmt: 0, sys: 'LAT/LONG' },
      ag: { tide: true, tilt: true, rej: true, terr: false, seis: false, raw: false },
      inst: { ...P0, dStart: sess.startUtc },
      opt: { read: 60, factory: 80, cyc: 1, delay: 4, lsep: 0, ssep: 0, autoinc: false, chart: 1, measure: 'NUMERIC', heater: false, amb: false, finalKey: true },
      dump: { baud: 9600 },
      clockOff: 0, contrast: 1, gScale: 0.5, gChan: 0,
      stn: { sta: 0, line: 0, elev: 0, lat: 0, lon: 0 },
      tx: (R() < 0.5 ? -1 : 1) * R.range(150, 420), ty: (R() < 0.5 ? -1 : 1) * R.range(150, 420),
      result: null, prevIdx: 0, mem: [], note: '', arrivedAt: sess.startUtc,
      dumped: false, rawDumped: false, recallLine: null, recallPos: 0, tideWarned: false
    };
  }

  /* =================== Model fisika =================== */
  // kemiringan nyata = posisi sekrup kaki + kemiringan perangkat (sensor gerak, bila aktif)
  const TX = () => st.tx + Field.gyroTilt().x, TY = () => st.ty + Field.gyroTilt().y;
  const tiltDisp = (tx, ty) => ({
    x: tx * (st.inst.txs / P0.txs) - (st.inst.txo - P0.txo),
    y: ty * (st.inst.tys / P0.tys) - (st.inst.tyo - P0.tyo)
  });
  // gayaberat sensor (mGal) tanpa noise — semua efek fisik termasuk apungan asli alat
  function sensorTrue(t, s, tx, ty, temp, hInst) {
    const tr = st.truth, base = sc().stations[0];
    const days = (t - st.inst.dStart) / 864e5;
    const th2 = (tx * tx + ty * ty) * Sim.ARCSEC ** 2;
    return tr.C + (s.gAbs - base.gAbs) - Sim.FAG * hInst
      + Sim.tideEffect(t, s.lat, s.lon, s.elev)
      + (P0.drift + tr.resid) * days
      - 978000 * th2 / 2
      + P0.tempco * temp;
  }
  // bangkitkan sampel 6 Hz secara deterministik dari spesifikasi pembacaan
  function genSamples(sp) {
    const s = sc().stations.find(x => x.id === sp.loc);
    const R = Sim.rng(sp.seed);
    const n = sp.n6, g = new Float64Array(n), tx = new Float64Array(n), ty = new Float64Array(n), tp = new Float64Array(n);
    const filt = sp.seis ? 0.55 : 1;
    const per = 5 + R() * 3, ph = R() * 6.28, amp = sp.sd * 0.8 * filt;
    let spike = 0;
    for (let i = 0; i < n; i++) {
      const tsec = i / 6, t = sp.t0 + tsec * 1000;
      if (i % 6 === 0) spike = R() < sp.spikeP ? (R() < 0.5 ? -1 : 1) * (0.3 + R() * 1.2) : 0;
      let ax = sp.tx + sp.dtx * tsec + R.gauss() * 0.15, ay = sp.ty + sp.dty * tsec + R.gauss() * 0.15;
      // getaran karena laptop/alat tersentuh: osilasi teredam + sedikit pergeseran tripod
      let kick = 0;
      for (const d of sp.dist || []) {
        if (tsec < d.t) continue;
        const u = tsec - d.t;
        kick += d.a * Math.exp(-u / 3) * Math.sin(2 * Math.PI * u / 1.8);
        ax += d.dx; ay += d.dy;
      }
      const temp = sp.temp + 0.002 * tsec / 60 + R.gauss() * 0.004;
      tx[i] = ax; ty[i] = ay; tp[i] = temp;
      g[i] = sensorTrue(t, s, ax, ay, temp, sp.hInst) + amp * Math.sin(2 * Math.PI * tsec / per + ph) + R.gauss() * sp.sd * 2 * filt + spike + kick * filt;
    }
    return { g, tx, ty, tp, s };
  }
  // hitung FINAL DATA dari n detik pertama sampel
  function finalize(sp, nSec) {
    const smp = genSamples(sp), s = smp.s;
    const g1 = [], tx1 = [], ty1 = [], tp1 = [];
    for (let k = 0; k < nSec; k++) {
      let a = 0, b = 0, c = 0, d = 0;
      for (let j = 0; j < 6; j++) { const i = k * 6 + j; a += smp.g[i]; b += smp.tx[i]; c += smp.ty[i]; d += smp.tp[i]; }
      g1.push(a / 6); tx1.push(b / 6); ty1.push(c / 6); tp1.push(d / 6);
    }
    let keep = g1.map((v, i) => i), rej = 0;
    if (sp.rej && g1.length > 4) {
      const srt = [...g1].sort((a, b) => a - b), med = srt[srt.length >> 1];
      const mad = g1.map(v => Math.abs(v - med)).sort((a, b) => a - b)[g1.length >> 1] * 1.4826 || 0.01;
      const lim = (sp.seis ? 6 : 4) * Math.max(mad, 0.005);
      keep = keep.filter(i => Math.abs(g1[i] - med) <= lim);
      rej = g1.length - keep.length;
    }
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const gk = keep.map(i => g1[i]);
    const m = mean(gk);
    const sd = Math.sqrt(gk.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(1, gk.length - 1));
    const tMid = sp.t0 + nSec * 500, tEnd = sp.t0 + nSec * 1000;
    const temp = mean(tp1);
    // koreksi kemiringan dari sensor tilt (kontinu, atau detik terakhir bila Cont. Tilt = NO)
    const corrOf = (x, y) => { const d = tiltDisp(x, y); return Math.abs(d.x) > 200 || Math.abs(d.y) > 200 ? 0 : 978000 * (d.x * d.x + d.y * d.y) * Sim.ARCSEC ** 2 / 2; };
    const tiltCorr = sp.cont ? mean(keep.map(i => corrOf(tx1[i], ty1[i]))) : corrOf(tx1[nSec - 1], ty1[nSec - 1]);
    const days = (tMid - st.inst.dStart) / 864e5;
    const tide = sp.tide ? Sim.longman(sp.tideUtcOff + tMid, sp.tlat, sp.tlon, 0) : 0;
    const grav = (st.inst.gcal / P0.gcal) * (m - st.inst.drift * days + tiltCorr - st.inst.tempco * temp) + tide - st.inst.gref;
    const dx = tiltDisp(mean(tx1), mean(ty1));
    const ideal = st.truth.C + (s.gAbs - sc().stations[0].gAbs) - Sim.FAG * sp.hInst + st.truth.resid * days
      + (sp.tide ? 0 : Sim.tideEffect(tMid, s.lat, s.lon, s.elev));
    return { grav, sd, err: sd / Math.sqrt(gk.length), tx: dx.x, ty: dx.y, temp, tide, dur: nSec, rej, n: g1.length, tMid, tEnd, ideal, trueTide: Sim.longman(tMid, s.lat, s.lon, s.elev) };
  }

  /* =================== Tampilan alat =================== */
  function mount(el) {
    if (!S().inst || S().inst.v !== 2) S().inst = newState(sc(), S());
    st = S().inst;
    root = el;
    const kb = (k, main, top, sub, cls = '') => `<button class="ck ${cls}" data-k="${k}">${top ? `<i class="top">${top}</i>` : ''}<b>${main}</b>${sub ? `<i class="sub">${sub}</i>` : ''}</button>`;
    el.innerHTML = `
      <div class="cg5-wrap">
        <div class="cg5x" tabindex="0" aria-label="Gravimeter Scintrex CG-5">
          <div class="cgx-head"><span class="cgx-model">CG-5 AUTOGRAV<sup>TM</sup></span><span class="cgx-brand">SCINTREX</span></div>
          <div class="cgx-mid">
            <div class="cgx-left">
              ${kb('pwr', 'ON/OFF', '', '', 'pwr')}
              ${kb('N', 'N', '', '+', 'dir')}${kb('S', 'S', '', '-', 'dir')}${kb('E', 'E', '', '+', 'dir')}${kb('W', 'W', '', '-', 'dir')}
            </div>
            <div class="lcd2" id="lcd"></div>
            <div class="cgx-right">${[1, 2, 3, 4, 5].map(i => kb('F' + i, 'F' + i, '', '', 'fk')).join('')}</div>
          </div>
          <div class="cgx-bottom">
            <div class="cgx-num">
              ${kb('1', '1', '', 'ABC')}${kb('2', '2', '', 'DEF')}${kb('3', '3', '', 'GHI')}${kb('4', '4', 'SETUP', 'JKL')}${kb('5', '5', 'RECALL', 'MNO')}
              ${kb('6', '6', 'DISPLAY', 'PQR')}${kb('7', '7', 'INFO', 'STU')}${kb('8', '8', 'NOTE', 'VWX')}${kb('9', '9', '', 'YZ')}${kb('0', '0', 'ESC', '')}
              ${kb('enter', 'ENTER', '', '', 'yel wide')}${kb('.', '•', 'HELP', '')}${kb('measure', 'MEASURE<br>CLR', '', '', 'yel wide')}
            </div>
            <div class="cgx-arrows">
              ${kb('up', '▲', '', '', 'arr up')}${kb('left', '◀', '', '', 'arr left')}${kb('right', '▶', '', '', 'arr right')}${kb('down', '▼', '', '', 'arr down')}
            </div>
          </div>
        </div>
        <div class="tripod">
          <div class="tripod-title">Sekrup kaki tripod (leveling)<label class="fine"><input type="checkbox" id="fineChk"> halus</label></div>
          <svg viewBox="-110 -100 220 200" class="tripod-svg">
            <polygon points="${Object.values(FEET).map(f => `${84 * f.x},${-84 * f.y}`).join(' ')}" class="plate"/>
            <rect x="-34" y="-34" width="68" height="68" rx="6" class="body-top"/>
            <text y="4" text-anchor="middle" class="plate-t">CG-5</text>
            <line x1="0" y1="0" x2="26" y2="0" class="axis"/><text x="29" y="4" class="axis-t">X</text>
            <line x1="0" y1="0" x2="0" y2="-26" class="axis"/><text x="-3" y="-29" class="axis-t">Y</text>
            ${Object.entries(FEET).map(([k, f]) => `<g transform="translate(${84 * f.x},${-84 * f.y})"><circle r="13" class="screw"/><text y="4" text-anchor="middle" class="screw-t">${k}</text></g>`).join('')}
          </svg>
          <div class="screw-btns">${[['F', 'depan'], ['L', 'kiri'], ['R', 'kanan']].map(([k, n]) => `<div><b>${k}</b><button class="btn sm" data-s="${k}" data-d="-1" title="Putar berlawanan jarum jam (kaki turun)">⟲</button><button class="btn sm" data-s="${k}" data-d="1" title="Putar searah jarum jam (kaki naik)">⟳</button><small>${n}</small></div>`).join('')}</div>
        </div>
        <div class="help" id="cgHelp"></div>
      </div>`;
    el.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => key(b.dataset.k)));
    el.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => screw(b.dataset.s, +b.dataset.d)));
    el.querySelector('#fineChk').onchange = e => { fine = e.target.checked; };
    document.removeEventListener('keydown', onKeyboard);
    document.addEventListener('keydown', onKeyboard);
    Field.onVibration(onVib);
    if (!window.__cgGyro) window.__cgGyro = setInterval(() => { const g = Field.gyroTilt(); if (st && st.scr === 'level' && (g.x || g.y)) draw(); }, 150);
    if (['measuring', 'boot'].includes(st.scr)) { st.scr = st.power ? 'setup' : 'off'; st.result = null; }
    draw();
  }

  function onKeyboard(e) {
    if (!st || document.querySelector('#modal:not([hidden])')) return;
    const tg = e.target;
    if (tg && /INPUT|SELECT|TEXTAREA/.test(tg.tagName)) return;
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'enter', Escape: '0', Backspace: 'measure', F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', '.': '.' };
    let k = map[e.key] || (/^[0-9]$/.test(e.key) ? e.key : null);
    const f = curField();
    if (st.edit && f && f.t === 'text' && e.key.length === 1 && /[\w\-. /]/.test(e.key) && !/^[0-9]$/.test(e.key)) k = 'ch:' + e.key;
    else if (st.edit && f && ['coord', 'dirnum', 'num'].includes(f.t) && /^[nsewNSEW]$/.test(e.key)) k = e.key.toUpperCase();
    else if (st.edit && f && f.t === 'num' && e.key === '-') k = 'S';
    if (!k) return;
    e.preventDefault();
    key(k);
  }

  /* =================== Definisi layar isian =================== */
  const F_SURVEY = [
    { k: 'id', l: 'SurveyID', t: 'text' }, { k: 'cust', l: 'Customer', t: 'text' }, { k: 'oper', l: 'Operator', t: 'text' },
    { k: 'lat', l: 'Latitude', t: 'coord', d: 'NS', gap: 'GRID REFERENCE:' }, { k: 'lon', l: 'Longitude', t: 'coord', d: 'EW' },
    { k: 'azi', l: 'Azimuth', t: 'num' }, { k: 'elev', l: 'Elevation', t: 'num' }, { k: 'zone', l: 'UTM Zone', t: 'num', dec: 0 },
    { k: 'gmt', l: 'GMT Diff.', t: 'num' }
  ];
  const F_AG1 = [
    { k: 'tide', l: 'Tide Correct.', t: 'yn' }, { k: 'tilt', l: 'Cont.Tilt.Corr', t: 'yn' }, { k: 'rej', l: 'Auto Reject', t: 'yn' },
    { k: 'terr', l: 'Terrain Corr.', t: 'yn' }, { k: 'seis', l: 'Seismic Filter', t: 'yn' }, { k: 'raw', l: 'Save Raw Data', t: 'yn' }
  ];
  const F_AG2 = [
    { k: 'gref', l: 'Gref.', t: 'num' }, { k: 'gcal', l: 'G.Cal1', t: 'num' }, { k: 'txs', l: 'TiltX.Sens', t: 'num' },
    { k: 'tys', l: 'TiltY.Sens', t: 'num' }, { k: 'txo', l: 'TiltX.Offs', t: 'num' }, { k: 'tyo', l: 'TiltY.Offs', t: 'num' },
    { k: 'tempco', l: 'Tempco', t: 'num' }, { k: 'drift', l: 'Drift', t: 'num' }
  ];
  const F_OPT = [
    { k: 'read', l: 'Read Time', t: 'num', dec: 0, min: 1, max: 256 }, { k: 'factory', l: 'Factory Flag', t: 'ro' },
    { k: 'cyc', l: '#Of Cycles', t: 'num', dec: 0, min: 1, max: 30 }, { k: 'delay', l: 'Start Delay', t: 'num', dec: 0, min: 1, max: 99 },
    { k: 'lsep', l: 'Line separation', t: 'num' }, { k: 'ssep', l: 'Station separation', t: 'num' },
    { k: 'autoinc', l: 'Auto station inc.', t: 'yn' }, { k: 'chart', l: 'Chart Scale', t: 'num', dec: 0 },
    { k: 'measure', l: 'Measurement', t: 'ch', ch: ['NUMERIC', 'GRAPHIC'] }, { k: 'heater', l: 'LCD Heater', t: 'yn', on: 'ON', off: 'OFF' },
    { k: 'amb', l: 'Record Amb.Temp', t: 'yn' }
  ];
  const F_SYS = [{ k: 'sys', l: 'System', t: 'ch', ch: SYSTEMS }];
  const F_DUMP = [{ k: 'baud', l: 'Baud rate', t: 'ch', ch: [600, 1200, 2400, 4800, 9600, 19200, 38400, 57600] }];
  const F_CLOCK = [{ k: 'time', l: 'HH:MM:SS', t: 'clk' }, { k: 'date', l: 'YYYY/MM/DD', t: 'clk' }];
  const F_NOTE = [{ k: 'note', l: 'Note', t: 'text', max: 30 }];
  function fStn() {
    const sys = st.survey.sys, el = { k: 'elev', l: st.opt.amb ? 'Amb.Temp' : 'Elevation', t: 'num' };
    if (sys === 'LAT/LONG') return [{ k: 'lon', l: 'Longit.', t: 'coord', d: 'EW' }, { k: 'lat', l: 'Latit.', t: 'coord', d: 'NS' }, el, { k: 'line', l: 'Line ID', t: 'dirnum', d: 'NS', gap: ' ' }];
    if (sys === 'XYm') return [{ k: 'sta', l: 'Station', t: 'num' }, { k: 'line', l: 'Line', t: 'num' }, el];
    return [{ k: 'sta', l: 'Station', t: 'dirnum', d: 'EW' }, { k: 'line', l: 'Line', t: 'dirnum', d: 'NS' }, el];
  }
  const FIELDS = {
    survey: () => [F_SURVEY, st.survey], sysdes: () => [F_SYS, st.survey], autograv: () => [F_AG1, st.ag], autograv2: () => [F_AG2, st.inst],
    options: () => [F_OPT, st.opt], dump: () => [F_DUMP, st.dump], clock: () => [F_CLOCK, clockObj()], stn: () => [fStn(), st.stn], note: () => [F_NOTE, st]
  };
  function curField() { const fd = FIELDS[st.scr]; if (!fd) return null; const [F] = fd(); return F[st.field] || null; }
  function clockObj() {
    const now = S().now;
    return {
      get time() { return dTime(now); }, set time(v) { setClock(v, dDate(now)); },
      get date() { return dDate(now); }, set date(v) { setClock(dTime(now), v); }
    };
  }
  function setClock(tStr, dStr) {
    const t = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(tStr), d = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(dStr);
    if (!t || !d) { flash('FORMAT SALAH'); return; }
    const want = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]);
    st.clockOff = Math.round(((want - S().now) / 3600e3 - Sim.WIB) * 3600) / 3600;
  }

  // format nilai isian
  function fmtCoord(v, d) { return `${Math.abs(v).toFixed(5)}${v < 0 ? d[1] : d[0]}`; }
  function fmtDirnum(v, d) { return `${Math.abs(v)}.${v < 0 ? d[1] : d[0]}`; }
  function fmtVal(f, obj) {
    const v = obj[f.k];
    if (f.t === 'yn') return v ? (f.on || 'YES') : (f.off || 'NO');
    if (f.t === 'ch' || f.t === 'ro' || f.t === 'clk' || f.t === 'text') return String(v ?? '');
    if (f.t === 'coord') return fmtCoord(v, f.d);
    if (f.t === 'dirnum') return fmtDirnum(v, f.d);
    if (f.dec === 0) return String(Math.round(v));
    return String(+(+v).toFixed(5));
  }

  /* =================== Tombol =================== */
  function key(k) {
    if (!st) return;
    if (k === 'pwr') return power();
    if (!st.power || st.scr === 'boot') return;
    if (st.overlay) {
      if ((st.overlay === 'info' && k === '7') || (st.overlay === 'help' && k === '.') || k === '0') st.overlay = null;
      return draw();
    }
    if (st.scr === 'measuring') { if (k === 'F5' || k === 'measure') stopReading(); else if (k === 'F1' || k === 'F2') scaleKey(k); return draw(); }
    if (st.scr === 'confirm') {
      if (k === '9') { st.mem = []; st.inst.dStart = S().now; go('memory'); flash('MEMORY CLEARED'); Field.refresh(); }
      else if (k === '5') go('memory');
      return draw();
    }
    if (st.edit) { editKey(k); return after(); }
    // ---- mode FUNCT ----
    const g = { '4': 'setup', '5': 'recall', '6': 'display', '8': 'note' };
    if (g[k]) { go(g[k]); return after(); }
    if (k === '7') { st.overlay = 'info'; return draw(); }
    if (k === '.') { st.overlay = 'help'; return draw(); }
    if (k === 'measure') {
      if (st.scr === 'stn' || st.scr === 'tercor') go('level');
      else if (st.scr === 'level') startReading();
      else if (st.scr === 'finished') SCREENS.finished.key('F5');
      else go('stn');
      return after();
    }
    const h = SCREENS[st.scr] && SCREENS[st.scr].key;
    if (h) h(k);
    after();
  }
  function after() { draw(); Field.refresh(); Field.save(); }
  function go(scr) {
    st.scr = scr; st.edit = false; st.field = 0; st.buf = null; st.mt = null; st.msg = null;
    if (FIELDS[scr]) st.snap = JSON.stringify([st.survey, st.ag, st.inst, st.opt, st.dump, st.stn, st.note, st.clockOff]);
  }
  function cancelChanges() {
    if (st.snap) [st.survey, st.ag, st.inst, st.opt, st.dump, st.stn, st.note, st.clockOff] = JSON.parse(st.snap);
  }
  function flash(m) { st.msg = m; setTimeout(() => { if (st && st.msg === m) { st.msg = null; draw(); } }, 1800); }

  /* GPS alat: Field.gpsFix() = posisi simulasi (stasiun + galat) atau lokasi asli HP */
  let gpsBusy = false;
  function readGps(apply, done) {
    if (gpsBusy) return;
    gpsBusy = true; st.msg = 'ACQUIRING GPS...'; draw();
    Field.gpsFix().then(fx => {
      gpsBusy = false; st.msg = null;
      const alt = typeof fx.alt === 'number' ? fx.alt : null;
      st.gpsLast = { lat: fx.lat, lon: fx.lon, alt, acc: fx.acc, altAcc: fx.altAcc || null, utc: fx.utc, sats: fx.sats, src: fx.src };
      apply({ ...fx, alt });
      if (done) flash(alt === null ? done + ' (NO ALT.)' : done);
      after();
    }).catch(e => { gpsBusy = false; st.msg = null; flash('NO GPS FIX'); Field.toast(e.message, 'err'); draw(); });
  }
  function putGps(o, fx) {
    o.lat = Math.round(fx.lat * 1e6) / 1e6; o.lon = Math.round(fx.lon * 1e6) / 1e6;
    if (fx.alt !== null && !(o === st.stn && st.opt.amb)) o.elev = Math.round(fx.alt * 10) / 10;
  }
  function power() {
    if (st.scr === 'measuring') { Field.toast('Sedang mengukur — tekan F5 STOP dulu.', 'err'); return; }
    if (st.power) { st.power = false; st.scr = 'off'; st.overlay = null; }
    else {
      st.power = true; st.scr = 'boot';
      setTimeout(() => { if (st.scr === 'boot') { go('setup'); draw(); Field.refresh(); } }, 1300);
    }
    draw(); Field.refresh(); Field.save(true);
  }

  /* ---------- mesin isian (mode EDIT) ---------- */
  function editKey(k) {
    const [F, obj] = FIELDS[st.scr]();
    const f = F[st.field];
    const commit = () => {
      if (st.buf === null) return true;
      const b = st.buf; st.buf = null; st.mt = null;
      if (f.t === 'text') { obj[f.k] = b.slice(0, f.max || 19); return true; }
      if (f.t === 'clk') { obj[f.k] = b; return true; }
      const v = parseFloat(b);
      if (!isFinite(v)) return true;
      if (f.min !== undefined && (v < f.min || v > f.max)) { flash(`RANGE ${f.min}-${f.max}`); return false; }
      if (f.k === 'lat' && Math.abs(v) > 90) { flash('RANGE ±90'); return false; }
      if (f.k === 'lon' && Math.abs(v) > 180) { flash('RANGE ±180'); return false; }
      if (f.k === 'gmt' && Math.abs(v) > 14) { flash('RANGE ±14'); return false; }
      obj[f.k] = f.dec === 0 ? Math.round(v) : v;
      return true;
    };
    const startBuf = () => { if (st.buf === null) st.buf = ''; };
    if (k === 'F3') { if (commit()) st.edit = false; return; }
    if (k === 'F4' && SCREENS[st.scr].cancel) { cancelChanges(); go(SCREENS[st.scr].cancel); return; }
    if (k === 'F5') { if (commit()) { st.edit = false; SCREENS[st.scr].key('F5'); } return; }
    if (k === 'up' || k === 'down') {
      if (!commit()) return;
      const n = F.length; let i = st.field;
      do { i = (i + (k === 'up' ? n - 1 : 1)) % n; } while (F[i].t === 'ro' && i !== st.field);
      st.field = i;
      return;
    }
    if (f.t === 'ro') return;
    if (f.t === 'yn') { if (['left', 'right', 'enter'].includes(k)) obj[f.k] = !obj[f.k]; return; }
    if (f.t === 'ch') {
      if (['left', 'right', 'enter'].includes(k)) {
        const i = f.ch.indexOf(obj[f.k]), n = f.ch.length, step = k === 'left' ? n - 1 : 1;
        let j = (i + step) % n;
        if (f.k === 'sys') while (!SYS_OK.includes(f.ch[j])) j = (j + step) % n;
        obj[f.k] = f.ch[j];
      }
      return;
    }
    if (k === 'F2') { st.buf = ''; st.mt = null; return; }                       // CLEAR ALL
    if (k === 'F1' && f.t === 'text') { st.caps = !st.caps; return; }           // CAPS LOCK
    if (k === 'measure') {                                                        // CLR: hapus karakter sebelumnya
      if (st.buf === null) st.buf = f.t === 'text' || f.t === 'clk' ? String(obj[f.k] || '') : String(Math.abs(obj[f.k]));
      st.buf = st.buf.slice(0, -1); st.mt = null; return;
    }
    if (k === 'enter') { commit(); return; }
    if (f.t === 'text') {
      if (k.startsWith('ch:')) { startBuf(); st.buf = (st.buf + (st.caps ? k.slice(3).toUpperCase() : k.slice(3))).slice(0, f.max || 19); st.mt = null; return; }
      if (k === 'right') { st.mt = null; return; }
      if (MT[k]) {
        startBuf();
        const now = Date.now(), set = MT[k];
        if (st.mt && st.mt.k === k && now - st.mt.at < 1200) {
          st.mt.n = (st.mt.n + 1) % set.length;
          st.buf = st.buf.slice(0, -1);
        } else st.mt = { k, n: 0 };
        st.mt.at = now;
        const ch = set[st.mt.n];
        st.buf = (st.buf + (st.caps ? ch.toUpperCase() : ch)).slice(0, f.max || 19);
        return;
      }
      if (k === '.') { startBuf(); st.buf += '.'; return; }
      return;
    }
    if (f.t === 'clk') {
      if (/^[0-9]$/.test(k)) { startBuf(); if (st.buf.length < 10) st.buf += k; }
      if (k === '.' || k === 'right') { startBuf(); st.buf += f.k === 'time' ? ':' : '/'; }
      return;
    }
    // angka: num, coord, dirnum
    if (/^[0-9]$/.test(k)) { startBuf(); if (st.buf.replace(/[-.]/g, '').length < 10) st.buf += k; return; }
    if (k === '.') { startBuf(); if (!st.buf.includes('.')) st.buf += '.'; return; }
    if ('NSEW'.includes(k) && k.length === 1) {
      const neg = k === 'S' || k === 'W';
      if (f.t === 'num') {
        if (st.buf === null || st.buf === '' || st.buf === '-') { st.buf = neg ? '-' : ''; return; }
        st.buf = (neg ? '-' : '') + st.buf.replace('-', '');
        commit();
        return;
      }
      // coord/dirnum: arah mengakhiri isian (mis. 6.235 lalu S)
      if (!f.d.includes(k)) { flash(`GUNAKAN ${f.d[0]}/${f.d[1]}`); return; }
      const base = st.buf === null ? Math.abs(obj[f.k]) : parseFloat(st.buf.replace('-', '')) || 0;
      st.buf = String((neg ? -1 : 1) * base);
      commit();
    }
  }

  /* =================== Layar: perilaku tombol FUNCT =================== */
  const SCREENS = {
    setup: {
      key(k) {
        const cols = 3, n = ICONS.length;
        if (k === 'left') st.sel = (st.sel + n - 1) % n;
        else if (k === 'right') st.sel = (st.sel + 1) % n;
        else if (k === 'up') st.sel = st.sel - cols >= 0 ? st.sel - cols : st.sel;
        else if (k === 'down') st.sel = Math.min(n - 1, st.sel + cols);
        else if (k === 'F5' || k === 'enter') go(ICONS[st.sel].k);
        else if (k === 'F1') readGps(() => go('gps'), null);
      }
    },
    survey: {
      cancel: 'setup',
      key(k) {
        if (k === 'F1') go('sysdes');
        else if (k === 'F2') readGps(fx => putGps(st.survey, fx), 'GPS POSITION READ');
        else if (k === 'F3') st.edit = true;
        else if (k === 'F4' || k === '0') { cancelChanges(); go('setup'); }
        else if (k === 'F5' || k === 'enter') go('setup');
      }
    },
    sysdes: {
      key(k) {
        if (k === 'F3') st.edit = true;
        else if (k === 'F5' || k === '0' || k === 'enter') { st.scr = 'survey'; st.edit = false; st.field = 0; }
      }
    },
    autograv: {
      cancel: 'setup',
      key(k) {
        if (k === 'F1') { st.scr = 'autograv2'; st.edit = false; st.field = 0; }
        else if (k === 'F3') st.edit = true;
        else if (k === 'F4' || k === '0') { cancelChanges(); go('setup'); }
        else if (k === 'F5') { go('setup'); flash('PARAMETERS RECORDED'); }
      }
    },
    autograv2: {
      key(k) {
        if (k === 'F3') st.edit = true;
        else if (k === 'F5' || k === '0') {
          const ch = ['gcal', 'txs', 'tys', 'txo', 'tyo', 'tempco', 'drift', 'gref'].filter(x => Math.abs(st.inst[x] - P0[x]) > 1e-9);
          if (ch.length) Field.logIssue(`Parameter alat diubah (${ch.join(', ')}). Manual: JANGAN mengubah parameter yang tertera di label alat.`);
          st.scr = 'autograv'; st.edit = false; st.field = 0;
        }
      }
    },
    options: {
      key(k) {
        if (k === 'F1') st.opt.finalKey = !st.opt.finalKey;
        else if (k === 'F3') st.edit = true;
        else if (k === 'F5' || k === '0') go('setup');
      }
    },
    clock: {
      key(k) {
        if (k === 'F1') readGps(() => { st.clockOff = -Sim.WIB; }, 'RTC SET TO GPS (UTC)');
        else if (k === 'F3') st.edit = true;
        else if (k === 'F5' || k === '0') go('setup');
      }
    },
    dump: {
      key(k) {
        if (k === 'F1' || k === 'F2') dumpTxt();
        else if (k === 'F4') dumpRaw();
        else if (k === 'F3') st.edit = true;
        else if (k === 'F5' || k === '0') go('setup');
      }
    },
    memory: {
      key(k) {
        if (k === 'F1') st.scr = 'confirm';
        else if (k === 'F5' || k === '0') go('setup');
      }
    },
    service: { key(k) { if (k === 'F5' || k === '0') go('setup'); } },
    display: {
      key(k) {
        if (k === 'F1') st.opt.heater = !st.opt.heater;
        else if (k === 'F2') st.contrast = 0.75; else if (k === 'F3') st.contrast = 1; else if (k === 'F4') st.contrast = 1.3;
        else if (k === 'up' || k === 'right' || k === 'N' || k === 'E') st.contrast = Math.min(1.6, st.contrast + 0.05);
        else if (k === 'down' || k === 'left' || k === 'S' || k === 'W') st.contrast = Math.max(0.5, st.contrast - 0.05);
        else if (k === 'F5' || k === '0') go('setup');
      }
    },
    note: {
      cancel: 'stn',
      key(k) {
        if (k === 'F3') { st.edit = true; st.field = 0; }
        else if (k === 'F4' || k === '0') { st.note = ''; go('stn'); }
        else if (k === 'F5' || k === 'enter') { const n = st.note; go('stn'); if (n) flash('NOTE SAVED'); }
      }
    },
    stn: {
      key(k) {
        if (k === 'F1') go('options');
        else if (k === 'F2') { st.stn.line += st.opt.lsep || 0; flash(`NEXT LINE ${st.stn.line}`); }
        else if (k === 'F3') st.edit = true;
        else if (k === 'F4' && st.survey.sys === 'LAT/LONG') readGps(fx => putGps(st.stn, fx), 'GPS POSITION READ');
        else if (k === 'F4') { st.stn.sta += st.opt.ssep || 0; flash(`NEXT STAT. ${st.stn.sta}`); }
        else if (k === 'F5') go(st.ag.terr ? 'tercor' : 'level');
        else if (k === '0') go('setup');
      }
    },
    gps: { key(k) { if (k === 'F5' || k === '0' || k === 'enter') go('setup'); } },
    tercor: { key(k) { if (k === 'F5') go('level'); else if (k === '0') go('stn'); } },
    level: { key(k) { if (k === 'F5') startReading(); else if (k === '0') go('stn'); } },
    finished: {
      key(k) {
        if (k === 'F5') { const r = st.result; go('final'); st.result = r; st.prevIdx = Math.max(0, st.mem.length - (r && r.recorded ? 2 : 1)); }
        else if (k === 'F3') st.gChan = (st.gChan + 1) % 3;
        else if (k === 'F4') st.gReview = true;
        else if (k === 'F1' || k === 'F2') scaleKey(k);
      }
    },
    final: {
      key(k) {
        if (k === 'up') st.prevIdx = Math.max(0, st.prevIdx - 1);
        else if (k === 'down') st.prevIdx = Math.min(Math.max(0, st.mem.length - 1), st.prevIdx + 1);
        else if (k === 'F5') record();
        else if (k === 'F4' && !(st.result && st.result.recorded)) { st.result = null; go('setup'); Field.toast('Data dibatalkan (CANCEL), tidak disimpan.', 'info'); }
      }
    },
    recall: {
      key(k) {
        const lines = [...new Set(st.mem.map(r => r.line))];
        if (st.recallLine === null && lines.length) st.recallLine = lines[0];
        if (k === 'F1') st.scr = 'recallParams';
        else if (k === 'F2' && lines.length) st.recallLine = lines[(lines.indexOf(st.recallLine) + 1) % lines.length];
        else if (k === 'F4') st.scr = 'recallPlot';
        else if (k === 'F5') { st.scr = 'recallList'; st.recallPos = 0; }
        else if (k === '0') go('setup');
      }
    },
    recallParams: { key(k) { if (k === 'F5' || k === '0') st.scr = 'recall'; } },
    recallPlot: { key(k) { if (k === 'F5' || k === '0') st.scr = 'recall'; } },
    recallList: {
      key(k) {
        const n = st.mem.filter(r => r.line === st.recallLine).length;
        if (k === 'F1' || k === 'down') st.recallPos = Math.min(Math.max(0, n - 1), st.recallPos + 1);
        else if (k === 'up') st.recallPos = Math.max(0, st.recallPos - 1);
        else if (k === 'F5' || k === '0') st.scr = 'recall';
      }
    }
  };
  function scaleKey(k) { st.gScale = Math.max(0.05, Math.min(20, st.gScale * (k === 'F1' ? 2 : 0.5))); }

  /* =================== Leveling =================== */
  function screw(id, d) {
    if (st.scr === 'measuring') { Field.logIssue('Sekrup kaki diputar saat alat sedang membaca.'); return; }
    const f = FEET[id], step = (fine ? STEP_FINE : STEP_COARSE) * d;
    st.tx += step * f.x;
    st.ty += step * f.y;
    draw(); Field.refresh(); Field.save();
  }

  /* =================== Getaran (laptop disentuh) =================== */
  let vibWarned = 0;
  function onVib(a, kind) {
    const R = Math.random, sgn = () => (R() < 0.5 ? -1 : 1);
    if (M && M.phase === 'read' && M.spec) {
      M.spec.dist.push({ t: M.sec + R() * 0.5, a: sgn() * a * (1.5 + R() * 1.5), dx: a > 0.3 ? sgn() * R() * 2 * a : 0, dy: a > 0.3 ? sgn() * R() * 2 * a : 0 });
      M.samples = genSamples(M.spec);
      M.disturbed = (M.disturbed || 0) + a;
      if (a >= 0.25 && Date.now() - vibWarned > 8000) {
        vibWarned = Date.now();
        Field.logIssue(`Alat terganggu getaran (${kind}) saat membaca di ${M.loc}. Menjauh dari alat selama pengukuran.`);
      }
    } else if (a >= 0.4 && st.scr !== 'off') {
      st.tx += sgn() * R() * 3 * a; st.ty += sgn() * R() * 3 * a;   // tripod tersenggol
      if (st.scr === 'level') draw();
    }
  }

  /* =================== Pengukuran =================== */
  function startReading() {
    const here = Field.station(), d = tiltDisp(TX(), TY());
    if (Math.abs(d.x) > 10 || Math.abs(d.y) > 10) Field.logIssue(`READ GRAV di ${here.id} sebelum level (X ${d.x.toFixed(0)}″, Y ${d.y.toFixed(0)}″).`);
    const useStn = st.survey.sys === 'LAT/LONG';
    const R = Math.random;
    const wind = { tenang: 0.004, angin: 0.03, jalan: 0.015 }[here.noise];
    M = {
      loc: here.id, cyc: st.opt.cyc, read: st.opt.read, delay: st.opt.delay,
      sec: 0, cycle: 0, phase: 'delay', partial: [], live: [],
      mk(cycle, t0) {
        return {
          loc: here.id, seed: Math.floor(R() * 4294967295), t0, n6: st.opt.read * 6,
          dist: [], tx: TX(), ty: TY(), dtx: (R() - 0.5) * 2 * wind, dty: (R() - 0.5) * 2 * wind,
          temp: st.truth.temp0 + (t0 - S().startUtc) / 3.6e6 * -0.03, sd: here.noiseSd, spikeP: Sim.NOISE[here.noise].spike,
          seis: st.ag.seis, rej: st.ag.rej, cont: st.ag.tilt, tide: st.ag.tide,
          tlat: useStn ? st.stn.lat : st.survey.lat, tlon: useStn ? st.stn.lon : st.survey.lon,
          tideUtcOff: (Sim.WIB + st.clockOff + st.survey.gmt) * 3600e3, hInst: Field.hInst(), raw: st.ag.raw, cycle
        };
      }
    };
    st.result = null;
    st.scr = 'measuring';
    st.gReview = false;
    Field.setBusy(true);
    Field.vibGrace(1200);                    // klik READ GRAV sendiri tidak dihitung getaran
    const total = M.delay + M.cyc * (M.read + 5);
    const secPerTick = Math.max(1, total / (Math.min(14, Math.max(4, total / 15)) * 20));
    let acc = 0;
    M.clock = S().now;                       // jam internal pembacaan (1 langkah = 1 detik)
    M.rt0 = Date.now(); M.done = 0;
    clearInterval(timer);
    timer = setInterval(() => {
      if (Field.realtime()) {                // waktu nyata: 1 detik pembacaan = 1 detik jam perangkat
        const target = Math.floor((Date.now() - M.rt0) / 1000);
        while (M && M.done < target) { M.done++; stepSecond(); }
      } else {
        acc += secPerTick;
        while (acc >= 1 && M) { acc -= 1; stepSecond(); }
      }
      draw();
    }, 50);
    draw();
  }
  function beginCycle() { M.phase = 'read'; M.sec = 0; M.spec = M.mk(M.cycle, M.clock); M.samples = genSamples(M.spec); M.live = []; }
  function stepSecond() {
    Field.advance(1);
    M.clock += 1000;
    if (M.phase === 'delay') { if (++M.sec >= M.delay) beginCycle(); return; }
    if (M.phase === 'gap') { if (++M.sec >= 5) beginCycle(); return; }
    const i0 = M.sec * 6;
    let a = 0; for (let j = 0; j < 6; j++) a += M.samples.g[i0 + j];
    M.live.push(a / 6);
    M.sec++;
    if (M.sec >= M.read) endCycle(M.read);
  }
  function endCycle(nSec) {
    const fin = finalize(M.spec, nSec);
    const rec = makeRec(M.spec, fin);
    rec.graph = Array.from(M.samples.g.slice(0, nSec * 6));
    M.partial.push(rec);
    if (M.cyc > 1) { pushMem(rec); rec.recorded = true; }
    M.cycle++;
    if (M.cycle >= M.cyc || nSec < M.read) finishReading(rec);
    else { M.phase = 'gap'; M.sec = 0; }
  }
  function stopReading() {
    if (!M) return;
    if (M.phase === 'read' && M.sec >= 2) endCycle(M.sec);
    else if (M.partial.length) finishReading(M.partial[M.partial.length - 1]);
    else { clearInterval(timer); M = null; Field.setBusy(false); go('level'); Field.toast('Pengukuran dihentikan sebelum ada data.', 'info'); }
  }
  function finishReading(rec) {
    clearInterval(timer);
    M = null;
    Field.setBusy(false);
    st.result = rec;
    st.scr = 'finished';
    if (!st.opt.finalKey) SCREENS.finished.key('F5');
    if (rec.issues.includes('koreksi tide salah') && !st.tideWarned) {
      st.tideWarned = true;
      Field.logIssue('Koreksi pasang surut alat tidak sesuai: periksa lintang, bujur, GMT DIFF, dan jam alat (UTC = jam alat + GMT DIFF).');
    }
    draw(); Field.refresh(); Field.save(true);
  }
  function makeRec(sp, fin) {
    const issues = [];
    if (sp.tide && Math.abs(fin.tide - fin.trueTide) > 0.008) issues.push('koreksi tide salah');
    if (Math.abs(fin.tx) > 10 || Math.abs(fin.ty) > 10) issues.push('belum level');
    if (fin.sd > 0.1) issues.push('SD besar');
    return {
      loc: sp.loc, sys: st.survey.sys, sta: st.stn.sta, line: st.stn.line, lat: st.stn.lat, lon: st.stn.lon, elev: st.stn.elev,
      grav: fin.grav, sd: fin.sd, err: fin.err, tx: fin.tx, ty: fin.ty, temp: fin.temp, tide: fin.tide, dur: fin.dur, rej: fin.rej, n: fin.n,
      tEnd: fin.tEnd, tMid: fin.tMid, devTime: dTime(fin.tEnd), devDate: dDate(fin.tEnd), dec: decTime(fin.tEnd),
      ideal: fin.ideal, issues, hInst: Field.hInstMeasured(), note: st.note,
      spec: sp.raw ? sp : null, cycle: sp.cycle
    };
  }
  function pushMem(rec) {
    const { graph, ...clean } = rec;
    st.mem.push(clean);
    Field.addRecord({ st: rec.loc, t: rec.tEnd, cg: clean, note: rec.note });
    if (rec.sd > 0.1) Field.logIssue(`Bacaan di ${rec.loc} disimpan dengan SD besar (${rec.sd.toFixed(3)} mGal).`, false);
  }
  function record() {
    const r = st.result;
    if (!r) { go('stn'); return; }
    if (!r.recorded) { pushMem(r); r.recorded = true; Field.toast(`RECORD tersimpan: ${r.loc}, GRAV ${r.grav.toFixed(3)} mGal.`, 'ok'); }
    st.note = '';
    st.result = null;
    if (st.opt.autoinc) { if (st.survey.sys === 'LAT/LONG') st.stn.line += st.opt.lsep || 1; else st.stn.sta += st.opt.ssep || 1; }
    go('stn');
  }

  /* =================== Render LCD =================== */
  const soft = labels => `<div class="sk">${labels.map(l => `<div>${l ? l.replace(/\n/g, '<br>') : ''}</div>`).join('')}</div>`;
  const fe = () => `<span class="${st.edit ? '' : 'inv'}">FUNCT</span><br><span class="${st.edit ? 'inv' : ''}">EDIT</span>`;
  const bat = () => '<span class="bat2">100%</span>';
  const status = txt => `<div class="sb"><span>${txt}</span>${bat()}</div>`;
  const title = (t, right = '') => `<div class="tt">${t}<span class="tr">${right}</span></div>`;
  const hm = () => { const p = dParts(S().now); return `${pad(p.h)}:${pad(p.mi)}`; };
  function rows(F, obj) {
    return '<table class="ft">' + F.map((f, i) => {
      const sel = st.edit && i === st.field;
      const v = sel && st.buf !== null ? st.buf + '▁' : fmtVal(f, obj);
      const gap = f.gap ? `<tr><td colspan="2" class="gap">${f.gap}</td></tr>` : '';
      return `${gap}<tr><td class="lb"><span class="${sel ? 'inv' : ''}">${f.l}:</span></td><td class="vl"><span class="box">${esc(v)}</span></td></tr>`;
    }).join('') + '</table>';
  }
  function graph(arr, scale, w = 100, h = 34) {
    if (!arr || arr.length < 2) return `<svg class="gr" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"></svg>`;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${Math.max(0, Math.min(h, h / 2 - (v - m) / scale * h / 2)).toFixed(1)}`).join(' ');
    return `<svg class="gr" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
  }
  function lcd() {
    const s = st.scr;
    if (s === 'off') return '<div class="lcd-off2"></div>';
    if (s === 'boot') return `<div class="boot2"><div class="b1">SCINTREX</div><div class="b2">CG-5 AUTOGRAV</div><div>Software Ver. ${SW}</div><div>Serial # ${SN}</div><div class="blink">Initializing...</div></div>`;
    let main = '', keys = ['', '', '', '', ''], sb = 'Sel:↑↓↵ Chg:Enter';
    const temp = `${(26 + Math.sin(S().now / 3.6e6) * 2).toFixed(0)} °C`;
    switch (s) {
      case 'setup':
        main = title('SETUP MENU', temp) + `<div class="icons">${ICONS.map((ic, i) => `<div class="ic ${i === 6 ? 'svc' : ''}"><div class="ig">${ic.i}</div><span class="${i === st.sel ? 'inv' : ''}">${ic.l}</span></div>`).join('')}</div>`;
        keys = ['CHECK\nGPS', '', '', '', 'OK']; sb = 'Sel:←↑↓→ GoTo:F5,↵'; break;
      case 'survey': {
        const f = curField();
        main = title('SURVEY HEADER', temp) + rows(F_SURVEY, st.survey);
        keys = st.edit ? [f && f.t === 'text' ? `CAPS\nLOCK\n${st.caps ? 'on' : 'off'}` : '', 'CLEAR\nALL', fe(), 'CANCEL', 'OK'] : ['PARAMS', 'READ\nGPS', fe(), 'CANCEL', 'OK'];
        sb = st.edit ? 'Sel:↑↓↵ Chg:Alpha,↔' : 'F3: FUNCT/EDIT'; break;
      }
      case 'sysdes':
        main = title('STATION DESIGNATION SYSTEM', temp) + `<div class="sysrow"><span class="${st.edit ? 'inv' : ''}">System:</span><span class="box">${st.survey.sys}</span></div>
          <table class="ex"><tr><th>SYSTEM</th><th>EXAMPLE ENTRY</th></tr>
          <tr><td>NSEWm</td><td>Line: 100N · Station: 20S</td></tr><tr><td>XYm</td><td>Line: 100 · Station: -20</td></tr>
          <tr><td>UTMm</td><td>Easting: 540800E</td></tr><tr><td>LAT/LONG</td><td>Longit.: 106.78E · Latit.: 6.23S</td></tr></table>`;
        keys = ['', '', fe(), '', 'OK']; sb = 'Sel:↑↓↵ Chg:↔'; break;
      case 'autograv':
        main = title('AUTOGRAV SETUP', temp) + rows(F_AG1, st.ag);
        keys = ['NEXT\nPAGE', '', fe(), 'CANCEL', 'RECORD']; sb = 'Sel:↑↓↵ Chg:↔'; break;
      case 'autograv2':
        main = title('AUTOGRAV SETUP', temp) + rows(F_AG2, st.inst) + `<div class="dst">Drift Start TM/DT: <span class="box">${dTime(st.inst.dStart)} ${dDate(st.inst.dStart)}</span></div>`;
        keys = ['', '', fe(), '', 'OK']; break;
      case 'options':
        main = title('DEFINE THE OPTIONS', temp) + rows(F_OPT, st.opt);
        keys = [`FINAL\nKEY\n<span class="${st.opt.finalKey ? 'inv' : ''}">on</span> <span class="${st.opt.finalKey ? '' : 'inv'}">off</span>`, '', fe(), '', 'OK']; break;
      case 'clock':
        main = title('REAL TIME CLOCK SETUP', temp) + `<div class="clk">◷</div>` + rows(F_CLOCK, clockObj());
        keys = ['SETRTC\nWITH\nGPS', '', fe(), '', 'OK']; break;
      case 'dump':
        main = title('DUMP PARAMETER SETUP', temp) + rows(F_DUMP, st.dump) + `<table class="ft ro"><tr><td>Data bits:</td><td>8</td></tr><tr><td>Parity check:</td><td>NO</td></tr><tr><td>Stop bits:</td><td>1</td></tr><tr><td>Data format:</td><td>ASCII</td></tr><tr><td>USB stick:</td><td>YES</td></tr></table>
          <div class="note2">${st.mem.length} records · Raw: ${st.mem.some(r => r.spec) ? 'YES' : 'NO'}</div>`;
        keys = ['START\nDUMP', 'DUMP\nDATA', fe(), 'DUMP\nRAW', 'OK']; sb = 'Chg:↔'; break;
      case 'memory': {
        const used = Math.min(100, st.mem.length * 0.08 + st.mem.filter(r => r.spec).length * 0.4);
        main = title('MEMORY', temp) + `<table class="ft ro"><tr><td>Records:</td><td>${st.mem.length}</td></tr><tr><td>Memory used:</td><td>${used.toFixed(1)}%</td></tr><tr><td>Memory free:</td><td>${(100 - used).toFixed(1)}%</td></tr></table>`;
        keys = ['CLEAR\nMEMORY', '', '', '', 'OK']; break;
      }
      case 'confirm':
        main = title('MEMORY') + `<div class="warn2">*** WARNING ! ! ! ***<br>Clear all data in memory?<br>Dump your data FIRST!<br><br>Press Y(9) or N(5)</div>`; break;
      case 'service':
        main = title('SERVICE', temp) + `<div class="note2">Service and support<br>Software Upgrade<br>User Calibration<br>Enable Factory Test<br><br>(tidak disimulasikan)</div>`;
        keys = ['', '', '', '', 'OK']; break;
      case 'display':
        main = title('DISPLAY', temp) + `<div class="note2">Contrast: ${'█'.repeat(Math.round(st.contrast * 8))}<br>Heater: ${st.opt.heater ? 'ON' : 'OFF'}<br><br>Arrows: adjust contrast</div>`;
        keys = [`HEATER\n${st.opt.heater ? 'OFF' : 'ON'}`, 'LOW', 'MED', 'HIGH', 'OK']; break;
      case 'note':
        main = title('NOTE', hm()) + rows(F_NOTE, st) + `<div class="note2">Catatan disimpan bersama record berikutnya.</div>`;
        keys = [st.edit ? `CAPS\nLOCK\n${st.caps ? 'on' : 'off'}` : '', st.edit ? 'CLEAR\nALL' : '', fe(), 'CANCEL', 'OK']; break;
      case 'gps': {
        const g = st.gpsLast;
        main = title('GPS STATUS', temp) + (g ? `<table class="ft ro">
          <tr><td>Status:</td><td>${g.src === 'hp' ? 'FIX (HP)' : '3D FIX'}</td></tr>
          ${g.sats ? `<tr><td>Satellites:</td><td>${g.sats}</td></tr>` : ''}
          <tr><td>Latitude:</td><td>${fmtCoord(g.lat, 'NS')}</td></tr><tr><td>Longitude:</td><td>${fmtCoord(g.lon, 'EW')}</td></tr>
          <tr><td>Altitude:</td><td>${g.alt === null ? 'N/A' : g.alt.toFixed(1) + ' m'}</td></tr>
          <tr><td>Accuracy:</td><td>±${g.acc.toFixed(1)} m${g.altAcc ? ` / ±${g.altAcc.toFixed(1)} m` : ''}</td></tr>
          <tr><td>UTC:</td><td>${new Date(g.utc).toISOString().slice(11, 19)}</td></tr></table>` : '<div class="note2">No GPS data</div>');
        keys = ['', '', '', '', 'OK']; break;
      }
      case 'stn':
        main = title('STATION DESIGNATION', hm()) + rows(fStn(), st.stn) + (st.note ? `<div class="note2">Note: ${esc(st.note)}</div>` : '');
        keys = ['OPTION', 'NEXT\nLINE', fe(), st.survey.sys === 'LAT/LONG' ? 'READ\nGPS' : 'NEXT\nSTAT.', st.ag.terr ? 'TERCOR' : 'LEVEL']; break;
      case 'tercor':
        main = title('NEAR TERRAIN CORRECTIONS', hm()) + `<div class="note2">Koreksi medan (Hammer) tidak disimulasikan.<br>Matikan "Terrain Corr." di AUTOGRAV bila tidak dipakai.</div>`;
        keys = ['', '', '', '', 'LEVEL']; break;
      case 'level': {
        const d = tiltDisp(TX(), TY()), R0 = 46, k = R0 / 150;
        const cx = Math.max(-49, Math.min(49, d.x * k)), cy = Math.max(-49, Math.min(49, -d.y * k));
        const ok = Math.abs(d.x) <= 10 && Math.abs(d.y) <= 10;
        const fA = Math.abs(d.y) <= 10 ? '' : d.y > 0 ? '↺' : '↻';
        const lA = Math.abs(d.x) <= 10 ? '' : d.x > 0 ? '↻' : '↺', rA = Math.abs(d.x) <= 10 ? '' : d.x > 0 ? '↺' : '↻';
        main = title('LEVELING') + `<div class="lv2">
          <svg viewBox="-60 -52 120 104">
            <circle r="${R0}" class="o"/>
            <line x1="${-R0}" x2="${R0}" y1="${cy}" y2="${cy}" class="h"/><line y1="${-R0}" y2="${R0}" x1="${cx}" x2="${cx}" class="h"/>
            <circle r="${Math.max(2.2, 10 * k)}" class="c"/>
            ${ok ? `<g transform="translate(${R0 * 0.3},${-R0 * 0.38})" class="smile"><circle r="5.2"/><circle cx="-1.8" cy="-1.3" r="0.8" class="e"/><circle cx="1.8" cy="-1.3" r="0.8" class="e"/><path d="M-2.8 1.2 Q0 4 2.8 1.2"/></g>` : ''}
            <g transform="translate(-53,-45)" class="fic"><circle r="4.6"/><text y="1.8" text-anchor="middle">F</text><text x="5.5" y="2.4" class="ar">${fA}</text></g>
            <g transform="translate(38,-45)" class="fic"><circle r="4.6"/><text y="1.8" text-anchor="middle">L</text><text x="5.2" y="2.4" class="ar">${lA}</text></g>
            <g transform="translate(51,-45)" class="fic"><circle r="4.6"/><text y="1.8" text-anchor="middle">R</text><text x="5.2" y="2.4" class="ar">${rA}</text></g>
          </svg></div>
          <div class="lvb"><span class="inv">X: ${pf(d.x.toFixed(0), 6)}</span>${bat()}<span class="inv">Y: ${pf(d.y.toFixed(0), 6)}</span></div>`;
        keys = ['', '', '', '', '⚖\nREAD\nGRAV.']; sb = null; break;
      }
      case 'measuring':
      case 'finished':
        ({ main, keys } = measScreen()); sb = null; break;
      case 'final': {
        const r = st.result, p = st.mem[st.prevIdx];
        const row = (id, a, b) => `<tr><td class="lb2">${id}</td><td>${a ?? ''}</td><td class="cur">${b ?? ''}</td></tr>`;
        const v = (x, f) => x ? f(x) : '';
        const fmtSta = x => x.sys === 'LAT/LONG' ? [fmtDirnum(x.line, 'NS'), `${Math.abs(x.lat).toFixed(4)}${x.lat < 0 ? 'S' : 'N'}`] : x.sys === 'NSEWm' ? [fmtDirnum(x.line, 'NS'), fmtDirnum(x.sta, 'EW')] : [String(x.line), String(x.sta)];
        const pc = x => `${x.rej} = ${(x.rej / x.n * 100).toFixed(1)}%`;
        main = title('AUTOGRAV FINAL DATA') + `<table class="fd"><tr><th>ID</th><th>Preceding</th><th>Current</th></tr>
          ${row('Grav.', v(p, x => x.grav.toFixed(3)), v(r, x => x.grav.toFixed(3)))}
          ${row('S.D.', v(p, x => x.sd.toFixed(3)), v(r, x => x.sd.toFixed(3)))}
          ${row('TiltX', v(p, x => x.tx.toFixed(3)), v(r, x => x.tx.toFixed(3)))}
          ${row('TiltY', v(p, x => x.ty.toFixed(3)), v(r, x => x.ty.toFixed(3)))}
          ${row('Temp.', v(p, x => x.temp.toFixed(2)), v(r, x => x.temp.toFixed(2)))}
          ${row('E.T.C.', v(p, x => x.tide.toFixed(3)), v(r, x => x.tide.toFixed(3)))}
          ${row('Dur.', v(p, x => x.dur), v(r, x => x.dur))}
          ${row('#Rej.', v(p, pc), v(r, pc))}
          ${row('Time', v(p, x => x.devTime), v(r, x => x.devTime))}
          ${row('Line', v(p, x => fmtSta(x)[0]), v(r, x => fmtSta(x)[0]))}
          ${row(r && r.sys === 'LAT/LONG' ? 'Lat.' : 'Stat.', v(p, x => fmtSta(x)[1]), v(r, x => fmtSta(x)[1]))}
          </table><div class="pr">Preceding Recall ↕ (${st.mem.length ? st.prevIdx + 1 : 0}/${st.mem.length})</div>`;
        keys = r && r.recorded ? ['', '', '', '', 'OK'] : ['', '', '', 'CANCEL', 'RECORD']; sb = null; break;
      }
      case 'recall': {
        const lines = [...new Set(st.mem.map(r => r.line))];
        if (st.recallLine === null && lines.length) st.recallLine = lines[0];
        main = title('RECALL', hm()) + `<div class="sysrow"><span class="inv">Survey:</span><span class="box">${esc(st.survey.id)}</span></div><div class="sysrow"><span>Line:</span><span class="box">${st.recallLine ?? 0}</span></div><div class="note2">${st.mem.length} records, ${lines.length} line</div>`;
        keys = ['SHOW\nSURVEY\nPARAMS', 'NEXT\nLINE', fe(), 'PLOT\nLINE\nDATA', 'RECALL\nLINE\nDATA']; sb = 'Sel:←↑↓→ GoTo:F5,↵'; break;
      }
      case 'recallParams': {
        const v = st.survey;
        main = title('SHOW SURVEY PARAMETERS') + `<table class="ft ro"><tr><td>SurveyID:</td><td>${esc(v.id)}</td></tr><tr><td>Customer:</td><td>${esc(v.cust)}</td></tr><tr><td>Operator:</td><td>${esc(v.oper)}</td></tr>
          <tr><td>Longitude:</td><td>${fmtCoord(v.lon, 'EW')}</td></tr><tr><td>Latitude:</td><td>${fmtCoord(v.lat, 'NS')}</td></tr><tr><td>Azimuth:</td><td>${v.azi}</td></tr><tr><td>Elevation:</td><td>${v.elev}</td></tr><tr><td>UTM Zone:</td><td>${v.zone}</td></tr><tr><td>GMT Diff.:</td><td>${v.gmt.toFixed(1)}</td></tr><tr><td>System:</td><td>${v.sys}</td></tr></table>`;
        keys = ['', '', '', '', 'OK']; break;
      }
      case 'recallList': {
        const list = st.mem.filter(r => r.line === st.recallLine);
        const from = Math.max(0, Math.min(st.recallPos - 3, list.length - 7));
        main = title(`LINE ${st.recallLine ?? 0} DATA`) + `<table class="fd"><tr><th>#</th><th>Stat.</th><th>Grav.</th><th>SD</th><th>Time</th></tr>${list.slice(from, from + 7).map((r, i) => `<tr class="${from + i === st.recallPos ? 'hl' : ''}"><td>${from + i + 1}</td><td>${r.sys === 'LAT/LONG' ? r.lat.toFixed(3) : r.sta}</td><td>${r.grav.toFixed(3)}</td><td>${r.sd.toFixed(3)}</td><td>${r.devTime}</td></tr>`).join('')}</table>`;
        keys = ['RECALL\nNEXT\nPOINT', '', '', '', 'OK']; break;
      }
      case 'recallPlot': {
        const list = st.mem.filter(r => r.line === st.recallLine).map(r => r.grav);
        main = title(`LINE ${st.recallLine ?? 0} PROFILE`) + (list.length > 1 ? graph(list, (Math.max(...list) - Math.min(...list)) / 1.8 || 1, 100, 60) : '<div class="note2">Data kurang.</div>') + `<div class="note2">${list.length} titik${list.length ? ` · min ${Math.min(...list).toFixed(3)} · max ${Math.max(...list).toFixed(3)}` : ''}</div>`;
        keys = ['', '', '', '', 'OK']; break;
      }
    }
    let ov = '';
    if (st.overlay === 'info') {
      const used = Math.min(100, st.mem.length * 0.08);
      ov = `<div class="ov"><div class="ovt">*** SYSTEM INFO ***</div><table class="ft ro">
        <tr><td>Software Ver.</td><td>${SW}</td></tr><tr><td>Serial #</td><td>${SN}</td></tr><tr><td>Memory Free</td><td>${(100 - used).toFixed(0)}%</td></tr>
        <tr><td>Battery Level</td><td>12.4V</td></tr><tr><td>Batt.1</td><td>Discharging</td></tr><tr><td>Batt.2</td><td>Standby</td></tr>
        <tr><td>Ambient Temperature</td><td>${(28 + Math.sin(S().now / 3.6e6) * 2).toFixed(1)}°C</td></tr><tr><td>Heater</td><td>${st.opt.heater ? 'ON' : 'OFF'}</td></tr>
        <tr><td>Drift Start Time</td><td>${dTime(st.inst.dStart)}</td></tr><tr><td>Date</td><td>${dDate(st.inst.dStart)}</td></tr></table><div class="ovt inv">Press 7 to close the window</div></div>`;
    } else if (st.overlay === 'help') {
      ov = `<div class="ov"><div class="ovt">*** HELP ***</div><div class="hlp">${HELP[st.scr] || HELP.setup}</div><div class="ovt inv">Press • to close</div></div>`;
    }
    const msg = st.msg ? `<div class="msg2">${esc(st.msg)}</div>` : '';
    return `<div class="lm">${main}${sb ? status(sb) : ''}${ov}${msg}</div>${soft(keys)}`;
  }
  function measScreen() {
    const m = M, r = st.result, numeric = st.opt.measure === 'NUMERIC';
    const live = m ? m.live : [];
    const n = live.length;
    const avg = n ? live.reduce((a, b) => a + b, 0) / n : 0;
    const sd = n > 1 ? Math.sqrt(live.reduce((a, v) => a + (v - avg) ** 2, 0) / (n - 1)) : 0;
    const d = tiltDisp(TX(), TY());
    const vals = r && !m ? { g: r.grav, err: r.err, sd: r.sd, tx: r.tx, ty: r.ty, tp: r.temp } : { g: avg, err: n ? sd / Math.sqrt(n) : 0, sd, tx: d.x, ty: d.y, tp: m && m.spec ? m.spec.temp : st.truth.temp0 };
    const statusTxt = m ? (m.phase === 'delay' ? `Delay... ${m.delay - m.sec}` : m.phase === 'gap' ? `Cycle ${m.cycle + 1}/${m.cyc}...` : `Measuring... ${m.sec}${m.cyc > 1 ? `  (${m.cycle + 1}/${m.cyc})` : ''}`) : `Finished  ${r ? r.dur : ''}sec`;
    const info = `<table class="mv">
      <tr><td>Err/SD:<small>(mGal)</small></td><td><span class="box">${vals.err.toFixed(3)}</span><span class="box">${vals.sd.toFixed(3)}</span></td></tr>
      <tr><td>Tilt X:<small>(arcsec)</small></td><td><span class="box">${vals.tx.toFixed(1)}</span></td></tr>
      <tr><td>Tilt Y:<small>(arcsec)</small></td><td><span class="box">${vals.ty.toFixed(1)}</span></td></tr>
      <tr><td>Temperature:<small>(mK)</small></td><td><span class="box">${vals.tp.toFixed(2)}</span></td></tr></table>`;
    let main, keys;
    if (numeric) {
      const prev = st.mem.slice(-5);
      main = `<table class="prev"><tr><th>n</th><th>Gravity</th><th>Time</th></tr>${[5, 4, 3, 2, 1].map(i => { const p = prev[prev.length - i]; return `<tr><td>-${i}</td><td>${p ? p.grav.toFixed(3) : ''}</td><td>${p ? p.devTime : ''}</td></tr>`; }).join('')}</table>
        <div class="big2">${vals.g ? vals.g.toFixed(3) : '----.---'} <small>mGal</small></div><div class="tm2">${dTime(S().now)}</div>${info}`;
      keys = m ? ['', '', '', '', 'STOP'] : ['', '', '', '', 'FINAL\nDATA'];
    } else {
      let arr = [];
      if (m && m.samples && m.phase === 'read') arr = Array.from([m.samples.g, m.samples.tx, m.samples.ty][st.gChan].slice(0, m.sec * 6));
      else if (r && r.graph && st.gChan === 0) arr = r.graph;
      main = `<div class="gh"><span>${dTime(S().now)}</span><span>FS: ±${st.gScale < 1 ? st.gScale.toFixed(2) : st.gScale.toFixed(1)}${st.gChan ? '(″)' : '(mGal)'}</span></div>${graph(arr, st.gScale)}
        <table class="mv"><tr><td>Gravity:<small>(mGal)</small></td><td><span class="box inv">${vals.g ? vals.g.toFixed(3) : ''}</span></td></tr></table>${info}`;
      keys = m ? ['SCALE ▲', 'SCALE ▼', '', '', 'STOP'] : ['SCALE ▲', 'SCALE ▼', ['<u>GRAV</u>\nTILTX\nTILTY', 'GRAV\n<u>TILTX</u>\nTILTY', 'GRAV\nTILTX\n<u>TILTY</u>'][st.gChan], 'REVIEW\nGRAPH', 'FINAL\nDATA'];
    }
    main += `<div class="sb ${m ? '' : 'fin'}"><span>${statusTxt}</span>${bat()}</div>`;
    return { main, keys };
  }

  const HELP = {
    setup: 'SETUP MENU: pilih ikon dengan panah, tekan F5 (OK) atau ENTER. MEASURE/CLR membuka STATION DESIGNATION. Di mode FUNCT: 4 = SETUP, 5 = RECALL, 6 = DISPLAY, 7 = INFO, 8 = NOTE, 0 = ESC, • = HELP.',
    survey: 'SURVEY HEADER: tekan F3 untuk mode EDIT. ↑↓ pindah isian. Angka diketik lalu ditutup dengan tombol arah, mis. 6.235 lalu S untuk lintang selatan. Teks: tekan tombol huruf berulang (2 → 2, d, e, f), ▶ untuk huruf berikutnya. F2 = CLEAR ALL, MEASURE/CLR = hapus satu karakter. GMT Diff = −7 untuk WIB (titik di timur Greenwich bernilai negatif). F1 PARAMS memilih sistem penamaan stasiun. F2 READ GPS mengisi Latitude, Longitude, dan Elevation dari GPS. F5 OK menyimpan.',
    sysdes: 'Pilih sistem penamaan stasiun dengan ←→ di mode EDIT (F3). LAT/LONG: titik dinamai dengan koordinat GPS, dan koordinat itu yang dipakai untuk koreksi pasang surut. NSEWm/XYm: Line dan Station berupa angka.',
    autograv: 'AUTOGRAV SETUP: F3 EDIT, ←→ mengubah YES/NO. Tide Correct. (Longman), Cont.Tilt.Corr, Auto Reject (>4σ, atau 6σ bila Seismic Filter), Save Raw Data menyimpan sampel 6 Hz. F1 NEXT PAGE = parameter alat (jangan diubah). F5 RECORD menyimpan.',
    autograv2: 'Parameter alat dari label kalibrasi pabrik. Manual: JANGAN diubah. Bila TiltX/Y.Sens = 0, leveling tidak berfungsi.',
    options: 'Read Time (detik, 1–256) dan #Of Cycles (pengulangan otomatis; setiap siklus langsung tersimpan). Auto station inc. menaikkan nomor stasiun setelah RECORD. Measurement: NUMERIC atau GRAPHIC. F1 FINAL KEY on/off.',
    clock: 'Jam alat. F3 EDIT untuk mengubah manual (angka, • sebagai pemisah). F1 SETRTC WITH GPS mengatur jam ke UTC dari GPS, jadi GMT Diff di Survey harus 0. Bila jam diatur ke WIB, GMT Diff −7.',
    gps: 'GPS STATUS: posisi dari GPS alat (simulasi) atau GPS HP, sesuai pilihan saat mulai. Elevasi GPS kurang teliti (±5 m atau lebih); untuk reduksi Bouguer pakai elevasi hasil pengukuran topografi bila ada.',
    dump: 'F1 START DUMP / F2 DUMP DATA: unduh data final (.TXT, format sama dengan alat). F4 DUMP RAW: unduh sampel 6 Hz (.SMP), hanya untuk bacaan yang diambil dengan Save Raw Data = YES.',
    memory: 'F1 CLEAR MEMORY menghapus semua data (DUMP dulu!). Konfirmasi dengan 9 (Y) atau 5 (N).',
    stn: 'STATION DESIGNATION: F3 EDIT, isi Longit./Latit. (sistem LAT/LONG) atau Station/Line, lalu Elevation dan Line ID. Setiap pergantian Line ID membuat blok "Line" baru di file dump. F2 NEXT LINE dan F4 NEXT STAT. menambah sesuai separation di OPTIONS; pada sistem LAT/LONG, F4 READ GPS mengisi Longit., Latit., dan Elevation dari GPS. F5 LEVEL (atau MEASURE).',
    level: 'LEVELING: putar sekrup kaki F (sumbu Y) lalu L dan R (sumbu X) mengikuti arah ikon di pojok layar sampai garis silang masuk lingkaran kecil (±10″) dan muncul ikon senyum. Ideal X dan Y antara −2 dan 2. Lalu F5 READ GRAV.',
    measuring: 'Sedang membaca. Menjauh dari alat dan jangan menimbulkan getaran. F5 STOP menghentikan pembacaan.',
    finished: 'Pembacaan selesai. Mode GRAPHIC: F3 memilih grafik, F4 REVIEW GRAPH. F5 FINAL DATA untuk melihat hasil.',
    final: 'AUTOGRAV FINAL DATA: Current = hasil sekarang, Preceding = data sebelumnya (↑↓ menggulir). Periksa S.D. lalu F5 RECORD untuk menyimpan, atau F4 CANCEL.',
    recall: 'RECALL: F1 lihat parameter survei, F2 ganti line, F4 plot profil line, F5 daftar data line.',
    note: 'NOTE: tekan F3 lalu ketik catatan, F5 OK. Catatan ikut record berikutnya.',
    display: 'Atur kontras dengan panah atau F2–F4. F1 pemanas layar.'
  };

  function draw() {
    if (!root) return;
    const l = root.querySelector('#lcd');
    l.innerHTML = lcd();
    l.classList.toggle('on', st.power);
    l.style.filter = st.power ? `contrast(${st.contrast})` : '';
    root.querySelector('#cgHelp').innerHTML = `<b>Bantuan layar:</b> ${HELP[st.scr] || (st.scr === 'off' ? 'Alat mati. Tekan <b>ON/OFF</b>. Oven dan sensor tetap menyala selama baterai terpasang.' : '')}`;
    root.querySelectorAll('[data-s]').forEach(b => { b.disabled = st.scr === 'measuring'; });
  }

  /* =================== DUMP =================== */
  const lj = (v, w) => String(v).padEnd(w);
  function header() {
    const s = S(), v = st.survey, p0 = dParts(s.startUtc), i = st.inst;
    return ['',
      `/\tCG-5 SOFTWARE VER.:  ${SW}`, '/\tCG-5 SURVEY', `/\tSurvey name:   \t${v.id}`, `/\tInstrument S/N:\t${SN}`,
      `/\tClient:        \t${v.cust}`, `/\tOperator:      \t${v.oper}`, `/\tDate:          \t${p0.y}/${String(p0.mo).padStart(2)}/${String(p0.d).padStart(2)}`,
      `/\tTime:          \t${dTime(s.startUtc)}`, `/\tLONG:        \t${Math.abs(v.lon).toFixed(7)} ${v.lon < 0 ? 'W' : 'E'}`,
      `/\tLAT:         \t${Math.abs(v.lat).toFixed(7)} ${v.lat < 0 ? 'S' : 'N'}`, `/\tZONE:        \t${lj(v.zone, 8)}`, `/\tGMT DIFF.:   \t${v.gmt.toFixed(1)} `, '',
      '/\tCG-5 SETUP PARAMETERS', `/\tGref:\t\t${lj(i.gref.toFixed(3), 8)}`, `/\tGcal1:\t\t${lj(i.gcal.toFixed(3), 8)}`, `/\tTiltxS:\t\t${lj(i.txs.toFixed(3), 8)}`,
      `/\tTiltyS:\t\t${lj(i.tys.toFixed(3), 8)}`, `/\tTiltxO:\t\t${lj(i.txo.toFixed(3), 8)}`, `/\tTiltyO:\t\t${lj(i.tyo.toFixed(3), 8)}`,
      `/\tTempco:\t\t${lj(i.tempco.toFixed(3), 8)}`, `/\tDrift:\t\t${lj(i.drift.toFixed(3), 8)}`, `/\tDriftTime Start:\t${dTime(i.dStart)}`, `/\tDriftDate Start:\t${dDate(i.dStart)}`, '',
      '/\tCG-5 OPTIONS', `/\tTide Correction:    ${st.ag.tide ? 'YES' : ' NO'}`, `/\tCont. Tilt:         ${st.ag.tilt ? 'YES' : ' NO'}`,
      `/\tAuto Rejection:     ${st.ag.rej ? 'YES' : ' NO'}`, `/\tTerrain Corr.:      ${st.ag.terr ? 'YES' : ' NO'}`, `/\tSeismic Filter:     ${st.ag.seis ? 'YES' : ' NO'}`,
      `/\tRaw Data:           ${st.ag.raw ? 'YES' : ' NO'}`];
  }
  function dataRow(r) {
    const mid = ' ' + pf(r.elev, 9, 4) + ' ' + pf(r.grav, 10, 3) + ' ' + pf(r.sd, 5, 3) + ' ' + pf(r.tx, 6, 1) + ' ' + pf(r.ty, 6, 1);
    const tail = ' ' + pf(r.temp, 5, 2) + ' ' + pf(r.tide, 5, 3) + ' ' + pf(r.dur, 3) + ' ' + pf(r.rej, 3) + ' ' + r.devTime + ' ' + pf(r.dec, 15, 5) + ' ' + pf(0, 9, 4) + '  ' + r.devDate;
    if (r.sys === 'LAT/LONG') return pf(r.lat, 10, 7) + ' ' + pf(r.lon, 12, 7) + mid + tail;
    const sta = r.sys === 'NSEWm' ? pf(Math.abs(r.sta), 10, 3) + (r.sta < 0 ? 'W' : 'E') : pf(r.sta, 10, 3) + ' ';
    return sta + pf('', 12) + mid + tail;
  }
  function lineLabel(r) {
    // lebar 8 seperti alat: "Line\t   1.000N", "Line\t9039.000S"
    if (r.sys === 'XYm') return `Line\t${pf(r.line, 8, 3)}`;
    return `Line\t${pf(Math.abs(r.line), 8, 3)}${r.line < 0 ? 'S' : 'N'}`;
  }
  function dumpText() {
    const L = header();
    let cur = null;
    for (const r of st.mem) {
      const lab = lineLabel(r) + '|' + r.sys;
      if (lab !== cur) {
        cur = lab;
        L.push(lineLabel(r));
        L.push(r.sys === 'LAT/LONG'
          ? '/-------LAT--------LONG-----ALT.------GRAV.---SD.--TILTX--TILTY-TEMP---TIDE---DUR-REJ-----TIME----DEC.TIME+DATE--TERRAIN---DATE'
          : '/----STATION---------------ALT.------GRAV.---SD.--TILTX--TILTY-TEMP---TIDE---DUR-REJ-----TIME----DEC.TIME+DATE--TERRAIN---DATE');
      }
      L.push(dataRow(r));
    }
    return L.join('\r\n');
  }
  const fileStamp = () => { const p = dParts(S().now); return `${pad(p.h)}${pad(p.mi)}${pad(p.mo)}${pad(p.d)}${String(p.y).slice(2)}`; };
  const fileId = () => (st.survey.id || 'SURVEY').replace(/[^\w-]+/g, '') || 'SURVEY';
  function dumpTxt() {
    if (!st.mem.length) { flash('NO DATA IN MEMORY'); Field.toast('Memori kosong.', 'err'); return; }
    st.dumped = true;
    Sim.downloadText(`CG-5_${fileId()}_${fileStamp()}.TXT`, dumpText());
    flash('DUMP COMPLETE');
    Field.toast(`DUMP DATA: ${st.mem.length} record diunduh (.TXT).`, 'ok');
    Field.refresh(); Field.save(true);
  }
  // sampel mentah 6 Hz dalam satuan A/D seperti file *.smp (rumus konversi manual hal. 3-49/3-50)
  function rawRows(r) {
    const smp = genSamples(r.spec), out = [];
    for (let i = 0; i < r.dur * 6; i++) {
      const gs = Math.round(smp.g[i] * FULL / P0.gcal);
      const xs = Math.round((smp.tx[i] / P0.txs + 2.5) / 0.000076295 + P0.txo);
      const ys = Math.round((-smp.ty[i] / P0.tys + 2.5) / 0.000076295 + P0.tyo);
      const ts = Math.round((smp.tp[i] + TBIAS + TOFF) / TEMP_SF);
      out.push({ i, t: r.spec.t0 + i * 1000 / 6, gs, xs, ys, ts, g: P0.gcal * gs / FULL, x: ((xs - P0.txo) * 0.000076295 - 2.5) * P0.txs, y: -((ys - P0.tyo) * 0.000076295 - 2.5) * P0.tys, tp: ts * TEMP_SF - TBIAS - TOFF });
    }
    return out;
  }
  function dumpRaw() {
    const recs = st.mem.filter(r => r.spec);
    if (!recs.length) { flash('NO RAW DATA'); Field.toast('Tidak ada data raw. Atur Save Raw Data = YES di AUTOGRAV sebelum mengukur.', 'err', 6000); return; }
    const L = ['/\tCG-5 RAW SAMPLES (6 Hz)  -  Simulator Praktikum Gayaberat', `/\tSurvey name:   \t${st.survey.id}`, `/\tInstrument S/N:\t${SN}`,
      `/\tGcal1: ${P0.gcal}  TiltxS: ${P0.txs}  TiltyS: ${P0.tys}  TiltxO: ${P0.txo}  TiltyO: ${P0.tyo}  TBIAS: ${TBIAS}  TOFFSET: ${TOFF}`,
      '/\tGravity = Gcal1*grav_sample/536870912',
      '/\tTiltX = ((tiltx_sample-TiltxO)*0.000076295-2.5)*TiltxS',
      '/\tTiltY = -((tilty_sample-TiltyO)*0.000076295-2.5)*TiltyS',
      '/\tTemp  = temp_sample*1000/536870912 - TBIAS - TOFFSET', ''];
    recs.forEach((r, k) => {
      L.push(`/ RECORD ${k + 1}  ${r.sys === 'LAT/LONG' ? `LAT ${r.lat.toFixed(7)} LONG ${r.lon.toFixed(7)}` : `LINE ${r.line} STATION ${r.sta}`}  START ${dTime(r.spec.t0)} ${dDate(r.spec.t0)}  SAMPLES ${r.dur * 6}`);
      L.push('/  GRAV_SAMPLE  TILTX_SAMPLE  TILTY_SAMPLE   TEMP_SAMPLE');
      rawRows(r).forEach(x => L.push(pf(x.gs, 13) + pf(x.xs, 14) + pf(x.ys, 14) + pf(x.ts, 14)));
    });
    st.rawDumped = true;
    Sim.downloadText(`CG-5_${fileId()}_${fileStamp()}.SMP`, L.join('\r\n'));
    flash('RAW DUMP COMPLETE');
    Field.toast(`DUMP RAW: ${recs.length} record × 6 Hz diunduh (.SMP).`, 'ok');
    Field.refresh(); Field.save(true);
  }

  /* =================== Panduan (SOP lab + manual) =================== */
  function guide() {
    const here = Field.station(), v = st.survey, sp = st.ag, o = st.opt;
    const tideOk = Math.abs(devUtc(S().now) - S().now) < 120000;
    const latOk = Math.abs(v.lat - here.lat) < 0.05 && Math.abs(v.lon - here.lon) < 0.05;
    const doneHere = st.mem.some(m => m.loc === here.id && m.tEnd >= st.arrivedAt);
    const d = tiltDisp(TX(), TY());
    const allDone = sc().stations.every(s => measured(s.id));
    const bsT = st.mem.filter(m => m.loc === 'BS').map(m => m.tEnd);
    const loop = allDone && st.mem.length >= 3 && st.mem[st.mem.length - 1].loc === 'BS' && bsT.length >= 2 && bsT[bsT.length - 1] - bsT[0] > 30 * 60e3;
    const inMeas = ['level', 'measuring', 'finished', 'final'].includes(st.scr);
    return [
      { t: 'Tekan <b>ON/OFF</b>; layar SETUP MENU muncul.', ok: st.power },
      { t: `Pilih <b>Survey</b> → F5. Tekan <b>F3</b> (EDIT), isi SurveyID (F2 = CLEAR ALL), Customer, Operator, Latitude, Longitude, dan <b>GMT Diff −${Sim.WIB}</b> (${Sim.tzLabel()}). F5 OK.`, ok: latOk && tideOk && v.id !== 'Default', tip: `Lintang: ketik ${Math.abs(here.lat).toFixed(5)} lalu tekan S. Bujur: ketik lalu tekan E. GMT Diff: ketik ${Sim.WIB} lalu S (minus). F1 PARAMS untuk memilih sistem stasiun (LAT/LONG bila memakai koordinat GPS).` },
      { t: 'Pilih <b>Autograv</b>: Tide Correct., Cont.Tilt.Corr, Auto Reject = YES (Save Raw Data = YES bila perlu data mentah). F5 RECORD.', ok: sp.tide && sp.tilt && sp.rej },
      { t: 'Pilih <b>Options</b>: Read Time (mis. 60) dan #Of Cycles (mis. 3). F5 OK.', ok: o.read >= 30 && (o.cyc > 1 || st.mem.length > 0 || inMeas) },
      { t: `Ukur <b>tinggi alat</b> (panel stasiun), lalu tekan <b>MEASURE/CLR</b>: isi Longit., Latit., Elevation, dan <b>Line ID</b> untuk ${here.id}.`, ok: doneHere || inMeas, tip: 'F3 untuk EDIT. Nilai berarah diketik lalu ditutup tombol N/S/E/W. Beri Line ID berbeda untuk tiap stasiun (mis. BS = 9000, S01 = 1, S02 = 2); setiap pergantian Line ID menjadi blok "Line" baru di file dump, sama seperti alat.' },
      { t: 'Tekan <b>F5 LEVEL</b>. Putar sekrup F lalu L/R sampai <b>ikon senyum</b> muncul (ideal X, Y antara −2 dan 2).', ok: doneHere || ['measuring', 'finished', 'final'].includes(st.scr) || (st.scr === 'level' && Math.abs(d.x) <= 10 && Math.abs(d.y) <= 10) },
      { t: 'Tekan <b>F5 READ GRAV</b>. Menjauh dari alat sampai pembacaan selesai.', ok: doneHere || st.scr === 'finished' || st.scr === 'final' },
      { t: '<b>F5 FINAL DATA</b>, periksa S.D., lalu <b>F5 RECORD</b>.', ok: doneHere },
      { t: 'Pindah ke stasiun berikutnya (klik peta) dan ulangi pengukuran.', ok: allDone },
      { t: 'Tutup loop: kembali ke <b>BS</b> dan ukur lagi untuk koreksi apungan.', ok: loop },
      { t: 'SETUP → <b>Dump</b>: F2 DUMP DATA (.TXT) dan F4 DUMP RAW (.SMP).', ok: st.dumped }
    ];
  }
  function measured(id) { return ((S().inst && S().inst.mem) || []).some(m => m.loc === id); }

  /* =================== Kunci =================== */
  function keyInfo() {
    return `<dt>Offset alat</dt><dd>${st.truth.C.toFixed(3)} mGal</dd><dt>Sisa apungan</dt><dd>${st.truth.resid.toFixed(3)} mGal/hari (setelah koreksi Drift alat)</dd>`;
  }
  function keyRows() { return [['Offset alat (mGal)', Sim.round(st.truth.C, 3)], ['Sisa apungan (mGal/hari)', Sim.round(st.truth.resid, 3)]]; }
  function keyRecords() {
    const recs = S().records.filter(r => r.cg);
    if (!recs.length) return '<p class="muted">Belum ada bacaan.</p>';
    return `<div class="table-wrap short"><table class="book"><thead><tr><th>No</th><th>Lokasi</th><th>Jam alat</th><th>GRAV</th><th>Ideal</th><th>Selisih</th><th>Catatan</th></tr></thead><tbody>${recs.map((r, i) => {
      const c = r.cg, d = c.grav - c.ideal;
      return `<tr><td>${i + 1}</td><td>${c.loc}</td><td>${c.devTime}</td><td class="num">${c.grav.toFixed(3)}</td><td class="num">${c.ideal.toFixed(3)}</td><td class="num ${Math.abs(d) > 0.03 ? 'bad' : ''}">${d.toFixed(3)}</td><td>${c.issues.join(', ') || '—'}</td></tr>`;
    }).join('')}</tbody></table></div><p class="muted small">Ideal = bacaan tanpa noise, alat level, koreksi pasang surut benar (bila Tide Correct. = YES). Sisa apungan tetap ada.</p>`;
  }

  /* =================== Ekspor Excel =================== */
  const desig = r => r.sys === 'LAT/LONG' ? `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}` : r.sys === 'NSEWm' ? `L ${fmtDirnum(r.line, 'NS')} S ${fmtDirnum(r.sta, 'EW')}` : `L ${r.line} S ${r.sta}`;
  function rawSheet() {
    const recs = st.mem.filter(r => r.spec);
    if (!recs.length) return [];
    const rows = [['Record', 'Stasiun', 'Sampel', 'Waktu alat', 'GRAV_SAMPLE', 'TILTX_SAMPLE', 'TILTY_SAMPLE', 'TEMP_SAMPLE', 'Gravity (mGal)', 'Tilt X (arcsec)', 'Tilt Y (arcsec)', 'Temp (mK)']];
    recs.forEach((r, k) => rawRows(r).forEach(x => rows.push([k + 1, r.loc, x.i + 1, dTime(x.t) + '.' + String(Math.floor((x.i % 6) * 1000 / 6)).padStart(3, '0'), x.gs, x.xs, x.ys, x.ts, Sim.round(x.g, 4), Sim.round(x.x, 2), Sim.round(x.y, 2), Sim.round(x.tp, 3)])));
    return [{ name: 'Raw 6 Hz', rows, boldRows: [0], widths: [8, 9, 8, 14, 13, 13, 13, 13, 14, 13, 13, 11] }];
  }

  Field.init({
    name: 'Scintrex CG-5 Autograv',
    storeKey: 'simgrav-cg5-v2',
    filePrefix: 'CG5',
    gps: true,
    emptyHint: 'Ukur lalu RECORD; data masuk otomatis dari memori alat.',
    newState, mount, guide, measured,
    refresh: draw,
    tick() {
      if (!st || st.scr === 'measuring') return;
      st.tx += (Math.random() - 0.5) * 0.3; st.ty += (Math.random() - 0.5) * 0.3;
      if (['level', 'setup', 'stn', 'clock'].includes(st.scr)) draw();
    },
    beforeLeave() {
      if (st.scr === 'measuring') return { block: 'Sedang mengukur. Tekan F5 STOP atau tunggu selesai.' };
      if (st.result && !st.result.recorded) return { warn: 'Hasil ukur terakhir belum di-RECORD dan akan hilang.' };
      return null;
    },
    beforeWait() { return st.scr === 'measuring' ? 'Sedang mengukur.' : null; },
    onLeave() {
      st.result = null;
      if (['level', 'finished', 'final', 'tercor'].includes(st.scr)) go('stn');
    },
    onArrive() {
      const R = Math.random;
      st.arrivedAt = S().now;
      st.tx = (R() < 0.5 ? -1 : 1) * (120 + R() * 360);
      st.ty = (R() < 0.5 ? -1 : 1) * (120 + R() * 360);
      draw();
    },
    bookColumns: [
      { h: 'ID alat', v: r => esc(desig(r.cg)) },
      { h: 'GRAV (mGal)', v: r => r.cg.grav.toFixed(3) },
      { h: 'SD', v: r => `<span class="${r.cg.sd > 0.1 ? 'bad' : ''}">${r.cg.sd.toFixed(3)}</span>` },
      { h: 'Tilt X/Y', v: r => `${r.cg.tx.toFixed(1)} / ${r.cg.ty.toFixed(1)}` },
      { h: 'TIDE', v: r => r.cg.tide.toFixed(3) },
      { h: 'Dur', v: r => r.cg.dur },
      { h: 'Rej', v: r => r.cg.rej },
      { h: 'Jam alat', v: r => r.cg.devTime }
    ],
    exportCols: [
      { h: 'Sistem', v: r => r.cg.sys }, { h: 'Line', v: r => r.cg.line }, { h: 'Station / Lat (alat)', v: r => r.cg.sys === 'LAT/LONG' ? Sim.round(r.cg.lat, 7) : r.cg.sta },
      { h: 'Long (alat)', v: r => r.cg.sys === 'LAT/LONG' ? Sim.round(r.cg.lon, 7) : '' }, { h: 'Alt (alat)', v: r => r.cg.elev },
      { h: 'Grav (mGal)', v: r => Sim.round(r.cg.grav, 3) }, { h: 'SD (mGal)', v: r => Sim.round(r.cg.sd, 3) },
      { h: 'Tilt X (arcsec)', v: r => Sim.round(r.cg.tx, 1) }, { h: 'Tilt Y (arcsec)', v: r => Sim.round(r.cg.ty, 1) },
      { h: 'Temp (mK)', v: r => Sim.round(r.cg.temp, 2) }, { h: 'Tide (mGal)', v: r => Sim.round(r.cg.tide, 3) },
      { h: 'Dur (s)', v: r => r.cg.dur }, { h: 'Rej', v: r => r.cg.rej }, { h: 'Time (alat)', v: r => r.cg.devTime },
      { h: 'Dec.Time+Date', v: r => Sim.round(r.cg.dec, 5) }, { h: 'Date (alat)', v: r => r.cg.devDate }
    ],
    infoRows: () => [['Nomor seri alat', SN], ['Kolom Grav', 'Sudah termasuk koreksi alat (drift, tilt, suhu) dan koreksi tide bila Tide Correct. = YES'], ['Data mentah', 'Sheet "Raw 6 Hz" berisi sampel 6 Hz bila Save Raw Data = YES']],
    extraExports: [{ label: 'DUMP .TXT', fn: dumpTxt }, { label: 'RAW 6 Hz .SMP', fn: dumpRaw }],
    extraSheets: rawSheet,
    ignoreKey: e => !!st && st.power && !(e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) && /^(Arrow\w+|Enter|Escape|Backspace|F[1-5]|[0-9.]|[nsewNSEW-])$/.test(e.key),
    keyInfo, keyRows, keyRecords
  });
})();
