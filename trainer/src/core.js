// ===== Simulation core: synthetic ICA components and SASICA-style measures =====
const FS = 128, T0 = -0.5, NT = 192, NTR = 100, LAG = 3, HEAD = 1.1;
const TIMES = new Float32Array(NT);
for (let i = 0; i < NT; i++) TIMES[i] = T0 + i / FS;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const r = mulberry32(seed);
  let spare = null;
  return {
    u: r,
    n() {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0; while (u === 0) u = r();
      const v = r(), m = Math.sqrt(-2 * Math.log(u));
      spare = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    },
    range(a, b) { return a + (b - a) * r(); },
    pick(arr) { return arr[Math.floor(r() * arr.length)]; },
    int(a, b) { return a + Math.floor(r() * (b - a + 1)); },
    sign() { return r() < 0.5 ? -1 : 1; }
  };
}

// Montage: 91 electrodes in rings + 4 EOG (2 infraorbital, 2 outer canthi)
const CH = (() => {
  const c = [{ x: 0, y: 0 }];
  [[0.19, 6], [0.38, 12], [0.57, 18], [0.76, 24], [0.94, 30]].forEach(([r, n], ri) => {
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * (i + 0.5 * (ri % 2)) / n;
      c.push({ x: r * Math.sin(a), y: r * Math.cos(a) });
    }
  });
  return c;
})();
const NCH = CH.length;
const EOGPOS = [
  { x: -0.34, y: 1.0, n: 'left infraorbital EOG' },
  { x: 0.34, y: 1.0, n: 'right infraorbital EOG' },
  { x: -0.74, y: 0.76, n: 'left canthus EOG' },
  { x: 0.74, y: 0.76, n: 'right canthus EOG' }
];

const SIG = x => 1 / (1 + Math.exp(-x));
const G = (x, y, cx, cy, s) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * s * s));
const polar = (r, deg) => ({ x: r * Math.sin(deg * Math.PI / 180), y: r * Math.cos(deg * Math.PI / 180) });

function locName(x, y) {
  const ap = y > 0.35 ? 'frontal' : y < -0.35 ? 'posterior' : 'central';
  const lat = x < -0.25 ? 'left ' : x > 0.25 ? 'right ' : 'midline ';
  return lat + ap + ' region';
}

const CATS = [
  { k: 'neural', name: 'Neural', reject: false },
  { k: 'blink', name: 'Blink', reject: true },
  { k: 'saccade', name: 'Eye movement', reject: true },
  { k: 'muscle', name: 'Muscle', reject: true },
  { k: 'badchan', name: 'Bad channel', reject: true },
  { k: 'rare', name: 'Rare event', reject: true },
  { k: 'other', name: 'Mixed / other', reject: false }
];
const CATIDX = Object.fromEntries(CATS.map((c, i) => [c.k, i]));

const SUBS = {
  alpha: { cat: 'neural', label: 'Posterior alpha' },
  beta: { cat: 'neural', label: 'Central beta / mu' },
  theta: { cat: 'neural', label: 'Frontal midline theta' },
  evoked: { cat: 'neural', label: 'Evoked response' },
  neural_frontal: { cat: 'neural', label: 'Frontal, looks like a blink', trap: true },
  focal_neural: { cat: 'neural', label: 'Focal, looks like a bad channel', trap: true },
  blink: { cat: 'blink', label: 'Blink' },
  hsacc: { cat: 'saccade', label: 'Horizontal saccade' },
  vsacc: { cat: 'saccade', label: 'Vertical saccade' },
  muscle: { cat: 'muscle', label: 'Tonic muscle' },
  badchan: { cat: 'badchan', label: 'Poorly connected electrode' },
  rare_focal: { cat: 'rare', label: 'Event at one electrode' },
  rare_spread: { cat: 'rare', label: 'Event at many electrodes' },
  noisy_events: { cat: 'rare', label: 'Noise with brief events', trap: true },
  badchan_fewtrials: { cat: 'rare', label: 'Bad channel in a few trials only', trap: true },
  other: { cat: 'other', label: 'Ambiguous mixture' },
  focal_nonmuscle: { cat: 'other', label: 'Focal without muscle noise', trap: true }
};
const SUBS_BY_CAT = {};
for (const [k, v] of Object.entries(SUBS)) (SUBS_BY_CAT[v.cat] = SUBS_BY_CAT[v.cat] || []).push(k);

function genComponent(sub, seed) {
  const R = makeRng((seed >>> 0) || 1);
  const tc = new Float32Array(NTR * NT);
  const c = {
    sub, cat: SUBS[sub].cat, seed,
    showEOG: R.u() < 0.5,
    corrV: R.range(0.005, 0.07), corrH: R.range(0.005, 0.07),
    reasons: [], trap: null, p: {}
  };
  let f = null, eog = null, wx = null;

  const bg = (a, sd) => {
    const s2 = sd * Math.sqrt(1 - a * a);
    for (let k = 0; k < NTR; k++) {
      let x = R.n() * sd; const o = k * NT;
      for (let t = 0; t < NT; t++) { x = a * x + R.n() * s2; tc[o + t] += x; }
    }
  };
  const white = sd => { for (let i = 0; i < tc.length; i++) tc[i] += R.n() * sd; };
  const blue = (sd, env) => {
    for (let k = 0; k < NTR; k++) {
      const e = env ? env(k) : 1; let p = R.n(); const o = k * NT;
      for (let t = 0; t < NT; t++) { const w = R.n(); tc[o + t] += sd * e * (w - 0.7 * p) / 1.22; p = w; }
    }
  };
  const erp = (list, jit = 0.3) => {
    for (let k = 0; k < NTR; k++) {
      const s = Math.max(0, 1 + jit * R.n()), lat = R.n() * 0.012, o = k * NT;
      for (let t = 0; t < NT; t++) {
        const tt = TIMES[t]; let v = 0;
        for (const [mu, A, sg] of list) v += A * Math.exp(-((tt - mu - lat) ** 2) / (2 * sg * sg));
        tc[o + t] += s * v;
      }
    }
  };
  const osc = (fr, amp, env) => {
    for (let k = 0; k < NTR; k++) {
      const a = amp * R.range(0.6, 1.4), ph = R.u() * 2 * Math.PI, df = R.n() * 0.3, o = k * NT;
      for (let t = 0; t < NT; t++) tc[o + t] += a * env(TIMES[t]) * Math.sin(2 * Math.PI * (fr + df) * TIMES[t] + ph);
    }
  };
  const steps = (prob, ampLo, ampHi) => {
    for (let k = 0; k < NTR; k++) {
      if (R.u() > prob) continue;
      const n = R.u() < 0.3 ? 2 : 1, o = k * NT;
      for (let s = 0; s < n; s++) {
        const c0 = R.range(-0.45, 0.8), dur = R.range(0.25, 0.7), A = R.sign() * R.range(ampLo, ampHi);
        for (let t = 0; t < NT; t++) {
          const tt = TIMES[t];
          tc[o + t] += A * (SIG((tt - c0) / 0.012) - SIG((tt - c0 - dur) / 0.012));
        }
      }
    }
  };
  const burst = (k, amp, wd) => {
    const c0 = R.range(-0.35, 0.85), o = k * NT, kind = R.u();
    const fr = R.range(4, 14), ph = R.u() * 6.28;
    for (let t = 0; t < NT; t++) {
      const tt = TIMES[t], env = Math.exp(-((tt - c0) ** 2) / (2 * wd * wd));
      tc[o + t] += amp * env * (kind < 0.5 ? 1 : Math.sin(2 * Math.PI * fr * tt + ph) * 1.4);
    }
  };
  const singleChan = (sign) => {
    const w = new Float32Array(NCH);
    for (let i = 0; i < NCH; i++) w[i] = R.n() * 0.025;
    const idx = R.int(7, NCH - 1); w[idx] = sign; c.p.chan = idx;
    c.p.chanLoc = locName(CH[idx].x, CH[idx].y);
    return w;
  };
  const randBlobs = (n, rmax, slo, shi) => {
    const bl = [];
    for (let i = 0; i < n; i++) {
      const p = polar(R.range(0, rmax), R.range(0, 360));
      bl.push([p.x, p.y, R.range(slo, shi), R.sign() * R.range(0.5, 1)]);
    }
    return (x, y) => bl.reduce((s, b) => s + b[3] * G(x, y, b[0], b[1], b[2]), 0);
  };

  switch (sub) {
    case 'alpha': {
      const cx = R.range(-0.25, 0.25), cy = R.range(-0.75, -0.5), th = R.range(0, 6.28), fr = R.range(9, 11.5);
      f = (x, y) => G(x, y, cx, cy, 0.4) * (1 + 0.5 * (((x - cx) * Math.cos(th) + (y - cy) * Math.sin(th)) / 0.4));
      bg(0.97, 0.7); white(0.05);
      osc(fr, 0.8, t => 1 - 0.55 * SIG((t - 0.15) / 0.04) * (1 - SIG((t - 0.8) / 0.08)));
      erp([[0.1, 0.6, 0.025], [0.17, -0.8, 0.03]]);
      c.p = { fr, loc: locName(cx, cy) };
      c.reasons = [
        `Smooth, dipolar topography over the ${c.p.loc}`,
        `Clear spectral peak at ~${fr.toFixed(1)} Hz (alpha band, 8–12 Hz)`,
        'Oscillatory, autocorrelated time course with no abrupt jumps',
        'Alpha decreases after the stimulus (desynchronization) and there is a small evoked response',
        'Artifact measures stay below threshold'
      ];
      break;
    }
    case 'beta': {
      const cx = R.sign() * R.range(0.3, 0.5), cy = R.range(-0.1, 0.2), th = R.range(0, 6.28), fr = R.range(18, 24);
      f = (x, y) => G(x, y, cx, cy, 0.38) * (0.25 + 1.3 * (((x - cx) * Math.cos(th) + (y - cy) * Math.sin(th)) / 0.38));
      bg(0.97, 0.6); white(0.05);
      osc(fr, 0.45, t => 1 - 0.6 * SIG((t - 0.25) / 0.05) * (1 - SIG((t - 0.65) / 0.05)) + 0.4 * SIG((t - 0.75) / 0.05));
      osc(R.range(9.5, 11.5), 0.35, () => 1);
      erp([[0.12, 0.4, 0.03], [0.2, -0.6, 0.04]]);
      c.p = { fr, loc: locName(cx, cy) };
      c.reasons = [
        `Dipolar topography (two poles of opposite sign) over the ${c.p.loc}`,
        `Spectral peak at ~${fr.toFixed(0)} Hz (beta, 15–30 Hz), typical of central sensors`,
        'Beta desynchronization after the stimulus, followed by a rebound',
        'Autocorrelated time course; no artifact measure passes threshold'
      ];
      break;
    }
    case 'theta': {
      const cy = R.range(0.35, 0.55), fr = R.range(5, 6.5);
      f = (x, y) => G(x, y, 0, cy, 0.42) - 0.15 * G(x, y, 0, -0.5, 0.4);
      bg(0.97, 0.6); white(0.05);
      osc(fr, 0.6, t => 1 + 0.8 * Math.exp(-((t - 0.4) ** 2) / (2 * 0.13 ** 2)));
      erp([[0.25, -0.6, 0.04], [0.4, 0.6, 0.08]]);
      c.p = { fr };
      c.reasons = [
        'Smooth topography over the frontal midline, fading gradually towards the back',
        `Spectral peak at ~${fr.toFixed(1)} Hz (theta, ~5 Hz)`,
        'Theta increase between 200 and 600 ms after the stimulus',
        'No correlation with the EOG: not an ocular artifact even though it is frontal'
      ];
      break;
    }
    case 'evoked': {
      const cx = R.range(-0.2, 0.2), cy = R.range(-0.6, -0.3), th = R.range(0, 6.28);
      f = (x, y) => G(x, y, cx, cy, 0.42) * (1 + 0.4 * (((x - cx) * Math.cos(th) + (y - cy) * Math.sin(th)) / 0.42));
      bg(0.97, 0.5); white(0.05);
      osc(R.range(9, 11), 0.25, () => 1);
      erp([[0.1, 1.1, 0.025], [0.17, -1.6, 0.03], [0.38, 1.0, 0.08]]);
      c.p = { loc: locName(cx, cy) };
      c.reasons = [
        `Smooth, dipolar topography over the ${c.p.loc}`,
        'Clear evoked response repeated across all trials (P1, N1, P3)',
        'Spectrum with 1/f fall-off and no excess power at high frequencies',
        'Usually among the components explaining the most variance'
      ];
      break;
    }
    case 'neural_frontal': {
      f = (x, y) => Math.exp(-(x * x) / (2 * 0.75 ** 2) - ((y - 0.85) ** 2) / (2 * 0.42 ** 2)) - 0.2 * G(x, y, 0, -0.7, 0.4);
      c.showEOG = R.u() < 0.7;
      bg(0.97, 0.6); white(0.08);
      erp([[0.26, -0.5, 0.04], [0.45, 1.8, 0.11], [0.62, 0.8, 0.08]], 0.35);
      c.corrV = R.range(0.08, 0.16);
      c.reasons = [
        'Large weights on frontal channels, but the topography is broad and smooth',
        'No polarity reversal at the electrodes below the eyes (when rendered, they have the same sign)',
        'Continuous, noisy time course without large isolated deflections',
        'Strong evoked response between 300 and 700 ms in almost every trial',
        'Low correlation with the bipolar vertical EOG'
      ];
      c.trap = 'The case in Fig. 8 of the paper: its frontal weight makes it look like a blink. ADJUST and FASTER flagged it as a blink, and subtracting it wiped out almost the entire ERP at Fpz. SASICA did not flag it because it uses the difference between the two vertical EOG channels.';
      break;
    }
    case 'focal_neural': {
      const p = polar(R.range(0.45, 0.7), R.range(0, 360));
      f = (x, y) => G(x, y, p.x, p.y, 0.18);
      bg(0.97, 0.4); white(0.05);
      erp([[0.11, 1.2, 0.025], [0.18, -1.5, 0.035], [0.32, 0.9, 0.06]]);
      c.p = { loc: locName(p.x, p.y) };
      c.reasons = [
        `Focal but smooth topography: it spans several neighbouring electrodes over the ${c.p.loc}`,
        'Sharp evoked response, reliable across trials',
        'Autocorrelated time course, without the noise of a loose electrode',
        'Spectrum with a normal 1/f fall-off'
      ];
      c.trap = 'The case in Fig. 5E: some users took it for a bad channel. A bad channel loads on a single electrode and its signal is noise with no response to events.';
      break;
    }
    case 'blink': {
      f = (x, y) => Math.exp(-((y - 1.02) ** 2) / (2 * 0.17 ** 2)) * Math.exp(-(x * x) / (2 * 0.55 ** 2));
      eog = [-1.1, -1.1, -0.25, -0.25];
      white(0.1); bg(0.8, 0.08);
      for (let k = 0; k < NTR; k++) {
        const nb = R.u() < 0.38 ? (R.u() < 0.15 ? 2 : 1) : 0;
        for (let b = 0; b < nb; b++) {
          const c0 = R.range(-0.45, 0.95), A = R.range(14, 20), s = R.range(0.05, 0.08), o = k * NT;
          for (let t = 0; t < NT; t++) {
            const d = TIMES[t] - c0;
            tc[o + t] += A * Math.exp(-(d * d) / (2 * (d < 0 ? s * 0.7 : s * 1.3) ** 2));
          }
        }
      }
      c.corrV = R.range(0.85, 0.96); c.corrH = R.range(0.05, 0.2);
      c.reasons = [
        'Topography almost flat except at the most frontal electrodes' + (c.showEOG ? ', with an abrupt polarity reversal at the EOG channels below the eyes' : ''),
        'Large, brief, isolated deflections (200–400 ms) on an almost flat baseline',
        'No peak in physiological bands',
        'Very high correlation with the vertical EOG',
        'Usually among the first components because of its large amplitude'
      ];
      break;
    }
    case 'hsacc': {
      const s = R.sign();
      f = (x, y) => s * Math.tanh(x / 0.22) * Math.exp(-((y - 0.95) ** 2) / (2 * 0.3 ** 2));
      eog = [-0.5 * s, 0.5 * s, -1.2 * s, 1.2 * s];
      white(0.12); bg(0.8, 0.1); steps(0.5, 2.5, 4);
      c.corrH = R.range(0.82, 0.95); c.corrV = R.range(0.05, 0.25);
      c.reasons = [
        'Frontal topography with opposite polarity on each side' + (c.showEOG ? ', maximal at the outer canthus EOG channels' : ''),
        'Step-like changes: the signal jumps and stays there while gaze is deviated',
        'No peak in physiological bands',
        'High correlation with the horizontal EOG'
      ];
      break;
    }
    case 'vsacc': {
      f = (x, y) => Math.exp(-((y - 0.95) ** 2) / (2 * 0.25 ** 2)) * Math.exp(-(x * x) / (2 * 0.6 ** 2));
      eog = [-0.9, -0.9, -0.2, -0.2];
      white(0.12); bg(0.8, 0.1); steps(0.45, 2, 3.5);
      c.corrV = R.range(0.78, 0.92); c.corrH = R.range(0.05, 0.2);
      c.reasons = [
        'Frontal topography similar to a blink',
        'But the time course shows sustained steps instead of brief peaks',
        'No peak in physiological bands',
        'High correlation with the vertical EOG'
      ];
      break;
    }
    case 'muscle': {
      const rng = R.pick([[60, 120], [-120, -60], [145, 215]]);
      const ang = R.range(rng[0], rng[1]), p = polar(0.92, ang);
      const two = R.u() < 0.5, p2 = polar(0.9, ang + R.sign() * 17);
      f = (x, y) => G(x, y, p.x, p.y, 0.13) - (two ? 0.85 * G(x, y, p2.x, p2.y, 0.11) : 0);
      const mode = R.pick(['sube', 'baja', 'pico']), kc = R.range(25, 75);
      const env = k => mode === 'sube' ? 0.25 + 0.95 * k / NTR : mode === 'baja' ? 1.2 - 0.95 * k / NTR : 0.25 + Math.exp(-(((k - kc) / 14) ** 2));
      blue(0.9, env); bg(0.5, 0.05);
      c.p = { loc: locName(p.x, p.y), mode };
      const modeTxt = { sube: 'it appears and builds up across trials', baja: 'it dissipates across trials', pico: 'it appears only during part of the experiment' };
      c.reasons = [
        `Very focal topography at the edge of the cap (${c.p.loc})` + (two ? ', with a neighbouring pole of opposite sign' : ''),
        'Continuous high-frequency noise that does not follow task events (no ERP)',
        `Amplitude varies across trials: ${modeTxt[mode]}`,
        'High power above 20 Hz',
        'Low autocorrelation'
      ];
      break;
    }
    case 'badchan': {
      wx = singleChan(R.sign());
      bg(0.97, 0.9); white(0.6);
      c.reasons = [
        `Topography restricted to a single electrode (${c.p.chanLoc})`,
        'Noisy time course in every trial, with slow drifts',
        'No response to events',
        'If the channel had been marked as bad, the correlation with it would be very high'
      ];
      break;
    }
    case 'rare_focal': {
      wx = singleChan(R.sign());
      white(0.12); bg(0.8, 0.06);
      const n = R.int(2, 4), used = new Set();
      while (used.size < n) used.add(R.int(0, NTR - 1));
      used.forEach(k => burst(k, R.range(12, 20), R.range(0.02, 0.06)));
      c.reasons = [
        `Focal topography at one electrode (${c.p.chanLoc}): it also qualifies as a bad channel`,
        `Almost flat time course except for ${n} trials with high-amplitude events`,
        'Focal trial activity measure far above threshold',
        'Alternative: reject those trials and recompute the ICA'
      ];
      break;
    }
    case 'rare_spread': {
      f = randBlobs(3, 0.85, 0.3, 0.5);
      white(0.12); bg(0.8, 0.06);
      const n = R.int(2, 4), used = new Set();
      while (used.size < n) used.add(R.int(0, NTR - 1));
      used.forEach(k => burst(k, R.range(10, 16), R.range(0.1, 0.25)));
      c.reasons = [
        'Irregular, unpredictable topography (the event affected many electrodes, e.g. touching the cap)',
        `Almost flat time course except for ${n} trials with huge activity`,
        'Very high temporal kurtosis and focal trial activity',
        'Alternative: reject those trials and recompute the ICA'
      ];
      break;
    }
    case 'noisy_events': {
      const p = polar(0.9, R.pick([R.range(60, 120), R.range(-120, -60)]));
      f = (x, y) => G(x, y, p.x, p.y, 0.14);
      blue(0.5); erp([[0.15, 0.4, 0.04], [0.3, -0.4, 0.06]]);
      const used = new Set();
      while (used.size < 3) used.add(R.int(0, NTR - 1));
      used.forEach(k => burst(k, R.range(10, 14), R.range(0.03, 0.08)));
      c.reasons = [
        'Focal topography at the edge of the cap and high-frequency noise, like muscle',
        'But a few trials contain huge brief events that dominate the signal',
        'There is also some evoked activity',
        'The experts classified it as a rare event, not as pure muscle'
      ];
      c.trap = 'The case in Fig. 4F: a mixture. Low autocorrelation points to muscle, but the few high-amplitude events are what decides it.';
      break;
    }
    case 'badchan_fewtrials': {
      wx = singleChan(R.sign());
      white(0.15); bg(0.8, 0.08);
      const k0 = R.int(10, 80), len = R.int(6, 10);
      for (let k = k0; k < k0 + len; k++) {
        let x = 0; const o = k * NT;
        for (let t = 0; t < NT; t++) { x = 0.97 * x + R.n() * 0.5; tc[o + t] += x + R.n() * 3; }
      }
      c.reasons = [
        `Single-electrode topography (${c.p.chanLoc}), like a bad channel`,
        `But the noise is only present during ${len} consecutive trials`,
        'Outside that stretch the signal is almost flat',
        'The experts classified it as a rare event (few trials)'
      ];
      c.trap = 'The case in Fig. 5F: overlap between bad channel and rare event. Both answers lead to rejection, but look at which trials contain the noise.';
      break;
    }
    case 'other': {
      f = randBlobs(R.int(2, 4), 0.9, 0.2, 0.45);
      bg(0.95, 0.5); white(0.15);
      erp([[0.15, -0.6, 0.04], [0.35, 0.5, 0.08]], 0.5);
      for (let k = 0; k < NTR; k++) if (R.u() < 0.03) burst(k, R.range(1.5, 2.5), 0.1);
      c.reasons = [
        'Spread-out, irregular topography with several poles that do not form a dipole',
        'Mixture of noise and some evoked response',
        'No property clearly matches a single artifact type',
        'The paper recommends not rejecting these systematically: part of the signal may be neural'
      ];
      break;
    }
    case 'focal_nonmuscle': {
      const p = polar(0.88, R.pick([R.range(55, 125), R.range(-125, -55)]));
      f = (x, y) => G(x, y, p.x, p.y, 0.14);
      bg(0.97, 0.8); white(0.08);
      erp([[0.2, 0.4, 0.06]], 0.6);
      c.reasons = [
        'Focal topography at the edge of the cap, like muscle',
        'But the time course is slow and irregular, without the continuous high-frequency noise of muscle',
        'Spectrum dominated by low frequencies, with no excess above 20 Hz',
        'High autocorrelation'
      ];
      c.trap = 'The case in Fig. 4E: users often mistake peripheral focal components for muscle. Without sustained noise, it is not muscle.';
      break;
    }
  }

  const w = new Float32Array(NCH), we = new Float32Array(4);
  if (wx) w.set(wx); else for (let i = 0; i < NCH; i++) w[i] = f(CH[i].x, CH[i].y) + R.n() * 0.015;
  for (let j = 0; j < 4; j++) we[j] = (eog ? eog[j] : f ? f(EOGPOS[j].x, EOGPOS[j].y) : 0) + R.n() * 0.015;
  let m = 0;
  for (const v of w) m = Math.max(m, Math.abs(v));
  for (const v of we) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < NCH; i++) w[i] /= m;
  for (let j = 0; j < 4; j++) we[j] /= m;
  c.w = w; c.we = we; c.tc = tc;
  let ms = 0, sw = 0;
  for (const v of tc) ms += v * v;
  for (const v of w) sw += v * v;
  c.variance = ms / tc.length * sw;
  c.raw = rawMeasures(c);
  return c;
}

const MEASURES = [
  { k: 'LoAC', tool: 'SASICA', dir: -1, kSD: 2, name: 'Low autocorrelation', what: 'Autocorrelation of the time course at a 20 ms lag. Neural components are strongly autocorrelated; muscle is not.', target: 'Muscle' },
  { k: 'FocCh', tool: 'SASICA', dir: 1, kSD: 2, name: 'Focal topography', what: 'Maximum z-score of the inverse weights across channels. High when one electrode dominates.', target: 'Bad channel, rare event' },
  { k: 'FocTr', tool: 'SASICA', dir: 1, kSD: 2, name: 'Focal trial activity', what: 'Maximum z-score of the range (max − min) across trials. High when a few trials dominate.', target: 'Rare event' },
  { k: 'CorrV', tool: 'SASICA', dir: 1, kSD: 4, name: 'Vertical EOG correlation', what: 'Correlation with the difference of the vertical EOG channels (bipolar). More conservative threshold: 4 SD.', target: 'Blink, vertical saccade' },
  { k: 'CorrH', tool: 'SASICA', dir: 1, kSD: 4, name: 'Horizontal EOG correlation', what: 'Correlation with the difference of the horizontal EOG channels. Threshold: 4 SD.', target: 'Horizontal saccade' },
  { k: 'TK', tool: 'ADJUST', dir: 1, kSD: 2, name: 'Temporal kurtosis', what: 'Kurtosis of the time course: high when there are rare high-amplitude events. ADJUST combines it with spatial measures.', target: 'Blink, rare event' }
];

function rawMeasures(c) {
  const tc = c.tc;
  let num = 0, den = 0;
  const ranges = new Float32Array(NTR);
  for (let k = 0; k < NTR; k++) {
    const o = k * NT; let m = 0, mx = -Infinity, mn = Infinity;
    for (let t = 0; t < NT; t++) { const v = tc[o + t]; m += v; if (v > mx) mx = v; if (v < mn) mn = v; }
    m /= NT; ranges[k] = mx - mn;
    for (let t = 0; t < NT; t++) {
      const a = tc[o + t] - m; den += a * a;
      if (t >= LAG) num += a * (tc[o + t - LAG] - m);
    }
  }
  const zmax = (arr, abs) => {
    let mu = 0; for (const v of arr) mu += v; mu /= arr.length;
    let sd = 0; for (const v of arr) sd += (v - mu) ** 2; sd = Math.sqrt(sd / (arr.length - 1)) || 1;
    let mx = -Infinity; for (const v of arr) { const z = (v - mu) / sd; mx = Math.max(mx, abs ? Math.abs(z) : z); }
    return mx;
  };
  let mu = 0; for (const v of tc) mu += v; mu /= tc.length;
  let m2 = 0, m4 = 0; for (const v of tc) { const d = (v - mu) ** 2; m2 += d; m4 += d * d; }
  m2 /= tc.length; m4 /= tc.length;
  return { LoAC: num / den, FocCh: zmax(c.w, true), FocTr: zmax(ranges, false), CorrV: c.corrV, CorrH: c.corrH, TK: m4 / (m2 * m2) - 3 };
}

function thresholds(comps) {
  const out = {};
  for (const M of MEASURES) {
    const vals = comps.map(c => c.raw[M.k]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1)) || 1;
    out[M.k] = { mean, sd, cut: mean + M.dir * M.kSD * sd };
  }
  return out;
}
function scores(c, thr) {
  const out = {};
  for (const M of MEASURES) {
    const z = (c.raw[M.k] - thr[M.k].mean) / thr[M.k].sd * M.dir;
    out[M.k] = { z, ratio: z / M.kSD, pass: z > M.kSD };
  }
  return out;
}

function genDataset(seed) {
  const R = makeRng(seed);
  const plan = [];
  const neuralPool = ['alpha', 'alpha', 'beta', 'beta', 'theta', 'evoked', 'evoked'];
  for (let i = 0; i < 7; i++) plan.push(R.pick(neuralPool));
  if (R.u() < 0.6) plan.push('neural_frontal'); else plan.push(R.pick(neuralPool));
  if (R.u() < 0.5) plan.push('focal_neural');
  plan.push('blink', 'hsacc');
  if (R.u() < 0.5) plan.push('vsacc');
  const nm = R.int(4, 6); for (let i = 0; i < nm; i++) plan.push('muscle');
  const nb = R.int(1, 2); for (let i = 0; i < nb; i++) plan.push('badchan');
  const nr = R.int(1, 2); for (let i = 0; i < nr; i++) plan.push(R.pick(['rare_focal', 'rare_spread', 'noisy_events', 'badchan_fewtrials']));
  let nfm = 0;
  while (plan.length < 40) { if (nfm < 2 && R.u() < 0.1) { plan.push('focal_nonmuscle'); nfm++; } else plan.push('other'); }
  const comps = plan.map((s, i) => genComponent(s, (seed * 7919 + i * 104729 + 17) >>> 0));
  comps.sort((a, b) => b.variance - a.variance);
  return { seed, comps, thr: thresholds(comps) };
}

// Radix-2 FFT and trial-averaged spectrum (Hann window, zero-padded to 256)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
function spectrum(c) {
  if (c.spec) return c.spec;
  const N = 256, P = new Float64Array(N / 2 + 1), re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k < NTR; k++) {
    re.fill(0); im.fill(0);
    let m = 0; for (let t = 0; t < NT; t++) m += c.tc[k * NT + t]; m /= NT;
    for (let t = 0; t < NT; t++) re[t] = (c.tc[k * NT + t] - m) * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / (NT - 1)));
    fft(re, im);
    for (let b = 0; b <= N / 2; b++) P[b] += re[b] * re[b] + im[b] * im[b];
  }
  const fq = [], db = [];
  for (let b = 1; b <= N / 2; b++) {
    const fr = b * FS / N;
    if (fr < 2 || fr > 50) continue;
    const filt = 1 / (1 + (fr / 45) ** 16);
    fq.push(fr); db.push(10 * Math.log10(P[b] / NTR * filt + 1e-9));
  }
  return (c.spec = { fq, db });
}

// Signal detection
function normInv(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const cc = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((cc[0] * q + cc[1]) * q + cc[2]) * q + cc[3]) * q + cc[4]) * q + cc[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((cc[0] * q + cc[1]) * q + cc[2]) * q + cc[3]) * q + cc[4]) * q + cc[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function sdt(hits, nSig, fas, nNoise) {
  const hr = nSig ? hits / nSig : 0, far = nNoise ? fas / nNoise : 0;
  const zh = normInv((hits + 0.5) / (nSig + 1)), zf = normInv((fas + 0.5) / (nNoise + 1));
  return { hr, far, d: zh - zf, c: -(zh + zf) / 2 };
}

if (typeof module !== 'undefined') module.exports = { genComponent, genDataset, thresholds, scores, spectrum, sdt, SUBS, CATS, MEASURES };
