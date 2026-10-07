// ===== Interface =====
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const catName = k => CATS[CATIDX[k]].name;
const isReject = k => CATS[CATIDX[k]].reject;
const pct = v => (v * 100).toFixed(0) + '%';
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmt = v => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
const rnd = () => (Math.random() * 2 ** 31) >>> 0;
const decPill = k => isReject(k) ? '<span class="pill reject">Reject</span>' : '<span class="pill keep">Keep</span>';
const catChip = k => `<span class="chip" style="background:var(--c-${k})"></span>`;

const CATINFO = {
  neural: {
    desc: 'Captures brain activity. When ICA is run on enough full-rank data, several components compellingly isolate neural sources. No single property is diagnostic on its own: the evidence is spread across topography, time course and spectrum.',
    props: ['Smooth, regular topography, well modelled by one or two dipoles', 'Often among the components explaining the most variance', 'Spectral peak in a physiological band: posterior alpha (8–12 Hz), central beta (15–30 Hz), frontal theta (~5 Hz), delta (1–4 Hz)', 'Evoked response to stimuli', 'Low artifact measures'],
    confuse: ['Components with heavy frontal weights can look like blinks (Fig. 8): check for the polarity reversal below the eyes', 'Focal but smooth components can look like a bad channel (Fig. 5E)', 'Gamma oscillations (>40 Hz) overlap with the muscle band'],
    auto: 'No tool flags a component as “neural”; the risk is that it gets flagged as an artifact. In the paper’s test data, ADJUST and FASTER mistook several frontal neural components for blinks.'
  },
  blink: {
    desc: 'The easiest type to identify. Blinks produce artifacts of extreme amplitude, so these components usually rank among the first dozen.',
    props: ['Topography essentially flat except at a few frontal electrodes and the EOG channels', 'If the infraorbital EOG channels are rendered on the map, an abrupt polarity reversal at the frontmost sites', 'Large, abrupt deflections on an otherwise near-zero signal', 'No peak in physiological bands', 'High correlation with the vertical EOG'],
    confuse: ['Neural components with frontal weight and no polarity reversal (Figs. 3H and 8)', 'Vertical saccades: same topography, but the time course shows steps'],
    auto: 'SASICA correlates the component with the difference between two vertical EOG channels (4 SD threshold). ADJUST combines SAD, SVD and temporal kurtosis; FASTER uses the maximum correlation with any EOG channel. With a single EOG electrode under one eye, correlation-based detection gets worse.'
  },
  saccade: {
    desc: 'Capture eye movements. In tasks with a saccade on almost every trial there can be several such components with similar topographies (Fig. 9).',
    props: ['Horizontal saccades: maximal at anterior electrodes with opposite polarity on each side', 'Vertical saccades: topography similar to blinks', 'Step-like variations in the time course', 'No peak in physiological bands', 'High correlation with the horizontal (or vertical) EOG'],
    confuse: ['Ambiguous components that correlate with one EOG channel but load on central channels (Fig. 3I): without a polarity reversal at the canthi they are not ocular', 'Brain potentials associated with saccades may be of interest and should not be removed without thought'],
    auto: 'SASICA and FASTER rely on correlation with the EOG. ADJUST does not need EOG: it combines maximum epoch variance (MEV) with the spatial difference between lateral regions (SED). Without several EOG channels around the eyes, ADJUST detected saccades best.'
  },
  muscle: {
    desc: 'Tonic activity of neck, jaw and face muscles produces a stereotypical pattern at electrodes on the edge of the cap. It can come from posture, yawning or swallowing.',
    props: ['Very focal topography over a local group of edge electrodes (sometimes with opposite polarity)', 'Steady noise that does not follow task events: no ERP', 'Amplitude changes across trials: it builds up or dissipates as the participant shifts posture', 'High power above 20 Hz', 'Low autocorrelation'],
    confuse: ['Peripheral focal components without steady noise (Fig. 4E)', 'Mixtures with a few high-amplitude events (Fig. 4F): the experts classified these as rare events', 'Components capturing neural gamma'],
    auto: 'SASICA uses low autocorrelation at 20 ms. FASTER uses the median gradient and the Hurst exponent. ADJUST and CORRMAP do not look for muscle. In the paper, autocorrelation caught 43% of muscle components.'
  },
  badchan: {
    desc: 'A poorly connected (high-impedance) electrode with large amplitudes, uncorrelated with the other channels, is readily isolated by ICA in a single component.',
    props: ['Focal topography restricted to one electrode', 'Noisy time course reflecting the bad connection', 'Very high correlation with the channel marked as bad'],
    confuse: ['Focal, smooth components with an evoked response (Fig. 5E): these are neural', 'A bad channel active only during a few trials (Fig. 5F) overlaps with the rare event category'],
    auto: 'SASICA: focal topography (FocCh) and correlation with a designated bad channel. FASTER: spatial kurtosis. ADJUST: generic discontinuities (GDSF). All tools detected less than half of these in the training data.'
  },
  rare: {
    desc: 'A few high-amplitude events, for example when the participant moves or touches the cap. This is the category with the least agreement between observers: users identified only 34%.',
    props: ['A few high-amplitude events in an otherwise almost flat time course', 'If the event happened at one electrode, focal topography (it also qualifies as a bad channel)', 'If it affected many electrodes, a less predictable topography', 'Very high focal trial activity and kurtosis'],
    confuse: ['Bad channel: decide by whether the noise is present in every trial or only a few', 'Mixtures of muscle noise and brief events'],
    auto: 'SASICA: focal trial activity (FocTr). ADJUST: GDSF and MEV. FASTER: spatial kurtosis. Alternative strategy from the paper: reject the affected trials and recompute the ICA.'
  },
  other: {
    desc: 'Many components, often the majority, do not fit a single category: they mix signals, and many contain evoked responses. The experts used this category when no consensus could be reached.',
    props: ['Spread-out or irregular topography with several poles', 'Mixture of noise and evoked activity', 'No property points to a specific artifact type'],
    confuse: ['Muscle, if the topography is focal and peripheral (Fig. 4E)', 'Bad channel, if the topography is focal'],
    auto: 'The paper advises against rejecting these components systematically, and against filtering by dipole residual variance (>15%): spread-out, synchronous neural populations are not well modelled by a dipole.'
  }
};

// ---------- Storage ----------
const STORE_KEY = 'ica-trainer-v1';
function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.conf) && s.conf.length === 7) return { conf: s.conf, runs: s.runs || [] };
  } catch (e) { }
  return { conf: Array.from({ length: 7 }, () => Array(7).fill(0)), runs: [] };
}
function saveStats() { try { localStorage.setItem(STORE_KEY, JSON.stringify(ST)); } catch (e) { } }
const ST = loadStats();

// Reference thresholds (fixed simulated dataset) for the Learn and Practice modes
const REF = genDataset(777);
const REFTHR = REF.thr;

// ---------- Drawing ----------
const STOPS = [[-1, [33, 102, 172]], [-0.5, [103, 169, 207]], [0, [247, 247, 247]], [0.5, [239, 138, 98]], [1, [178, 24, 43]]];
function cmap(v) {
  v = Math.max(-1, Math.min(1, v));
  for (let i = 0; i < 4; i++) {
    const [a, ca] = STOPS[i], [b, cb] = STOPS[i + 1];
    if (v <= b) { const t = (v - a) / (b - a); return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]; }
  }
  return STOPS[4][1];
}
function setupCanvas(cv, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
function topoImage(c, showEOG) {
  c._t = c._t || {};
  const key = showEOG ? 'e' : 'n';
  if (c._t[key]) return c._t[key];
  const N = 64, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N);
  const px = [], py = [], pv = [];
  for (let i = 0; i < NCH; i++) { px.push(CH[i].x); py.push(CH[i].y); pv.push(c.w[i]); }
  if (showEOG) for (let j = 0; j < 4; j++) { px.push(EOGPOS[j].x); py.push(EOGPOS[j].y); pv.push(c.we[j]); }
  for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    const x = ((ix + 0.5) / N * 2 - 1) * HEAD, y = (1 - (iy + 0.5) / N * 2) * HEAD;
    if (x * x + y * y > HEAD * HEAD * 1.02) continue;
    let sw = 0, sv = 0;
    for (let i = 0; i < px.length; i++) {
      const d2 = (x - px[i]) ** 2 + (y - py[i]) ** 2 + 1e-4, w = 1 / (d2 * Math.sqrt(d2));
      sw += w; sv += w * pv[i];
    }
    const col = cmap(sv / sw), o = (iy * N + ix) * 4;
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (c._t[key] = cv);
}
function drawTopo(cv, c, showEOG, dots) {
  const W = cv.clientWidth || 72, ctx = setupCanvas(cv, W, W);
  const cx = W / 2, cy = W / 2 + W * 0.035, r = W * 0.405, ink = tok('--ink');
  ctx.clearRect(0, 0, W, W);
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.clip();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(topoImage(c, showEOG), cx - r, cy - r, 2 * r, 2 * r);
  ctx.restore();
  ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, W / 110);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - r * 0.13, cy - r * 0.99); ctx.lineTo(cx, cy - r * 1.14); ctx.lineTo(cx + r * 0.13, cy - r * 0.99); ctx.stroke();
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * r * 1.04, cy, r * 0.06, r * 0.17, 0, 0, 2 * Math.PI); ctx.stroke(); }
  if (dots) {
    ctx.fillStyle = ink; ctx.globalAlpha = 0.5;
    for (const p of CH) { ctx.beginPath(); ctx.arc(cx + p.x / HEAD * r, cy - p.y / HEAD * r, Math.max(0.8, W / 220), 0, 2 * Math.PI); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (showEOG) {
      ctx.lineWidth = 1.2;
      for (const p of EOGPOS) { const s = W / 70; ctx.strokeRect(cx + p.x / HEAD * r - s, cy - p.y / HEAD * r - s, 2 * s, 2 * s); }
    }
  }
}
function erpImage(c) {
  if (c._erp) return c._erp;
  const sm = new Float32Array(NTR * NT), half = 2;
  for (let k = 0; k < NTR; k++) for (let t = 0; t < NT; t++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(NTR - 1, k + half); j++) { s += c.tc[j * NT + t]; n++; }
    sm[k * NT + t] = s / n;
  }
  const abs = Array.from(sm, Math.abs).sort((a, b) => a - b);
  const lim = abs[Math.floor(abs.length * 0.985)] || 1;
  const cv = document.createElement('canvas'); cv.width = NT; cv.height = NTR;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(NT, NTR);
  for (let k = 0; k < NTR; k++) for (let t = 0; t < NT; t++) {
    const col = cmap(sm[k * NT + t] / lim), o = ((NTR - 1 - k) * NT + t) * 4;
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const mean = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { let s = 0; for (let k = 0; k < NTR; k++) s += c.tc[k * NT + t]; mean[t] = s / NTR; }
  return (c._erp = { cv, lim, mean });
}
function drawERP(cv, c) {
  const W = cv.clientWidth || 300, H = Math.round(Math.min(270, Math.max(210, W * 0.6)));
  const ctx = setupCanvas(cv, W, H), ink = tok('--ink'), muted = tok('--muted'), line = tok('--line');
  const L = 38, Rm = 6, T = 4, pw = W - L - Rm, imgH = Math.round(H * 0.6), erpT = T + imgH + 8, erpH = H - erpT - 20;
  const e = erpImage(c);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(e.cv, L, T, pw, imgH);
  const xOf = t => L + (t - T0) / 1.5 * pw;
  ctx.font = '10px ' + tok('--font-mono'); ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText('1', L - 4, T + imgH - 5); ctx.fillText(String(NTR), L - 4, T + 6);
  ctx.save(); ctx.translate(10, T + imgH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('Trials', 0, 0); ctx.restore();
  // mean ERP
  let mx = 0; for (const v of e.mean) mx = Math.max(mx, Math.abs(v));
  const ymax = Math.max(mx * 1.15, e.lim * 0.3);
  const yOf = v => erpT + erpH / 2 - v / ymax * erpH / 2;
  ctx.strokeStyle = line; ctx.lineWidth = 1;
  ctx.strokeRect(L + 0.5, erpT + 0.5, pw - 1, erpH - 1);
  ctx.beginPath(); ctx.moveTo(L, yOf(0)); ctx.lineTo(L + pw, yOf(0)); ctx.stroke();
  ctx.strokeStyle = tok('--accent'); ctx.lineWidth = 1.6; ctx.beginPath();
  for (let t = 0; t < NT; t++) { const x = xOf(TIMES[t]), y = yOf(e.mean[t]); t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.fillStyle = muted; ctx.textAlign = 'right';
  ctx.fillText('ERP', L - 4, erpT + erpH / 2);
  // stimulus line
  ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(xOf(0), T); ctx.lineTo(xOf(0), erpT + erpH); ctx.stroke(); ctx.setLineDash([]);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = muted;
  for (const t of [-0.5, 0, 0.5, 1]) {
    const x = Math.min(Math.max(xOf(t), L + 12), L + pw - 14);
    ctx.fillText((t * 1000).toFixed(0), x, erpT + erpH + 4);
  }
  ctx.textAlign = 'right'; ctx.fillText('ms', W - 2, erpT + erpH + 4);
}
function niceTicks(lo, hi, n) {
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
function drawSpec(cv, c) {
  const W = cv.clientWidth || 300, H = 160, ctx = setupCanvas(cv, W, H);
  const muted = tok('--muted'), line = tok('--line');
  const { fq, db } = spectrum(c);
  const L = 38, Rm = 8, T = 8, B = 22, pw = W - L - Rm, ph = H - T - B;
  let lo = Math.min(...db), hi = Math.max(...db); const pad = (hi - lo) * 0.08 + 0.5; lo -= pad; hi += pad;
  const xOf = f => L + (f - 2) / 48 * pw, yOf = v => T + (hi - v) / (hi - lo) * ph;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10px ' + tok('--font-mono'); ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of niceTicks(lo, hi, 4)) { const y = yOf(v); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillText(v.toFixed(0), L - 4, y); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const f of [10, 20, 30, 40, 50]) ctx.fillText(String(f), Math.min(xOf(f), L + pw - 6), T + ph + 5);
  ctx.textAlign = 'left'; ctx.fillText('Hz', L, T + ph + 5);
  ctx.save(); ctx.translate(9, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('dB', 0, 0); ctx.restore();
  // reference band
  ctx.fillStyle = tok('--accent-soft'); ctx.globalAlpha = 0.55;
  ctx.fillRect(xOf(8), T, xOf(12) - xOf(8), ph);
  ctx.globalAlpha = 1;
  ctx.fillStyle = muted; ctx.textBaseline = 'top'; ctx.textAlign = 'center'; ctx.fillText('α', xOf(10), T + 2);
  ctx.strokeStyle = tok('--bad'); ctx.lineWidth = 1.8; ctx.beginPath();
  fq.forEach((f, i) => { const x = xOf(f), y = yOf(db[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
}

function measuresHTML(c, thr) {
  const sc = scores(c, thr);
  const rows = MEASURES.map(M => {
    const s = sc[M.k], w = Math.max(0, Math.min(2, s.ratio)) / 2 * 100;
    return `<div class="meas-row" title="${esc(M.name + ' (' + M.tool + '): ' + M.what)}">
      <span class="mk">${M.k}</span>
      <div class="track" role="img" aria-label="${esc(M.name)}: ${s.pass ? 'passes' : 'does not pass'} threshold"><div class="bar ${s.pass ? 'pass' : ''}" style="width:${w}%;background:var(--m-${M.k})"></div><div class="th"></div></div>
      <span class="mv">${fmt(c.raw[M.k])}</span></div>`;
  }).join('');
  return `<div class="meas">${rows}<div class="meas-legend"><span>0</span><span>threshold</span><span>2×</span></div></div>
  <details style="margin-top:8px;font-size:.82rem"><summary class="muted" style="cursor:pointer">What each bar measures</summary>
  <ul style="margin:6px 0 0;padding-left:18px;display:grid;gap:4px">${MEASURES.map(M => `<li><b class="mono" style="color:var(--m-${M.k})">${M.k}</b> · ${M.name} (${M.tool}). ${M.what} <span class="muted">Targets: ${M.target}.</span></li>`).join('')}</ul></details>`;
}

let liveDraws = [];
function renderCard(el, c, thr, o = {}) {
  el.innerHTML = `<article class="cmp">
    <div class="cmp-head"><span class="id">${esc(o.title || 'Component')}</span>${o.headRight || ''}</div>
    <div class="cmp-grid">
      <figure class="pane topo-pane"><figcaption>Topography${c.showEOG ? ' · with EOG' : ''}</figcaption><canvas class="cv-topo"></canvas></figure>
      <figure class="pane"><figcaption>Single-trial activity and mean ERP</figcaption><canvas class="cv-erp"></canvas></figure>
      <div class="cmp-row2">
        <figure class="pane"><figcaption>Activity power spectrum</figcaption><canvas class="cv-spec"></canvas></figure>
        <figure class="pane"><figcaption>Automated measures</figcaption>${o.showMeasures ? measuresHTML(c, thr) : `<div class="meas-hidden">${o.hiddenMsg || 'Measures hidden'}</div>`}</figure>
      </div>
    </div></article>`;
  const draw = () => {
    if (!el.isConnected) return;
    drawTopo($('.cv-topo', el), c, c.showEOG, true);
    drawERP($('.cv-erp', el), c);
    drawSpec($('.cv-spec', el), c);
  };
  liveDraws.push(draw);
  requestAnimationFrame(draw);
}
function redrawAll() { liveDraws = liveDraws.filter(fn => { fn(); return true; }); }

// ---------- State ----------
const S = {
  tab: 'learn',
  learn: { cat: 'guide', sub: null, seed: 11 },
  pr: null,
  prSession: { n: 0, correct: 0, dec: 0, streak: 0, best: 0 },
  prShowMeas: false,
  ds: null,
  dsSug: false, dsOverview: true,
  resConfirm: false
};

// ---------- Learn ----------
function renderLearn() {
  const v = $('#v-learn'); liveDraws = [];
  const L = S.learn;
  const nav = `<nav class="catlist" aria-label="Component types">
    <button data-cat="guide" aria-current="${L.cat === 'guide'}"><span class="chip" style="background:var(--accent)"></span>Reading guide</button>
    ${CATS.map(cc => `<button data-cat="${cc.k}" aria-current="${L.cat === cc.k}">${catChip(cc.k)}${cc.name}<span class="side">${cc.reject ? 'reject' : 'keep'}</span></button>`).join('')}
  </nav>`;
  let body;
  if (L.cat === 'guide') {
    body = `<div class="learn-body">
      <div class="panel principles">
        <div class="eyebrow">Why it matters</div>
        <h2 style="font-size:1.6rem;margin-top:4px">Read a component before you subtract it</h2>
        <p style="max-width:68ch;margin:.5em 0 0">Each independent component (IC) is a linear combination of electrodes: it has a <b>topography</b> (inverse weights over the cap) and a <b>time course</b> (the signal an electrode placed at the source would record). Subtracting an artifactual IC cleans the data just like discarding a bad electrode. The hard part is deciding which ones to subtract.</p>
        <ol>
          <li>It is a signal detection problem: leaving an artifact in is under-correction (type II error); removing a neural component is over-correction (type I error).</li>
          <li>No single property is enough. Always look at topography, ERP image and spectrum together.</li>
          <li>Automated measures guide the decision; they do not make it. No automated method isolated artifacts accurately without supervision.</li>
          <li>Decide up front which artifacts you want to correct (blinks, muscle, channels) for your question: someone studying gamma may not want to remove components with high-frequency power.</li>
          <li>When a component is ambiguous, keep it: it may contain neural signal.</li>
          <li>Report the measures and thresholds you used so that preprocessing is reproducible.</li>
        </ol>
      </div>
      <div class="panel howto">
        <div><h3>Topography</h3><p>Red and blue are opposite polarities. Look for smoothness (dipole), focality (one electrode, the edge) or frontal loading. The frontal squares are EOG channels when they are rendered.</p></div>
        <div><h3>ERP image</h3><p>Each row is a trial (trial 1 at the bottom), smoothed over 5 neighbouring trials. The dashed line marks the stimulus. Below it, the mean ERP.</p></div>
        <div><h3>Spectrum</h3><p>Power in dB from 2 to 50 Hz, with the alpha band shaded. Physiological peaks versus flat or rising high-frequency noise. The drop near 45 Hz is the filter.</p></div>
        <div><h3>Measures</h3><p>Scaled bars: the red line is the threshold (dataset mean + 2 SD; 4 SD for EOG). A coloured bar passes threshold.</p></div>
      </div>
      <div id="learn-card"></div>
    </div>`;
  } else {
    const I = CATINFO[L.cat], subs = SUBS_BY_CAT[L.cat];
    if (!L.sub || SUBS[L.sub].cat !== L.cat) L.sub = subs[0];
    body = `<div class="learn-body">
      <div class="panel learn-intro">
        <div>
          <div class="eyebrow">Component type</div>
          <h2 style="margin-top:4px">${catChip(L.cat)}${catName(L.cat)} ${decPill(L.cat)}</h2>
          <p>${I.desc}</p>
          <div class="subhead">Expected properties</div>
          <ul class="props">${I.props.map(p => `<li>${p}</li>`).join('')}</ul>
        </div>
        <div>
          <div class="subhead" style="margin-top:0">Can be mistaken for</div>
          <ul class="props warn">${I.confuse.map(p => `<li>${p}</li>`).join('')}</ul>
          <div class="subhead">Automated detection</div>
          <p style="font-size:.92rem">${I.auto}</p>
        </div>
      </div>
      <div class="variants" role="group" aria-label="Variants">
        <span class="eyebrow" style="margin-right:4px">Examples</span>
        ${subs.map(s => `<button data-sub="${s}" aria-pressed="${L.sub === s}">${SUBS[s].label}${SUBS[s].trap ? '<span class="t">edge case</span>' : ''}</button>`).join('')}
        <button class="btn" id="learn-new" style="margin-left:auto">New example</button>
      </div>
      <div id="learn-card"></div>
      <div id="learn-why"></div>
    </div>`;
  }
  v.innerHTML = `<div class="learn">${nav}${body}</div>`;
  const sub = L.cat === 'guide' ? 'evoked' : L.sub;
  const c = genComponent(sub, L.seed + sub.length * 101);
  renderCard($('#learn-card'), c, REFTHR, { title: L.cat === 'guide' ? 'Example: neural component with an evoked response' : SUBS[sub].label, showMeasures: true, headRight: decPill(c.cat) });
  if (L.cat !== 'guide') {
    $('#learn-why').innerHTML = `<div class="panel" style="padding:14px 16px"><div class="subhead" style="margin-top:0">What to notice in this example</div><ul class="props">${c.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>${c.trap ? `<div class="note" style="margin-top:10px">${esc(c.trap)}</div>` : ''}</div>`;
  }
  $$('.catlist button', v).forEach(b => b.onclick = () => { L.cat = b.dataset.cat; L.sub = null; renderLearn(); });
  $$('.variants [data-sub]', v).forEach(b => b.onclick = () => { L.sub = b.dataset.sub; renderLearn(); });
  const nb = $('#learn-new'); if (nb) nb.onclick = () => { L.seed = rnd(); renderLearn(); };
}

// ---------- Practice ----------
function newPracticeItem() {
  const cat = CATS[Math.floor(Math.random() * CATS.length)].k;
  const subs = SUBS_BY_CAT[cat], sub = subs[Math.floor(Math.random() * subs.length)];
  S.pr = { c: genComponent(sub, rnd()), answer: null };
}
function renderPractice() {
  if (!S.pr) newPracticeItem();
  const v = $('#v-practice'); liveDraws = [];
  const P = S.pr, ss = S.prSession, c = P.c, answered = P.answer !== null;
  const acc = ss.n ? pct(ss.correct / ss.n) : '—', dec = ss.n ? pct(ss.dec / ss.n) : '—';
  v.innerHTML = `
    <div class="scorebar">
      <div class="stat"><b>${ss.n}</b><span>answered</span></div>
      <div class="stat"><b>${acc}</b><span>correct type</span></div>
      <div class="stat"><b>${dec}</b><span>correct decision</span></div>
      <div class="stat"><b>${ss.streak}</b><span>streak (best ${ss.best})</span></div>
      <label class="switch" style="margin-left:auto"><input type="checkbox" id="pr-meas" ${S.prShowMeas ? 'checked' : ''}> Show measures before answering</label>
    </div>
    <div class="practice">
      <div id="pr-card"></div>
      <div style="display:grid;gap:14px">
        <div class="panel answers">
          <h3>What does this component capture?</h3>
          <p class="muted" style="margin:0 0 4px;font-size:.84rem">Keys 1–7 to answer${answered ? ', Enter to continue' : ''}.</p>
          ${CATS.map((cc, i) => {
            let cls = '';
            if (answered) { if (cc.k === c.cat) cls = 'correct'; else if (cc.k === P.answer) cls = 'wrong'; }
            return `<button class="ans ${cls}" data-k="${cc.k}" ${answered ? 'disabled' : ''}><span class="key">${i + 1}</span>${catChip(cc.k)}<span>${cc.name}</span><span class="dec" style="color:${cc.reject ? 'var(--bad)' : 'var(--ok)'}">${cc.reject ? 'reject' : 'keep'}</span></button>`;
          }).join('')}
        </div>
        <div id="pr-fb"></div>
      </div>
    </div>`;
  renderCard($('#pr-card'), c, REFTHR, {
    title: answered ? SUBS[c.sub].label : 'Unknown component',
    showMeasures: answered || S.prShowMeas,
    headRight: answered ? decPill(c.cat) : '',
    hiddenMsg: 'Measures hidden.<br>Decide first by looking at the topography, ERP image and spectrum.'
  });
  if (answered) $('#pr-fb').innerHTML = feedbackHTML(c, P.answer);
  $('#pr-meas').onchange = e => { S.prShowMeas = e.target.checked; renderPractice(); };
  $$('.ans', v).forEach(b => b.onclick = () => answerPractice(b.dataset.k));
  const nx = $('#pr-next'); if (nx) nx.onclick = nextPractice;
}
function feedbackHTML(c, ans) {
  const ok = ans === c.cat;
  let decTxt;
  if (ok) decTxt = '';
  else if (isReject(ans) === isReject(c.cat)) decTxt = `The decision would have been the same (${isReject(ans) ? 'reject' : 'keep'}), but the category needs refining.`;
  else if (!isReject(c.cat)) decTxt = 'You would have subtracted a component that should be kept: over-correction (type I error), risking the loss of neural signal.';
  else decTxt = 'You would have left an artifact in the data: under-correction (type II error).';
  const sc = scores(c, REFTHR), passed = MEASURES.filter(M => sc[M.k].pass);
  const sasica = passed.filter(M => M.tool === 'SASICA');
  let autoTxt = passed.length ? `Above threshold: ${passed.map(M => `<b class="mono" style="color:var(--m-${M.k})">${M.k}</b>`).join(', ')}.` : 'No measure passes threshold.';
  if (isReject(c.cat) && !sasica.length) autoTxt += ' SASICA would not have suggested it: visual inspection is essential here.';
  if (!isReject(c.cat) && sasica.length) autoTxt += ' SASICA would have suggested rejecting it, even though it should be kept.';
  return `<div class="panel feedback">
    <h3 class="${ok ? 'ok' : 'no'}">${ok ? 'Correct' : 'Not quite'}: ${catName(c.cat)}</h3>
    ${decTxt ? `<p style="margin:0;font-size:.92rem">${decTxt}</p>` : ''}
    <div class="subhead" style="margin:0">Key features of this component</div>
    <ul>${c.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    ${c.trap ? `<div class="note">${esc(c.trap)}</div>` : ''}
    <p style="margin:0;font-size:.88rem" class="muted">${autoTxt}</p>
    <button class="btn primary" id="pr-next">Next component</button>
  </div>`;
}
function answerPractice(k) {
  const P = S.pr; if (!P || P.answer !== null) return;
  P.answer = k;
  const ss = S.prSession, ok = k === P.c.cat;
  ss.n++; if (ok) { ss.correct++; ss.streak++; ss.best = Math.max(ss.best, ss.streak); } else ss.streak = 0;
  if (isReject(k) === isReject(P.c.cat)) ss.dec++;
  ST.conf[CATIDX[P.c.cat]][CATIDX[k]]++; saveStats();
  renderPractice();
}
function nextPractice() { newPracticeItem(); renderPractice(); window.scrollTo({ top: 0, behavior: 'auto' }); }

// ---------- Full dataset ----------
function newDataset(seed) {
  const d = genDataset(seed ?? rnd());
  S.ds = { d, marks: d.comps.map(() => false), sel: 0, graded: null };
}
function gradeDataset() {
  const D = S.ds, comps = D.d.comps;
  let h = 0, m = 0, fa = 0, cr = 0, sh = 0, sfa = 0, artV = 0, nonV = 0, hitV = 0, faV = 0;
  comps.forEach((c, i) => {
    const art = isReject(c.cat), mk = D.marks[i];
    const sc = scores(c, D.d.thr), auto = MEASURES.some(M => M.tool === 'SASICA' && sc[M.k].pass);
    if (art) { artV += c.variance; if (mk) { h++; hitV += c.variance; } else m++; if (auto) sh++; }
    else { nonV += c.variance; if (mk) { fa++; faV += c.variance; } else cr++; if (auto) sfa++; }
  });
  const nA = h + m, nN = fa + cr, you = sdt(h, nA, fa, nN), sas = sdt(sh, nA, sfa, nN);
  D.graded = { h, m, fa, cr, nA, nN, you, sas, artVarRemoved: hitV / artV, nonVarRemoved: faV / nonV };
  ST.runs.unshift({ date: new Date().toISOString(), hr: you.hr, far: you.far, d: you.d, c: you.c, sasD: sas.d, varA: hitV / artV, varN: faV / nonV });
  ST.runs = ST.runs.slice(0, 30); saveStats();
}
function renderDataset() {
  if (!S.ds) newDataset(2026);
  const v = $('#v-dataset'); liveDraws = [];
  const D = S.ds, comps = D.d.comps, G = D.graded;
  const nMarked = D.marks.filter(Boolean).length;
  v.innerHTML = `
    <div class="ds-tools">
      <div><div class="eyebrow">Simulated dataset · ${comps.length} components sorted by variance</div>
      <p style="margin:2px 0 0;font-size:.9rem;max-width:70ch">Review every component as in the EEGLAB tool: mark the ones you would subtract and compare your selection with the reference classification. Click the <span class="mono">IC</span> label to toggle keep / reject.</p></div>
      <div class="spacer"></div>
      <label class="switch"><input type="checkbox" id="ds-sug" ${S.dsSug ? 'checked' : ''}> SASICA suggestions</label>
      <label class="switch"><input type="checkbox" id="ds-ov" ${S.dsOverview ? 'checked' : ''}> Measures overview</label>
      <button class="btn" id="ds-new">New dataset</button>
      <button class="btn primary" id="ds-grade" ${G ? 'disabled' : ''}>Score (${nMarked} to reject)</button>
    </div>
    ${S.dsSug ? `<div class="legend" style="margin-bottom:10px">${MEASURES.map(M => `<span><i style="background:var(--m-${M.k})"></i>${M.k} · ${M.name}</span>`).join('')}</div>` : ''}
    <div class="ds">
      <div class="icgrid" id="ds-grid">${comps.map((c, i) => {
        const sc = scores(c, D.d.thr), passed = MEASURES.filter(M => sc[M.k].pass);
        let g = '';
        if (G) { const art = isReject(c.cat), mk = D.marks[i]; g = art ? (mk ? 'g-hit' : 'g-miss') : (mk ? 'g-fa' : ''); }
        return `<div class="ic ${D.marks[i] ? 'rej' : ''} ${g}" aria-current="${D.sel === i}">
          <button class="num" data-tog="${i}" aria-label="IC ${i + 1}: ${D.marks[i] ? 'reject' : 'keep'}">IC ${i + 1}</button>
          <button data-sel="${i}" style="border:0;background:none;padding:0" aria-label="View IC ${i + 1}"><canvas data-i="${i}"></canvas></button>
          ${S.dsSug ? `<span class="dots">${passed.map(M => `<i style="background:var(--m-${M.k})" title="${M.k}"></i>`).join('')}</span>` : ''}
          ${G ? `<span class="truth" style="color:var(--c-${c.cat})">${catName(c.cat)}</span>` : ''}
        </div>`;
      }).join('')}</div>
      <div class="ds-side">
        ${G ? resultsHTML(G) : ''}
        ${S.dsOverview ? `<div class="panel"><div class="overview" id="ds-ov-wrap">${MEASURES.map(M => `<figure><figcaption>${M.k} · ${M.tool}</figcaption><canvas data-m="${M.k}"></canvas></figure>`).join('')}</div></div>` : ''}
        <div class="decide" id="ds-decide"></div>
        <div id="ds-card"></div>
        <div id="ds-why"></div>
      </div>
    </div>`;
  // thumbnails
  const drawThumbs = () => $$('#ds-grid canvas').forEach(cv => drawTopo(cv, comps[+cv.dataset.i], false, false));
  liveDraws.push(drawThumbs); requestAnimationFrame(drawThumbs);
  if (S.dsOverview) { const ov = () => drawOverview(D); liveDraws.push(ov); requestAnimationFrame(ov); }
  renderDsDetail();
  $('#ds-sug').onchange = e => { S.dsSug = e.target.checked; renderDataset(); };
  $('#ds-ov').onchange = e => { S.dsOverview = e.target.checked; renderDataset(); };
  $('#ds-new').onclick = () => { newDataset(); renderDataset(); };
  $('#ds-grade').onclick = () => { gradeDataset(); renderDataset(); };
  $$('[data-tog]', v).forEach(b => b.onclick = () => toggleMark(+b.dataset.tog));
  $$('[data-sel]', v).forEach(b => b.onclick = () => selectIC(+b.dataset.sel));
  $$('#ds-ov-wrap canvas').forEach(cv => cv.onclick = e => {
    const r = cv.getBoundingClientRect(), L = 6, pw = r.width - 12;
    const i = Math.round((e.clientX - r.left - L) / pw * (comps.length - 1));
    if (i >= 0 && i < comps.length) selectIC(i);
  });
}
function toggleMark(i) {
  const D = S.ds; D.marks[i] = !D.marks[i]; D.sel = i;
  if (D.graded) D.graded = null; // changing the selection invalidates the score
  renderDataset();
}
function selectIC(i) {
  const D = S.ds; D.sel = i;
  $$('#ds-grid .ic').forEach((el, j) => el.setAttribute('aria-current', j === i));
  renderDsDetail();
  if (S.dsOverview) drawOverview(D);
}
function renderDsDetail() {
  const D = S.ds, i = D.sel, c = D.d.comps[i], G = D.graded;
  liveDraws = liveDraws.filter(fn => !fn._detail);
  const dec = $('#ds-decide');
  dec.innerHTML = `<span class="eyebrow">IC ${i + 1}</span>
    <button class="btn k" aria-pressed="${!D.marks[i]}" id="ds-keep">Keep <span class="mono muted">K</span></button>
    <button class="btn r" aria-pressed="${D.marks[i]}" id="ds-rej">Reject <span class="mono muted">R</span></button>
    <span class="muted" style="font-size:.8rem;margin-left:auto">← → to move</span>`;
  $('#ds-keep').onclick = () => { if (D.marks[i]) toggleMark(i); };
  $('#ds-rej').onclick = () => { if (!D.marks[i]) toggleMark(i); };
  const wrap = $('#ds-card'), before = liveDraws.length;
  renderCard(wrap, c, D.d.thr, {
    title: `IC ${i + 1} · ${(c.variance / D.d.comps.reduce((a, b) => a + b.variance, 0) * 100).toFixed(1)}% of variance`,
    showMeasures: true,
    headRight: G ? `<span>${catChip(c.cat)} <b>${catName(c.cat)}</b> · ${SUBS[c.sub].label}</span>` : ''
  });
  liveDraws.slice(before).forEach(fn => fn._detail = true);
  $('#ds-why').innerHTML = G ? `<div class="panel" style="padding:14px 16px"><ul class="props">${c.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>${c.trap ? `<div class="note" style="margin-top:10px">${esc(c.trap)}</div>` : ''}</div>` : '';
}
function resultsHTML(G) {
  const f2 = v => (v >= 0 ? '' : '−') + Math.abs(v).toFixed(2);
  return `<div class="panel" style="padding:14px;display:grid;gap:10px">
    <div><div class="eyebrow">Score against the reference</div>
    <p style="margin:2px 0 0;font-size:.88rem">${G.h} of ${G.nA} artifacts rejected · ${G.fa} of ${G.nN} neural or mixed components rejected by mistake. In the grid: green border = hit, dashed red = miss or false alarm.</p></div>
    <div class="results-grid">
      <div class="tile"><b>${pct(G.you.hr)}</b><span>hit rate</span><div class="vs">SASICA ${pct(G.sas.hr)}</div></div>
      <div class="tile"><b>${pct(G.you.far)}</b><span>false alarm rate</span><div class="vs">SASICA ${pct(G.sas.far)}</div></div>
      <div class="tile"><b>${f2(G.you.d)}</b><span>sensitivity d′</span><div class="vs">SASICA ${f2(G.sas.d)}</div></div>
      <div class="tile"><b>${f2(G.you.c)}</b><span>criterion c</span><div class="vs">${G.you.c > 0 ? 'conservative' : 'liberal'}</div></div>
      <div class="tile"><b>${pct(G.artVarRemoved)}</b><span>artifact variance removed</span></div>
      <div class="tile"><b>${pct(G.nonVarRemoved)}</b><span>neural/mixed variance removed</span></div>
    </div>
    <p class="muted" style="margin:0;font-size:.8rem">“SASICA” = reject every component that passes at least one SASICA threshold. In the paper, users removed 64.6% of artifact variance and 13.4% of non-artifact variance.</p>
  </div>`;
}
function drawOverview(D) {
  const comps = D.d.comps;
  $$('#ds-ov-wrap canvas').forEach(cv => {
    const M = MEASURES.find(m => m.k === cv.dataset.m), W = cv.clientWidth || 160, H = 92, ctx = setupCanvas(cv, W, H);
    const vals = comps.map(c => c.raw[M.k]), th = D.d.thr[M.k];
    let lo = Math.min(...vals, th.cut), hi = Math.max(...vals, th.cut);
    if (M.k === 'TK') { lo = Math.min(...vals); }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const L = 6, pw = W - 12, T = 4, ph = H - 10;
    const xOf = i => L + i / (comps.length - 1) * pw, yOf = v => T + (hi - v) / (hi - lo) * ph;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = tok('--sunk'); ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = tok('--bad'); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(L, yOf(th.cut)); ctx.lineTo(L + pw, yOf(th.cut)); ctx.stroke();
    const muted = tok('--muted'), col = tok('--m-' + M.k);
    comps.forEach((c, i) => {
      const pass = M.dir > 0 ? c.raw[M.k] > th.cut : c.raw[M.k] < th.cut;
      ctx.fillStyle = pass ? col : muted; ctx.globalAlpha = pass ? 1 : 0.55;
      ctx.beginPath(); ctx.arc(xOf(i), yOf(c.raw[M.k]), pass ? 3.2 : 2.2, 0, 2 * Math.PI); ctx.fill();
    });
    ctx.globalAlpha = 1;
    const i = D.sel; ctx.strokeStyle = tok('--ink'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(xOf(i), yOf(comps[i].raw[M.k]), 5.5, 0, 2 * Math.PI); ctx.stroke();
  });
}

// ---------- Results ----------
function renderResults() {
  const v = $('#v-results'); liveDraws = [];
  const conf = ST.conf, total = conf.flat().reduce((a, b) => a + b, 0);
  let h = 0, nA = 0, fa = 0, nN = 0;
  CATS.forEach((ct, i) => CATS.forEach((cr, j) => {
    const n = conf[i][j];
    if (ct.reject) { nA += n; if (cr.reject) h += n; } else { nN += n; if (cr.reject) fa += n; }
  }));
  const s = sdt(h, nA, fa, nN);
  const diag = CATS.reduce((a, _, i) => a + conf[i][i], 0);
  const matrix = total ? `<div class="tablewrap"><table class="conf">
      <thead><tr><th class="rowh">True ↓ · Your answer →</th>${CATS.map(cc => `<th>${cc.name}</th>`).join('')}<th>Correct</th></tr></thead>
      <tbody>${CATS.map((cc, i) => {
        const row = conf[i], rs = row.reduce((a, b) => a + b, 0);
        return `<tr><th class="rowh">${catChip(cc.k)} ${cc.name}</th>${row.map((n, j) => {
          const p = rs ? n / rs : 0, base = i === j ? 'var(--ok)' : 'var(--bad)';
          return `<td style="background:color-mix(in srgb, ${base} ${Math.round(p * 55)}%, transparent)">${n || '·'}</td>`;
        }).join('')}<td><b>${rs ? pct(row[i] / rs) : '—'}</b></td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="empty">No answers yet. Go to <b>Practice</b> to start.</div>`;
  const runs = ST.runs.length ? `<table class="list"><thead><tr><th>Date</th><th>Hits</th><th>False alarms</th><th>d′</th><th>SASICA d′</th></tr></thead><tbody>${ST.runs.map(r => `<tr><td>${new Date(r.date).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>${pct(r.hr)}</td><td>${pct(r.far)}</td><td>${r.d.toFixed(2)}</td><td>${r.sasD.toFixed(2)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">Score a full dataset to track your progress.</div>`;
  v.innerHTML = `<div class="res">
    <div class="panel" style="padding:16px;display:grid;gap:12px;min-width:0">
      <div><div class="eyebrow">Single-component practice · ${total} answers</div><h2 style="font-size:1.4rem;margin-top:2px">Confusion matrix</h2></div>
      ${total ? `<div class="results-grid">
        <div class="tile"><b>${pct(diag / total)}</b><span>correct type</span></div>
        <div class="tile"><b>${nA ? pct(s.hr) : '—'}</b><span>artifacts rejected</span></div>
        <div class="tile"><b>${nN ? pct(s.far) : '—'}</b><span>useful components rejected</span></div>
        <div class="tile"><b>${(nA && nN) ? s.d.toFixed(2) : '—'}</b><span>d′ reject / keep</span></div>
      </div>` : ''}
      ${matrix}
      <p class="muted" style="margin:0;font-size:.82rem">Rows: reference category. Columns: your answer. In the original study even the experts disagreed (Krippendorff’s α 0.42–0.51) and only reached consensus after discussion.</p>
    </div>
    <div class="panel" style="padding:16px;display:grid;gap:12px;min-width:0">
      <div><div class="eyebrow">Full datasets</div><h2 style="font-size:1.4rem;margin-top:2px">History</h2></div>
      ${runs}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${S.resConfirm
        ? `<span>Delete all results saved in this browser?</span><button class="btn" id="res-yes" style="border-color:var(--bad);color:var(--bad)">Delete</button><button class="btn" id="res-no">Cancel</button>`
        : `<button class="btn" id="res-reset">Delete results</button><span class="muted" style="font-size:.8rem">Results are saved in this browser only.</span>`}</div>
    </div>
  </div>`;
  const r = $('#res-reset'); if (r) r.onclick = () => { S.resConfirm = true; renderResults(); };
  const y = $('#res-yes'); if (y) y.onclick = () => { ST.conf = Array.from({ length: 7 }, () => Array(7).fill(0)); ST.runs = []; saveStats(); S.resConfirm = false; renderResults(); };
  const n = $('#res-no'); if (n) n.onclick = () => { S.resConfirm = false; renderResults(); };
}

// ---------- Navigation ----------
const VIEWS = { learn: renderLearn, practice: renderPractice, dataset: renderDataset, results: renderResults };
function showTab(t, push) {
  if (!VIEWS[t]) t = 'learn';
  S.tab = t;
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  Object.keys(VIEWS).forEach(k => $('#v-' + k).hidden = k !== t);
  VIEWS[t]();
  if (push) { try { history.replaceState(null, '', '#' + t); } catch (e) { } }
}
$$('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab, true));

document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (S.tab === 'practice' && S.pr) {
    if (S.pr.answer === null && /^[1-7]$/.test(e.key)) { answerPractice(CATS[+e.key - 1].k); e.preventDefault(); }
    else if (S.pr.answer !== null && (e.key === 'Enter' || e.key === 'ArrowRight')) { nextPractice(); e.preventDefault(); }
  } else if (S.tab === 'dataset' && S.ds) {
    const D = S.ds, n = D.d.comps.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { selectIC(Math.min(n - 1, D.sel + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { selectIC(Math.max(0, D.sel - 1)); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') { if (!D.marks[D.sel]) toggleMark(D.sel); }
    else if (e.key === 'k' || e.key === 'K') { if (D.marks[D.sel]) toggleMark(D.sel); }
  }
});

let rT;
window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(redrawAll, 150); });
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(redrawAll, 30)); } catch (e) { }
new MutationObserver(() => setTimeout(redrawAll, 30)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

showTab((location.hash || '').replace('#', '') || 'learn', false);
