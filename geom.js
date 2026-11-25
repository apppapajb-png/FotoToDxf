/* Foto to DXF – rechnerischer Kern (Linien/Bögen einpassen, Verschönern, SVG lesen, DXF schreiben)
   Portierung aus dem Windows-Tool "Schablone zu DXF". Läuft im Browser und unter Node.
   Elemente:
     {t:'L', a:[x,y], b:[x,y]}
     {t:'A', a:[x,y], b:[x,y], c:[x,y], r:Zahl, sw:Zahl}   sw>0 = gegen Uhrzeigersinn
     {t:'C', c:[x,y], r:Zahl}                               Vollkreis
   Punkte sind [x,y] in mm, y nach oben. */
(function (root) {
  'use strict';
  const T = 2 * Math.PI;

  // ---- kleine Vektor-Helfer ----
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, s) => [a[0] * s, a[1] * s];
  const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const norm = (a) => Math.hypot(a[0], a[1]);
  function wrap(x) { return ((x + Math.PI) % T + T) % T - Math.PI; }

  // 3x3 lineares Gleichungssystem lösen (für die Kreis-Ausgleichsrechnung)
  function solve3(M, v) {
    const a = M.map((r, i) => r.concat(v[i]));
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      if (Math.abs(a[p][c]) < 1e-12) return null;
      [a[c], a[p]] = [a[p], a[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = a[r][c] / a[c][c];
        for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
      }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
  }

  // algebraischer Kreis (Kasa) durch Punktwolke -> {c,r} oder null
  function circleFit(P) {
    const n = P.length;
    let mx = 0, my = 0;
    for (const p of P) { mx += p[0]; my += p[1]; }
    mx /= n; my /= n;
    let Sxx = 0, Sxy = 0, Syy = 0, Sx1 = 0, Sy1 = 0, S1 = n, Sxb = 0, Syb = 0, S1b = 0;
    for (const p of P) {
      const x = p[0] - mx, y = p[1] - my, bb = -(x * x + y * y);
      Sxx += x * x; Sxy += x * y; Syy += y * y; Sx1 += x; Sy1 += y;
      Sxb += x * bb; Syb += y * bb; S1b += bb;
    }
    const M = [[Sxx, Sxy, Sx1], [Sxy, Syy, Sy1], [Sx1, Sy1, S1]];
    const sol = solve3(M, [Sxb, Syb, S1b]);
    if (!sol) return null;
    const c = [mx - sol[0] / 2, my - sol[1] / 2];
    const r = Math.sqrt(Math.max(1e-12, (sol[0] * sol[0] + sol[1] * sol[1]) / 4 - sol[2]));
    return { c, r };
  }

  function lineDev(Q) {
    const A = Q[0], B = Q[Q.length - 1];
    const d = sub(B, A), L = norm(d);
    if (L < 1e-9) return Infinity;
    const nx = -d[1] / L, ny = d[0] / L;
    let m = 0;
    for (const p of Q) m = Math.max(m, Math.abs((p[0] - A[0]) * nx + (p[1] - A[1]) * ny));
    return m;
  }

  const MAX_SWEEP = 300 * Math.PI / 180;
  function arcFit(Q, minr, maxr) {
    const n = Q.length;
    if (n < 5) return null;
    const A = Q[0], B = Q[n - 1], ch = sub(B, A), L = norm(ch);
    if (L < 1e-6) return null;
    const Mid = mul(add(A, B), 0.5), u = [ch[0] / L, ch[1] / L], nrm = [-u[1], u[0]];
    const cf = circleFit(Q);
    if (!cf) return null;
    let t = (cf.c[0] - Mid[0]) * nrm[0] + (cf.c[1] - Mid[1]) * nrm[1];
    let C, r;
    for (let it = 0; it < 8; it++) {
      C = [Mid[0] + t * nrm[0], Mid[1] + t * nrm[1]];
      r = Math.hypot(L / 2, t);
      let Jr = 0, Jres = 0;
      for (const p of Q) {
        const vx = p[0] - C[0], vy = p[1] - C[1], dist = Math.hypot(vx, vy) + 1e-12;
        const res = dist - r;
        const j = -(vx * nrm[0] + vy * nrm[1]) / dist - t / r;
        Jr += j * j; Jres += j * res;
      }
      const dt = -Jres / (Jr + 1e-12);
      t += dt;
      if (Math.abs(dt) < 1e-7) break;
    }
    C = [Mid[0] + t * nrm[0], Mid[1] + t * nrm[1]];
    r = Math.hypot(L / 2, t);
    if (!(r >= minr && r <= maxr)) return null;
    let dev = 0;
    const ang = [];
    for (const p of Q) {
      const vx = p[0] - C[0], vy = p[1] - C[1];
      dev = Math.max(dev, Math.abs(Math.hypot(vx, vy) - r));
      ang.push(Math.atan2(vy, vx));
    }
    // unwrap
    for (let i = 1; i < ang.length; i++) {
      let d = ang[i] - ang[i - 1];
      while (d > Math.PI) { ang[i] -= T; d = ang[i] - ang[i - 1]; }
      while (d < -Math.PI) { ang[i] += T; d = ang[i] - ang[i - 1]; }
    }
    const sweep = ang[ang.length - 1] - ang[0];
    if (Math.abs(sweep) < 1e-6 || Math.abs(sweep) > MAX_SWEEP) return null;
    const sgn = Math.sign(sweep);
    for (let i = 1; i < ang.length; i++) if ((ang[i] - ang[i - 1]) * sgn < -1e-3) return null;
    return { dev, c: C, r, sw: sweep };
  }

  // größtes j in [jmin,jmax] mit ok(j); null wenn ok(jmin) falsch
  function grow(ok, jmin, jmax) {
    if (jmin > jmax || !ok(jmin)) return null;
    let good = jmin, step = 4, bad = null;
    for (;;) {
      const j = good + step;
      if (j > jmax) { if (good < jmax && ok(jmax)) return jmax; bad = good < jmax ? jmax : null; break; }
      if (ok(j)) { good = j; step *= 2; } else { bad = j; break; }
    }
    if (bad === null) return good;
    let lo = good, hi = bad;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ok(mid)) lo = mid; else hi = mid; }
    return lo;
  }

  // ---- Element-Helfer ----
  function elLen(e) {
    if (e.t === 'A') return e.r * Math.abs(e.sw);
    if (e.t === 'C') return T * e.r;
    return hyp(e.a, e.b);
  }
  function chordAng(e) { return Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]); }
  function tanStart(e) { return chordAng(e) - (e.t === 'A' ? e.sw / 2 : 0); }
  function tanEnd(e) { return chordAng(e) + (e.t === 'A' ? e.sw / 2 : 0); }

  function arcPoints(e, degStep) {
    const stepRad = (degStep || 3) * Math.PI / 180;
    const a0 = Math.atan2(e.a[1] - e.c[1], e.a[0] - e.c[0]);
    const n = Math.max(2, Math.ceil(Math.abs(e.sw) / stepRad));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const th = a0 + e.sw * i / n;
      pts.push([e.c[0] + e.r * Math.cos(th), e.c[1] + e.r * Math.sin(th)]);
    }
    pts[0] = e.a.slice(); pts[pts.length - 1] = e.b.slice();
    return pts;
  }
  function circlePoints(e) {
    const pts = [];
    for (let i = 0; i <= 72; i++) { const th = T * i / 72; pts.push([e.c[0] + e.r * Math.cos(th), e.c[1] + e.r * Math.sin(th)]); }
    return pts;
  }
  function elementPoints(e) {
    if (e.t === 'L') return [e.a.slice(), e.b.slice()];
    if (e.t === 'A') return arcPoints(e, 3);
    return circlePoints(e);
  }
  function sampleChain(els, step) {
    step = step || 0.5;
    const pts = [];
    for (const e of els) {
      if (e.t === 'L') {
        const nseg = Math.max(2, Math.floor(elLen(e) / step) + 1);
        for (let i = 0; i < nseg; i++) { const tt = i / nseg; pts.push([e.a[0] + tt * (e.b[0] - e.a[0]), e.a[1] + tt * (e.b[1] - e.a[1])]); }
      } else if (e.t === 'A') {
        const degStep = Math.max(0.2, (step / Math.max(e.r, 1e-3)) * 180 / Math.PI);
        const q = arcPoints(e, degStep); q.pop(); for (const p of q) pts.push(p);
      } else {
        for (const p of circlePoints(e)) pts.push(p);
      }
    }
    return pts.length ? pts : [];
  }

  // ---- offene / geschlossene Einpassung ----
  function fitOpen(P, tol, minr, maxr) {
    const n = P.length;
    if (n < 2) return [];
    const seg = (i, j) => P.slice(i, j + 1);
    const els = [];
    let i = 0;
    while (i < n - 1) {
      const jl0 = grow(j => lineDev(seg(i, j)) <= tol, i + 1, n - 1);
      const cache = {};
      const okArc = j => { const r = arcFit(seg(i, j), minr, maxr); cache[j] = r; return r && r.dev <= tol; };
      const ja = grow(okArc, i + 4, n - 1);
      const jl = jl0 === null ? i + 1 : jl0;
      if (ja !== null && ja > jl) {
        const r = cache[ja] || arcFit(seg(i, ja), minr, maxr);
        els.push({ t: 'A', a: P[i].slice(), b: P[ja].slice(), c: r.c, r: r.r, sw: r.sw });
        i = ja;
      } else {
        els.push({ t: 'L', a: P[i].slice(), b: P[jl].slice() });
        i = jl;
      }
    }
    return els;
  }

  function fitContour(P, tol, minr, maxr, circles) {
    let n = P.length;
    if (circles !== false && n >= 12) {
      const cf = circleFit(P);
      if (cf) {
        let dev = 0; for (const p of P) dev = Math.max(dev, Math.abs(hyp(p, cf.c) - cf.r));
        if (dev <= tol && cf.r >= minr && cf.r <= maxr) return [{ t: 'C', c: cf.c, r: cf.r }];
      }
    }
    // schärfste Ecke als Start
    const w = Math.max(2, Math.floor(n / 200));
    let s0 = 0, best = -1;
    for (let k = 0; k < n; k++) {
      const p = P[k], pm = P[(k - w + n) % n], pn = P[(k + w) % n];
      const a1 = Math.atan2(p[1] - pm[1], p[0] - pm[0]), a2 = Math.atan2(pn[1] - p[1], pn[0] - p[0]);
      const turn = Math.abs(wrap(a2 - a1));
      if (turn > best) { best = turn; s0 = k; }
    }
    let Pr = P.slice(s0).concat(P.slice(0, s0));

    function greedy(P) {
      const seg = (i, j) => { const o = []; for (let k = i; k <= j; k++) o.push(P[k % n]); return o; };
      const els = [], rng = [];
      let i = 0;
      while (i < n) {
        const iStart = i;
        const jl0 = grow(j => lineDev(seg(i, j)) <= tol, i + 1, n);
        const cache = {};
        const okArc = j => { const r = arcFit(seg(i, j), minr, maxr); cache[j] = r; return r && r.dev <= tol; };
        const ja = grow(okArc, i + 4, n);
        const jl = jl0 === null ? i + 1 : jl0;
        if (ja !== null && ja > jl) {
          const r = cache[ja] || arcFit(seg(i, ja), minr, maxr);
          els.push({ t: 'A', a: P[i % n].slice(), b: P[ja % n].slice(), c: r.c, r: r.r, sw: r.sw });
          i = ja;
        } else {
          els.push({ t: 'L', a: P[i % n].slice(), b: P[jl % n].slice() });
          i = jl;
        }
        rng.push([iStart, i]);
      }
      return { els, rng };
    }

    let g = greedy(Pr);
    if (g.els.length > 1) {
      const m = g.els.length;
      let kBest = 0, kv = -1;
      const kinks = [];
      for (let k = 0; k < m; k++) { const v = Math.abs(wrap(tanStart(g.els[k]) - tanEnd(g.els[(k - 1 + m) % m]))); kinks.push(v); if (v > kv) { kv = v; kBest = k; } }
      if (kv * 180 / Math.PI < 15) { let lb = -1; for (let k = 0; k < m; k++) { const l = elLen(g.els[k]); if (l > lb) { lb = l; kBest = k; } } }
      const s1 = g.rng[kBest][0] % n;
      if (s1 !== 0) { Pr = Pr.slice(s1).concat(Pr.slice(0, s1)); g = greedy(Pr); }
    }
    return g.els;
  }

  // ---- Neuabtasten / Glätten ----
  function densify(P, step, closed) {
    let Q = P;
    if (closed && hyp(P[0], P[P.length - 1]) > 1e-9) Q = P.concat([P[0]]);
    const d = [0]; let L = 0;
    for (let i = 1; i < Q.length; i++) { L += hyp(Q[i], Q[i - 1]); d.push(L); }
    if (L < 1e-9) return P;
    const nn = Math.max(8, Math.floor(L / step));
    const out = [];
    let j = 0;
    for (let i = 0; i <= nn; i++) {
      const s = L * i / nn;
      while (j < d.length - 2 && d[j + 1] < s) j++;
      const t = (s - d[j]) / Math.max(1e-12, d[j + 1] - d[j]);
      out.push([Q[j][0] + t * (Q[j + 1][0] - Q[j][0]), Q[j][1] + t * (Q[j + 1][1] - Q[j][1])]);
    }
    if (closed) out.pop();
    return out;
  }
  function resampleClosed(P, step) {
    const d = [0]; let L = 0;
    const Q = P.concat([P[0]]);
    for (let i = 1; i < Q.length; i++) { L += hyp(Q[i], Q[i - 1]); d.push(L); }
    const nn = Math.max(8, Math.round(L / step));
    const st = L / nn, out = [];
    let j = 0;
    for (let i = 0; i < nn; i++) {
      const s = st * i;
      while (j < d.length - 2 && d[j + 1] < s) j++;
      const t = (s - d[j]) / Math.max(1e-12, d[j + 1] - d[j]);
      out.push([Q[j][0] + t * (Q[j + 1][0] - Q[j][0]), Q[j][1] + t * (Q[j + 1][1] - Q[j][1])]);
    }
    return { P: out, step: st };
  }
  function smoothClosed(P, sigmaPts) {
    const n = P.length;
    const r = Math.max(1, Math.round(3 * sigmaPts));
    const k = [];
    let ks = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * (i / sigmaPts) ** 2); k.push(v); ks += v; }
    const out = [];
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0;
      for (let t = -r; t <= r; t++) { const p = P[(i + t + n * 10) % n], wgt = k[t + r] / ks; x += p[0] * wgt; y += p[1] * wgt; }
      out.push([x, y]);
    }
    return out;
  }

  // ---- Ecke abrunden (Fillet) zwischen zwei Geraden ----
  function filletLines(e1, e2, R) {
    if (e1.t !== 'L' || e2.t !== 'L') return null;
    const P = e1.b;
    const d1 = sub(e1.a, P), d2 = sub(e2.b, P);
    const l1 = norm(d1), l2 = norm(d2);
    if (l1 < 1e-6 || l2 < 1e-6) return null;
    const u1 = [d1[0] / l1, d1[1] / l1], u2 = [d2[0] / l2, d2[1] / l2];
    let ang = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    if (ang < 1e-3 || ang > Math.PI - 1e-3) return null;
    const tdist = R / Math.tan(ang / 2);
    if (tdist > l1 - 1e-6 || tdist > l2 - 1e-6) return null;
    const T1 = [P[0] + u1[0] * tdist, P[1] + u1[1] * tdist];
    const T2 = [P[0] + u2[0] * tdist, P[1] + u2[1] * tdist];
    const bis = [u1[0] + u2[0], u1[1] + u2[1]]; const bl = norm(bis);
    if (bl < 1e-9) return null;
    const cdist = R / Math.sin(ang / 2);
    const C = [P[0] + bis[0] / bl * cdist, P[1] + bis[1] / bl * cdist];
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    let a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    let sw = a2 - a1; while (sw > Math.PI) sw -= T; while (sw < -Math.PI) sw += T;
    const A = { t: 'L', a: e1.a.slice(), b: T1 };
    const arc = { t: 'A', a: T1.slice(), b: T2.slice(), c: C, r: R, sw };
    const B = { t: 'L', a: T2.slice(), b: e2.b.slice() };
    return [A, arc, B];
  }

  function beautifyContour(els, closed, smoothMm, R, fp, cornerDeg) {
    cornerDeg = cornerDeg || 22;
    if (!els.length || els[0].t === 'C') return null;
    let P = sampleChain(els, 0.5);
    if (!closed && els[els.length - 1].t !== 'C') P = P.concat([els[els.length - 1].b.slice()]);
    if (P.length < 6) return null;
    const tol = Math.max(0.02, fp.tol), minr = Math.max(0.2, fp.minr), maxr = fp.maxr;
    // Abtastschritt an Umfang koppeln
    let per = 0; const Pd = closed ? P.concat([P[0]]) : P;
    for (let i = 1; i < Pd.length; i++) per += hyp(Pd[i], Pd[i - 1]);
    const baseStep = Math.min(2.0, Math.max(0.5, per / 2500));
    let out;
    if (closed) {
      const rs = resampleClosed(P, baseStep);
      const sm = smoothClosed(rs.P, Math.max(0.3, smoothMm / rs.step));
      out = fitContour(sm, tol, minr, maxr, true);
    } else {
      const Pr = densify(P, baseStep, false);
      out = fitOpen(Pr, tol, minr, maxr);
    }
    if (!out || !out.length) return null;
    if (R > 0 && out.length >= 2) {
      const list = out.slice();
      const verts = [];
      for (let k = (closed ? 0 : 1); k < list.length; k++) verts.push(k);
      verts.sort((a, b) => b - a);
      for (const k0 of verts) {
        const m = list.length; if (k0 >= m) continue;
        const kp = (k0 - 1 + m) % m;
        const e1 = list[kp], e2 = list[k0];
        if (e1.t === 'L' && e2.t === 'L') {
          const kink = Math.abs(wrap(tanStart(e2) - tanEnd(e1))) * 180 / Math.PI;
          if (kink >= cornerDeg) {
            const res = filletLines(e1, e2, R);
            if (res) { if (kp < k0) list.splice(kp, 2, res[0], res[1], res[2]); else { list[kp] = res[0]; list[0] = res[2]; list.push(res[1]); } }
          }
        }
      }
      out = list;
    }
    return out;
  }

  // ===================== SVG lesen =====================
  const NUMRE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
  const LENUNIT = { mm: 1, cm: 10, 'in': 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: null, '': null };
  function svgLength(s) { if (!s) return [null, '']; s = s.trim(); const m = s.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/); if (!m) return [null, '']; return [parseFloat(m[0]), s.slice(m.index + m[0].length).trim().toLowerCase()]; }
  function floats(s) { return (s ? s.match(NUMRE) || [] : []).map(parseFloat); }
  const matId = () => [1, 0, 0, 1, 0, 0];
  function matMul(m, n) { return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; }
  function matApply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  function parseTransform(s) {
    let m = matId(); if (!s) return m;
    const re = /(\w+)\s*\(([^)]*)\)/g; let mt;
    while ((mt = re.exec(s))) {
      const v = floats(mt[2]); let t = null;
      switch (mt[1]) {
        case 'matrix': if (v.length === 6) t = v.slice(); break;
        case 'translate': t = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
        case 'scale': t = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0]; break;
        case 'rotate': { const a = (v[0] || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); if (v.length >= 3) t = matMul([1, 0, 0, 1, v[1], v[2]], matMul([ca, sa, -sa, ca, 0, 0], [1, 0, 0, 1, -v[1], -v[2]])); else t = [ca, sa, -sa, ca, 0, 0]; break; }
        case 'skewX': t = [1, 0, Math.tan((v[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
        case 'skewY': t = [1, Math.tan((v[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break;
      }
      if (t) m = matMul(m, t);
    }
    return m;
  }
  function flattenCubic(p0, p1, p2, p3, tol, out, depth) {
    depth = depth || 0;
    if (depth > 18) { out.push(p3); return; }
    const dx = p3[0] - p0[0], dy = p3[1] - p0[1], L = Math.hypot(dx, dy) + 1e-12;
    const d1 = Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / L;
    const d2 = Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) / L;
    if (d1 + d2 <= tol) { out.push(p3); return; }
    const p01 = mul(add(p0, p1), 0.5), p12 = mul(add(p1, p2), 0.5), p23 = mul(add(p2, p3), 0.5);
    const a = mul(add(p01, p12), 0.5), b = mul(add(p12, p23), 0.5), mid = mul(add(a, b), 0.5);
    flattenCubic(p0, p01, a, mid, tol, out, depth + 1);
    flattenCubic(mid, b, p23, p3, tol, out, depth + 1);
  }
  function flattenQuad(p0, p1, p2, tol, out) {
    const c1 = [p0[0] + 2 / 3 * (p1[0] - p0[0]), p0[1] + 2 / 3 * (p1[1] - p0[1])];
    const c2 = [p2[0] + 2 / 3 * (p1[0] - p2[0]), p2[1] + 2 / 3 * (p1[1] - p2[1])];
    flattenCubic(p0, c1, c2, p2, tol, out);
  }
  function svgArc(p0, rx, ry, phiDeg, laf, sf, p1, tol, out) {
    if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) { out.push(p1); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (phiDeg % 360) * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx2 = (p0[0] - p1[0]) / 2, dy2 = (p0[1] - p1[1]) / 2;
    const x1p = cp * dx2 + sp * dy2, y1p = -sp * dx2 + cp * dy2;
    let lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    let co = den > 0 ? Math.sqrt(Math.max(0, num / den)) : 0;
    if (laf === sf) co = -co;
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const cx = cp * cxp - sp * cyp + (p0[0] + p1[0]) / 2, cy = sp * cxp + cp * cyp + (p0[1] + p1[1]) / 2;
    const angf = (ux, uy, vx, vy) => { const d = Math.hypot(ux, uy) * Math.hypot(vx, vy); let a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (d + 1e-12)))); if (ux * vy - uy * vx < 0) a = -a; return a; };
    const th0 = angf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dth = angf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sf && dth > 0) dth -= T; else if (sf && dth < 0) dth += T;
    let n = Math.max(6, Math.min(400, Math.ceil(Math.abs(dth) / (2 * Math.acos(Math.max(0, 1 - tol / Math.max(rx, ry, 1e-6)))))));
    if (!isFinite(n)) n = 24;
    for (let i = 1; i <= n; i++) {
      const th = th0 + dth * i / n;
      out.push([cp * rx * Math.cos(th) - sp * ry * Math.sin(th) + cx, sp * rx * Math.cos(th) + cp * ry * Math.sin(th) + cy]);
    }
  }
  function parsePathD(d, tol) {
    const toks = (d || '').match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    let i = 0; const subs = []; let segs = []; let cur = [0, 0], start = [0, 0], cmd = null, pc2 = null, pq1 = null;
    const num = () => parseFloat(toks[i++]);
    const flat = (fn, args) => { const out = [cur]; fn.apply(null, args.concat([out])); return out; };
    while (i < toks.length) {
      if (/[MmLlHhVvCcSsQqTtAaZz]/.test(toks[i])) { cmd = toks[i]; i++; }
      if (cmd === null) { i++; continue; }
      const rel = cmd >= 'a', C = cmd.toUpperCase();
      if (C === 'M') { let x = num(), y = num(); if (rel && segs.length) { x += cur[0]; y += cur[1]; } if (segs.length) { subs.push([segs, false]); segs = []; } cur = [x, y]; start = cur.slice(); cmd = rel ? 'l' : 'L'; pc2 = pq1 = null; }
      else if (C === 'L') { let x = num(), y = num(); if (rel) { x += cur[0]; y += cur[1]; } segs.push(['L', cur, [x, y]]); cur = [x, y]; pc2 = pq1 = null; }
      else if (C === 'H') { let x = num(); if (rel) x += cur[0]; segs.push(['L', cur, [x, cur[1]]]); cur = [x, cur[1]]; pc2 = pq1 = null; }
      else if (C === 'V') { let y = num(); if (rel) y += cur[1]; segs.push(['L', cur, [cur[0], y]]); cur = [cur[0], y]; pc2 = pq1 = null; }
      else if (C === 'C') { let c1 = [num(), num()], c2 = [num(), num()], p = [num(), num()]; if (rel) { c1 = add(c1, cur); c2 = add(c2, cur); p = add(p, cur); } segs.push(['F', flat(flattenCubic, [cur, c1, c2, p, tol])]); cur = p; pc2 = c2; pq1 = null; }
      else if (C === 'S') { let c2 = [num(), num()], p = [num(), num()]; if (rel) { c2 = add(c2, cur); p = add(p, cur); } const c1 = pc2 ? [2 * cur[0] - pc2[0], 2 * cur[1] - pc2[1]] : cur; segs.push(['F', flat(flattenCubic, [cur, c1, c2, p, tol])]); cur = p; pc2 = c2; pq1 = null; }
      else if (C === 'Q') { let q1 = [num(), num()], p = [num(), num()]; if (rel) { q1 = add(q1, cur); p = add(p, cur); } segs.push(['F', flat(flattenQuad, [cur, q1, p, tol])]); cur = p; pq1 = q1; pc2 = null; }
      else if (C === 'T') { let p = [num(), num()]; if (rel) p = add(p, cur); const q1 = pq1 ? [2 * cur[0] - pq1[0], 2 * cur[1] - pq1[1]] : cur; segs.push(['F', flat(flattenQuad, [cur, q1, p, tol])]); cur = p; pq1 = q1; pc2 = null; }
      else if (C === 'A') { const rx = num(), ry = num(), rot = num(), laf = num() | 0, sf = num() | 0; let p = [num(), num()]; if (rel) p = add(p, cur); segs.push(['F', flat(svgArc, [cur, rx, ry, rot, laf, sf, p, tol])]); cur = p; pc2 = pq1 = null; }
      else if (C === 'Z') { if (hyp(cur, start) > 1e-9) segs.push(['L', cur, start.slice()]); if (segs.length) { subs.push([segs, true]); segs = []; } cur = start.slice(); pc2 = pq1 = null; }
      else i++;
    }
    if (segs.length) subs.push([segs, false]);
    return subs;
  }
  function shapeSubpaths(tag, at, tol) {
    const g = (k, d) => parseFloat(at[k] != null ? at[k] : (d || 0)) || 0;
    const lines = pts => { const o = []; for (let k = 0; k < pts.length - 1; k++) o.push(['L', pts[k], pts[k + 1]]); return o; };
    if (tag === 'rect') { const x = g('x'), y = g('y'), w = g('width'), h = g('height'); if (w <= 0 || h <= 0) return []; return [[lines([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]), true]]; }
    if (tag === 'circle') { const cx = g('cx'), cy = g('cy'), r = g('r'); if (r <= 0) return []; const n = Math.min(400, Math.max(32, Math.ceil(T * r / Math.max(tol, 1e-3)))); const p = []; for (let k = 0; k <= n; k++) p.push([cx + r * Math.cos(T * k / n), cy + r * Math.sin(T * k / n)]); return [[[['F', p]], true]]; }
    if (tag === 'ellipse') { const cx = g('cx'), cy = g('cy'), rx = g('rx'), ry = g('ry'); if (rx <= 0 || ry <= 0) return []; const n = Math.min(400, Math.max(32, Math.ceil(T * Math.max(rx, ry) / Math.max(tol, 1e-3)))); const p = []; for (let k = 0; k <= n; k++) p.push([cx + rx * Math.cos(T * k / n), cy + ry * Math.sin(T * k / n)]); return [[[['F', p]], true]]; }
    if (tag === 'line') return [[[['L', [g('x1'), g('y1')], [g('x2'), g('y2')]]], false]];
    if (tag === 'polyline' || tag === 'polygon') { const v = floats(at.points); const pts = []; for (let k = 0; k < v.length - 1; k += 2) pts.push([v[k], v[k + 1]]); if (pts.length < 2) return []; if (tag === 'polygon') { pts.push(pts[0]); return [[lines(pts), true]]; } return [[lines(pts), false]]; }
    return [];
  }
  function buildElements(segs, closed, tol, minr, maxr) {
    if (closed && segs.every(s => s[0] === 'F')) {
      let pts = []; for (const s of segs) pts = pts.concat(s[1]);
      const P = densify(pts, 0.5, true);
      return fitContour(P, tol, minr, maxr, true);
    }
    const els = []; let i = 0;
    while (i < segs.length) {
      if (segs[i][0] === 'L') { const a = segs[i][1], b = segs[i][2]; if (hyp(a, b) > 1e-6) els.push({ t: 'L', a: a.slice(), b: b.slice() }); i++; }
      else {
        let pts = [];
        while (i < segs.length && segs[i][0] === 'F') { pts = pts.concat(segs[i][1]); i++; }
        const P = densify(pts, 0.5, false);
        if (P.length < 2) continue;
        if (lineDev(P) <= tol) els.push({ t: 'L', a: P[0].slice(), b: P[P.length - 1].slice() });
        else { const af = arcFit(P, minr, maxr); if (af && af.dev <= tol) els.push({ t: 'A', a: P[0].slice(), b: P[P.length - 1].slice(), c: af.c, r: af.r, sw: af.sw }); else for (const e of fitOpen(P, tol, minr, maxr)) els.push(e); }
      }
    }
    return els;
  }
  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }
  // DOMParser im Browser, in Node ein einfacher Fallback-Parser (nur für Tests)
  function parseXML(txt) {
    if (typeof DOMParser !== 'undefined') return new DOMParser().parseFromString(txt, 'image/svg+xml').documentElement;
    return nodeParseXML(txt);
  }
  function svgToContours(txt, fp) {
    const root = parseXML(txt);
    const vb = attr(root, 'viewBox');
    const [wv, wu] = svgLength(attr(root, 'width'));
    let scaleKnown = false, mmPerUser = 25.4 / 96;
    if (vb) { const p = floats(vb); const vbw = p.length >= 4 ? p[2] : null; if (vbw && wv && LENUNIT[wu]) { mmPerUser = wv * LENUNIT[wu] / vbw; scaleKnown = true; } }
    else if (wv && LENUNIT[wu]) { mmPerUser = LENUNIT[wu]; scaleKnown = true; }
    const raw = [];
    (function walk(el, M) {
      M = matMul(M, parseTransform(attr(el, 'transform')));
      if (attr(el, 'display') === 'none') return;
      const tg = tagName(el); let subs = [];
      if (tg === 'path') subs = parsePathD(attr(el, 'd'), 0.15);
      else if (['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(tg)) subs = shapeSubpaths(tg, attrs(el), 0.15);
      for (const [segs, closed] of subs) {
        const ts = segs.map(s => s[0] === 'L' ? ['L', matApply(M, s[1][0], s[1][1]), matApply(M, s[2][0], s[2][1])] : ['F', s[1].map(p => matApply(M, p[0], p[1]))]);
        raw.push([ts, closed]);
      }
      for (const ch of children(el)) walk(ch, M);
    })(root, matId());
    if (!raw.length) return { contours: [], width_mm: 0, height_mm: 0, scale_known: scaleKnown, note: 'Keine Pfade/Formen gefunden.' };
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    const eachPt = segs => { const o = []; for (const s of segs) { if (s[0] === 'L') { o.push(s[1]); o.push(s[2]); } else for (const p of s[1]) o.push(p); } return o; };
    for (const [segs] of raw) for (const p of eachPt(segs)) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
    const MARGIN = 5, tol = Math.max(0.02, fp.tol), minr = Math.max(0.2, fp.minr), maxr = fp.maxr;
    const toMM = p => [(p[0] - minx) * mmPerUser + MARGIN, (maxy - p[1]) * mmPerUser + MARGIN];
    const contours = [];
    for (const [segs, closed] of raw) {
      const mm = segs.map(s => s[0] === 'L' ? ['L', toMM(s[1]), toMM(s[2])] : ['F', s[1].map(toMM)]);
      const els = buildElements(mm, closed, tol, minr, maxr);
      if (els && els.length) contours.push({ els, closed, outer: true, drawn: true, P: sampleChain(els) });
    }
    const closedPolys = contours.filter(c => c.closed && c.P.length >= 3);
    for (const c of contours) {
      if (!c.closed || c.P.length < 3) continue;
      let cx = 0, cy = 0; for (const p of c.P) { cx += p[0]; cy += p[1]; } cx /= c.P.length; cy /= c.P.length;
      for (const o of closedPolys) { if (o === c) continue; if (pointInPoly([cx, cy], o.P)) { c.outer = false; break; } }
    }
    return { contours, width_mm: (maxx - minx) * mmPerUser, height_mm: (maxy - miny) * mmPerUser, scale_known: scaleKnown, mm_per_user: mmPerUser, note: scaleKnown ? '' : 'SVG ohne echte Größe – 96 dpi angenommen, bitte Breite prüfen.' };
  }
  // XML-Zugriff (Browser-DOM oder Node-Fallback)
  function attr(el, k) { return el.getAttribute ? el.getAttribute(k) : (el.attrs ? el.attrs[k] : null); }
  function attrs(el) { if (el.attrs) return el.attrs; const o = {}; if (el.attributes) for (const a of el.attributes) o[a.name] = a.value; return o; }
  function tagName(el) { const t = el.tagName || el.tag || ''; return t.split(':').pop().toLowerCase(); }
  function children(el) { if (el.kids) return el.kids; return el.children ? Array.from(el.children) : []; }

  // ===================== DXF R12 schreiben =====================
  function signedArea(P) { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
  function chainPoints(els) { let pts = []; for (const e of els) pts = pts.concat(elementPoints(e)); return pts; }
  function reverseChain(els) {
    const out = [];
    for (let i = els.length - 1; i >= 0; i--) { const e = els[i]; if (e.t === 'L') out.push({ t: 'L', a: e.b.slice(), b: e.a.slice() }); else if (e.t === 'A') out.push({ t: 'A', a: e.b.slice(), b: e.a.slice(), c: e.c.slice(), r: e.r, sw: -e.sw }); else out.push(e); }
    return out;
  }
  const bulge = sw => Math.tan(sw / 4);
  function makeDxf(contours, opt) {
    opt = opt || {};
    const mirror = !!opt.mirror, sx = mirror ? -1 : 1;
    let chains = [];
    for (const c of contours) {
      if (!c.els.length) continue;
      const els = c.els.map(e => { if (e.t === 'L') return { t: 'L', a: [sx * e.a[0], e.a[1]], b: [sx * e.b[0], e.b[1]] }; if (e.t === 'A') return { t: 'A', a: [sx * e.a[0], e.a[1]], b: [sx * e.b[0], e.b[1]], c: [sx * e.c[0], e.c[1]], r: e.r, sw: mirror ? -e.sw : e.sw }; return { t: 'C', c: [sx * e.c[0], e.c[1]], r: e.r }; });
      chains.push({ els, outer: c.outer !== false, closed: c.closed !== false });
    }
    if (!chains.length) throw new Error('Keine Kontur vorhanden.');
    for (const ch of chains) {
      if (ch.closed && !(ch.els.length === 1 && ch.els[0].t === 'C')) {
        const a = signedArea(chainPoints(ch.els));
        if ((ch.outer && a < 0) || (!ch.outer && a > 0)) ch.els = reverseChain(ch.els);
      }
    }
    let allp = []; for (const ch of chains) allp = allp.concat(chainPoints(ch.els));
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const p of allp) { mnx = Math.min(mnx, p[0]); mny = Math.min(mny, p[1]); mxx = Math.max(mxx, p[0]); mxy = Math.max(mxy, p[1]); }
    const org = opt.origin || 'll';
    let o = [mnx, mny];
    if (org === 'center') o = [(mnx + mxx) / 2, (mny + mxy) / 2];
    for (const ch of chains) for (const e of ch.els) { e.a && (e.a = sub(e.a, o)); e.b && (e.b = sub(e.b, o)); e.c && (e.c = sub(e.c, o)); }
    mnx -= o[0]; mny -= o[1]; mxx -= o[0]; mxy -= o[1];
    const out = [];
    const g = (code, val) => { out.push(String(code)); out.push(typeof val === 'string' ? val : val.toFixed(4)); };
    const gi = (code, val) => { out.push(String(code)); out.push(String(Math.round(val))); };
    const lo = opt.layer_out || 'AUSSENKONTUR', li = opt.layer_in || 'INNENKONTUR';
    g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); gi(70, 4);
    g(9, '$EXTMIN'); g(10, mnx); g(20, mny); g(30, 0); g(9, '$EXTMAX'); g(10, mxx); g(20, mxy); g(30, 0); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LTYPE'); gi(70, 1); g(0, 'LTYPE'); g(2, 'CONTINUOUS'); gi(70, 0); g(3, 'Solid line'); gi(72, 65); gi(73, 0); g(40, 0); g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); gi(70, 3);
    for (const [name, col] of [['0', 7], [lo, 1], [li, 5]]) { g(0, 'LAYER'); g(2, name); gi(70, 0); gi(62, col); g(6, 'CONTINUOUS'); }
    g(0, 'ENDTAB'); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    let nl = 0, na = 0, nc = 0;
    for (const ch of chains) {
      const lay = ch.outer ? lo : li;
      g(0, 'POLYLINE'); g(8, lay); gi(66, 1); g(10, 0); g(20, 0); g(30, 0); gi(70, ch.closed ? 1 : 0);
      if (ch.els.length === 1 && ch.els[0].t === 'C') {
        const e = ch.els[0], b = ch.outer ? 1 : -1;
        for (const p of [[e.c[0] + e.r, e.c[1]], [e.c[0] - e.r, e.c[1]]]) { g(0, 'VERTEX'); g(8, lay); g(10, p[0]); g(20, p[1]); g(30, 0); g(42, b); }
        nc++;
      } else {
        for (const e of ch.els) { g(0, 'VERTEX'); g(8, lay); g(10, e.a[0]); g(20, e.a[1]); g(30, 0); if (e.t === 'A') { g(42, bulge(e.sw)); na++; } else nl++; }
        if (!ch.closed) { const last = ch.els[ch.els.length - 1]; g(0, 'VERTEX'); g(8, lay); g(10, last.b[0]); g(20, last.b[1]); g(30, 0); }
      }
      g(0, 'SEQEND'); g(8, lay);
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    return { dxf: out.join('\r\n') + '\r\n', info: { lines: nl, arcs: na, circles: nc, contours: chains.length, width: mxx - mnx, height: mxy - mny } };
  }

  // ---- winziger XML-Parser nur für Node-Tests ----
  function nodeParseXML(txt) {
    txt = txt.replace(/<\?[^?]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    let pos = 0;
    function parseNode() {
      const m = /<([\w:]+)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g; m.lastIndex = pos;
      const open = m.exec(txt); if (!open) return null;
      pos = m.lastIndex;
      const node = { tag: open[1], attrs: {}, kids: [] };
      const ar = /([\w:-]+)\s*=\s*"([^"]*)"/g; let a;
      while ((a = ar.exec(open[2]))) node.attrs[a[1]] = a[2];
      if (open[3] === '/') return node;
      for (;;) {
        const closeIdx = txt.indexOf('</' + node.tag, pos);
        const nextOpen = txt.indexOf('<', pos);
        if (nextOpen === closeIdx) { pos = txt.indexOf('>', closeIdx) + 1; break; }
        const kid = parseNode(); if (!kid) break; node.kids.push(kid);
      }
      return node;
    }
    return parseNode();
  }

  const api = { lineDev, arcFit, fitContour, fitOpen, sampleChain, elementPoints, elLen, beautifyContour, densify, svgToContours, makeDxf, reverseChain, signedArea, chainPoints };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Geom = api;
})(typeof window !== 'undefined' ? window : globalThis);
