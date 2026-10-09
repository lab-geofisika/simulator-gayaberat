/* =====================================================================
   Simulator Praktikum Gayaberat — kerangka lapangan bersama
   Jam simulasi, peta lintasan, info stasiun, panduan langkah,
   buku lapangan, ekspor Excel/CSV, kunci jawaban asisten.
   Instrumen (cg5.js / lacoste.js) mendaftar lewat Field.init({...}).
   ===================================================================== */
'use strict';

const Field = (() => {
  // SHA-256 dari PIN asisten (PIN tidak ditulis langsung karena kode ini publik).
  // Ganti PIN: hitung hash-nya, mis. di PowerShell/Git Bash: printf 'PIN_BARU' | sha256sum
  const PIN_HASH = 'b8835efc692bf92ae30724342cea116f1f41932f21e2712a7f7fec87c8c318f6';
  const WALK = 0.9;                   // kecepatan jalan membawa alat, m/s
  const DRIVE = 8;                    // kecepatan kendaraan, m/s (dipakai bila jarak > DRIVE_MIN)
  const DRIVE_MIN = 800;
  const SETUP_SEC = 90;               // waktu menurunkan & memasang alat

  let I = null, S = null, sc = null;
  let busy = false;                   // true saat jam dikendalikan instrumen (mis. CG-5 mengukur)
  let modalOpen = false, lastSave = 0;

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const station = id => sc.stations.find(s => s.id === (id || S.at));

  /* ---------------- Mulai ---------------- */
  function init(inst) {
    I = inst;
    const saved = Sim.store.get(I.storeKey);
    if (saved && saved.v === 1) {
      S = saved;
      Sim.setTZ(S.tz ?? 7);
      if (S.realtime) S.now = Date.now();
      sc = Sim.buildScenario(S.code, S.custom, S.center);
      boot();
    } else {
      showSetup();
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
    vibInit();
  }

  function showSetup() {
    const today = '2026-10-09';
    modal(`
      <h3>Mulai simulasi — ${esc(I.name)}</h3>
      <p class="muted">Setiap kelompok memakai <b>kode skenario</b> sendiri: benda anomali, densitas, dan kondisi tiap titik ditentukan oleh kode ini. Kode yang sama selalu menghasilkan lapangan yang sama.</p>
      <form id="setupForm" class="form-grid">
        <label>Kode skenario / kelompok<input name="code" required value="GPA-K1" maxlength="20" autocomplete="off"></label>
        <label>Nama operator<input name="operator" placeholder="Nama mahasiswa" maxlength="40"></label>
        <fieldset class="span2 lintasan">
          <legend>Waktu</legend>
          <label class="rad"><input type="radio" name="clock" value="real" checked> Ikuti jam perangkat (waktu nyata): <b id="devNow"></b></label>
          <label class="rad"><input type="radio" name="clock" value="manual"> Atur tanggal &amp; jam sendiri (WIB, waktu bisa dipercepat)</label>
          <div id="manualBox" class="form-grid" hidden>
            <label>Tanggal survei<input name="date" type="date" value="${today}"></label>
            <label>Jam mulai (WIB)<input name="time" type="time" value="09:00"></label>
          </div>
          <p class="small muted" id="clockNote">Jam, tanggal, dan zona waktu mengikuti perangkat. Pembacaan alat berjalan 1:1 dengan waktu nyata (Read Time 60 s = 60 detik); perpindahan stasiun tidak memajukan jam.</p>
        </fieldset>
        <label class="span2">Mode
          <select name="mode">
            <option value="latihan">Latihan — panduan langkah dan peringatan ditampilkan</option>
            <option value="ujian">Ujian — tanpa panduan dan tanpa peringatan</option>
          </select>
        </label>
        <fieldset class="span2 lintasan">
          <legend>Peta pengukuran</legend>
          <label class="rad"><input type="radio" name="map" value="auto" checked> Otomatis: Base Station + S01–S15, jarak 100 m</label>
          <label class="rad"><input type="radio" name="map" value="custom"> Buat sendiri dari daftar stasiun</label>
          <div id="customBox" hidden>
            <p class="small muted">Tempel dari Excel (blok kolom lalu Ctrl+C, Ctrl+V di sini) atau unggah CSV. Kolom: <b>ID, Lintang, Bujur, Elevasi</b> (elevasi boleh kosong). Stasiun ber-ID <b>BS</b> menjadi base; bila tidak ada, baris pertama. Lintang selatan negatif, desimal boleh koma.</p>
            <textarea name="stations" rows="6" placeholder="ID&#9;Lintang&#9;Bujur&#9;Elevasi&#10;BS&#9;-6.23500&#9;106.78400&#9;25&#10;G01&#9;-6.23450&#9;106.78480&#9;27&#10;G02&#9;-6.23400&#9;106.78560&#9;"></textarea>
            <div class="row-btns">
              <label class="btn sm file-btn">Unggah CSV<input type="file" id="csvFile" accept=".csv,.txt,text/csv,text/plain" hidden></label>
              <button type="button" class="btn sm ghost" id="tplXlsx">Unduh template (.xlsx)</button>
              <button type="button" class="btn sm ghost" id="tplFill">Isi contoh</button>
            </div>
            <div id="custPrev" class="small"></div>
          </div>
        </fieldset>
        ${I.gps ? `<fieldset class="span2 lintasan">
          <legend>GPS alat (READ GPS)</legend>
          <label class="rad"><input type="radio" name="gps" value="sim" checked> Simulasi: koordinat stasiun di peta + galat GPS ±3 m</label>
          <label class="rad"><input type="radio" name="gps" value="hp"> GPS HP/laptop: lokasi asli perangkat</label>
          <p class="small muted" id="gpsNote">READ GPS mengisi lintang, bujur, dan elevasi dari posisi stasiun simulasi.</p>
        </fieldset>` : ''}
        <div class="span2 actions"><button class="btn primary" type="submit">Mulai di Base Station</button></div>
      </form>`, { closable: false, wide: true });
    const f = $('#setupForm'), box = $('#customBox'), prev = $('#custPrev');
    const isReal = () => f.querySelector('input[name="clock"]:checked').value === 'real';
    const showNow = () => {
      const el = $('#devNow');
      if (!el) return;
      const tz = Sim.deviceTZ(), lbl = { 7: 'WIB', 8: 'WITA', 9: 'WIT' }[tz] || `UTC${tz >= 0 ? '+' : ''}${tz}`;
      el.textContent = `${new Date().toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${lbl}`;
    };
    showNow();
    const nowTimer = setInterval(() => { if (!$('#devNow')) clearInterval(nowTimer); else showNow(); }, 1000);
    f.querySelectorAll('input[name="clock"]').forEach(x => {
      x.onchange = () => {
        $('#manualBox').hidden = isReal();
        $('#clockNote').textContent = isReal()
          ? 'Jam, tanggal, dan zona waktu mengikuti perangkat. Pembacaan alat berjalan 1:1 dengan waktu nyata (Read Time 60 s = 60 detik); perpindahan stasiun tidak memajukan jam.'
          : 'Jam simulasi dimulai dari tanggal dan jam di atas (WIB). Perjalanan antarstasiun dan tombol Tunggu memajukan jam; pembacaan CG-5 dipercepat.';
      };
    });
    const isCustom = () => f.querySelector('input[name="map"]:checked').value === 'custom';
    const check = () => {
      if (!isCustom()) return null;
      const r = Sim.parseStations(f.stations.value);
      if (!f.stations.value.trim()) { prev.innerHTML = ''; return r; }
      const base = r.stations.find(p => /^(BS|BASE)$/i.test(p.id)) || r.stations[0];
      const noElev = r.stations.filter(p => p.elev === null).length;
      prev.innerHTML = (r.stations.length >= 2
        ? `<span class="ok-t">✓ ${r.stations.length} stasiun terbaca. Base: <b>${esc(base.id)}</b>.</span>${noElev ? ` ${noElev} stasiun tanpa elevasi (diisi otomatis).` : ''}`
        : '<span class="bad">Minimal 2 stasiun.</span>') + (r.errs.length ? `<br><span class="bad">${r.errs.slice(0, 4).map(esc).join('<br>')}</span>` : '');
      return r;
    };
    const gpsMode = () => (f.querySelector('input[name="gps"]:checked') || { value: 'sim' }).value;
    const gpsNote = () => {
      const el = $('#gpsNote');
      if (!el) return;
      el.innerHTML = gpsMode() === 'sim'
        ? 'READ GPS mengisi lintang, bujur, dan elevasi dari posisi stasiun simulasi.'
        : (isCustom()
          ? 'READ GPS memakai lokasi asli HP. Datangi titik sesuai daftar stasiun agar koordinatnya cocok.'
          : 'READ GPS memakai lokasi asli HP. Peta otomatis dipusatkan di lokasi Anda sekarang sebagai <b>Base Station</b>, lalu datangi titik S01–S15 sungguhan.')
        + (gpsMode() === 'hp' && !window.isSecureContext ? ' <span class="bad">GPS HP butuh alamat https:// (mis. lab-geofisika.github.io) atau localhost.</span>' : '');
    };
    f.querySelectorAll('input[name="gps"]').forEach(x => { x.onchange = gpsNote; });
    f.querySelectorAll('input[name="map"]').forEach(x => { x.onchange = () => { box.hidden = !isCustom(); check(); gpsNote(); }; });
    f.stations.addEventListener('input', check);
    $('#csvFile').onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => { f.stations.value = String(rd.result); check(); };
      rd.readAsText(file);
    };
    const sample = [['ID', 'Lintang', 'Bujur', 'Elevasi (m)'], ['BS', -6.2350, 106.7840, 25.0],
      ...Array.from({ length: 10 }, (_, i) => [`G${String(i + 1).padStart(2, '0')}`, Sim.round(-6.2345 + i * 0.0004, 6), Sim.round(106.7848 + i * 0.0007, 6), Sim.round(26 + 4 * Math.sin(i / 2), 1)])];
    $('#tplXlsx').onclick = () => Sim.downloadXlsx('Template_Stasiun_Gayaberat.xlsx', [{ name: 'Stasiun', rows: sample, boldRows: [0], widths: [10, 13, 13, 12] }]);
    $('#tplFill').onclick = () => { f.stations.value = sample.map(r => r.join('\t')).join('\n'); check(); };
    f.addEventListener('submit', ev => {
      ev.preventDefault();
      const fd = new FormData(f);
      let custom = null;
      if (isCustom()) {
        const r = check();
        if (!r || r.stations.length < 2) { toast('Daftar stasiun belum valid (minimal 2 stasiun).', 'err'); return; }
        custom = r.stations;
      }
      if (!isReal() && (!fd.get('date') || !fd.get('time'))) { toast('Isi tanggal dan jam mulai.', 'err'); return; }
      const o = { code: fd.get('code'), operator: fd.get('operator') || '', date: fd.get('date'), time: fd.get('time'), mode: fd.get('mode'), custom, realtime: isReal(), gps: I.gps ? gpsMode() : null };
      if (o.gps !== 'hp') { closeModal(); newSession(o); return; }
      const btn = f.querySelector('button[type="submit"]'), txt = btn.textContent;
      btn.disabled = true; btn.textContent = 'Mencari lokasi GPS…';
      devicePos().then(c => {
        if (!custom) o.center = { lat: c.lat, lon: c.lon, alt: typeof c.alt === 'number' ? Math.round(c.alt * 10) / 10 : null };
        closeModal(); newSession(o);
        toast(`GPS HP aktif (akurasi ±${Math.round(c.acc)} m).`, 'ok');
      }).catch(e => { btn.disabled = false; btn.textContent = txt; toast(e.message, 'err'); });
    });
  }

  function newSession(o) {
    const tz = o.realtime ? Sim.deviceTZ() : 7;
    Sim.setTZ(tz);
    sc = Sim.buildScenario(o.code, o.custom, o.center);
    S = {
      v: 1, code: sc.code, operator: o.operator.trim(), mode: o.mode, custom: o.custom || null,
      gps: o.gps || 'sim', center: o.center || null,
      realtime: !!o.realtime, tz,
      startUtc: o.realtime ? Math.floor(Date.now() / 1000) * 1000 : Sim.wibToUtc(o.date, o.time), at: 'BS', visited: { BS: 1 },
      records: [], log: [], walked: 0, hInst: newHeight(), hMeasured: null
    };
    S.now = S.startUtc;
    S.inst = I.newState(sc, S);
    save(true);
    boot();
  }

  let booted = false;
  function boot() {
    watchMe();
    renderHeader();
    I.mount($('#inst'));
    renderMap();
    renderStation();
    renderVib();
    renderBook();
    refresh();
    updateClock();
    if (!booted) {
      booted = true;
      setInterval(() => {
        if (!S) return;
        if (S.realtime) {                      // waktu nyata: selalu ikut jam perangkat
          S.now = Date.now();
          if (!busy && !document.hidden) I.tick && I.tick(1);
          updateClock();
          save();
          return;
        }
        if (document.hidden || busy || modalOpen) return;
        S.now += 1000;
        I.tick && I.tick(1);
        updateClock();
        save();
      }, 1000);
      window.addEventListener('beforeunload', () => save(true));
    }
  }

  /* ---------------- Header & jam ---------------- */
  function renderHeader() {
    $('#topbar').innerHTML = `
      <a class="brand" href="index.html" title="Kembali ke beranda simulator"><img src="img/logo.png" alt=""><span>Simulator Gayaberat<small>${esc(I.name)}</small></span></a>
      <div class="clock"><span id="clkDate"></span><b id="clkTime"></b><span class="tz">${Sim.tzLabel()}</span></div>
      <div class="top-actions">
        <span class="chip" title="Kode skenario">${esc(S.code)}</span>
        ${S.realtime ? '<span class="chip" title="Jam mengikuti perangkat">Waktu nyata</span>' : ''}
        ${S.gps === 'hp' ? '<span class="chip" title="READ GPS memakai lokasi asli perangkat">GPS HP</span>' : ''}
        <span class="chip ${S.mode === 'ujian' ? 'warn' : 'ok'}">${S.mode === 'ujian' ? 'Mode ujian' : 'Mode latihan'}</span>
        <button class="btn ghost" id="btnKey" title="Kunci jawaban untuk asisten (perlu PIN)">Kunci asisten</button>
        <button class="btn ghost" id="btnReset" title="Hapus sesi dan mulai lagi">Mulai ulang</button>
      </div>`;
    $('#btnReset').onclick = async () => {
      const ok = await ask('Mulai ulang?', 'Semua data di buku lapangan dan memori alat akan dihapus. Unduh dulu data Anda bila masih diperlukan.', 'Hapus & mulai ulang', 'danger');
      if (!ok) return;
      Sim.store.del(I.storeKey);
      S = null;
      location.reload();
    };
    $('#btnKey').onclick = openKey;
  }
  function updateClock() {
    if (!S) return;
    const d = $('#clkDate'), t = $('#clkTime');
    if (d) d.textContent = Sim.fmtDateLong(S.now);
    if (t) t.textContent = Sim.fmtTime(S.now);
  }
  function advance(sec) {
    if (S.realtime) S.now = Date.now();   // waktu nyata: jam tidak bisa dipercepat
    else S.now += sec * 1000;
    I.tick && I.tick(sec);
    updateClock();
    save();
  }

  /* ---------------- Peta lintasan ---------------- */
  function renderMap() {
    const st = sc.stations;
    const xs = st.map(s => s.E), ys = st.map(s => s.N);
    const pad = 70;
    let minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    // jaga rasio peta minimal 4:5 (tinggi:lebar) agar lintasan tidak terlalu pipih
    const grow = (lo, hi, need) => { const c = (lo + hi) / 2; return [c - need / 2, c + need / 2]; };
    if (maxY - minY < (maxX - minX) * 0.8) [minY, maxY] = grow(minY, maxY, (maxX - minX) * 0.8);
    if (maxX - minX < (maxY - minY) * 0.8) [minX, maxX] = grow(minX, maxX, (maxY - minY) * 0.8);
    const w = maxX - minX, hgt = maxY - minY;
    const X = e => e - minX, Y = n => maxY - n;
    // jalan: garis sejajar lintasan melewati dekat base
    const az = sc.az * Sim.DEG, ue = Math.sin(az), un = Math.cos(az), ve = Math.cos(az), vn = -Math.sin(az);
    let road = '';
    if (sc.road) {
      const ry = sc.road.y, rp = (x) => [X(x * ue + ry * ve), Y(x * un + ry * vn)];
      const r1 = rp(-600), r2 = rp(2200);
      road = `<line x1="${r1[0]}" y1="${r1[1]}" x2="${r2[0]}" y2="${r2[1]}" class="map-road" stroke-width="${10 * w / 360}"/>
          <line x1="${r1[0]}" y1="${r1[1]}" x2="${r2[0]}" y2="${r2[1]}" class="map-road-mid" stroke-width="${w / 360}" stroke-dasharray="${8 * w / 360} ${6 * w / 360}"/>`;
    }
    const line = st.filter(s => s.id !== 'BS').map(s => `${X(s.E).toFixed(1)},${Y(s.N).toFixed(1)}`).join(' ');
    const sb = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find(v => v >= w / 6) || 10000; // skala batang
    const sbl = sb >= 1000 ? `${sb / 1000} km` : `${sb} m`;
    const k = w / 360; // ukuran simbol relatif
    const many = st.length > 22;
    $('#map').innerHTML = `
      <svg viewBox="0 0 ${w.toFixed(0)} ${hgt.toFixed(0)}" class="map-svg" role="img" aria-label="Peta lintasan survei">
        <defs><clipPath id="mclip"><rect width="${w}" height="${hgt}"/></clipPath></defs>
        <rect width="${w}" height="${hgt}" class="map-bg"/>
        <g clip-path="url(#mclip)">
          ${road}
        </g>
        <polyline points="${line}" class="map-line" stroke-width="${2 * k}"/>
        ${st.map((s, idx) => {
          const cx = X(s.E), cy = Y(s.N), isB = s.id === 'BS';
          const cls = ['map-st', S.visited[s.id] ? 'vis' : '', s.id === S.at ? 'cur' : '', I.measured && I.measured(s.id) ? 'done' : ''].join(' ');
          const shape = isB
            ? `<rect x="${cx - 8 * k}" y="${cy - 8 * k}" width="${16 * k}" height="${16 * k}" rx="${2 * k}" stroke-width="${1.5 * k}"/>`
            : `<circle cx="${cx}" cy="${cy}" r="${7 * k}" stroke-width="${1.5 * k}"/>`;
          const lbl = isB || s.id === S.at || (sc.custom ? (!many || idx % 2 === 1) : idx % 2 === 1);
          return `<g class="${cls}" data-id="${s.id}" tabindex="0" role="button" aria-label="Stasiun ${s.id}">
            ${s.id === S.at ? `<circle cx="${cx}" cy="${cy}" r="${14 * k}" class="map-ring" stroke-width="${2 * k}"/>` : ''}
            ${shape}
            ${lbl ? `<text x="${cx}" y="${cy - 12 * k}" font-size="${11 * k}" text-anchor="middle">${s.id}</text>` : ''}
          </g>`;
        }).join('')}
        ${meMarker(X, Y, k)}
        <g transform="translate(${w - 30 * k},${34 * k})" class="map-north">
          <path d="M0 ${-18 * k} L${6 * k} ${4 * k} L0 0 L${-6 * k} ${4 * k} Z"/>
          <text y="${16 * k}" font-size="${10 * k}" text-anchor="middle">U</text>
        </g>
        <g transform="translate(${14 * k},${hgt - 14 * k})" class="map-scale">
          <line x1="0" y1="0" x2="${sb}" y2="0" stroke-width="${2 * k}"/>
          <line x1="0" y1="${-4 * k}" x2="0" y2="${4 * k}" stroke-width="${1.5 * k}"/>
          <line x1="${sb}" y1="${-4 * k}" x2="${sb}" y2="${4 * k}" stroke-width="${1.5 * k}"/>
          <text x="${sb / 2}" y="${-6 * k}" font-size="${10 * k}" text-anchor="middle">${sbl}</text>
        </g>
      </svg>
      <div class="map-legend"><span><i class="lg base"></i>Base</span><span><i class="lg"></i>Belum</span><span><i class="lg vis"></i>Dikunjungi</span><span><i class="lg done"></i>Sudah diukur</span>${S.gps === 'hp' ? '<span><i class="lg me"></i>Posisi HP</span>' : ''}</div>`;
    $('#map').querySelectorAll('.map-st').forEach(g => {
      g.addEventListener('click', () => moveTo(g.dataset.id));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); moveTo(g.dataset.id); } });
    });
  }

  async function moveTo(id) {
    if (!S || id === S.at) return;
    const from = station(), to = station(id);
    const dist = Math.hypot(to.E - from.E, to.N - from.N);
    const drive = dist > DRIVE_MIN;
    const sec = Math.round(drive ? dist / DRIVE + 240 + SETUP_SEC : dist / WALK + SETUP_SEC);
    const chk = I.beforeLeave ? I.beforeLeave() : null;
    if (chk && chk.block) { toast(chk.block, 'err'); return; }
    const dTxt = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`;
    let msg = `${drive ? 'Berkendara' : 'Berjalan'} ${dTxt} ke <b>${id}</b>, termasuk memasang alat sekitar <b>${Math.round(sec / 60)} menit</b>.`;
    if (S.realtime) msg += '<br><small class="muted">Mode waktu nyata: perpindahan langsung, jam tidak dimajukan.</small>';
    if (chk && chk.warn && S.mode === 'latihan') msg = `<div class="callout err">${chk.warn}</div>` + msg;
    const ok = await ask(`Pindah ke ${id}?`, msg, 'Pindah');
    if (!ok) return;
    I.onLeave && I.onLeave(from, to);
    S.at = id;
    S.visited[id] = 1;
    S.walked += dist;
    S.hInst = newHeight();
    S.hMeasured = null;
    advance(sec);
    I.onArrive && I.onArrive(to);
    renderMap();
    renderStation();
    refresh();
    save(true);
    toast(`Tiba di ${id}. Alat sudah dipasang; lakukan leveling.`, 'ok');
  }

  /* ---------------- Info stasiun ---------------- */
  function renderStation() {
    const s = station(), n = Sim.NOISE[s.noise];
    $('#stInfo').innerHTML = `
      <div class="st-head"><span class="st-id">${s.id}</span><span class="badge n-${s.noise}" title="${esc(n.ket)}">${n.label}</span></div>
      <dl class="kv">
        <dt>Lintang</dt><dd>${Math.abs(s.lat).toFixed(6)}° ${s.lat < 0 ? 'LS' : 'LU'}</dd>
        <dt>Bujur</dt><dd>${s.lon.toFixed(6)}° BT</dd>
        <dt>Elevasi</dt><dd>${s.elev.toFixed(2)} m <small class="muted">(GPS geodetik)</small></dd>
        <dt>Tinggi alat</dt><dd>${S.hMeasured !== null && S.hMeasured !== undefined ? `<b>${S.hMeasured.toFixed(3)} m</b> <small class="muted">(dari permukaan)</small>` : '<button class="btn sm" id="btnH">Ukur dengan meteran</button>'}</dd>
        <dt>Kondisi</dt><dd>${esc(n.ket)}</dd>
        ${s.id === 'BS' ? `<dt>g absolut</dt><dd><b>${sc.baseG.toFixed(2)} mGal</b><br><small class="muted">diikat ke titik referensi</small></dd>` : ''}
      </dl>
      ${S.realtime ? '<p class="small muted">Waktu nyata: untuk mengamati apungan, tunggu sungguhan di titik ini.</p>' : `<div class="wait">
        <span>Tunggu di sini:</span>
        <button class="btn sm" data-w="5">+5 mnt</button><button class="btn sm" data-w="15">+15 mnt</button><button class="btn sm" data-w="30">+30 mnt</button>
      </div>`}
      <p class="muted small">Klik stasiun di peta untuk pindah. Total jarak tempuh: ${(S.walked / 1000).toFixed(2)} km.</p>`;
    const bh = $('#btnH');
    if (bh) bh.onclick = () => {
      S.hMeasured = Math.round((S.hInst + (Math.random() - 0.5) * 0.004) * 1000) / 1000;
      advance(30);
      renderStation(); refresh(); save(true);
      toast(`Tinggi alat ${S.hMeasured.toFixed(3)} m. Catat di buku lapangan (koreksi udara bebas memakai elevasi + tinggi alat).`, 'info', 6000);
    };
    $('#stInfo').querySelectorAll('[data-w]').forEach(b => b.onclick = () => {
      const chk = I.beforeWait ? I.beforeWait() : null;
      if (chk) { toast(chk, 'err'); return; }
      advance(+b.dataset.w * 60);
      toast(`Menunggu ${b.dataset.w} menit.`, 'info');
      refresh();
    });
  }

  /* ---------------- Panduan langkah ---------------- */
  function renderGuide() {
    const el = $('#guide');
    if (!el) return;
    if (S.mode === 'ujian') {
      el.innerHTML = '<p class="muted">Mode ujian: panduan langkah disembunyikan. Ikuti prosedur yang sudah dipelajari.</p>';
      return;
    }
    const steps = I.guide();
    let cur = steps.findIndex(s => !s.ok);
    el.innerHTML = '<ol class="steps">' + steps.map((s, i) =>
      `<li class="${s.ok ? 'ok' : i === cur ? 'cur' : ''}"><span class="mk">${s.ok ? '✓' : i + 1}</span><span>${s.t}${s.tip && i === cur ? `<small>${s.tip}</small>` : ''}</span></li>`).join('') + '</ol>';
  }

  /* ---------------- Buku lapangan ---------------- */
  function renderBook() {
    $('#book').innerHTML = `
      <div id="bookForm"></div>
      <div class="table-wrap"><table class="book"><thead></thead><tbody></tbody></table></div>
      <div class="exports">
        <button class="btn" id="exXlsx">Unduh Excel (.xlsx)</button>
        <button class="btn ghost" id="exCsv">CSV</button>
        ${(I.extraExports || []).map((x, i) => `<button class="btn ghost" data-ex="${i}">${esc(x.label)}</button>`).join('')}
      </div>`;
    if (I.renderBookForm) I.renderBookForm($('#bookForm'));
    $('#exXlsx').onclick = exportXlsx;
    $('#exCsv').onclick = exportCsv;
    $('#book').querySelectorAll('[data-ex]').forEach(b => b.onclick = () => I.extraExports[+b.dataset.ex].fn());
    renderBookTable();
  }
  function renderBookTable() {
    const cols = I.bookColumns;
    $('#book thead').innerHTML = '<tr><th>No</th><th>Stasiun</th><th>Waktu</th>' + cols.map(c => `<th>${c.h}</th>`).join('') + '<th>Catatan</th><th></th></tr>';
    const tb = $('#book tbody');
    if (!S.records.length) {
      tb.innerHTML = `<tr><td colspan="${cols.length + 5}" class="muted empty">Belum ada bacaan. ${esc(I.emptyHint || '')}</td></tr>`;
      return;
    }
    tb.innerHTML = S.records.map((r, i) => `<tr>
      <td>${i + 1}</td><td><b>${esc(r.st)}</b></td><td>${Sim.fmtTime(r.t)}</td>
      ${cols.map(c => `<td class="num">${c.v(r)}</td>`).join('')}
      <td><input class="note" data-i="${i}" value="${esc(r.note || '')}" placeholder="—"></td>
      <td><button class="icon-btn" data-del="${i}" title="Hapus baris">×</button></td></tr>`).join('');
    tb.querySelectorAll('.note').forEach(inp => inp.onchange = () => { S.records[+inp.dataset.i].note = inp.value; save(true); });
    tb.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const ok = await ask('Hapus baris?', `Baris ${+b.dataset.del + 1} akan dihapus dari buku lapangan.`, 'Hapus', 'danger');
      if (!ok) return;
      S.records.splice(+b.dataset.del, 1);
      save(true);
      renderBookTable();
      refresh();
    });
    const wrap = tb.closest('.table-wrap');
    wrap.scrollTop = wrap.scrollHeight;
  }
  function addRecord(r) {
    r.t = r.t ?? S.now;
    r.st = r.st ?? S.at;
    r.h = S.hMeasured ?? null;
    S.records.push(r);
    save(true);
    renderBookTable();
    renderMap();
    refresh();
  }

  /* ---------------- Ekspor ---------------- */
  function bookRows() {
    const head = ['No', 'Stasiun', 'Lintang', 'Bujur', 'Elevasi (m)', 'Tinggi alat (m)', 'Tanggal', `Waktu (${Sim.tzLabel()})`, ...I.exportCols.map(c => c.h), 'Catatan'];
    const rows = S.records.map((r, i) => {
      const s = station(r.st) || station(r.locId) || {};
      return [i + 1, r.st, Sim.round(s.lat ?? NaN, 6), Sim.round(s.lon ?? NaN, 6), s.elev, r.h ?? '', Sim.fmtDate(r.t), Sim.fmtTime(r.t), ...I.exportCols.map(c => c.v(r)), r.note || ''];
    });
    return { head, rows };
  }
  function fileBase() {
    return `${I.filePrefix}_${S.code}_${Sim.fmtDate(S.startUtc)}`.replace(/[^\w.-]+/g, '-');
  }
  function exportXlsx() {
    const b = bookRows();
    const info = [
      ['Simulator Praktikum Gayaberat — Lab Teknik Geofisika Universitas Pertamina'], [],
      ['Alat', I.name], ['Kode skenario', S.code], ['Operator', S.operator || '-'],
      ['Tanggal survei', Sim.fmtDateLong(S.startUtc)], ['Zona waktu', `${Sim.tzLabel()} (UTC${Sim.WIB >= 0 ? '+' : ''}${Sim.WIB})${S.realtime ? ', mengikuti jam perangkat' : ''}`],
      ['g absolut Base Station (mGal)', sc.baseG],
      ['Catatan', 'Data hasil simulasi untuk latihan. Lakukan koreksi pasang surut, apungan (drift), lintang, udara bebas, dan Bouguer.'],
      ...(I.infoRows ? I.infoRows() : [])
    ];
    const sheets = [
      { name: 'Buku Lapangan', rows: [b.head, ...b.rows], boldRows: [0], widths: b.head.map((h, i) => i < 2 ? 8 : Math.max(11, h.length + 2)) },
      { name: 'Stasiun', rows: [['Stasiun', 'Lintang', 'Bujur', 'Elevasi (m)', 'Kondisi'], ...sc.stations.map(s => [s.id, Sim.round(s.lat, 6), Sim.round(s.lon, 6), s.elev, Sim.NOISE[s.noise].label])], boldRows: [0], widths: [9, 12, 12, 12, 14] },
      { name: 'Info', rows: info, boldRows: [0], widths: [30, 60] },
      ...(I.extraSheets ? I.extraSheets() : [])
    ];
    Sim.downloadXlsx(fileBase() + '.xlsx', sheets);
    I.onExport && I.onExport();
  }
  function exportCsv() {
    const b = bookRows();
    const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [b.head, ...b.rows].map(r => r.map(q).join(',')).join('\r\n');
    Sim.downloadText(fileBase() + '.csv', '﻿' + text, 'text/csv;charset=utf-8');
    I.onExport && I.onExport();
    toast('CSV memakai titik sebagai desimal. Bila Excel Anda berbahasa Indonesia, pakai unduhan .xlsx.', 'info');
  }

  /* ---------------- Kunci jawaban (asisten) ---------------- */
  // SHA-256 murni JS: crypto.subtle tidak tersedia di http://IP (server Wi-Fi mode HTTP)
  function sha256(str) {
    const K = [], H = [];
    for (let n = 2, c = 0; c < 64; n++) {
      if ([...Array(n).keys()].slice(2).some(d => n % d === 0)) continue;
      if (c < 8) H[c] = (Math.pow(n, 1 / 2) * 2 ** 32) | 0;
      K[c++] = (Math.pow(n, 1 / 3) * 2 ** 32) | 0;
    }
    const bytes = [...new TextEncoder().encode(str)], bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 255);
    const ror = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < bytes.length; o += 64) {
      const w = [];
      for (let i = 0; i < 64; i++) {
        if (i < 16) w[i] = (bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3];
        else {
          const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
          const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
    }
    return H.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }

  async function openKey() {
    const pin = await prompt('Kunci jawaban asisten', 'Masukkan PIN asisten:', 'password');
    if (pin === null) return;
    if (sha256(pin) !== PIN_HASH) { toast('PIN salah.', 'err'); return; }
    const b = sc.body;
    const bodyTxt = b.type === 'patahan'
      ? `tebal ${b.t.toFixed(0)} m, kedalaman ${b.z.toFixed(0)} m, Δρ ${(b.drho / 1000).toFixed(2)} g/cc, tepi di x = ${b.x.toFixed(0)} m`
      : `jari-jari ${b.R.toFixed(0)} m, kedalaman pusat ${b.z.toFixed(0)} m, Δρ ${(b.drho / 1000).toFixed(2)} g/cc, pusat di x = ${b.x.toFixed(0)} m`;
    const rows = sc.stations.map(s => {
      const faa = s.gAbs - Sim.normalGravity(s.lat) + Sim.FAG * s.elev;
      const sba = faa - Sim.BOUG * sc.rhoB * s.elev;
      return { s, faa, sba };
    });
    const chart = profileSvg(rows.filter(r => r.s.id !== 'BS'));
    const issues = S.log.filter(l => l.kind === 'err');
    modal(`
      <h3>Kunci jawaban — ${esc(S.code)}</h3>
      <div class="key-grid">
        <div>
          <h4>Model lapangan</h4>
          <dl class="kv">
            <dt>Benda</dt><dd>${esc(b.nama)}<br><small>${bodyTxt}</small></dd>
            <dt>Densitas Bouguer</dt><dd>${sc.rhoB.toFixed(2)} g/cc</dd>
            <dt>Regional</dt><dd>${sc.regional.gx.toFixed(2)} mGal/km (sepanjang lintasan)</dd>
            <dt>Azimut lintasan</dt><dd>N${sc.az.toFixed(0)}°E</dd>
            ${I.keyInfo ? I.keyInfo() : ''}
          </dl>
        </div>
        <div><h4>Profil anomali Bouguer sederhana (benar, mGal)</h4>${chart}</div>
      </div>
      <h4>Nilai benar per stasiun</h4>
      <div class="table-wrap short"><table class="book">
        <thead><tr><th>Stasiun</th><th>Elev (m)</th><th>g abs (mGal)</th><th>Anomali udara bebas</th><th>Anomali Bouguer sederhana</th><th>Efek benda</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.s.id}</td><td class="num">${r.s.elev.toFixed(2)}</td><td class="num">${r.s.gAbs.toFixed(3)}</td><td class="num">${r.faa.toFixed(3)}</td><td class="num">${r.sba.toFixed(3)}</td><td class="num">${r.s.anom.toFixed(3)}</td></tr>`).join('')}</tbody>
      </table></div>
      <h4>Pemeriksaan bacaan</h4>
      ${I.keyRecords ? I.keyRecords() : ''}
      <h4>Kesalahan prosedur tercatat (${issues.length})</h4>
      ${issues.length ? '<ul class="issues">' + issues.map(l => `<li><b>${Sim.fmtTime(l.t)}</b> · ${esc(l.st)} — ${esc(l.msg)}</li>`).join('') + '</ul>' : '<p class="muted">Tidak ada.</p>'}
      <div class="actions"><button class="btn" id="keyXlsx">Unduh kunci (.xlsx)</button></div>
    `, { wide: true });
    $('#keyXlsx').onclick = () => Sim.downloadXlsx(`Kunci_${fileBase()}.xlsx`, [
      { name: 'Nilai Benar', boldRows: [0], widths: [9, 12, 12, 10, 14, 14, 14, 12],
        rows: [['Stasiun', 'Lintang', 'Bujur', 'Elevasi', 'g abs', 'Anomali FA', 'Anomali Bouguer', 'Efek benda'],
          ...rows.map(r => [r.s.id, Sim.round(r.s.lat, 6), Sim.round(r.s.lon, 6), r.s.elev, Sim.round(r.s.gAbs, 3), Sim.round(r.faa, 3), Sim.round(r.sba, 3), Sim.round(r.s.anom, 3)])] },
      { name: 'Model', boldRows: [], widths: [24, 60], rows: [['Benda', b.nama], ['Parameter', bodyTxt], ['Densitas Bouguer (g/cc)', sc.rhoB], ['Regional (mGal/km)', Sim.round(sc.regional.gx, 3)], ...(I.keyRows ? I.keyRows() : [])] },
      { name: 'Kesalahan', boldRows: [0], widths: [10, 9, 80], rows: [['Waktu', 'Stasiun', 'Keterangan'], ...issues.map(l => [Sim.fmtTime(l.t), l.st, l.msg])] }
    ]);
  }
  function profileSvg(rows) {
    const W = 420, H = 180, m = { l: 44, r: 10, t: 10, b: 28 };
    const xs = rows.map(r => r.s.x), ys = rows.map(r => r.sba);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    const padY = (y1 - y0) * 0.15 || 0.5; y0 -= padY; y1 += padY;
    const X = x => m.l + (x - x0) / (x1 - x0) * (W - m.l - m.r), Y = y => m.t + (y1 - y) / (y1 - y0) * (H - m.t - m.b);
    const ticks = [0, 1, 2, 3].map(i => y0 + (y1 - y0) * i / 3);
    return `<svg viewBox="0 0 ${W} ${H}" class="chart">
      ${ticks.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`).join('')}
      <polyline points="${rows.map(r => `${X(r.s.x)},${Y(r.sba)}`).join(' ')}" class="series"/>
      ${rows.map(r => `<circle cx="${X(r.s.x)}" cy="${Y(r.sba)}" r="3" class="dot"><title>${r.s.id}: ${r.sba.toFixed(3)} mGal</title></circle>`).join('')}
      ${rows.filter((r, i) => i % 2 === 0).map(r => `<text x="${X(r.s.x)}" y="${H - 10}" text-anchor="middle">${r.s.id}</text>`).join('')}
    </svg>`;
  }

  /* ---------------- Tinggi alat ---------------- */
  function newHeight() { return Math.round((0.20 + Math.random() * 0.12) * 1000) / 1000; }

  /* ---------------- Catatan kesalahan ---------------- */
  function logIssue(msg, warnUser = true) {
    S.log.push({ t: S.now, st: S.at, kind: 'err', msg });
    if (warnUser && S.mode === 'latihan') toast(msg, 'err');
    save(true);
  }

  /* ---------------- Modal, toast ---------------- */
  function modal(html, opt = {}) {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-box ${opt.wide ? 'wide' : ''}" role="dialog" aria-modal="true">${opt.closable === false ? '' : '<button class="modal-x" aria-label="Tutup">×</button>'}${html}</div>`;
    m.hidden = false;
    modalOpen = true;
    const x = $('.modal-x', m);
    if (x) x.onclick = closeModal;
    m.onclick = e => { if (e.target === m && opt.closable !== false) closeModal(); };
    const first = m.querySelector('input,select,button.primary');
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    const m = $('#modal');
    m.hidden = true;
    m.innerHTML = '';
    modalOpen = false;
    if (m._resolve) { const r = m._resolve; m._resolve = null; r(null); }
  }
  function ask(title, html, okLabel = 'OK', kind = 'primary') {
    return new Promise(res => {
      modal(`<h3>${title}</h3><div>${html}</div><div class="actions"><button class="btn ghost" data-a="0">Batal</button><button class="btn ${kind}" data-a="1">${okLabel}</button></div>`);
      const m = $('#modal');
      m._resolve = v => res(!!v);
      m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const r = m._resolve; m._resolve = null; closeModal(); r(b.dataset.a === '1'); });
      setTimeout(() => m.querySelector('[data-a="1"]').focus(), 30);
    });
  }
  function prompt(title, label, type = 'text') {
    return new Promise(res => {
      modal(`<h3>${title}</h3><form id="pf"><label>${label}<input name="v" type="${type}" autocomplete="off"></label><div class="actions"><button type="button" class="btn ghost" id="pfc">Batal</button><button class="btn primary">OK</button></div></form>`);
      const m = $('#modal');
      m._resolve = v => res(v);
      $('#pfc').onclick = () => closeModal();
      $('#pf').onsubmit = e => { e.preventDefault(); const v = new FormData(e.target).get('v'); const r = m._resolve; m._resolve = null; closeModal(); r(v); };
    });
  }
  function toast(msg, kind = 'info', ms = 4200) {
    const box = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = msg;
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
  }

  /* ---------------- Simpan & segarkan ---------------- */
  function save(force) {
    if (!S) return;
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    Sim.store.set(I.storeKey, S);
  }
  /* ---------------- Getaran dari sentuhan laptop & sensor gerak (gyro) ----------------
     Sentuhan di luar panel alat (gerak touchpad/mouse, klik, ketik, gulir, sentuh layar)
     dianggap menyenggol alat. Di perangkat bersensor, kemiringan perangkat ikut
     memiringkan alat dan guncangan menjadi getaran. */
  const GYRO_K = 40;                       // detik busur kemiringan alat per derajat kemiringan perangkat
  const VIB = { on: true, level: 0, grace: 0, fns: [], lastMove: 0, mx: null, my: null,
    gyro: { on: false, ok: null, x: 0, y: 0, base: null, raw: null } };
  function vibInit() {
    try { const v = localStorage.getItem('simgrav-vib'); if (v === '0') VIB.on = false; } catch (e) { /* abaikan */ }
    const inInst = t => t && t.closest && (t.closest('#inst') || t.closest('#modal'));
    document.addEventListener('pointerdown', e => { if (!inInst(e.target)) vibEmit(e.pointerType === 'touch' ? 0.6 : 0.45, 'klik'); }, true);
    document.addEventListener('pointermove', e => {
      if (inInst(e.target) || e.pointerType === 'touch') return;
      const now = performance.now();
      if (VIB.mx !== null) {
        const d = Math.hypot(e.clientX - VIB.mx, e.clientY - VIB.my);
        if (now - VIB.lastMove > 120 && d > 4) { vibEmit(Math.min(0.15, d / 900), 'gerak'); VIB.lastMove = now; }
      }
      VIB.mx = e.clientX; VIB.my = e.clientY;
    }, true);
    document.addEventListener('wheel', e => { if (!inInst(e.target)) vibEmit(0.12, 'gulir'); }, { capture: true, passive: true });
    document.addEventListener('keydown', e => {
      if (I && I.ignoreKey && I.ignoreKey(e)) return;
      const typing = e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      vibEmit(typing ? 0.08 : 0.3, 'ketik');
    }, true);
    setInterval(() => {
      VIB.level *= 0.82;
      const bar = $('#vibBar');
      if (bar) bar.style.width = `${Math.round(VIB.level * 100)}%`;
      const g = $('#gyroVal');
      if (g && VIB.gyro.on) g.textContent = VIB.gyro.ok ? `X ${VIB.gyro.x.toFixed(0)}″  Y ${VIB.gyro.y.toFixed(0)}″` : '';
    }, 150);
  }
  function vibEmit(a, kind) {
    if (!VIB.on || !S || performance.now() < VIB.grace) return;
    VIB.level = Math.min(1, VIB.level + a);
    VIB.fns.forEach(f => f(a, kind));
  }
  function renderVib() {
    let box = $('#vibBox');
    if (!box) { box = document.createElement('div'); box.id = 'vibBox'; box.className = 'vib-box'; $('#stInfo').after(box); }
    const g = VIB.gyro;
    box.innerHTML = `
      <div class="vib-h">Gangguan &amp; sensor</div>
      <label class="vib-c"><input type="checkbox" id="vibOn" ${VIB.on ? 'checked' : ''}> Sentuhan laptop = getaran pada alat</label>
      <div class="vib-m" title="Tingkat getaran"><i id="vibBar"></i></div>
      <div class="vib-g">
        <button class="btn sm ${g.on ? 'primary' : ''}" id="gyroBtn">${g.on ? 'Sensor gerak: aktif' : 'Aktifkan sensor gerak (gyro)'}</button>
        ${g.on && g.ok ? '<button class="btn sm ghost" id="gyroZero" title="Jadikan posisi perangkat sekarang sebagai datar">Nolkan</button>' : ''}
        <span class="small muted" id="gyroVal">${g.on && g.ok === false ? 'Sensor tidak ditemukan. Laptop biasa umumnya tidak punya; coba di HP/tablet/laptop 2-in-1.' : g.on && g.ok === null ? 'Menunggu sensor…' : ''}</span>
        ${g.insecure ? `<div class="callout err small">Browser hanya memberi data sensor gerak di halaman <b>https</b>. Halaman ini dibuka lewat <b>http</b>, jadi gyro diblokir browser. Jalankan <b>Jalankan Server HTTPS.bat</b> di laptop, lalu buka <b>${esc(httpsUrl())}</b>${location.protocol === 'file:' ? '' : ' (setujui peringatan sertifikat sekali)'}.</div>` : ''}
      </div>
      <p class="small muted">Saat alat membaca, jangan sentuh laptop (sama seperti di lapangan: menjauh dari alat). Klik/ketik pada panel alat tidak dihitung.</p>`;
    $('#vibOn').onchange = e => { VIB.on = e.target.checked; try { localStorage.setItem('simgrav-vib', VIB.on ? '1' : '0'); } catch (er) { /* abaikan */ } };
    $('#gyroBtn').onclick = toggleGyro;
    const z = $('#gyroZero');
    if (z) z.onclick = () => { g.base = g.raw ? { ...g.raw } : null; g.x = 0; g.y = 0; I.refresh && I.refresh(); };
  }
  function onOrient(e) {
    const g = VIB.gyro;
    if (e.beta === null || e.gamma === null) return;
    g.ok = true;
    g.raw = { b: e.beta, g: e.gamma };
    if (!g.base) { g.base = { ...g.raw }; renderVib(); }
    g.x = (e.gamma - g.base.g) * GYRO_K;
    g.y = (e.beta - g.base.b) * GYRO_K;
  }
  function onMotion(e) {
    const a = e.acceleration || {};
    if (a.x === null || a.x === undefined) return;
    const m = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    if (m > 1.2) vibEmit(Math.min(1, m / 8), 'guncang');
  }
  function httpsUrl() {
    if (location.protocol === 'file:') return 'https://<IP-laptop>:8443/';
    return `https://${location.hostname}:8443${location.pathname}`;
  }
  async function toggleGyro() {
    const g = VIB.gyro;
    if (!g.on && window.isSecureContext === false) { g.insecure = true; renderVib(); toast('Gyro butuh halaman https. Lihat petunjuk di panel Gangguan & sensor.', 'err', 7000); return; }
    if (g.on) {
      g.on = false; g.x = 0; g.y = 0; g.base = null;
      window.removeEventListener('deviceorientation', onOrient); window.removeEventListener('devicemotion', onMotion);
      renderVib(); I.refresh && I.refresh(); return;
    }
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') { toast('Izin sensor gerak ditolak.', 'err'); return; }
      }
    } catch (e) { /* lanjut */ }
    g.on = true; g.ok = null; g.base = null;
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('devicemotion', onMotion);
    renderVib();
    setTimeout(() => { if (g.on && g.ok === null) { g.ok = false; renderVib(); } }, 2000);
  }

  /* ---------------- GPS (READ GPS alat) ---------------- */
  // Lokasi asli perangkat. Browser hanya memberi lokasi di https:// atau localhost.
  function devicePos(timeout = 20000) {
    return new Promise((ok, no) => {
      if (!window.isSecureContext) return no(new Error('GPS HP butuh alamat https:// (mis. lab-geofisika.github.io) atau localhost.'));
      if (!navigator.geolocation) return no(new Error('Perangkat ini tidak menyediakan GPS/lokasi.'));
      navigator.geolocation.getCurrentPosition(
        p => ok({ lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, acc: p.coords.accuracy, altAcc: p.coords.altitudeAccuracy, utc: p.timestamp }),
        e => no(new Error(e.code === 1 ? 'Izin lokasi ditolak. Izinkan akses lokasi untuk situs ini di pengaturan browser.'
          : e.code === 3 ? 'GPS belum mendapat posisi (timeout). Coba di tempat terbuka, lalu ulangi.' : 'Lokasi tidak tersedia. Pastikan GPS/Location HP menyala.')),
        { enableHighAccuracy: true, timeout, maximumAge: 0 });
    });
  }
  const gauss = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
  // Satu kali baca GPS untuk alat: simulasi (stasiun saat ini + galat) atau lokasi HP
  function gpsFix() {
    if (S.gps === 'hp') return devicePos().then(c => { me.fix = c; renderMap(); return { ...c, src: 'hp', sats: null }; });
    const s = station(), sh = 2.5, sv = 4.5;  // galat GPS navigasi: horizontal ±2,5 m, vertikal ±4,5 m (1σ)
    const fix = {
      lat: s.lat + gauss() * sh / 110574, lon: s.lon + gauss() * sh / (111320 * Math.cos(s.lat * Sim.DEG)),
      alt: s.elev + gauss() * sv, acc: sh * 1.2 + Math.random() * 1.5, altAcc: sv * 1.5, utc: S.now,
      src: 'sim', sats: 6 + Math.floor(Math.random() * 6)
    };
    return new Promise(ok => setTimeout(() => ok(fix), 900 + Math.random() * 900));
  }
  // posisi HP di peta (mode GPS HP), diperbarui terus selama halaman terbuka
  const me = { fix: null, watch: null, last: -Infinity };
  function watchMe() {
    if (S.gps !== 'hp' || me.watch !== null || !window.isSecureContext || !navigator.geolocation) return;
    me.watch = navigator.geolocation.watchPosition(p => {
      me.fix = { lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, acc: p.coords.accuracy };
      if (performance.now() - me.last > 2000) { me.last = performance.now(); renderMap(); }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
  }
  function meMarker(X, Y, k) {
    if (S.gps !== 'hp' || !me.fix) return '';
    const E = (me.fix.lon - sc.lon0) * 111320 * Math.cos(sc.lat0 * Sim.DEG), N = (me.fix.lat - sc.lat0) * 110574;
    const cx = X(E), cy = Y(N);
    return `<g class="map-me" pointer-events="none"><circle cx="${cx}" cy="${cy}" r="${Math.max(8 * k, me.fix.acc)}" class="acc"/>
      <circle cx="${cx}" cy="${cy}" r="${6 * k}" class="dot" stroke-width="${2 * k}"/></g>`;
  }

  function refresh() {
    renderGuide();
    I.refresh && I.refresh();
  }

  return {
    init, advance, addRecord, logIssue, toast, ask, modal, closeModal, save, refresh,
    renderMap, renderBookTable, station, esc,
    hInst: () => (S && S.hInst) || 0.25, hInstMeasured: () => (S ? S.hMeasured ?? null : null),
    gpsFix, gpsMode: () => (S && S.gps) || 'sim',
    setBusy: v => { busy = v; },
    realtime: () => !!(S && S.realtime),
    onVibration: fn => { VIB.fns = [fn]; },
    vibGrace: ms => { VIB.grace = performance.now() + ms; },
    gyroTilt: () => VIB.gyro.on && VIB.gyro.ok ? { x: VIB.gyro.x, y: VIB.gyro.y } : { x: 0, y: 0 },
    get S() { return S; }, get sc() { return sc; }
  };
})();
