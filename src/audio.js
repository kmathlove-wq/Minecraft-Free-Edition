// ===== 절차적 사운드 (WebAudio, 외부 파일 없음) =====
let ctx = null;
let master = null;
let enabled = true;

function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return ctx;
}

export function resumeAudio() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
}
export function setVolume(v) { if (master) master.gain.value = v; }
export function setAudioEnabled(v) { enabled = v; }

function noiseBuffer(dur) {
    const c = ensure();
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
}

/** 노이즈 기반 타격음 (발소리·채굴음) */
function burst({ dur = 0.12, freq = 800, q = 1.2, gain = 0.5, type = 'bandpass', decay = 1 }) {
    const c = ensure();
    if (!c || !enabled) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * decay);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
}

/** 음정이 있는 짧은 음 */
function tone({ freq = 440, dur = 0.15, gain = 0.25, type = 'sine', to = null }) {
    const c = ensure();
    if (!c || !enabled) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    const t = c.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur);
}

// 재질별 발소리 파라미터
const STEP = {
    stone:  { freq: 1400, q: 1.0, gain: 0.30, dur: 0.07 },
    grass:  { freq: 2600, q: 0.6, gain: 0.22, dur: 0.09 },
    sand:   { freq: 3200, q: 0.4, gain: 0.18, dur: 0.10 },
    gravel: { freq: 1800, q: 0.8, gain: 0.28, dur: 0.08 },
    wood:   { freq: 900,  q: 2.0, gain: 0.30, dur: 0.07 },
    snow:   { freq: 4200, q: 0.5, gain: 0.16, dur: 0.09 },
    wool:   { freq: 700,  q: 0.7, gain: 0.16, dur: 0.09 }
};

export const sfx = {
    step(mat = 'stone') {
        const p = STEP[mat] || STEP.stone;
        burst({ ...p, gain: p.gain * (0.8 + Math.random() * 0.4), freq: p.freq * (0.85 + Math.random() * 0.3) });
    },
    dig(mat = 'stone') {
        const p = STEP[mat] || STEP.stone;
        burst({ ...p, dur: p.dur * 0.8, gain: p.gain * 0.55, freq: p.freq * (0.7 + Math.random() * 0.5) });
    },
    breakBlock(mat = 'stone') {
        const p = STEP[mat] || STEP.stone;
        burst({ ...p, dur: 0.22, gain: p.gain * 1.1, freq: p.freq * 0.8, decay: 0.9 });
        burst({ dur: 0.16, freq: 300, q: 0.6, gain: 0.12 });
    },
    place(mat = 'stone') {
        const p = STEP[mat] || STEP.stone;
        burst({ ...p, dur: 0.10, gain: p.gain * 0.9 });
    },
    hurt() { tone({ freq: 340, to: 150, dur: 0.22, gain: 0.3, type: 'square' }); },
    die() { tone({ freq: 300, to: 80, dur: 0.9, gain: 0.3, type: 'triangle' }); },
    eat() { burst({ dur: 0.09, freq: 500, q: 1.5, gain: 0.22 }); },
    pop() { tone({ freq: 700, to: 1100, dur: 0.08, gain: 0.18, type: 'sine' }); },
    click() { tone({ freq: 900, dur: 0.05, gain: 0.15, type: 'square' }); },
    craft() { tone({ freq: 660, to: 990, dur: 0.12, gain: 0.18 }); },
    splash() { burst({ dur: 0.35, freq: 900, q: 0.4, gain: 0.3, type: 'lowpass' }); },
    explode() {
        burst({ dur: 0.9, freq: 180, q: 0.3, gain: 0.6, type: 'lowpass' });
        tone({ freq: 90, to: 30, dur: 0.7, gain: 0.35, type: 'sawtooth' });
    },
    mob(kind) {
        if (kind === 'zombie') tone({ freq: 180, to: 120, dur: 0.5, gain: 0.22, type: 'sawtooth' });
        else if (kind === 'skeleton') { burst({ dur: 0.08, freq: 2200, q: 3, gain: 0.2 }); burst({ dur: 0.08, freq: 1800, q: 3, gain: 0.18 }); }
        else if (kind === 'cow') tone({ freq: 200, to: 150, dur: 0.7, gain: 0.2, type: 'sawtooth' });
        else if (kind === 'pig') tone({ freq: 420, to: 280, dur: 0.25, gain: 0.2, type: 'square' });
        else if (kind === 'sheep') tone({ freq: 520, to: 420, dur: 0.5, gain: 0.18, type: 'triangle' });
        else if (kind === 'chicken') tone({ freq: 1200, to: 800, dur: 0.15, gain: 0.16, type: 'square' });
    }
};
