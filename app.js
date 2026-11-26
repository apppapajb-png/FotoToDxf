/* Foto to DXF – Oberfläche (Stufe 1: Foto/Bild/SVG -> DXF).
   Nutzt OpenCV.js für Schwelle + Konturen und geom.js für Linien/Bögen + DXF. */
(function () {
  'use strict';
  const APP_VER = '0.4.1';
  const $ = s => document.querySelector(s);
  const G = window.Geom;
  const FP = { tol: 0.2, minr: 1.0, maxr: 5000, smooth: 0.6, minArea: 50 };

  document.getElementById('ver').textContent = 'v' + APP_VER;

  // ---------- Bildschirme ----------
  const screens = { start: $('#screen-start'), corners: $('#screen-corners'), cam: $('#screen-cam'), result: $('#screen-result') };
  function show(name) { if (name !== 'cam') stopCam(); for (const k in screens) screens[k].classList.toggle('hide', k !== name); window.scrollTo(0, 0); }
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
  let region = null;        // optionaler Bereich (Fenster/Lasso) als Polygon in Bild-Pixeln; null = ganzes Bild
  let regionDraft = null;   // Bereich, der gerade gezeichnet wird
  let pickMode = 'corners'; // 'corners' | 'rect' | 'lasso'

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
      srcImg = imgCanvas;
      pickPts = (cvReady() ? (autoDetectA4(imgCanvas) || []) : []);
      startCornerPick();
    };
    img.onerror = () => alert('Bild konnte nicht geladen werden.');
    img.src = url;
  }
  $('#in-cam').onchange = e => { loadFile(e.target.files[0], 'img'); e.target.value = ''; };
  $('#in-img').onchange = e => { loadFile(e.target.files[0], 'img'); e.target.value = ''; };
  $('#in-svg').onchange = e => { loadFile(e.target.files[0], 'svg'); e.target.value = ''; };

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
    region = null; regionDraft = null; setPickMode('corners');
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
    drawRegion(cssW, cssH);
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
  function draftPoly() {
    if (!regionDraft) return null;
    if (regionDraft.type === 'rect') { const a = regionDraft.a, b = regionDraft.b; return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; }
    return regionDraft.pts;
  }
  function drawRegion(cssW, cssH) {
    const poly = regionDraft ? draftPoly() : region;
    if (!poly || poly.length < 2) return;
    ctxp.save();
    if (!regionDraft && poly.length >= 3) {
      // außerhalb des Bereichs abdunkeln
      ctxp.beginPath(); ctxp.rect(0, 0, cssW, cssH);
      poly.forEach((p, i) => { const c = img2css(p); i ? ctxp.lineTo(c[0], c[1]) : ctxp.moveTo(c[0], c[1]); });
      ctxp.closePath(); ctxp.fillStyle = 'rgba(5,10,18,.55)'; ctxp.fill('evenodd');
    }
    ctxp.beginPath();
    poly.forEach((p, i) => { const c = img2css(p); i ? ctxp.lineTo(c[0], c[1]) : ctxp.moveTo(c[0], c[1]); });
    if (!regionDraft || regionDraft.type === 'rect') ctxp.closePath();
    ctxp.strokeStyle = '#3ddc84'; ctxp.lineWidth = 2.5; ctxp.setLineDash([8, 5]); ctxp.stroke();
    ctxp.restore();
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
    $('#region-clear').disabled = !region;
    if (pickMode !== 'corners') { setStatus($('#pick-status'), modeHint()); return; }
    setStatus($('#pick-status'), pickPts.length < 4 ? ('Noch ' + (4 - pickPts.length) + ' Ecke(n) setzen …') : 'Alle 4 gesetzt. Zum Feinjustieren einen Punkt antippen und schieben (Lupe). Optional: mit ▭ Fenster oder ✎ Lasso nur einen Bereich wählen. Dann „Entzerren & erkennen“.');
  }
  function modeHint() {
    const has = region ? ' Bereich gesetzt ✓ – nur Konturen darin kommen in die DXF. Neu zeichnen ersetzt ihn.' : '';
    if (pickMode === 'rect') return 'Fenster: mit einem Finger ein Rechteck um das Teil aufziehen.' + has;
    return 'Lasso: mit einem Finger das Teil frei umfahren – beim Loslassen wird der Bereich geschlossen.' + has;
  }
  function setPickMode(m) {
    pickMode = m;
    document.querySelectorAll('#pick-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    $('#pick-title').textContent = m === 'corners' ? '4 Ecken des Referenz‑Rechtecks antippen' : (m === 'rect' ? 'Fenster: Bereich für die DXF aufziehen' : 'Lasso: Bereich für die DXF umfahren');
    updateGo();
  }
  document.querySelectorAll('#pick-mode button').forEach(b => { b.onclick = () => { setPickMode(b.dataset.mode); if (srcImg) drawPick(); }; });
  const clampImg = p => [Math.max(0, Math.min(srcImg.width, p[0])), Math.max(0, Math.min(srcImg.height, p[1]))];
  function beginRegion(xy) {
    const p = clampImg(css2img(xy[0], xy[1]));
    regionDraft = pickMode === 'rect' ? { type: 'rect', a: p, b: p } : { type: 'lasso', pts: [p] };
    showLoupe = true; loupeAt = p; drawPick();
  }
  function moveRegion(xy) {
    if (!regionDraft) return;
    const p = clampImg(css2img(xy[0], xy[1]));
    if (regionDraft.type === 'rect') regionDraft.b = p;
    else { const l = img2css(regionDraft.pts[regionDraft.pts.length - 1]), c = img2css(p); if (Math.hypot(c[0] - l[0], c[1] - l[1]) >= 3) regionDraft.pts.push(p); }
    loupeAt = p; drawPick();
  }
  function endRegion() {
    if (!regionDraft) return;
    const poly = draftPoly(); regionDraft = null; showLoupe = false;
    // zu kleine Bereiche (versehentliches Antippen) ignorieren
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    if (poly.length >= 3 && (x1 - x0) * view.scale > 15 && (y1 - y0) * view.scale > 15) region = poly.map(p => p.slice());
    drawPick(); updateGo();
  }
  let ptUndo = null; // um einen versehentlich (beim Zwei-Finger-Zoom) gesetzten Punkt zurückzunehmen
  function startPoint(xy) {
    if (pickMode !== 'corners') return beginRegion(xy);
    const img = css2img(xy[0], xy[1]);
    ptUndo = pickPts.map(p => p.slice());
    if (pickPts.length < 4) { pickPts.push(img); dragPt = pickPts.length - 1; }
    else { let k = 0, bd = 1e9; pickPts.forEach((p, i) => { const c = img2css(p); const d = Math.hypot(c[0] - xy[0], c[1] - xy[1]); if (d < bd) { bd = d; k = i; } }); dragPt = k; pickPts[k] = img; }
    showLoupe = true; loupeAt = pickPts[dragPt]; drawPick(); updateGo();
  }
  function movePoint(xy) { if (pickMode !== 'corners') return moveRegion(xy); if (dragPt < 0) return; const img = css2img(xy[0], xy[1]); pickPts[dragPt] = img; loupeAt = img; drawPick(); }
  function endPoint() { if (pickMode !== 'corners') return endRegion(); ptUndo = null; showLoupe = false; dragPt = -1; drawPick(); updateGo(); }

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
      if (gesture === 'point') {
        if (regionDraft) regionDraft = null;
        if (ptUndo) { pickPts = ptUndo; ptUndo = null; dragPt = -1; updateGo(); }
      }
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
  $('#region-clear').onclick = () => { region = null; regionDraft = null; drawPick(); updateGo(); };
  $('#corners-back').onclick = () => show('start');
  $('#pick-go').onclick = () => waitCv(runPhoto);
  // Referenz-Voreinstellungen (A4 Standard) + freie Maßeingabe
  $('#ref-preset').onchange = e => {
    const v = e.target.value;
    if (v === 'custom') { $('#a4w').focus(); $('#a4w').select && $('#a4w').select(); return; }
    const p = v.split('x'); $('#a4w').value = p[0]; $('#a4h').value = p[1];
  };
  function presetToCustom() { const sel = $('#ref-preset'); if (sel) sel.value = 'custom'; }
  $('#a4w').addEventListener('input', presetToCustom);
  $('#a4h').addEventListener('input', presetToCustom);
  window.addEventListener('resize', () => { if (!screens.corners.classList.contains('hide') && srcImg) { sizePickStage(); drawPick(); } });
  window.addEventListener('orientationchange', () => { setTimeout(() => { if (!screens.corners.classList.contains('hide') && srcImg) { sizePickStage(); drawPick(); } }, 300); });

  function orderQuad(pts) {
    const sum = pts.map(p => p[0] + p[1]), diff = pts.map(p => p[1] - p[0]);
    const amin = a => a.indexOf(Math.min.apply(null, a)), amax = a => a.indexOf(Math.max.apply(null, a));
    return [pts[amin(sum)], pts[amin(diff)], pts[amax(sum)], pts[amax(diff)]]; // TL,TR,BR,BL
  }

  // Automatische A4-Erkennung: helles, wenig gesättigtes Rechteck (weißes Blatt) finden.
  // Rückgabe: 4 Ecken in Bild-Pixeln (geordnet) oder null.
  function autoDetectA4(canvas) {
    if (!cvReady()) return null;
    let src = null;
    try {
      src = cv.imread(canvas);
      const sc = 1000 / Math.max(src.rows, src.cols);
      const small = new cv.Mat(); cv.resize(src, small, new cv.Size(Math.round(src.cols * sc), Math.round(src.rows * sc)));
      const rgb = new cv.Mat(); cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);
      const hsv = new cv.Mat(); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      const ch = new cv.MatVector(); cv.split(hsv, ch);
      const S = ch.get(1), V = ch.get(2);
      const Vth = new cv.Mat(), Sth = new cv.Mat(), mask = new cv.Mat();
      cv.threshold(V, Vth, 165, 255, cv.THRESH_BINARY);
      cv.threshold(S, Sth, 75, 255, cv.THRESH_BINARY_INV);
      cv.bitwise_and(Vth, Sth, mask);
      const k1 = cv.Mat.ones(5, 5, cv.CV_8U), k2 = cv.Mat.ones(15, 15, cv.CV_8U);
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k1);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k2);
      const contours = new cv.MatVector(), hier = new cv.Mat();
      cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const Hs = small.rows, Ws = small.cols; let best = null, bestA = 0;
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i); const a = cv.contourArea(c);
        if (a < 0.01 * Hs * Ws || a > 0.9 * Hs * Ws) { c.delete(); continue; }
        const peri = cv.arcLength(c, true); let quad = null;
        for (const ef of [0.02, 0.03, 0.04, 0.05, 0.07]) {
          const ap = new cv.Mat(); cv.approxPolyDP(c, ap, ef * peri, true); // OpenCV.js: (Eingabe, Ausgabe, epsilon, geschlossen)
          if (ap.rows === 4 && cv.isContourConvex(ap)) { quad = []; for (let j = 0; j < 4; j++) quad.push([ap.data32S[2 * j], ap.data32S[2 * j + 1]]); }
          ap.delete(); if (quad) break;
        }
        c.delete();
        if (quad && a > bestA) { bestA = a; best = quad; }
      }
      src.delete(); small.delete(); rgb.delete(); hsv.delete(); ch.delete();
      Vth.delete(); Sth.delete(); mask.delete(); k1.delete(); k2.delete(); contours.delete(); hier.delete();
      if (!best) return null;
      return orderQuad(best.map(p => [p[0] / sc, p[1] / sc]));
    } catch (e) { console.error(e); try { if (src) src.delete(); } catch (_) { } return null; }
  }

  // =========================================================
  //  Foto -> Konturen (OpenCV: Schwelle + Konturen; Homographie -> mm)
  // =========================================================
  // ---------- Fortschritt ----------
  let busyCancel = false;
  const tick = () => new Promise(r => setTimeout(r, 0));
  let lastYield = 0;
  // kurz an den Browser abgeben, damit Anzeige + Balken aktualisiert werden (höchstens alle ~40 ms)
  async function breathe(force) { const t = performance.now(); if (force || t - lastYield > 40) { lastYield = performance.now(); await tick(); } if (busyCancel) throw new Error('__cancel__'); }
  function progress(pct, text) {
    $('#ov-pbar').classList.remove('hide'); $('#ov-cancel').classList.remove('hide');
    $('#ov-pfill').style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
    $('#ov-pct').textContent = Math.round(pct) + ' %';
    if (text) $('#ov-text').textContent = text;
  }
  function progressOff() { $('#ov-pbar').classList.add('hide'); $('#ov-cancel').classList.add('hide'); $('#ov-pct').textContent = ''; $('#ov-pfill').style.width = '0'; }
  $('#ov-cancel').onclick = () => { busyCancel = true; $('#ov-text').textContent = 'Wird abgebrochen …'; };
  async function runBusy(job, failMsg) {
    busyCancel = false; overlay(true, 'Bitte warten …'); progress(0);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30))); // Anzeige erst zeichnen lassen
    try { await job(); }
    catch (e) { if (e && e.message === '__cancel__') { /* abgebrochen */ } else { console.error(e); alert(failMsg + '\n' + (e && e.message)); } }
    finally { progressOff(); overlay(false); busyCancel = false; }
  }

  function runPhoto() { runBusy(doPhoto, 'Erkennung fehlgeschlagen:'); }
  async function doPhoto() {
    const T0 = performance.now();
    const W = parseFloat($('#a4w').value) || 210, H = parseFloat($('#a4h').value) || 297;
    progress(2, 'Bild vorbereiten …'); await breathe(true);

    // --- 1) OpenCV: Schwelle + Konturen (alles in JS-Arrays kopieren, Mats sofort freigeben) ---
    let rawPx = [], Md;
    {
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
      if (!(brightBorder < 0.5)) cv.bitwise_not(bin, bin);
      const m = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.morphologyEx(bin, bin, cv.MORPH_OPEN, m);
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, m);
      src.delete(); gray.delete(); m.delete();
      progress(10, 'Konturen suchen …'); await breathe(true);

      const contours = new cv.MatVector(); const hier = new cv.Mat();
      cv.findContours(bin, contours, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);
      bin.delete(); hier.delete();
      for (let i = 0; i < contours.size(); i++) { const c = contours.get(i); if (c.data32S.length >= 16) rawPx.push(Int32Array.from(c.data32S)); c.delete(); }
      contours.delete();

      // Homographie Bild-px -> Referenz-Ebene (mm, y nach unten)
      const q = orderQuad(pickPts.map(p => p.slice()));
      const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]]);
      const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
      const M = cv.getPerspectiveTransform(srcTri, dstTri);
      Md = M.data64F.slice();
      srcTri.delete(); dstTri.delete(); M.delete();
    }
    const T1 = performance.now();
    // Vorzeichen des Nenners im Blatt (Mitte) – Punkte "hinter dem Horizont" der Entzerrung sind unbrauchbar
    const den = (x, y) => Md[6] * x + Md[7] * y + Md[8];
    const qc = pickPts.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    const dSign = Math.sign(den(qc[0], qc[1])) || 1;
    const MAX_LEN = 20 * (W + H) + 2000; // Konturen, die nach Entzerrung absurd lang wären (Tischkanten am Bildrand …), überspringen

    // --- 2) Konturen filtern + in mm umrechnen ---
    progress(18, 'Konturen prüfen (' + rawPx.length + ') …'); await breathe(true);
    const inPoly = (pt, Q) => { let ins = false; for (let a = 0, b = Q.length - 1; a < Q.length; b = a++) { if (((Q[a][1] > pt[1]) !== (Q[b][1] > pt[1])) && (pt[0] < (Q[b][0] - Q[a][0]) * (pt[1] - Q[a][1]) / (Q[b][1] - Q[a][1]) + Q[a][0])) ins = !ins; } return ins; };
    // Kontur liegt im gewählten Bereich (Fenster/Lasso)? -> mind. 85 % ihrer Punkte innerhalb
    const inRegion = (d, n) => {
      if (!region) return true;
      const step = Math.max(1, Math.floor(n / 300)); let ins = 0, tot = 0;
      for (let j = 0; j < n; j += step) { tot++; if (inPoly([d[2 * j], d[2 * j + 1]], region)) ins++; }
      return ins >= 0.85 * tot;
    };
    const raw = [];
    let skippedFar = 0;
    for (let i = 0; i < rawPx.length; i++) {
      const d = rawPx[i], nPts = d.length / 2;
      if (!inRegion(d, nPts)) continue;
      const P = new Array(nPts); let bad = false, len = 0;
      for (let j = 0; j < nPts; j++) {
        const x = d[2 * j], y = d[2 * j + 1], dd = den(x, y);
        if (dd * dSign <= 1e-9) { bad = true; break; }
        P[j] = [(Md[0] * x + Md[1] * y + Md[2]) / dd, (Md[3] * x + Md[4] * y + Md[5]) / dd];
        if (j) { len += Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1]); if (len > MAX_LEN) { bad = true; break; } }
      }
      if (bad) { skippedFar++; continue; }
      // Fläche in mm² + Begrenzungsrechteck
      let area = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let j = 0; j < nPts; j++) { const a = P[j], b = P[(j + 1) % nPts]; area += a[0] * b[1] - b[0] * a[1]; if (a[0] < x0) x0 = a[0]; if (a[0] > x1) x1 = a[0]; if (a[1] < y0) y0 = a[1]; if (a[1] > y1) y1 = a[1]; }
      area = Math.abs(area) / 2;
      if (area < FP.minArea) continue;
      // Referenz-Blatt selbst? (bbox ~ 0..W, 0..H)
      if (Math.abs(x0) < 6 && Math.abs(y0) < 6 && Math.abs(x1 - W) < 6 && Math.abs(y1 - H) < 6) continue;
      raw.push({ P, outer: true, bb: [x0, y0, x1, y1], len });
      if ((i & 15) === 0) { progress(18 + 12 * i / rawPx.length); await breathe(); }
    }
    rawPx = null;

    // Außen/Innen über Verschachtelung bestimmen (nicht über OpenCV-Hierarchie:
    // dort ist das weiße A4-Blatt die äußere Ebene und die Schablone nur ein „Loch“ darin).
    // Schnelltest über Begrenzungsrechtecke, damit es auch bei vielen Konturen flott bleibt.
    progress(30, 'Außen- und Innenkonturen …'); await breathe(true);
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i], p0 = r.P[0]; let depth = 0;
      for (const o of raw) { if (o === r) continue; const b = o.bb; if (p0[0] < b[0] || p0[0] > b[2] || p0[1] < b[1] || p0[1] > b[3]) continue; if (inPoly(p0, o.P)) depth++; }
      r.outer = depth % 2 === 0;
      if ((i & 7) === 0) { progress(30 + 5 * i / raw.length); await breathe(); }
    }

    if (!raw.length && region) { alert('Im gewählten Bereich wurde keine Kontur gefunden. Bereich etwas größer ziehen (das Teil muss ganz drin liegen) oder „✕ Bereich löschen“.'); return; }
    if (!raw.length) { alert('Keine Kontur gefunden. Tipps: Schablone deutlich vom Untergrund abheben, A4‑Ecken genau setzen, gutes Licht.'); return; }

    // y nach oben spiegeln (DXF-Konvention), in den positiven Bereich schieben
    let maxY = -1e9, minX = 1e9;
    for (const r of raw) { minX = Math.min(minX, r.bb[0]); maxY = Math.max(maxY, r.bb[3]); }
    const MARGIN = 5;

    // --- 3) Linien + Bögen einpassen (teuerster Teil) – Fortschritt nach Konturlänge ---
    const totalLen = raw.reduce((s, r) => s + r.len, 0) || 1;
    let doneLen = 0;
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      progress(35 + 63 * doneLen / totalLen, 'Linien & Bögen einpassen … (' + (i + 1) + ' / ' + raw.length + ')');
      await breathe();
      const P = r.P.map(p => [p[0] - minX + MARGIN, (maxY - p[1]) + MARGIN]);
      const dense = G.densify(P, 0.5, true);
      const rs = resampleClosedSmooth(dense, FP.smooth);
      const els = G.fitContour(rs, FP.tol, FP.minr, FP.maxr, true);
      if (els && els.length) out.push({ els, outer: r.outer, closed: true, P: G.sampleChain(els) });
      doneLen += r.len;
    }
    progress(100, 'Fertig'); await breathe(true);
    console.log('Erkennung: OpenCV ' + Math.round(T1 - T0) + ' ms, gesamt ' + Math.round(performance.now() - T0) + ' ms, ' + raw.length + ' Konturen' + (skippedFar ? ', ' + skippedFar + ' außerhalb übersprungen' : ''));
    if (!out.length) { alert('Keine verwertbare Kontur.'); return; }
    result = out;
    showResult('Foto erkannt: ' + result.length + ' Kontur(en)' + (region ? ' im gewählten Bereich' : '') + '.');
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
    // Breite am umgebenden Kasten ausrichten (sonst wird rechts abgeschnitten) + Rand, damit Kanten sichtbar bleiben
    const boxW = cvr.parentElement ? cvr.parentElement.clientWidth : window.innerWidth - 28;
    const maxW = Math.max(120, Math.min(boxW, 740)), PAD = 8;
    const [x0, y0, x1, y1] = bbox(result);
    const wmm = Math.max(1, x1 - x0), hmm = Math.max(1, y1 - y0);
    const s = (maxW - 2 * PAD) / wmm;
    cvr.width = maxW; cvr.height = Math.max(120, Math.round(hmm * s) + 2 * PAD);
    cvr.style.width = maxW + 'px';
    ctxr.fillStyle = '#243244'; ctxr.fillRect(0, 0, cvr.width, cvr.height);
    const toS = p => [PAD + (p[0] - x0) * s, cvr.height - PAD - (p[1] - y0) * s];
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
    runBusy(async () => {
      const t0 = Date.now(); let done = 0;
      const todo = result.filter(k => k.els.length && k.els[0].t !== 'C');
      const work = result.map(k => ({ k, els: k.els, P: k.P })); // erst am Ende übernehmen (Abbrechen = nichts geändert)
      for (let i = 0; i < work.length; i++) {
        const w = work[i];
        if (!w.els.length || w.els[0].t === 'C') continue;
        progress(100 * done / Math.max(1, todo.length), 'Verschönern … (' + (done + 1) + ' / ' + todo.length + ')'); await breathe();
        try { const nb = G.beautifyContour(w.els, w.k.closed, smoothMm, R, FP); if (nb) { w.els = nb; w.P = G.sampleChain(nb); } } catch (e) { console.error(e); }
        done++;
      }
      progress(100, 'Fertig'); await breathe(true);
      for (const w of work) { w.k.els = w.els; w.k.P = w.P; }
      const rest = Math.max(0, 300 - (Date.now() - t0)); if (rest) await new Promise(r => setTimeout(r, rest));
      drawResult(); const inf = count(result);
      setStatus($('#res-status'), 'Verschönert (' + done + ' Konturen). ' + inf.lines + ' Geraden, ' + inf.arcs + ' Bögen, ' + inf.circles + ' Kreise.');
    }, 'Verschönern fehlgeschlagen:');
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

  // ---------- DXF teilen / in App öffnen (iOS/Android Teilen-Auswahl) ----------
  async function shareDxf() {
    if (!result.length) return;
    let out;
    try { out = G.makeDxf(result, { origin: 'll', mirror: $('#opt-mirror').checked }); }
    catch (e) { alert('DXF konnte nicht erstellt werden:\n' + e.message); return; }
    const name = 'FotoToDxf_' + Date.now() + '.dxf';
    try {
      const file = new File([out.dxf], name, { type: 'application/dxf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Foto to DXF', text: 'DXF aus Foto to DXF' });
        setStatus($('#res-status'), 'Geteilt – in der Auswahl „CADREADER“ (oder eine andere App) wählen.');
        return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; console.error(e); }
    // Rückfallebene: Download
    const blob = new Blob([out.dxf], { type: 'application/dxf' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    setStatus($('#res-status'), 'Teilen hier nicht verfügbar – DXF gespeichert. In „Dateien“ öffnen → Teilen → CADREADER.');
  }
  $('#btn-share').onclick = shareDxf;

  // =========================================================
  //  Live-Kamera (DXF Camera): Kanten live + auslösen -> Ecken
  // =========================================================
  const video = $('#cam-video'), camOv = $('#cam-ov');
  let camStream = null, camRAF = null, camFrame = 0;
  const eSmall = document.createElement('canvas'); const eCtx = eSmall.getContext('2d', { willReadFrequently: true });

  async function startLiveCam() {
    show('cam');
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      video.srcObject = camStream; await video.play();
      camLoop();
    } catch (e) {
      console.error(e);
      alert('Kamera konnte nicht gestartet werden:\n' + e.message + '\n\nHinweise: Die Seite muss über https:// laufen (GitHub Pages passt), und der Kamerazugriff muss erlaubt werden. In iOS Safari nutzen (nicht in einer anderen App‑Vorschau).');
      show('start');
    }
  }
  function stopCam() { if (camRAF) { cancelAnimationFrame(camRAF); camRAF = null; } if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; } if (video) video.srcObject = null; }

  function camLoop() {
    camRAF = requestAnimationFrame(camLoop);
    if (!video.videoWidth) return;
    const dispW = camOv.clientWidth, dispH = camOv.clientHeight || Math.round(dispW * video.videoHeight / video.videoWidth);
    if (camOv.width !== dispW || camOv.height !== dispH) { camOv.width = dispW; camOv.height = dispH; }
    const octx = camOv.getContext('2d');
    octx.clearRect(0, 0, camOv.width, camOv.height);
    if (!$('#cam-edges').checked) return;
    if ((camFrame++ & 1)) return;    // nur jedes 2. Bild rechnen (Tempo)
    const sw = 420, sh = Math.max(2, Math.round(video.videoHeight / video.videoWidth * sw));
    eSmall.width = sw; eSmall.height = sh;
    eCtx.drawImage(video, 0, 0, sw, sh);
    let d; try { d = eCtx.getImageData(0, 0, sw, sh).data; } catch (e) { return; }
    const g = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
    const eg = eCtx.createImageData(sw, sh), ed = eg.data;
    for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const gx = -g[i - sw - 1] - 2 * g[i - 1] - g[i + sw - 1] + g[i - sw + 1] + 2 * g[i + 1] + g[i + sw + 1];
      const gy = -g[i - sw - 1] - 2 * g[i - sw] - g[i - sw + 1] + g[i + sw - 1] + 2 * g[i + sw] + g[i + sw + 1];
      const o = 4 * i;
      if (Math.hypot(gx, gy) > 95) { ed[o] = 0; ed[o + 1] = 255; ed[o + 2] = 210; ed[o + 3] = 255; } else ed[o + 3] = 0;
    }
    eCtx.putImageData(eg, 0, 0);
    if ($('#cam-only').checked) { octx.fillStyle = '#0a0f16'; octx.fillRect(0, 0, camOv.width, camOv.height); }
    octx.imageSmoothingEnabled = false;
    octx.drawImage(eSmall, 0, 0, camOv.width, camOv.height);
  }
  $('#btn-livecam').onclick = startLiveCam;
  $('#cam-back').onclick = () => show('start');
  $('#cam-shot').onclick = () => {
    if (!video.videoWidth) { alert('Kamerabild noch nicht bereit – kurz warten.'); return; }
    const vw = video.videoWidth, vh = video.videoHeight, MAX = 2000, sc = Math.min(1, MAX / Math.max(vw, vh));
    imgCanvas = document.createElement('canvas'); imgCanvas.width = Math.round(vw * sc); imgCanvas.height = Math.round(vh * sc);
    imgCanvas.getContext('2d').drawImage(video, 0, 0, imgCanvas.width, imgCanvas.height);
    srcImg = imgCanvas; stopCam();
    pickPts = (cvReady() ? (autoDetectA4(imgCanvas) || []) : []);
    startCornerPick();
  };
})();
