// Sunset Bay — sound.js
// WebAudio 程序化音效：引擎、警笛、拾取、撞击、任务完成。不带任何外部音频文件。
// 浏览器里第一次调用时才建 AudioContext（避免自动播放限制）；
// node / 无 WebAudio 的环境里所有函数都是静默空操作，加载与调用都不报错。
//
// 用法（main.js）：
//   import { sound } from './sound.js';
//   sound.engine(true);          // 上车后启动引擎声
//   sound.engineSpeed(0.6);      // 车速 0–1，引擎音调跟车速走
//   sound.engine(false);         // 下车 / 熄火
//   sound.siren(true);           // 有通缉时警笛响，sound.siren(false) 停
//   sound.pickup(); sound.crash(); sound.missionDone(); sound.click();
//   sound.setMuted(true);        // 静音开关（M 键之外另设，建议 main.js 绑到静音键）

const HAS_AUDIO =
  typeof window !== 'undefined' &&
  (typeof window.AudioContext === 'function' || typeof window.webkitAudioContext === 'function');

let ctx = null;
let master = null;
let muted = false;

let engineNodes = null; // { osc, osc2, filter, gain }
let sirenNodes = null; // { osc, gain, timer }

function ensureContext() {
  if (!HAS_AUDIO) return null;
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

function now() {
  return ctx ? ctx.currentTime : 0;
}

/** 一段滑音的振荡器音：频率从 from 滑到 to，持续 dur 秒后停。 */
function tone({ freq = 440, freqEnd = null, dur = 0.15, type = 'sine', volume = 0.2, delay = 0 }) {
  const audio = ensureContext();
  if (!audio) return;
  const t0 = now() + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** 一段噪声（撞击、刹车用）：白噪声过低通，持续 dur 秒。 */
function noise({ dur = 0.2, volume = 0.3, cutoff = 800, delay = 0 }) {
  const audio = ensureContext();
  if (!audio) return;
  const t0 = now() + delay;
  const length = Math.max(1, Math.floor(audio.sampleRate * dur));
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0);
}

function engineOn() {
  const audio = ensureContext();
  if (!audio || engineNodes) return;
  const osc = audio.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 70;
  const osc2 = audio.createOscillator();
  osc2.type = 'square';
  osc2.frequency.value = 35;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 400;
  const gain = audio.createGain();
  gain.gain.value = 0.0;
  gain.gain.linearRampToValueAtTime(0.08, now() + 0.2);
  osc.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  osc.start();
  osc2.start();
  engineNodes = { osc, osc2, filter, gain, speed: 0 };
}

function engineOff() {
  if (!engineNodes) return;
  const nodes = engineNodes;
  engineNodes = null;
  try {
    nodes.gain.gain.linearRampToValueAtTime(0.0001, now() + 0.15);
    nodes.osc.stop(now() + 0.2);
    nodes.osc2.stop(now() + 0.2);
  } catch {
    // 停引擎失败也不影响游戏。
  }
}

function sirenOn() {
  const audio = ensureContext();
  if (!audio || sirenNodes) return;
  const osc = audio.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 700;
  const gain = audio.createGain();
  gain.gain.value = 0.05;
  osc.connect(gain);
  gain.connect(master);
  osc.start();
  let high = false;
  const timer = setInterval(() => {
    if (!sirenNodes) return;
    high = !high;
    try {
      osc.frequency.setValueAtTime(high ? 950 : 700, audio.currentTime);
    } catch {
      // 频率切不过去就保持当前音调。
    }
  }, 450);
  sirenNodes = { osc, gain, timer };
}

function sirenOff() {
  if (!sirenNodes) return;
  const nodes = sirenNodes;
  sirenNodes = null;
  try {
    clearInterval(nodes.timer);
    nodes.gain.gain.linearRampToValueAtTime(0.0001, now() + 0.1);
    nodes.osc.stop(now() + 0.15);
  } catch {
    // 停警笛失败也不影响游戏。
  }
}

export const sound = {
  /** 引擎声开关：上车 engine(true)，下车 engine(false)。 */
  engine(on) {
    if (on) engineOn();
    else engineOff();
  },

  /** 车速 0–1：引擎音调与音量跟车速走。没启动引擎时调用无效。 */
  engineSpeed(speed) {
    if (!engineNodes || !ctx) return;
    const v = Math.max(0, Math.min(1, speed || 0));
    try {
      engineNodes.osc.frequency.setTargetAtTime(70 + v * 180, ctx.currentTime, 0.05);
      engineNodes.osc2.frequency.setTargetAtTime(35 + v * 90, ctx.currentTime, 0.05);
      engineNodes.filter.frequency.setTargetAtTime(400 + v * 1200, ctx.currentTime, 0.05);
      engineNodes.gain.gain.setTargetAtTime(0.05 + v * 0.07, ctx.currentTime, 0.05);
    } catch {
      // 参数推不上去就保持上一档。
    }
  },

  /** 警笛开关：有通缉 siren(true)，通缉清零 siren(false)。 */
  siren(on) {
    if (on) sirenOn();
    else sirenOff();
  },

  /** 拾取（接乘客 / 取包裹 / 赚钱）：两声上扬的清脆 blip。 */
  pickup() {
    tone({ freq: 660, dur: 0.09, type: 'sine', volume: 0.18 });
    tone({ freq: 990, dur: 0.14, type: 'sine', volume: 0.18, delay: 0.08 });
  },

  /** 撞击：低频闷响 + 噪声。 */
  crash() {
    noise({ dur: 0.25, volume: 0.35, cutoff: 500 });
    tone({ freq: 120, freqEnd: 45, dur: 0.3, type: 'sine', volume: 0.3 });
  },

  /** 任务完成：四音上行小琶音。 */
  missionDone() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      tone({ freq, dur: 0.22, type: 'triangle', volume: 0.2, delay: i * 0.11 });
    });
  },

  /** 任务失败：两声下行低音。 */
  missionFailed() {
    tone({ freq: 320, dur: 0.2, type: 'sawtooth', volume: 0.12 });
    tone({ freq: 210, dur: 0.35, type: 'sawtooth', volume: 0.12, delay: 0.16 });
  },

  /** 界面点击 / 确认。 */
  click() {
    tone({ freq: 880, dur: 0.06, type: 'sine', volume: 0.12 });
  },

  /** 静音开关。 */
  setMuted(value) {
    muted = !!value;
    if (master && ctx) {
      try {
        master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
      } catch {
        // 静音切不过去就保持原样。
      }
    }
  },

  isMuted() {
    return muted;
  },

  toggleMuted() {
    this.setMuted(!muted);
    return muted;
  },

  /** 换场景 / 退出到标题时调用：停掉引擎与警笛。 */
  stopAll() {
    engineOff();
    sirenOff();
  },
};
