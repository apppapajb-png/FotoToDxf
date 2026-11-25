/* Foto to DXF – Oberfläche (Stufe 1: Foto/Bild/SVG -> DXF).
   Nutzt OpenCV.js für Schwelle + Konturen und geom.js für Linien/Bögen + DXF. */
(function () {
  'use strict';
  const APP_VER = '0.2';
  const $ = s => document.querySelector(s);
  const G = window.Geom;
  const FP = { tol: 0.2, minr: 1.0, maxr: 5000, smooth: 0.6, minArea: 50 };

  document.getElementById('ver').textContent = 'v' + APP_VER;

  // ---------- Bildschirme ----------
  const screens = { start: $('#screen-start'), corners: $('#screen-corners'), result: $('#screen-result') };
  function show(name) { for (const k in screens) screens[k].classList.toggle('hide', k !== name); window.scrollTo(0, 0); }
  function overlay(on, text) { $('#overlay').classList.toggle('hide', !on); if (text) $('#ov-text').textContent = text; }
  function setStatus(el, msg, err) { el.textContent = msg || ''; el.classList.toggle('err', !!err); }

  // ---------- OpenCV bereit? ----------
  function cvReady() { return window.cvReady && typeof cv !== 'undefined' && cv.Mat; }
  function waitCv(cb) {
    if (cvReady()) return cb();
    overlay(true, 'Bildverarbeitung wird geladen …');
    const t = setInterval(() => { if (cvReady()) { clearInterval(t); overlay(false); cb(); } }, 120);
    setTimeout(() => { if (!cvReady()) { clearInterval(t); overlay(false); alert('Die Bildverarbeitung (OpenCV) konnte nicht geladen werden. Internetverbindung prüfen und Seite neu laden.'); } }, 20000);
  }

  // ---------- Zustand ----------
  let srcImg = null;        // HTMLImageElement / Canvas mit Originalbild (volle Auflösung)
  let imgCanvas = null;     // Canvas in Originalgröße
  let pickPts = [];         // 4 Ecken in Bild-Pixeln
  let result = [];          // Konturen {els, outer, closed, P}

  // =========================================================
  //  Bild / SVG laden
  // =========================================================
  function loadFile(file, kind) {
    if (!file) return;
    if (kind === 'svg') { const r = new FileReader(); r.onload = () => openSvg(r.result); r.readAsText(file); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // auf max. 2000 px verkleinern (Tempo auf dem Handy)
      const MAX = 2000, sc = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
      imgCanvas = document.createElement('canvas'); imgCanvas.width = w; imgCanvas.height = h;
      imgCanvas.getContext('2d').drawImage(img, 0, 0, w, h);
      srcImg = imgCanvas; pickPts = [];
      startCornerPick();
    };
    img.onerror = () => alert('Bild konnte nicht geladen werden.');
    img.src = url;
  }
  $('#in-cam').onchange = e => loadFile(e.target.files[0], 'img');
  $('#in-img').onchange = e => loadFile(e.target.files[0], 'img');
  $('#in-svg').onchange = e => loadFile(e.target.files[0], 'svg');

  // =========================================================
  //  Ecken setzen
  // =========================================================
  const cvp = $('#cv-pick'); const ctxp = cvp.getContext('2d');
  // großes Bild + Zoom/Pan (zwei Finger) + Lupe am Finger für genaues Setzen
  const stageEl = cvp.parentElement;
  const DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let view = { scale: 1, ox: 0, oy: 0 };
  let dragPt = -1, showLoupe = false, loupeAt = null;
  let gesture = null, pinch = null;

  function sizePickStage() {
    const cssW = stageEl.clientWidth || (window.innerWidth - 28);
    const top = stageEl.getBoundingClientRect().top;
    const cssH = Math.max(280, Math.min(Math.round(window.innerHeight * 0.74), window.innerHeight - top - 150));
    cvp.style.width = cssW + 'px'; cvp.style.height = cssH + 'px';
    cvp.width = Math.round(cssW * DPR); cvp.height = Math.round(cssH * DPR);
  }
  function fitView() {
    const cssW = cvp.width / DPR, cssH = cvp.height / DPR;
    const s = Math.min(cssW / srcImg.width, cssH / srcImg.height);
    view.scale = s; view.ox = (cssW - srcImg.width * s) / 2; view.oy = (cssH - srcImg.height * s) / 2;
  }
  const img2css = p => [p[0] * view.scale + view.ox, p[1] * view.scale + view.oy];
  const css2img = (x, y) => [(x - view.ox) / view.scale, (y - view.oy) / view.scale];
  function localXY(t) { const r = cvp.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top]; }

  function startCornerPick() {
    show('corners');
    view = { scale: 1, ox: 0, oy: 0 };
    requestAnimationFrame(() => { sizePickStage(); fitView(); drawPick(); });
    setStatus($('#pick-status'), 'Ecke antippen und mit dem Finger genau schieben – die Lupe zeigt die Stelle. Zwei Finger = zoomen/verschieben.');
    $('#pick-go').disabled = pickPts.length < 4;
  }
  function drawPick() {
    const cssW = cvp.width / DPR, cssH = cvp.height / DPR;
    ctxp.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctxp.fillStyle = '#1a2533'; ctxp.fillRect(0, 0, cssW, cssH);
    ctxp.imageSmoothingQuality = 'high';
    ctxp.drawImage(srcImg, view.ox, view.oy, srcImg.width * view.scale, srcImg.height * view.scale);
    if (pickPts.length > 1) {
      ctxp.strokeStyle = '#f5a623'; ctxp.lineWidth = 2; ctxp.beginPath();
      pickPts.forEach((p, i) => { const c = img2css(p); i ? ctxp.lineTo(c[0], c[1]) : ctxp.moveTo(c[0], c[1]); });
      if (pickPts.length === 4) ctxp.closePath(); ctxp.stroke();
    }
    pickPts.forEach((p, i) => {
      const c = img2css(p);
      ctxp.fillStyle = '#2d6cdf'; ctxp.beginPath(); ctxp.arc(c[0], c[1], 11, 0, 7); ctxp.fill();
      ctxp.fillStyle = '#fff'; ctxp.font = 'bold 13px sans-serif'; ctxp.textAlign = 'center'; ctxp.textBaseline = 'middle';
      ctxp.fillText(i + 1, c[0], c[1]);
    });
    if (showLoupe && loupeAt) drawLoupe(loupeAt);
  }
  function drawLoupe(imgPt) {
    const R = 60, mag = 3.4, cssW = cvp.width / DPR, cssH = cvp.height / DPR;
    const fc = img2css(imgPt);
    const lx = R + 14, ly = (fc[1] < cssH / 2) ? (cssH - R - 14) : (R + 14);
    ctxp.save();
    ctxp.beginPath(); ctxp.arc(lx, ly, R, 0, 7); ctxp.closePath();
    ctxp.fillStyle = '#1a2533'; ctxp.fill(); ctxp.clip();
    const sc = view.scale * mag;
    ctxp.drawImage(srcImg, lx - imgPt[0] * sc, ly - imgPt[1] * sc, srcImg.width * sc, srcImg.height * sc);
    ctxp.strokeStyle = '#ff3b3b'; ctxp.lineWidth = 1.5;
    ctxp.beginPath(); ctxp.moveTo(lx - R, ly); ctxp.lineTo(lx + R, ly); ctxp.moveTo(lx, ly - R); ctxp.lineTo(lx, ly + R); ctxp.stroke();
    ctxp.restore();
    ctxp.beginPath(); ctxp.arc(lx, ly, R, 0, 7); ctxp.strokeStyle = '#fff'; ctxp.lineWidth = 3; ctxp.stroke();
  }
  function updateGo() {
    $('#pick-go').disabled = pickPts.length < 4;
    setStatus($('#pick-status'), pickPts.length < 4 ? ('Noch ' + (4 - pickPts.length) + ' Ecke(n) setzen …') : 'Alle 4 gesetzt. Zum Feinjustieren einen Punkt antippen und schieben (Lupe). Dann „Entzerren & erkennen“.');
  }
  function startPoint(xy) {
    const img = css2img(xy[0], xy[1]);
    if (pickPts.length < 4) { pickPts.push(img); dragPt = pickPts.length - 1; }
    else { let k = 0, bd = 1e9; pickPts.forEach((p, i) => { const c = img2css(p); const d = Math.hypot(c[0] - xy[0], c[1] - xy[1]); if (d < bd) { bd = d; k = i; } }); dragPt = k; pickPts[k] = img; }
    showLoupe = true; loupeAt = pickPts[dragPt]; drawPick(); updateGo();
  }
  function movePoint(xy) { if (dragPt < 0) return; const img = css2img(xy[0], xy[1]); pickPts[dragPt] = img; loupeAt = img; drawPick(); }
  function endPoint() { showLoupe = false; dragPt = -1; drawPick(); updateGo(); }

  function zoomAt(cx, cy, f) {
    const ip = css2img(cx, cy);
    view.scale = Math.max(0.05, Math.min(40, view.scale * f));
    view.ox = cx - ip[0] * view.scale; view.oy = cy - ip[1] * view.scale;
    drawPick();
  }
  // Touch
  cvp.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const a = localXY(e.touches[0]), b = localXY(e.touches[1]);
      gesture = 'pan'; showLoupe = false;
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], scale: view.scale, ox: view.ox, oy: view.oy };
      drawPick(); return;
    }
    gesture = 'point'; startPoint(localXY(e.touches[0]));
  }, { passive: false });
  cvp.addEventListener('touchmove', e => {
    e.preventDefault();
    if (gesture === 'pan' && e.touches.length === 2 && pinch) {
      const a = localXY(e.touches[0]), b = localXY(e.touches[1]);
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], f = d / pinch.d;
      view.scale = pinch.scale * f;
      view.ox = mid[0] - (pinch.mid[0] - pinch.ox) / pinch.scale * view.scale + (mid[0] - pinch.mid[0]);
      view.oy = mid[1] - (pinch.mid[1] - pinch.oy) / pinch.scale * view.scale + (mid[1] - pinch.mid[1]);
      drawPick();
    } else if (gesture === 'point' && e.touches.length === 1) movePoint(localXY(e.touches[0]));
  }, { passive: false });
  cvp.addEventListener('touchend', e => { if (gesture === 'point') endPoint(); gesture = null; pinch = null; }, { passive: false });
  // Maus (PC)
  let mdown = false;
  cvp.addEventListener('mousedown', e => { mdown = true; startPoint(localXY(e)); });
  cvp.addEventListener('mousemove', e => { if (mdown) movePoint(localXY(e)); });
  window.addEventListener('mouseup', () => { if (mdown) { mdown = false; endPoint(); } });
  cvp.addEventListener('wheel', e => { e.preventDefault(); const xy = localXY(e); zoomAt(xy[0], xy[1], e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });

  $('#zoom-in').onclick = () => zoomAt(cvp.width / DPR / 2, cvp.height / DPR / 2, 1.4);
  $('#zoom-out').onclick = () => zoomAt(cvp.width / DPR / 2, cvp.height / DPR / 2, 1 / 1.4);
  $('#zoom-fit').onclick = () => { fitView(); drawPick(); };
  $('#pick-reset').onclick = () => { pickPts = []; dragPt = -1; showLoupe = false; drawPick(); updateGo(); };
  $('#corners-back').onclick = () => show('start');
  $('#pick-go').onclick = () => waitCv(runPhoto);
  window.addEventListener('resize', () => { if (!screens.corners.classList.contains('hide') && srcImg) { sizePickStage(); drawPick(); } });
  window.addEventListener('orientationchange', () => { setTimeout(() => { if (!screens.corners.classList.contains('hide') && srcImg) { sizePickStage(); drawPick(); } }, 300); });

  function orderQuad(pts) {
    const sum = pts.map(p => p[0] + p[1]), diff = pts.map(p => p[1] - p[0]);
    const amin = a => a.indexOf(Math.min.apply(null, a)), amax = a => a.indexOf(Math.max.apply(null, a));
    return [pts[amin(sum)], pts[amin(diff)], pts[amax(sum)], pts[amax(diff)]]; // TL,TR,BR,BL
  }

  // =========================================================
  //  Foto -> Konturen (OpenCV: Schwelle + Konturen; Homographie -> mm)
  // =========================================================
  function runPhoto() {
    overlay(true, 'Entzerren & erkennen …');
    setTimeout(() => {
      try { doPhoto(); }
      catch (e) { console.error(e); alert('Erkennung fehlgeschlagen:\n' + e.message); overlay(false); }
    }, 60);
  }
  function doPhoto() {
    const W = parseFloat($('#a4w').value) || 210, H = parseFloat($('#a4h').value) || 297;
    const src = cv.imread(imgCanvas);
    const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const k = Math.max(3, (Math.round(Math.min(src.cols, src.rows) * 0.004) | 1));
    cv.GaussianBlur(gray, gray, new cv.Size(k, k), 0);
    const bin = new cv.Mat();
    cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    // Polarität: Rand = Hintergrund
    const border = [];
    for (let x = 0; x < bin.cols; x += Math.max(1, bin.cols >> 6)) { border.push(bin.ucharPtr(0, x)[0]); border.push(bin.ucharPtr(bin.rows - 1, x)[0]); }
    const brightBorder = border.reduce((s, v) => s + (v > 127 ? 1 : 0), 0) / border.length;
    const objBright = brightBorder < 0.5;
    if (!objBright) cv.bitwise_not(bin, bin);
    const m = cv.Mat.ones(5, 5, cv.CV_8U);
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, m);
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, m);

    const contours = new cv.MatVector(); const hier = new cv.Mat();
    cv.findContours(bin, contours, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);

    // Homographie Bild-px -> A4-Ebene (mm, y nach unten)
    const q = orderQuad(pickPts.map(p => p.slice()));
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const Md = M.data64F.slice();
    const toMM = (x, y) => { const d = Md[6] * x + Md[7] * y + Md[8]; return [(Md[0] * x + Md[1] * y + Md[2]) / d, (Md[3] * x + Md[4] * y + Md[5]) / d]; };

    // Konturen einsammeln (A4-Rechteck selbst überspringen)
    const raw = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const nPts = cnt.data32S.length / 2;
      if (nPts < 8) { cnt.delete(); continue; }
      const P = [];
      for (let j = 0; j < nPts; j++) P.push(toMM(cnt.data32S[2 * j], cnt.data32S[2 * j + 1]));
      cnt.delete();
      // Fläche in mm²
      let area = 0; for (let j = 0; j < P.length; j++) { const a = P[j], b = P[(j + 1) % P.length]; area += a[0] * b[1] - b[0] * a[1]; }
      area = Math.abs(area) / 2;
      if (area < FP.minArea) continue;
      // A4-Blatt? (bbox ~ 0..W, 0..H)
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      const isA4 = Math.abs(x0) < 6 && Math.abs(y0) < 6 && Math.abs(x1 - W) < 6 && Math.abs(y1 - H) < 6;
      if (isA4) continue;
      const outer = hier.intPtr(0, i)[3] === -1;
      raw.push({ P, outer });
    }
    src.delete(); gray.delete(); bin.delete(); m.delete(); contours.delete(); hier.delete();
    srcTri.delete(); dstTri.delete(); M.delete();

    if (!raw.length) { overlay(false); alert('Keine Kontur gefunden. Tipps: Schablone deutlich vom Untergrund abheben, A4‑Ecken genau setzen, gutes Licht.'); return; }

    // y nach oben spiegeln (DXF-Konvention), in den positiven Bereich schieben
    let maxY = -1e9, minX = 1e9, minY = 1e9;
    for (const r of raw) for (const p of r.P) { maxY = Math.max(maxY, p[1]); minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); }
    const MARGIN = 5;
    // nur das größte Teil + dessen Innenkonturen behalten? -> wir behalten alle über Mindestfläche.
    result = [];
    for (const r of raw) {
      let P = r.P.map(p => [p[0] - minX + MARGIN, (maxY - p[1]) + MARGIN]);
      // glätten + einpassen
      const dense = G.densify(P, 0.5, true);
      const rs = resampleClosedSmooth(dense, FP.smooth);
      const els = G.fitContour(rs, FP.tol, FP.minr, FP.maxr, true);
      if (els && els.length) result.push({ els, outer: r.outer, closed: true, P: G.sampleChain(els) });
    }
    overlay(false);
    if (!result.length) { alert('Keine verwertbare Kontur.'); return; }
    showResult('Foto erkannt: ' + result.length + ' Kontur(en).');
  }
  function resampleClosedSmooth(P, smoothMm) {
    // über geom: resample (0.5) + Gauss-Glättung
    const r = G.beautifyContour; // nicht direkt – wir glätten simpel über densify + Mittel
    // einfache gleitende Mittelung proportional zu smoothMm
    const n = P.length; if (n < 6) return P;
    const win = Math.max(1, Math.round(smoothMm / 0.5));
    const out = [];
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0, c = 0;
      for (let t = -win; t <= win; t++) { const p = P[(i + t + n * 10) % n]; x += p[0]; y += p[1]; c++; }
      out.push([x / c, y / c]);
    }
    return out;
  }

  // =========================================================
  //  SVG -> Konturen
  // =========================================================
  function openSvg(text) {
    let info;
    try { info = G.svgToContours(text, FP); }
    catch (e) { console.error(e); alert('SVG konnte nicht gelesen werden:\n' + e.message); return; }
    if (!info.contours.length) { alert(info.note || 'Keine Konturen in der SVG.'); return; }
    let cs = info.contours, w = info.width_mm;
    if (!info.scale_known) {
      const ans = prompt('Die SVG hat keine echte Größe (mm).\nTatsächliche BREITE der Zeichnung in mm:', Math.round(w));
      const nw = parseFloat(ans);
      if (nw && nw > 0 && w > 1e-6) { const f = nw / w; cs = cs.map(c => scaleContour(c, f)); w *= f; }
    }
    result = cs.map(c => ({ els: c.els, outer: c.outer, closed: c.closed, P: G.sampleChain(c.els) }));
    showResult('SVG geladen: ' + result.length + ' Kontur(en).' + (info.note ? '  ' + info.note : ''));
  }
  function scaleContour(c, f) {
    const sc = e => { if (e.t === 'L') return { t: 'L', a: [e.a[0] * f, e.a[1] * f], b: [e.b[0] * f, e.b[1] * f] }; if (e.t === 'A') return { t: 'A', a: [e.a[0] * f, e.a[1] * f], b: [e.b[0] * f, e.b[1] * f], c: [e.c[0] * f, e.c[1] * f], r: e.r * f, sw: e.sw }; return { t: 'C', c: [e.c[0] * f, e.c[1] * f], r: e.r * f }; };
    const els = c.els.map(sc); return { els, outer: c.outer, closed: c.closed, P: G.sampleChain(els) };
  }

  // =========================================================
  //  Ergebnis zeichnen
  // =========================================================
  const cvr = $('#cv-res'); const ctxr = cvr.getContext('2d');
  function showResult(msg) {
    show('result');
    drawResult();
    const inf = count(result);
    setStatus($('#res-status'), (msg ? msg + '  ' : '') + inf.lines + ' Geraden, ' + inf.arcs + ' Bögen, ' + inf.circles + ' Kreise.');
  }
  function count(cs) { let l = 0, a = 0, c = 0; for (const k of cs) for (const e of k.els) { if (e.t === 'L') l++; else if (e.t === 'A') a++; else c++; } return { lines: l, arcs: a, circles: c }; }
  function bbox(cs) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const k of cs) for (const p of k.P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return [x0, y0, x1, y1];
  }
  function drawResult() {
    const maxW = Math.min(window.innerWidth - 28, 740);
    const [x0, y0, x1, y1] = bbox(result);
    const wmm = Math.max(1, x1 - x0), hmm = Math.max(1, y1 - y0);
    const s = maxW / wmm;
    cvr.width = maxW; cvr.height = Math.max(120, Math.round(hmm * s)) + 2;
    cvr.style.width = maxW + 'px';
    ctxr.fillStyle = '#243244'; ctxr.fillRect(0, 0, cvr.width, cvr.height);
    const toS = p => [(p[0] - x0) * s, cvr.height - (p[1] - y0) * s - 1];
    for (const k of result) {
      ctxr.strokeStyle = k.outer ? '#ff5a3c' : '#49b3ff';
      ctxr.lineWidth = 2; ctxr.beginPath();
      const pts = k.P;
      pts.forEach((p, i) => { const q = toS(p); i ? ctxr.lineTo(q[0], q[1]) : ctxr.moveTo(q[0], q[1]); });
      if (k.closed) ctxr.closePath();
      ctxr.stroke();
    }
  }
  window.addEventListener('resize', () => { if (!screens.result.classList.contains('hide') && result.length) drawResult(); });

  // ---------- Verschönern ----------
  $('#btn-beautify').onclick = () => {
    if (!result.length) return;
    const smoothMm = parseFloat(prompt('Glättung in mm (z. B. 1):', '1')); if (!(smoothMm >= 0)) return;
    const R = parseFloat(prompt('Eckenradius in mm (0 = nicht runden):', '0')) || 0;
    overlay(true, 'Verschönern …');
    const t0 = Date.now();
    setTimeout(() => {
      let done = 0;
      for (const k of result) {
        if (!k.els.length || k.els[0].t === 'C') continue;
        try { const nb = G.beautifyContour(k.els, k.closed, smoothMm, R, FP); if (nb) { k.els = nb; k.P = G.sampleChain(nb); done++; } } catch (e) { console.error(e); }
      }
      const rest = Math.max(0, 450 - (Date.now() - t0));
      setTimeout(() => { overlay(false); drawResult(); const inf = count(result); setStatus($('#res-status'), 'Verschönert (' + done + ' Konturen). ' + inf.lines + ' Geraden, ' + inf.arcs + ' Bögen, ' + inf.circles + ' Kreise.'); }, rest);
    }, 40);
  };

  // ---------- DXF speichern ----------
  $('#btn-dxf').onclick = () => {
    if (!result.length) return;
    let out;
    try { out = G.makeDxf(result, { origin: 'll', mirror: $('#opt-mirror').checked }); }
    catch (e) { alert('DXF konnte nicht erstellt werden:\n' + e.message); return; }
    const name = 'FotoToDxf_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.dxf';
    const blob = new Blob([out.dxf], { type: 'application/dxf' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    setStatus($('#res-status'), 'DXF gespeichert: ' + out.info.lines + ' Geraden, ' + out.info.arcs + ' Bögen, ' + out.info.circles + ' Kreise, ' + out.info.width.toFixed(0) + '×' + out.info.height.toFixed(0) + ' mm.');
  };
  $('#result-back').onclick = () => { result = []; show('start'); };

  // ---------- QR-Code teilen ----------
  $('#btn-qr').onclick = () => {
    const card = $('#qr-card'); card.classList.toggle('hide');
    if (card.classList.contains('hide')) return;
    const box = $('#qrbox'); box.innerHTML = '';
    const url = location.href.split('#')[0];
    try { new QRCode(box, { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M }); }
    catch (e) { box.textContent = url; }
    $('#qr-url').textContent = url;
  };
})();
