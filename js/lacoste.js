/* =====================================================================
   Simulator gravimeter LaCoste & Romberg Model G
   Mengikuti "Instruction Manual Model G & D Gravity Meters" (L&R, 3-2001)
   dan USGS Techniques & Methods 2-D4 (prosedur lapangan):
   pelat dasar → lampu → level silang lalu level panjang → buka kunci
   (arrestment berlawanan jarum jam) → putar nulling dial searah jarum jam
   sampai sisi kiri benang (crosshair) di garis baca → baca counter + dial →
   kunci (searah jarum jam ±3 putaran) → konversi dengan tabel kalibrasi.
   ===================================================================== */
'use strict';

(() => {
  const SN = 'G-1036';                     // nomor seri fiktif (contoh)
  const READ_LINE = 2.3;                   // garis baca pada plakat (contoh di manual: 2.3)
  const STOP_LO = 1.6, STOP_HI = 3.0;      // batas gerak benang: 14 garis skala kecil
  const PLAY = 0.04;                       // kelonggaran roda gigi (satuan counter)
  const OPER_TEMP = 50.4;                  // suhu operasi alat (°C), tertulis di tabel kalibrasi
  const STEP_COARSE = 12, STEP_FINE = 3;   // detik busur per klik kenop kaki
  // efek memutar kenop searah jarum jam (kaki naik) terhadap level silang (C) dan level panjang (L)
  const KNOBS = {
    cross: { dC: 1, dL: -0.5, nama: 'Pengatur level silang', pos: 'kiri depan' },
    long: { dC: 0, dL: 1, nama: 'Pengatur level panjang', pos: 'kanan' },
    ref: { dC: -1, dL: -0.5, nama: 'Kaki referensi', pos: 'kiri belakang' }
  };

  /* ---------------- Tabel kalibrasi (contoh, format seperti manual hal. 1-9) ---------------- */
  const CAL = (() => {
    const rows = [];
    let val = 0;
    for (let k = 0; k <= 70; k++) {
      const f = Math.round((1.00760 + 0.00012 * Math.sin(k / 9 + 0.5) + 0.00004 * Math.sin(k / 2.7)) * 100000) / 100000;
      rows.push({ c: k * 100, v: Math.round(val * 100) / 100, f });
      val += f * 100;
    }
    return rows;
  })();
  function toMgal(c) {
    const k = Math.max(0, Math.min(69, Math.floor(c / 100)));
    return CAL[k].v + (c - CAL[k].c) * CAL[k].f;
  }
  function toCounter(g) {
    let k = 0;
    while (k < 69 && CAL[k + 1].v <= g) k++;
    return CAL[k].c + (g - CAL[k].v) / CAL[k].f;
  }

  let st = null, root = null, fine = false, raf = 0, dragging = null;
  let beam = { p: STOP_LO, last: 0, ph: Math.random() * 6.28, per: 6 };
  const S = () => Field.S, sc = () => Field.sc;

  /* ---------------- Model ---------------- */
  function meterMgal(t, s, withTilt = true) {
    const base = sc().stations[0], hrs = (t - S().startUtc) / 3.6e6;
    let g = st.C + (s.gAbs - base.gAbs) - Sim.FAG * Field.hInst() + Sim.tideEffect(t, s.lat, s.lon, s.elev)
      + st.drift * hrs + st.drift2 * hrs * hrs + st.tare;
    if (withTilt) g -= 978000 * ((TL() ** 2 + TC() ** 2) * Sim.ARCSEC ** 2) / 2;
    return g;
  }
  const nullCounter = (withTilt = true) => toCounter(meterMgal(S().now, Field.station(), withTilt));
  // kemiringan nyata = posisi kenop kaki + kemiringan perangkat (sensor gerak, bila aktif)
  const TL = () => st.tL + Field.gyroTilt().y, TC = () => st.tC + Field.gyroTilt().x;
  const level = () => Math.abs(TL()) <= 10 && Math.abs(TC()) <= 10;
  const sens = () => Math.max(0.45, Math.min(1.8, 1 - TL() / 220));   // sisi kanan naik → kurang peka
  const rubbing = () => Math.abs(TC()) > 250 || Math.abs(TL()) > 250;
  const crossPos = () => READ_LINE + sens() * (st.mech - nullCounter()) * 1.0; // 1 putaran (≈1 mGal) ≈ 10 garis kecil

  function newState(scn) {
    const R = Sim.rng(Sim.hashStr('lcr|' + scn.code));
    const base = scn.stations[0];
    const C = toMgal(1430) + (base.gAbs - 978046) + R.range(-15, 15);   // tabel manual: lintang 0° ≈ 1430
    const n0 = toCounter(C);
    const dial = Math.round((n0 + (R() < 0.5 ? -1 : 1) * R.range(2, 6)) * 100) / 100;
    return {
      v: 2, C,
      drift: R.range(0.02, 0.06) * (R() < 0.8 ? 1 : -1),
      drift2: R.range(-0.003, 0.003),
      tare: 0, tares: [],
      dial, mech: dial - PLAY, lastDir: 1,
      clamped: true, clampAnim: 0, light: false,
      tL: (R() < 0.5 ? -1 : 1) * R.range(80, 220), tC: (R() < 0.5 ? -1 : 1) * R.range(80, 220),
      knobRot: { cross: 0, long: 0, ref: 0 },
      arrivedAt: 0, exported: false, refWarned: false
    };
  }

  /* ---------------- Tampilan ---------------- */
  function dialSvg() {
    const t = [];
    for (let i = 0; i < 100; i++) {
      const a = i * 3.6 * Sim.DEG, big = i % 10 === 0, mid = i % 5 === 0;
      const r1 = 60, r2 = big ? 49 : mid ? 53 : 56;
      t.push(`<line x1="${(r1 * Math.sin(a)).toFixed(2)}" y1="${(-r1 * Math.cos(a)).toFixed(2)}" x2="${(r2 * Math.sin(a)).toFixed(2)}" y2="${(-r2 * Math.cos(a)).toFixed(2)}" class="${big ? 'tk big' : 'tk'}"/>`);
      if (big) t.push(`<text x="${(41 * Math.sin(a)).toFixed(2)}" y="${(-41 * Math.cos(a) + 4).toFixed(2)}" text-anchor="middle" class="tn">${i / 10}</text>`);
    }
    return t.join('');
  }
  function knobSvg(id, x, y, label) {
    const teeth = Array.from({ length: 18 }, (_, i) => { const a = i * 20 * Sim.DEG; return `<line x1="${(15 * Math.sin(a)).toFixed(1)}" y1="${(-15 * Math.cos(a)).toFixed(1)}" x2="${(19 * Math.sin(a)).toFixed(1)}" y2="${(-19 * Math.cos(a)).toFixed(1)}"/>`; }).join('');
    return `<g transform="translate(${x},${y})" class="lk"><g id="kn-${id}" class="lk-rot"><circle r="19" class="lk-o"/>${teeth}<circle r="11" class="lk-i"/><line y1="-11" y2="-4" class="lk-m"/></g><text y="32" text-anchor="middle" class="lid-t">${label}</text></g>`;
  }
  function mount(el) {
    if (!S().inst || S().inst.v !== 2) S().inst = newState(sc());
    st = S().inst;
    root = el;
    const scale = [];
    for (let v = 10; v <= 36; v++) {
      const x = (v / 10 - 2.3) * 70, big = v % 10 === 0, half = v % 5 === 0;
      scale.push(`<line x1="${x}" x2="${x}" y1="${big ? -13 : half ? -9 : -5}" y2="0" class="sc"/>`);
      if (big || half) scale.push(`<text x="${x}" y="-16" text-anchor="middle" class="sn ${big ? '' : 'h'}">${big ? v / 10 : ''}</text>`);
    }
    el.innerHTML = `
      <div class="lcr-wrap2">
        <div class="lcr-stage">
          <svg viewBox="0 0 600 400" class="lid" id="lid" aria-label="Tutup atas gravimeter LaCoste & Romberg G">
            <rect x="4" y="4" width="592" height="392" rx="22" class="case"/>
            <rect x="22" y="22" width="556" height="356" rx="12" class="lidb"/>
            <text x="300" y="46" text-anchor="middle" class="lid-brand">LaCOSTE &amp; ROMBERG · MODEL G · ${SN}</text>
            ${knobSvg('ref', 70, 78, 'KAKI REF.')}
            ${knobSvg('cross', 70, 318, 'CROSS LEVEL ADJ.')}
            ${knobSvg('long', 528, 200, 'LONG LEVEL ADJ.')}
            <g transform="translate(190,70)">
              <rect x="0" y="0" width="200" height="22" rx="11" class="vial2"/><g class="vial-marks">${[-3, -2, -1, 1, 2, 3].map(i => `<line x1="${100 + i * 12 + (i > 0 ? 6 : -6)}" x2="${100 + i * 12 + (i > 0 ? 6 : -6)}" y1="4" y2="18"/>`).join('')}</g>
              <ellipse id="bubL" cx="100" cy="11" rx="15" ry="7" class="bub2"/>
              <text x="100" y="-6" text-anchor="middle" class="lid-t">LONG LEVEL</text>
            </g>
            <g transform="translate(440,96)">
              <rect x="0" y="0" width="22" height="200" rx="11" class="vial2"/><g class="vial-marks">${[-3, -2, -1, 1, 2, 3].map(i => `<line y1="${100 + i * 12 + (i > 0 ? 6 : -6)}" y2="${100 + i * 12 + (i > 0 ? 6 : -6)}" x1="4" x2="18"/>`).join('')}</g>
              <ellipse id="bubC" cx="11" cy="100" rx="7" ry="15" class="bub2"/>
              <text x="11" y="216" text-anchor="middle" class="lid-t">CROSS LEVEL</text>
            </g>
            <g transform="translate(118,128)" class="placard">
              <rect width="120" height="46" rx="3"/><text x="60" y="15" text-anchor="middle">READING LINE</text><text x="60" y="36" text-anchor="middle" class="big">${READ_LINE.toFixed(1)}</text>
            </g>
            <g transform="translate(258,212)" id="dialG" class="ndial" tabindex="0" role="slider" aria-label="Nulling dial">
              <polygon points="0,-74 -7,-84 7,-84" class="idx"/>
              <g id="dialRot"><circle r="66" class="nd-o"/><circle r="62" class="nd-f"/>${dialSvg()}<circle r="20" class="nd-h"/><circle r="6" cy="-30" class="nd-g"/></g>
              <text y="96" text-anchor="middle" class="lid-t">NULLING DIAL</text>
            </g>
            <g transform="translate(340,196)">
              <rect width="88" height="34" rx="4" class="cnt-w"/>
              <g id="counter2"></g>
              <text x="44" y="50" text-anchor="middle" class="lid-t">COUNTER</text>
            </g>
            <g transform="translate(296,326)">
              <circle r="22" class="eye-o"/><circle r="14" class="eye-i"/><text y="37" text-anchor="middle" class="lid-t">EYEPIECE</text>
            </g>
            <g transform="translate(370,338)" id="arrest" class="arrest" role="button" tabindex="0" aria-label="Arrestment knob">
              <g id="arrRot"><circle r="15" class="ar-o"/>${Array.from({ length: 12 }, (_, i) => { const a = i * 30 * Sim.DEG; return `<line x1="${(10 * Math.sin(a)).toFixed(1)}" y1="${(-10 * Math.cos(a)).toFixed(1)}" x2="${(15 * Math.sin(a)).toFixed(1)}" y2="${(-15 * Math.cos(a)).toFixed(1)}" class="ar-t"/>`; }).join('')}<line y1="-9" y2="0" class="ar-m"/></g>
              <text y="30" text-anchor="middle" class="lid-t">ARRESTMENT</text>
            </g>
            <g transform="translate(486,332)" id="lightSw" class="lsw" role="button" tabindex="0" aria-label="Reading and level light switch">
              <rect x="-16" y="-12" width="32" height="24" rx="5" class="lsw-b"/><rect id="lswT" x="-12" y="-9" width="11" height="18" rx="3" class="lsw-t"/>
              <text y="27" text-anchor="middle" class="lid-t">LIGHT</text>
            </g>
            <g transform="translate(470,48)" class="therm">
              <rect x="-2" y="-12" width="66" height="22" rx="3" class="th-b"/><text id="thermT" x="31" y="4" text-anchor="middle" class="th-t">50.40</text>
              <circle id="heatL" cx="80" cy="-1" r="5" class="heat"/><text x="31" y="24" text-anchor="middle" class="lid-t">THERMOMETER °C</text>
            </g>
          </svg>
          <div class="eyebox">
            <div class="cap2">Pandangan melalui okuler</div>
            <svg viewBox="-100 -100 200 200" class="eyeview" id="eyev">
              <defs><clipPath id="evc"><circle r="90"/></clipPath><radialGradient id="evg" r="0.7"><stop offset="0" stop-color="#fffdf0"/><stop offset="1" stop-color="#e6dcb5"/></radialGradient></defs>
              <circle r="96" class="ev-rim"/>
              <g clip-path="url(#evc)">
                <rect x="-100" y="-100" width="200" height="200" fill="url(#evg)"/>
                <g transform="translate(0,28)">${scale.join('')}</g>
                <line id="rlMark" x1="0" x2="0" y1="-70" y2="64" class="rl2"/>
                <g id="wire"><rect x="0" y="-92" width="2.2" height="184" class="wire"/></g>
                <rect x="-100" y="-100" width="200" height="200" class="ev-dark" id="evDark"/>
                <text y="4" text-anchor="middle" class="ev-msg" id="evMsg"></text>
              </g>
            </svg>
            <div class="small muted ev-note">Baca dari <b>sisi kiri</b> benang. Dial searah jarum jam → benang ke kanan.</div>
          </div>
        </div>
        <div class="lcr-ctrl">
          <div class="ctrl-g">
            <div class="cap2">Nulling dial (1 putaran = 1 satuan counter)</div>
            <div class="dial-btns2">
              ${[-1, -0.1, -0.01].map(v => `<button class="btn sm" data-d="${v}">⟲ ${Math.abs(v)}</button>`).join('')}
              <span class="sep"></span>
              ${[0.01, 0.1, 1].map(v => `<button class="btn sm" data-d="${v}">⟳ ${v}</button>`).join('')}
              <button class="btn sm ghost" data-d="-5" title="Putar cepat 5 putaran berlawanan jarum jam">⟲⟲ 5</button><button class="btn sm ghost" data-d="5" title="Putar cepat 5 putaran searah jarum jam">⟳⟳ 5</button>
            </div>
            <div class="small muted">Atau seret melingkar / roda tetikus di atas dial (Shift = kasar).</div>
          </div>
          <div class="ctrl-g">
            <div class="cap2">Kenop kaki (leveling) <label class="fine"><input type="checkbox" id="fineChk"> halus</label></div>
            <div class="knob-btns">${Object.entries(KNOBS).map(([k, o]) => `<div><span>${o.nama} <small>(${o.pos})</small></span><button class="btn sm" data-k="${k}" data-dir="-1" title="Berlawanan jarum jam (kaki turun)">⟲</button><button class="btn sm" data-k="${k}" data-dir="1" title="Searah jarum jam (kaki naik)">⟳</button></div>`).join('')}</div>
          </div>
          <div class="ctrl-g row2">
            <button class="btn" id="btnArr"></button>
            <button class="btn" id="btnLight2"></button>
            <button class="btn ghost" id="btnCal">Tabel kalibrasi ${SN}</button>
          </div>
        </div>
        <div class="help" id="lcrHelp"></div>
      </div>`;

    el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => turn(+b.dataset.d));
    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => knob(b.dataset.k, +b.dataset.dir));
    el.querySelector('#fineChk').onchange = e => { fine = e.target.checked; };
    const arr = () => toggleClamp(), lt = () => toggleLight();
    el.querySelector('#btnArr').onclick = arr;
    el.querySelector('#arrest').addEventListener('click', arr);
    el.querySelector('#btnLight2').onclick = lt;
    el.querySelector('#lightSw').addEventListener('click', lt);
    ['#arrest', '#lightSw'].forEach(s => el.querySelector(s).addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.querySelector(s).dispatchEvent(new Event('click')); } }));
    el.querySelector('#btnCal').onclick = showCal;

    // nulling dial: roda tetikus dan seret melingkar
    const dg = el.querySelector('#dialG'), svg = el.querySelector('#lid');
    const center = () => { const r = svg.getBoundingClientRect(), k = r.width / 600; return { x: r.left + 258 * k, y: r.top + 212 * k }; };
    const ang = e => { const c = center(); return Math.atan2(e.clientY - c.y, e.clientX - c.x); };
    dg.addEventListener('wheel', e => { e.preventDefault(); turn((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01)); }, { passive: false });
    dg.addEventListener('pointerdown', e => { dragging = { a: ang(e) }; dg.setPointerCapture(e.pointerId); });
    dg.addEventListener('pointermove', e => {
      if (!dragging) return;
      const a = ang(e);
      let d = a - dragging.a;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      dragging.a = a;
      const dv = d / (2 * Math.PI);
      if (Math.abs(dv) > 0.0004) turn(dv, true);
    });
    ['pointerup', 'pointercancel'].forEach(t => dg.addEventListener(t, () => { dragging = null; }));
    dg.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); turn(e.shiftKey ? 0.1 : 0.01); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); turn(e.shiftKey ? -0.1 : -0.01); }
    });

    Field.onVibration((a, kind) => {
      const sgn = Math.random() < 0.5 ? -1 : 1;
      if (!st.clamped && !st.clampAnim) beam.p += sgn * a * (0.25 + Math.random() * 0.35);   // benang tersentak
      if (a >= 0.4) { st.tL += sgn * Math.random() * 2.5 * a; st.tC += (Math.random() - 0.5) * 5 * a; }  // alat tersenggol
    });

    cancelAnimationFrame(raf);
    beam.p = st.clamped ? STOP_LO : Math.max(STOP_LO, Math.min(STOP_HI, crossPos()));
    beam.last = performance.now();
    raf = requestAnimationFrame(loop);
    draw();
  }

  /* ---------------- Aksi ---------------- */
  function turn(dv, raw) {
    const v = Math.max(0, Math.min(7000, st.dial + dv));
    st.dial = raw ? v : Math.round(v * 1000) / 1000;
    st.mech = Math.max(st.dial - PLAY, Math.min(st.dial, st.mech));   // kelonggaran roda gigi
    st.lastDir = dv > 0 ? 1 : -1;
    drawDial();
    Field.refresh();
    Field.save();
  }
  function knob(id, d) {
    const k = KNOBS[id], step = (fine ? STEP_FINE : STEP_COARSE) * d;
    st.tC += step * k.dC;
    st.tL += step * k.dL;
    st.knobRot[id] = (st.knobRot[id] + d * (fine ? 15 : 60)) % 360;
    if (id === 'ref' && !st.refWarned && S().mode === 'latihan') { st.refWarned = true; Field.toast('Kaki referensi sebaiknya tidak diputar; gunakan pengatur level silang dan panjang.', 'info', 6000); }
    draw();
    Field.refresh();
    Field.save();
  }
  function toggleClamp() {
    if (st.clampAnim) return;
    const unclamping = st.clamped;
    st.clampAnim = 1;
    const t0 = performance.now(), dur = 1400, turns = 3;
    const step = now => {
      if (!st.clampAnim) return;
      const f = Math.min(1, (now - t0) / dur);
      const r = root && root.querySelector('#arrRot');
      if (r) r.setAttribute('transform', `rotate(${((unclamping ? -1 : 1) * f * turns * 360).toFixed(1)})`);
      if (f < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(() => {                       // status diselesaikan dengan timer (tidak bergantung pada animasi)
      st.clampAnim = 0;
      st.clamped = !unclamping;
      Field.advance(6);
      if (!st.clamped && !level() && S().mode === 'latihan') Field.toast('Beam dibuka sebelum kedua level di tengah. Level dulu, baru buka kunci.', 'info');
      draw(); Field.refresh(); Field.save(true);
    }, dur);
  }
  function toggleLight() { st.light = !st.light; draw(); Field.refresh(); Field.save(); }

  /* ---------------- Animasi benang & termostat ---------------- */
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!root || !st) return;
    const dt = Math.min(0.1, (now - beam.last) / 1000);
    beam.last = now;
    const here = Field.station();
    let target = STOP_LO, amp = 0;
    if (!st.clamped && !st.clampAnim && !rubbing()) {
      target = crossPos();
      amp = Math.max(0.01, (here.noiseSd - 0.025) * 3) * sens();
    }
    const tc = Math.max(STOP_LO, Math.min(STOP_HI, target));
    const tau = st.clamped ? 0.4 : 1.8 * sens();
    beam.p += (tc - beam.p) * (1 - Math.exp(-dt / tau));
    beam.ph += dt * 2 * Math.PI / beam.per;
    if (beam.ph > 6.283) { beam.ph -= 6.283; beam.per = 5 + Math.random() * 3; }
    let show = beam.p + amp * Math.sin(beam.ph) + (amp ? (Math.random() - 0.5) * amp * 0.12 : 0);
    show = Math.max(STOP_LO, Math.min(STOP_HI, show));
    const w = root.querySelector('#wire');
    if (w) w.setAttribute('transform', `translate(${((show - 2.3) * 70).toFixed(2)},0)`);
    const gy = Field.gyroTilt();
    if (gy.x || gy.y) {                       // sensor gerak aktif: gelembung mengikuti kemiringan perangkat
      const bub = t => Math.max(-1, Math.min(1, t / 110)) * 84;
      root.querySelector('#bubL').setAttribute('cx', (100 + bub(TL())).toFixed(1));
      root.querySelector('#bubC').setAttribute('cy', (100 + bub(TC())).toFixed(1));
    }
    const hl = root.querySelector('#heatL');
    if (hl) hl.classList.toggle('on', (now / 1000) % 7 < 2.6);
  }

  /* ---------------- Gambar ---------------- */
  function drawDial() {
    if (!root) return;
    const tenths = Math.floor(st.dial * 10 + 1e-9);
    const digits = String(tenths % 100000).padStart(5, '0').split('');
    root.querySelector('#counter2').innerHTML = digits.map((d, i) => `<rect x="${5 + i * 16}" y="5" width="14" height="24" rx="2" class="${i === 4 ? 'cd t' : 'cd'}"/><text x="${12 + i * 16}" y="23" text-anchor="middle" class="${i === 4 ? 'cdt t' : 'cdt'}">${d}</text>`).join('');
    const frac = st.dial - Math.floor(st.dial);
    root.querySelector('#dialRot').setAttribute('transform', `rotate(${(-frac * 360).toFixed(2)})`);
    drawHelp();
  }
  function draw() {
    if (!root) return;
    const bub = (t) => Math.max(-1, Math.min(1, t / 110)) * 84;
    root.querySelector('#bubL').setAttribute('cx', (100 + bub(TL())).toFixed(1));
    root.querySelector('#bubC').setAttribute('cy', (100 + bub(TC())).toFixed(1));
    Object.keys(KNOBS).forEach(k => root.querySelector('#kn-' + k).setAttribute('transform', `rotate(${st.knobRot[k]})`));
    root.querySelector('#lid').classList.toggle('lit', st.light);
    root.querySelector('#lswT').setAttribute('x', st.light ? 1 : -12);
    root.querySelector('#evDark').style.opacity = st.light ? 0 : 0.94;
    root.querySelector('#evMsg').textContent = st.light ? '' : 'gelap — nyalakan lampu baca';
    root.querySelector('#rlMark').style.display = S().mode === 'latihan' ? '' : 'none';
    root.querySelector('#rlMark').setAttribute('x1', 0); root.querySelector('#rlMark').setAttribute('x2', 0);
    if (!st.clampAnim) root.querySelector('#arrRot').setAttribute('transform', `rotate(${st.clamped ? 0 : -60})`);
    root.querySelector('#btnArr').textContent = st.clamped ? 'Buka kunci beam (putar arrestment ⟲)' : 'Kunci beam (putar arrestment ⟳)';
    root.querySelector('#btnArr').classList.toggle('primary', !st.clamped);
    root.querySelector('#btnLight2').textContent = st.light ? 'Matikan lampu' : 'Nyalakan lampu baca & level';
    root.querySelector('#thermT').textContent = (OPER_TEMP + Math.sin(S().now / 9e5) * 0.02).toFixed(2);
    drawDial();
  }
  function drawHelp() {
    const el = root && root.querySelector('#lcrHelp');
    if (!el) return;
    let hint = '';
    if (S().mode === 'latihan') {
      const lvlC = Math.abs(TC()) <= 10, lvlL = Math.abs(TL()) <= 10;
      if (!st.light) hint = 'Nyalakan lampu baca &amp; level (sakelar LIGHT).';
      else if (!lvlC) hint = 'Pusatkan <b>level silang</b> dulu dengan kenop CROSS LEVEL ADJ. (ia juga menggeser level panjang).';
      else if (!lvlL) hint = 'Sekarang pusatkan <b>level panjang</b> dengan kenop LONG LEVEL ADJ.';
      else if (st.clamped) hint = 'Kedua level sudah di tengah. Buka kunci beam: putar ARRESTMENT berlawanan jarum jam sampai mentok.';
      else {
        const off = crossPos() - READ_LINE;
        if (rubbing()) hint = 'Beam menggesek (alat terlalu miring). Level ulang.';
        else if (off < -0.7) hint = 'Benang mentok di kiri: putar dial <b>searah jarum jam</b> (⟳ 1 / ⟳⟳ 5).';
        else if (off > 0.7) hint = 'Benang mentok di kanan: putar dial <b>berlawanan jarum jam</b> jauh melewati garis, lalu dekati lagi dari kiri.';
        else if (off < -0.006) hint = `Benang di kiri garis baca (${(READ_LINE + off).toFixed(2)}): lanjutkan putar searah jarum jam sedikit demi sedikit, tunggu benang diam.`;
        else if (off > 0.006) hint = `Benang melewati garis baca (${(READ_LINE + off).toFixed(2)}): putar balik ±¼ putaran berlawanan jarum jam, lalu dekati lagi searah jarum jam.`;
        else if (st.lastDir < 0) hint = 'Benang di garis baca, tetapi putaran terakhir berlawanan jarum jam (backlash). Putar balik ±¼ putaran lalu dekati searah jarum jam.';
        else hint = 'Sisi kiri benang tepat di garis baca. Baca counter + dial, cek level, tulis di buku lapangan, lalu kunci beam.';
      }
    }
    el.innerHTML = `<b>Cara membaca:</b> 4 digit pertama counter = satuan; digit ke-5 (merah) = persepuluhan dan sama dengan angka dial di bawah segitiga; garis kecil dial = perseratusan. Contoh counter <b>1523</b><span class="t5">4</span> dan dial lewat 4 garis 7 → <b>1523.47</b>.` +
      (hint ? `<div class="hint">${hint}</div>` : '');
  }

  /* ---------------- Tabel kalibrasi ---------------- */
  function calTableHtml(highlight) {
    const k = highlight != null ? Math.floor(highlight / 100) : -1;
    return `<table class="book cal"><thead><tr><th>Counter Reading</th><th>Value in Milligals</th><th>Factor for Interval</th></tr></thead><tbody>${CAL.map((r, i) =>
      `<tr class="${i === k ? 'hl' : ''}"><td class="num">${String(r.c).padStart(4, '0')}</td><td class="num">${r.v.toFixed(2)}</td><td class="num">${r.f.toFixed(5)}</td></tr>`).join('')}</tbody></table>`;
  }
  function showCal() {
    const ex = 1523.47, k = 15;
    Field.modal(`<h3>Tabel kalibrasi ${SN} (contoh)</h3>
      <p class="muted">Seperti contoh di manual: pecah bacaan menjadi baris tabel + sisa, lalu<br>
      mGal = <i>Value in Milligals</i> baris itu + (bacaan − baris) × <i>Factor for Interval</i>.<br>
      Contoh ${ex.toFixed(2)}: ${CAL[k].v.toFixed(2)} + ${(ex - 1500).toFixed(2)} × ${CAL[k].f.toFixed(5)} = <b>${toMgal(ex).toFixed(2)} mGal</b>. Suhu operasi alat: ${OPER_TEMP} °C.</p>
      <div class="table-wrap short" id="calWrap">${calTableHtml(st.dial)}</div>`);
    const hl = document.querySelector('#calWrap tr.hl');
    if (hl) hl.scrollIntoView({ block: 'center' });
  }

  /* ---------------- Buku lapangan (tulis manual) ---------------- */
  function renderBookForm(el) {
    el.innerHTML = `
      <form class="book-form" id="lcrForm" autocomplete="off">
        <label>Stasiun<input name="st" required maxlength="10"></label>
        <label>Waktu (${Sim.tzLabel()})<span class="row"><input name="t" placeholder="hh:mm:ss" maxlength="8" required><button type="button" class="icon-btn" id="tNow" title="Isi jam sekarang">⟳</button></span></label>
        <label>Bacaan counter<input name="c" inputmode="decimal" placeholder="mis. 1523.47" required></label>
        <label class="grow">Catatan<input name="note" maxlength="60"></label>
        <button class="btn primary">Catat</button>
      </form>`;
    const f = el.querySelector('#lcrForm');
    const fill = () => { f.st.value = S().at; f.t.value = Sim.fmtTime(S().now); };
    fill();
    el.querySelector('#tNow').onclick = () => { f.t.value = Sim.fmtTime(S().now); };
    f.c.addEventListener('focus', () => { if (!f.t.dataset.touched) f.t.value = Sim.fmtTime(S().now); });
    f.t.addEventListener('input', () => { f.t.dataset.touched = 1; });
    f.onsubmit = e => {
      e.preventDefault();
      const typed = parseFloat(String(f.c.value).replace(',', '.'));
      if (!isFinite(typed) || typed < 0 || typed > 7000) { Field.toast('Bacaan counter tidak valid (0–7000).', 'err'); return; }
      const tm = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/.exec(f.t.value.trim());
      if (!tm) { Field.toast('Format waktu hh:mm atau hh:mm:ss.', 'err'); return; }
      const p = Sim.wibParts(S().now);
      const tTyped = Date.UTC(p.y, p.mo - 1, p.d, +tm[1] - Sim.WIB, +tm[2], +(tm[3] || 0));
      recordReading(f.st.value.trim().toUpperCase(), tTyped, typed, f.note.value.trim());
      f.c.value = ''; f.note.value = ''; delete f.t.dataset.touched;
      fill();
    };
  }
  function recordReading(stTyped, tTyped, typed, note) {
    const here = Field.station();
    const nt = nullCounter(), ntIdeal = nullCounter(false) + PLAY;   // pendekatan searah jarum jam
    const issues = [];
    if (st.clamped) issues.push('beam masih terkunci');
    if (!level()) issues.push('alat belum level');
    if (rubbing()) issues.push('beam menggesek (terlalu miring)');
    if (!st.clamped && Math.abs(crossPos() - READ_LINE) > 0.02) issues.push('benang belum di garis baca');
    if (st.lastDir < 0) issues.push('pendekatan berlawanan jarum jam (backlash)');
    if (Math.abs(typed - st.dial) > 0.006) issues.push(`salah baca/tulis (counter ${st.dial.toFixed(2)})`);
    if (Math.abs(tTyped - S().now) > 120000) issues.push('waktu tercatat berbeda > 2 menit');
    if (stTyped !== here.id) issues.push(`nama stasiun ${stTyped} ≠ lokasi ${here.id}`);
    Field.addRecord({ st: stTyped, locId: here.id, t: tTyped, note, lc: { typed, dial: st.dial, nt, ntIdeal, tReal: S().now, issues } });
    issues.forEach(m => Field.logIssue(`Bacaan ${here.id}: ${m}.`, false));
    if (S().mode === 'latihan') {
      if (issues.length) Field.toast('Periksa bacaan: ' + issues.join('; ') + '.', 'err', 7000);
      else Field.toast(`Tercatat ${here.id}: ${typed.toFixed(2)} (≈ ${toMgal(typed).toFixed(2)} mGal). Kunci beam sebelum pindah.`, 'ok');
    } else Field.toast(`Tercatat ${stTyped}: ${typed.toFixed(2)}.`, 'ok');
  }

  /* ---------------- Panduan ---------------- */
  function measured(id) { return S().records.some(r => r.locId === id); }
  function guide() {
    const here = Field.station();
    const doneHere = S().records.some(r => r.locId === here.id && r.lc && r.lc.tReal >= st.arrivedAt);
    const allDone = sc().stations.every(s => measured(s.id));
    const recs = S().records;
    const bsT = recs.filter(r => r.locId === 'BS').map(r => r.lc.tReal);
    const loop = allDone && recs.length >= 3 && recs[recs.length - 1].locId === 'BS' && bsT.length >= 2 && bsT[bsT.length - 1] - bsT[0] > 30 * 60e3;
    const nulled = !st.clamped && Math.abs(crossPos() - READ_LINE) <= 0.01 && st.lastDir > 0;
    return [
      { t: 'Letakkan alat di pelat dasar dan nyalakan <b>lampu baca &amp; level</b> (sakelar LIGHT).', ok: doneHere || st.light },
      { t: 'Pusatkan <b>level silang</b> dengan CROSS LEVEL ADJ., lalu <b>level panjang</b> dengan LONG LEVEL ADJ. Jangan memutar kaki referensi.', ok: doneHere || level(), tip: 'Pengatur level silang ikut menggeser level panjang, jadi selesaikan level silang lebih dulu. Pakai mode "halus" di akhir.' },
      { t: 'Ukur <b>tinggi alat</b> dengan meteran (panel stasiun).', ok: doneHere || S().hMeasured !== null },
      { t: 'Buka kunci beam: putar <b>ARRESTMENT</b> berlawanan jarum jam sampai mentok.', ok: doneHere || !st.clamped },
      { t: `Lihat okuler. Putar nulling dial <b>searah jarum jam</b> sampai sisi kiri benang tepat di <b>garis baca ${READ_LINE}</b>.`, ok: doneHere || nulled, tip: 'Selalu dekati garis baca dari kiri. Bila terlewat, putar balik ±¼ putaran lalu dekati lagi. Benang lambat bergerak: putar sedikit lalu tunggu.' },
      { t: 'Baca counter + dial, cek level lagi, lalu tulis di <b>buku lapangan</b> bersama jam baca.', ok: doneHere },
      { t: '<b>Kunci beam</b>: putar ARRESTMENT searah jarum jam ±3 putaran sampai mentok.', ok: doneHere && st.clamped, tip: 'Memindah alat dengan beam terbuka menyebabkan tare (loncatan bacaan) dan apungan besar.' },
      { t: 'Pindah ke stasiun berikutnya (klik peta) dan ulangi.', ok: allDone },
      { t: 'Tutup loop: kembali ke <b>BS</b> dan baca lagi untuk koreksi apungan.', ok: loop },
      { t: 'Ubah bacaan ke mGal dengan tabel kalibrasi, lalu unduh Excel buku lapangan.', ok: st.exported }
    ];
  }

  /* ---------------- Kunci ---------------- */
  function keyInfo() {
    return `<dt>Alat</dt><dd>${SN}, garis baca ${READ_LINE}, kelonggaran dial ${PLAY}</dd>
      <dt>Apungan</dt><dd>${st.drift.toFixed(4)} mGal/jam (+${st.drift2.toFixed(4)} mGal/jam²)</dd>
      <dt>Tare</dt><dd>${st.tares.length ? st.tares.map(t => `${t.d >= 0 ? '+' : ''}${t.d.toFixed(3)} mGal (${Sim.fmtTime(t.t)}, ${t.from}→${t.to})`).join('<br>') : 'tidak ada'}</dd>`;
  }
  function keyRows() { return [['Apungan (mGal/jam)', Sim.round(st.drift, 4)], ['Total tare (mGal)', Sim.round(st.tare, 3)]]; }
  function keyRecords() {
    const recs = S().records.filter(r => r.lc);
    if (!recs.length) return '<p class="muted">Belum ada bacaan.</p>';
    return `<div class="table-wrap short"><table class="book"><thead><tr><th>No</th><th>Lokasi</th><th>Waktu nyata</th><th>Ditulis</th><th>Dial</th><th>Null ideal</th><th>Selisih (mGal)</th><th>Catatan</th></tr></thead><tbody>${recs.map((r, i) => {
      const c = r.lc, d = (c.typed - c.ntIdeal) * CAL[Math.max(0, Math.min(69, Math.floor(c.ntIdeal / 100)))].f;
      return `<tr><td>${i + 1}</td><td>${r.locId}</td><td>${Sim.fmtTime(c.tReal)}</td><td class="num">${c.typed.toFixed(2)}</td><td class="num">${c.dial.toFixed(3)}</td><td class="num">${c.ntIdeal.toFixed(3)}</td><td class="num ${Math.abs(d) > 0.02 ? 'bad' : ''}">${d.toFixed(3)}</td><td>${c.issues.join(', ') || '—'}</td></tr>`;
    }).join('')}</tbody></table></div><p class="muted small">Null ideal = posisi dial bila alat level, sisi kiri benang tepat di garis baca, dan didekati searah jarum jam (tare dan apungan tetap ada).</p>`;
  }

  Field.init({
    name: 'LaCoste & Romberg Model G',
    storeKey: 'simgrav-lcr-v2',
    filePrefix: 'LCR',
    emptyHint: 'Setelah benang di garis baca, tulis bacaan di formulir atas.',
    newState, mount, guide, measured, renderBookForm,
    refresh() { draw(); },
    tick() { if (st) { st.tL += (Math.random() - 0.5) * 0.25; st.tC += (Math.random() - 0.5) * 0.25; } },
    beforeLeave() {
      if (st.clampAnim) return { block: 'Tunggu kenop arrestment selesai diputar.' };
      if (!st.clamped) return { warn: 'Beam belum dikunci! Memindah alat dengan beam terbuka menimbulkan tare.' };
      return null;
    },
    onLeave(from, to) {
      if (!st.clamped) {
        const d = (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.4);
        st.tare += d;
        st.tares.push({ t: S().now, d, from: from.id, to: to.id });
        st.drift += 0.05 * (Math.random() < 0.5 ? -1 : 1);
        Field.logIssue(`Alat dipindah dari ${from.id} ke ${to.id} dengan beam terbuka (tare, apungan naik).`);
      }
      if (st.light) Field.logIssue('Lampu dibiarkan menyala saat pindah (boros baterai, memanaskan alat).', false);
    },
    onArrive(to) {
      st.arrivedAt = S().now;
      const R = Math.random;
      st.tL = (R() < 0.5 ? -1 : 1) * (60 + R() * 180);
      st.tC = (R() < 0.5 ? -1 : 1) * (60 + R() * 180);
      const f = document.querySelector('#lcrForm');
      if (f) { f.st.value = to.id; f.t.value = Sim.fmtTime(S().now); }
      draw();
    },
    onExport() { st.exported = true; Field.refresh(); Field.save(true); },
    get bookColumns() {
      const cols = [{ h: 'Bacaan counter', v: r => r.lc.typed.toFixed(2) }];
      if (S().mode === 'latihan') cols.push({ h: 'mGal (tabel)', v: r => toMgal(r.lc.typed).toFixed(3) });
      return cols;
    },
    get exportCols() {
      const cols = [{ h: 'Bacaan counter', v: r => Sim.round(r.lc.typed, 2) }];
      if (S().mode === 'latihan') cols.push({ h: 'Bacaan (mGal, tabel kalibrasi)', v: r => Sim.round(toMgal(r.lc.typed), 3) });
      return cols;
    },
    infoRows: () => [['Nomor seri alat', SN + ' (fiktif)'], ['Garis baca', READ_LINE], ['Suhu operasi', `${OPER_TEMP} °C`], ['Konversi', 'mGal = Value in Milligals + (bacaan − Counter Reading) × Factor for Interval (sheet Tabel Kalibrasi)']],
    extraSheets: () => [{ name: 'Tabel Kalibrasi', boldRows: [0], widths: [16, 18, 18], rows: [['Counter Reading', 'Value in Milligals', 'Factor for Interval'], ...CAL.map(r => [r.c, r.v, r.f])] }],
    keyInfo, keyRows, keyRecords
  });
})();
