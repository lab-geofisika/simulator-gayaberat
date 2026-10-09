/* =====================================================================
   Simulator Praktikum Gayaberat — inti model (dipakai CG-5 dan LaCoste)
   Isi: angka acak berbenih, skenario lintasan, model gayaberat bumi,
   pasang surut (Longman 1959), format waktu, penyimpanan, ekspor file.
   ===================================================================== */
'use strict';

const Sim = (() => {
  /* ---------- Angka acak berbenih (hasil sama untuk kode skenario sama) ---------- */
  function hashStr(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + (hi - lo) * next();
    next.gauss = () => {
      let u = 0;
      while (!u) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    };
    next.pick = arr => arr[Math.floor(next() * arr.length)];
    return next;
  }

  /* ---------- Konstanta & rumus dasar ---------- */
  const G = 6.674e-11;            // m^3 kg^-1 s^-2
  const SI2MGAL = 1e5;            // 1 m/s^2 = 1e5 mGal
  const FAG = 0.3086;             // gradien udara bebas, mGal/m
  const BOUG = 0.04193;           // 2*pi*G, mGal per (g/cc · m)
  const DEG = Math.PI / 180;
  const ARCSEC = DEG / 3600;
  let TZ = 7;                     // zona waktu tampilan (jam); bawaan WIB = UTC+7, atau mengikuti perangkat

  // Gayaberat normal GRS80 (rumus tertutup Somigliana, deret), mGal
  function normalGravity(latDeg) {
    const s2 = Math.sin(latDeg * DEG) ** 2;
    return 978032.67715 * (1 + 0.0052790414 * s2 + 0.0000232718 * s2 * s2 + 0.0000001262 * s2 * s2 * s2);
  }

  /* ---------- Pasang surut bumi padat: Longman (1959) ----------
     Mengembalikan percepatan pasang surut ke ATAS (mGal).
     Efek pada bacaan alat = -nilai ini; koreksi yang ditambahkan = +nilai ini. */
  function longman(utcMs, latDeg, lonDeg, altM) {
    const mu = 6.67e-8, M = 7.3537e25, S = 1.993e33;
    const e = 0.05490, m = 0.074804, c = 3.84402e10, c1 = 1.495e13;
    const h2 = 0.612, k2 = 0.303, love = 1 + h2 - 1.5 * k2;
    const a = 6.378270e8, i = 0.08979719, omega = 0.4093146;

    const jd = utcMs / 86400000 + 2440587.5;
    const T = (jd - 2415020.0) / 36525;
    const T2 = T * T, T3 = T2 * T;
    const hourUT = ((utcMs / 3600000) % 24 + 24) % 24;

    const s = 4.72000889397 + 8399.70927456 * T + 3.45575191895e-05 * T2 + 3.49065850399e-08 * T3;
    const p = 5.83515162814 + 71.0180412089 * T + 1.80108282532e-04 * T2 + 1.74532925199e-07 * T3;
    const h = 4.88162798259 + 628.331950894 * T + 5.23598775598e-06 * T2;
    const N = 4.52360161181 - 33.757146295 * T + 3.6264063347e-05 * T2 + 3.39369576777e-08 * T3;
    const p1 = 4.90822941839 + 0.0300025492114 * T + 7.85398163397e-06 * T2 + 5.3329504922e-08 * T3;
    const e1 = 0.01675104 - 0.0000418 * T - 0.000000126 * T2;

    const lat = latDeg * DEG;
    const I = Math.acos(Math.cos(omega) * Math.cos(i) - Math.sin(omega) * Math.sin(i) * Math.cos(N));
    const nu = Math.asin(Math.sin(i) * Math.sin(N) / Math.sin(I));
    const t = (15 * (hourUT - 12) + lonDeg) * DEG;
    const chi = t + h - nu;
    const cosA = Math.cos(N) * Math.cos(nu) + Math.sin(N) * Math.sin(nu) * Math.cos(omega);
    const sinA = Math.sin(omega) * Math.sin(N) / Math.sin(I);
    const alpha = 2 * Math.atan(sinA / (1 + cosA));
    const xi = N - alpha;
    const sigma = s - xi;
    const l = sigma + 2 * e * Math.sin(s - p) + (5 / 4) * e * e * Math.sin(2 * (s - p))
      + (15 / 4) * m * e * Math.sin(s - 2 * h + p) + (11 / 8) * m * m * Math.sin(2 * (s - h));
    const chi1 = t + h;
    const l1 = h + 2 * e1 * Math.sin(h - p1);

    const cosTheta = Math.sin(lat) * Math.sin(I) * Math.sin(l)
      + Math.cos(lat) * (Math.cos(I / 2) ** 2 * Math.cos(l - chi) + Math.sin(I / 2) ** 2 * Math.cos(l + chi));
    const cosPhi = Math.sin(lat) * Math.sin(omega) * Math.sin(l1)
      + Math.cos(lat) * (Math.cos(omega / 2) ** 2 * Math.cos(l1 - chi1) + Math.sin(omega / 2) ** 2 * Math.cos(l1 + chi1));

    const C = Math.sqrt(1 / (1 + 0.006738 * Math.sin(lat) ** 2));
    const r = C * a + (altM || 0) * 100;
    const ap = 1 / (c * (1 - e * e));
    const ap1 = 1 / (c1 * (1 - e1 * e1));
    const d = 1 / (1 / c + ap * e * Math.cos(s - p) + ap * e * e * Math.cos(2 * (s - p))
      + (15 / 8) * ap * m * e * Math.cos(s - 2 * h + p) + ap * m * m * Math.cos(2 * (s - h)));
    const D = 1 / (1 / c1 + ap1 * e1 * Math.cos(h - p1));

    const gm = mu * M * r / d ** 3 * (3 * cosTheta ** 2 - 1) + 1.5 * mu * M * r * r / d ** 4 * (5 * cosTheta ** 3 - 3 * cosTheta);
    const gs = mu * S * r / D ** 3 * (3 * cosPhi ** 2 - 1);
    return (gm + gs) * 1000 * love; // Gal -> mGal
  }
  const tideEffect = (utcMs, lat, lon, alt) => -longman(utcMs, lat, lon, alt);

  /* ---------- Skenario lintasan ----------
     Kode skenario menentukan benda anomali, densitas, regional, dan noise.
     Posisi stasiun: otomatis (BS + S01–S15) atau daftar buatan pengguna (custom). */
  const NOISE = {
    tenang: { label: 'Tenang', ket: 'Lapangan terbuka, jauh dari jalan', sd: [0.030, 0.050], spike: 0.004 },
    angin:  { label: 'Berangin', ket: 'Angin cukup kencang, alat bergoyang', sd: [0.060, 0.095], spike: 0.03 },
    jalan:  { label: 'Dekat jalan', ket: 'Getaran kendaraan lewat', sd: [0.080, 0.140], spike: 0.08 }
  };
  const BODY_TYPES = {
    bola: 'Bola padat (intrusi)',
    silinder: 'Silinder horizontal rapat massa rendah (alur sedimen)',
    patahan: 'Patahan (lempeng terpotong)'
  };

  // custom: [{id, lat, lon, elev?}] — stasiun berlabel BS (atau baris pertama) menjadi base
  function buildScenario(code, custom) {
    const CODE = (code || 'DEMO').trim().toUpperCase();
    const R = rng(hashStr('grav|' + CODE));
    const isCustom = Array.isArray(custom) && custom.length >= 2;
    let lat0 = -6.2350 + R.range(-0.004, 0.004), lon0 = 106.7840 + R.range(-0.004, 0.004);
    let az = R.range(35, 145);
    let pts; // {id, x, y, E, N, lat, lon, elev?}
    if (isCustom) {
      lat0 = custom.reduce((s, p) => s + p.lat, 0) / custom.length;
      lon0 = custom.reduce((s, p) => s + p.lon, 0) / custom.length;
      const kx = 111320 * Math.cos(lat0 * DEG), ky = 110574;
      let bi = custom.findIndex(p => /^(BS|BASE)$/i.test(String(p.id).trim()));
      if (bi < 0) bi = 0;
      const raw = custom.map((p, i) => ({ id: i === bi ? 'BS' : String(p.id).trim().toUpperCase(), lat: p.lat, lon: p.lon, elev: p.elev, E: (p.lon - lon0) * kx, N: (p.lat - lat0) * ky }));
      // sumbu utama (PCA) dari stasiun selain base
      const others = raw.filter((p, i) => i !== bi), src = others.length >= 2 ? others : raw;
      const me = src.reduce((s, p) => s + p.E, 0) / src.length, mn = src.reduce((s, p) => s + p.N, 0) / src.length;
      let sxx = 0, syy = 0, sxy = 0;
      src.forEach(p => { const a = p.E - me, b = p.N - mn; sxx += a * a; syy += b * b; sxy += a * b; });
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);      // sudut dari sumbu E
      let ue = Math.cos(th), un = Math.sin(th);
      if (ue < 0) { ue = -ue; un = -un; }
      az = ((Math.atan2(ue, un) / DEG) + 360) % 360;
      const proj = p => ({ x: (p.E - me) * ue + (p.N - mn) * un, y: -(p.E - me) * un + (p.N - mn) * ue });
      const xmin = Math.min(...src.map(p => proj(p).x));
      pts = raw.map(p => { const q = proj(p); return { ...p, x: q.x - xmin, y: q.y }; });
      [pts[0], pts[bi]] = [pts[bi], pts[0]]; // base di indeks 0
    } else {
      const ue = Math.sin(az * DEG), un = Math.cos(az * DEG), ve = Math.cos(az * DEG), vn = -Math.sin(az * DEG);
      const at = (id, x, y) => { const E = x * ue + y * ve, N = x * un + y * vn; return { id, x, y, E, N, lat: lat0 + N / 110574, lon: lon0 + E / (111320 * Math.cos(lat0 * DEG)) }; };
      pts = [at('BS', -130 + R.range(-20, 20), -90 + R.range(-15, 15))];
      for (let k = 1; k <= 15; k++) pts.push(at('S' + String(k).padStart(2, '0'), (k - 1) * 100 + R.range(-6, 6), R.range(-12, 12)));
    }
    const line = pts.slice(1);
    const x0 = Math.min(...line.map(p => p.x)), x1 = Math.max(...line.map(p => p.x));
    const L = Math.max(100, x1 - x0), s = Math.max(0.25, Math.min(6, L / 1400));

    // topografi halus (dipakai bila elevasi tidak diberikan)
    const h0 = R.range(18, 35), A1 = R.range(5, 12), L1 = R.range(800, 1600) * s, f1 = R.range(0, 6.28);
    const A2 = R.range(1, 3), L2 = R.range(200, 400) * s, f2 = R.range(0, 6.28);
    const topo = (x, y) => h0 + A1 * Math.sin(2 * Math.PI * x / L1 + f1) + A2 * Math.sin(2 * Math.PI * x / L2 + f2) + 0.01 * y;

    // benda penyebab anomali; ukuran diskalakan dengan panjang lintasan, amplitudo dijaga serupa
    const type = R.pick(Object.keys(BODY_TYPES));
    const body = { type, nama: BODY_TYPES[type], x: x0 + L * R.range(0.32, 0.68), y: R.range(-40, 40) * s };
    if (type === 'bola') Object.assign(body, { R: R.range(85, 120) * s, z: R.range(130, 190) * s, drho: R.range(450, 700) / s });
    if (type === 'silinder') Object.assign(body, { R: R.range(55, 80) * s, z: R.range(100, 150) * s, drho: -R.range(400, 600) / s });
    if (type === 'patahan') Object.assign(body, { t: R.range(60, 100) * s, z: R.range(100, 180) * s, drho: R.range(300, 450) / s, dir: R() < 0.5 ? 1 : -1 });
    const regional = { gx: R.range(-0.6, 0.6), gy: R.range(-0.2, 0.2) }; // mGal/km
    const rhoB = Math.round(R.range(2.10, 2.60) * 100) / 100;
    const c0 = R.range(12, 38);

    function anomaly(x, y) {
      const b = body;
      let gz = 0;
      if (b.type === 'bola') {
        const r2 = (x - b.x) ** 2 + (y - b.y) ** 2, Mx = 4 / 3 * Math.PI * b.R ** 3 * b.drho;
        gz = G * Mx * b.z / Math.pow(r2 + b.z * b.z, 1.5);
      } else if (b.type === 'silinder') {
        const xx = x - b.x;
        gz = 2 * Math.PI * G * b.drho * b.R * b.R * b.z / (xx * xx + b.z * b.z);
      } else {
        const xx = (x - b.x) * b.dir;
        gz = 2 * G * b.drho * b.t * (Math.PI / 2 + Math.atan(xx / b.z));
      }
      return gz * SI2MGAL;
    }

    // elevasi kosong pada daftar buatan: pakai elevasi stasiun terdekat yang diisi (bila ada)
    const given = pts.filter(p => p.elev !== undefined && p.elev !== null && isFinite(p.elev));
    const nearestElev = p => given.reduce((b, q) => { const d = Math.hypot(q.x - p.x, q.y - p.y); return d < b.d ? { d, e: +q.elev } : b; }, { d: Infinity, e: null }).e;
    const stations = pts.map((p, i) => {
      const u = R();
      const noise = i === 0 ? 'tenang' : u < 0.6 ? 'tenang' : u < 0.85 ? 'angin' : 'jalan';
      const hasElev = p.elev !== undefined && p.elev !== null && isFinite(p.elev);
      const elev = Math.round((hasElev ? +p.elev : given.length ? nearestElev(p) + (R() - 0.5) * 2 : topo(p.x, p.y)) * 100) / 100;
      const anom = anomaly(p.x, p.y);
      const reg = regional.gx * p.x / 1000 + regional.gy * p.y / 1000;
      const gAbs = normalGravity(p.lat) - FAG * elev + BOUG * rhoB * elev + c0 + reg + anom;
      return { id: p.id, x: p.x, y: p.y, lat: p.lat, lon: p.lon, E: p.E, N: p.N, elev, elevGiven: hasElev, noise, noiseSd: R.range(...NOISE[noise].sd), anom, reg, gAbs };
    });
    const base = stations[0];
    return {
      code: CODE, custom: isCustom, lat0, lon0, az, L, stations, body, regional, rhoB, c0,
      road: isCustom ? null : { y: base.y - 25 },
      baseG: Math.round(base.gAbs * 100) / 100
    };
  }

  // Baca daftar stasiun dari teks (tempel dari Excel / CSV). Kolom: ID, Lintang, Bujur, [Elevasi]
  function parseStations(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    const out = [], errs = [];
    lines.forEach((l, n) => {
      let cells;
      if (l.includes('\t')) cells = l.split('\t');
      else if (l.includes(';')) cells = l.split(';');
      else cells = l.split(',');
      cells = cells.map(c => c.trim().replace(/^"|"$/g, ''));
      const num = c => { const v = parseFloat(String(c ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? v : NaN; };
      const lat = num(cells[1]), lon = num(cells[2]);
      if (!isFinite(lat) || !isFinite(lon)) { if (n > 0) errs.push(`Baris ${n + 1}: lintang/bujur tidak terbaca`); return; } // baris judul dilewati
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { errs.push(`Baris ${n + 1}: koordinat di luar batas`); return; }
      const el = cells.length > 3 && cells[3] !== '' ? num(cells[3]) : NaN;
      out.push({ id: cells[0] || `T${out.length + 1}`, lat, lon, elev: isFinite(el) ? el : null });
    });
    const ids = new Set();
    out.forEach(p => { let id = String(p.id).toUpperCase().slice(0, 10), k = 2; while (ids.has(id)) id = `${p.id}-${k++}`.toUpperCase(); ids.add(id); p.id = id; });
    if (out.length > 60) errs.push('Maksimal 60 stasiun; sisanya diabaikan.');
    return { stations: out.slice(0, 60), errs };
  }

  /* ---------- Format angka gaya printf ---------- */
  const pf = (v, w, d) => (d === undefined ? String(v) : Number(v).toFixed(d)).padStart(w);

  /* ---------- Waktu ---------- */
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  function wibParts(utcMs) {
    const d = new Date(utcMs + TZ * 3600000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  const fmtTime = ms => { const p = wibParts(ms); return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`; };
  const fmtHM = ms => { const p = wibParts(ms); return `${pad(p.h)}:${pad(p.mi)}`; };
  const fmtDate = ms => { const p = wibParts(ms); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; };
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const fmtDateLong = ms => {
    const p = wibParts(ms), wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
    return `${HARI[wd]}, ${p.d} ${BULAN[p.mo - 1]} ${p.y}`;
  };
  // "2026-10-09" + "08:00" (WIB) -> UTC ms
  function wibToUtc(dateStr, timeStr) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [h, mi] = (timeStr || '08:00').split(':').map(Number);
    return Date.UTC(y, mo - 1, d, h - TZ, mi || 0, 0);
  }

  /* ---------- Penyimpanan (aman bila localStorage diblokir) ---------- */
  const store = {
    get(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* diabaikan */ } },
    del(key) { try { localStorage.removeItem(key); } catch (e) { /* diabaikan */ } }
  };

  /* ---------- Unduhan: teks/CSV dan XLSX tanpa pustaka luar ---------- */
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const downloadText = (name, text, mime) => download(name, new Blob([text], { type: mime || 'text/plain;charset=utf-8' }));

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // ZIP tanpa kompresi (metode "store")
  function zip(files) {
    const enc = new TextEncoder(), chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }
  const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function colName(i) { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
  // sheets: [{name, rows: [[...], ...], widths?: [..]}]; baris pertama ditebalkan
  function downloadXlsx(name, sheets) {
    const sheetXml = sh => {
      const cols = sh.widths ? '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : '';
      const rows = sh.rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((v, c) => {
        const ref = colName(c) + (r + 1), st = sh.boldRows && sh.boldRows.includes(r) ? ' s="1"' : '';
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      }).join('') + '</row>').join('');
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
    };
    const files = [
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => `<sheet name="${xmlEsc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) }))
    ];
    download(name, zip(files));
  }

  const fix = (v, n) => (v === null || v === undefined || !isFinite(v)) ? '' : Number(v).toFixed(n);
  const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

  return {
    hashStr, rng, G, SI2MGAL, FAG, BOUG, DEG, ARCSEC, NOISE, BODY_TYPES,
    get WIB() { return TZ; },                                  // nama lama dipertahankan: offset zona aktif
    setTZ(h) { TZ = h; },
    deviceTZ: () => -new Date().getTimezoneOffset() / 60,
    tzLabel: () => ({ 7: 'WIB', 8: 'WITA', 9: 'WIT' }[TZ] || `UTC${TZ >= 0 ? '+' : ''}${TZ}`),
    normalGravity, longman, tideEffect, buildScenario, parseStations, pf,
    pad, wibParts, fmtTime, fmtHM, fmtDate, fmtDateLong, wibToUtc,
    store, download, downloadText, downloadXlsx, fix, round
  };
})();
