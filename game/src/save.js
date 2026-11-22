// Sunset Bay — save.js
// localStorage 存档：金钱、已完成任务、最佳成绩。标题屏显示“继续”时用 loadSave()。
// 本文件不依赖 world.js，只处理纯数据；不画、不碰游戏循环。
// 浏览器外（node 冒烟测试）没有 localStorage 时，所有读写静默走内存回退，不报错。

export const SAVE_KEY = 'sunset-bay.save.v1';
export const SAVE_VERSION = 1;

/** 存档形状（v1）：{ version, money, completedMissions, best, savedAt }。 */
function blankSave() {
  return {
    version: SAVE_VERSION,
    money: 0,
    completedMissions: [],
    best: { money: 0, missionsCompleted: 0, packageRunSeconds: null },
    savedAt: 0,
  };
}

function storageAvailable() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

// node / 无 localStorage 环境下的内存回退：测试能跑，游戏内无影响。
let memoryFallback = null;

function readRaw() {
  if (storageAvailable()) {
    try {
      return localStorage.getItem(SAVE_KEY);
    } catch {
      return null;
    }
  }
  return memoryFallback;
}

function writeRaw(text) {
  if (storageAvailable()) {
    try {
      localStorage.setItem(SAVE_KEY, text);
      return true;
    } catch {
      return false;
    }
  }
  memoryFallback = text;
  return true;
}

function removeRaw() {
  if (storageAvailable()) {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // 存档删不掉也不影响游戏。
    }
  }
  memoryFallback = null;
}

/** 校验并规整一份读出来的存档；形状不对返回 null（当作无存档）。 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const save = blankSave();
  if (typeof raw.money === 'number' && Number.isFinite(raw.money)) {
    save.money = Math.max(0, Math.floor(raw.money));
  }
  if (Array.isArray(raw.completedMissions)) {
    save.completedMissions = raw.completedMissions.filter((id) => typeof id === 'string');
  }
  if (raw.best && typeof raw.best === 'object') {
    if (typeof raw.best.money === 'number' && Number.isFinite(raw.best.money)) {
      save.best.money = Math.max(0, Math.floor(raw.best.money));
    }
    if (typeof raw.best.missionsCompleted === 'number' && Number.isFinite(raw.best.missionsCompleted)) {
      save.best.missionsCompleted = Math.max(0, Math.floor(raw.best.missionsCompleted));
    }
    if (typeof raw.best.packageRunSeconds === 'number' && Number.isFinite(raw.best.packageRunSeconds)) {
      save.best.packageRunSeconds = Math.max(0, raw.best.packageRunSeconds);
    }
  }
  if (typeof raw.savedAt === 'number') save.savedAt = raw.savedAt;
  return save;
}

/**
 * 读档。没有存档 / 存档损坏 / 存储不可用时返回 null。
 * main.js 在标题屏用它决定是否显示“继续”。
 */
export function loadSave() {
  let parsed = null;
  try {
    parsed = JSON.parse(readRaw() || 'null');
  } catch {
    return null;
  }
  return normalize(parsed);
}

/** 是否有可用存档。 */
export function hasSave() {
  return loadSave() !== null;
}

/**
 * 合并最佳成绩：只进不出。money 取历史最高持有金钱，
 * missionsCompleted 取历史最多完成任务数，packageRunSeconds 取最快送件用时（越小越好）。
 */
export function mergeBest(oldBest, candidate) {
  const base = { ...(oldBest || blankSave().best) };
  const next = { ...(candidate || {}) };
  return {
    money: Math.max(base.money || 0, next.money || 0),
    missionsCompleted: Math.max(base.missionsCompleted || 0, next.missionsCompleted || 0),
    packageRunSeconds:
      base.packageRunSeconds === null || base.packageRunSeconds === undefined
        ? next.packageRunSeconds ?? null
        : next.packageRunSeconds === null || next.packageRunSeconds === undefined
          ? base.packageRunSeconds
          : Math.min(base.packageRunSeconds, next.packageRunSeconds),
  };
}

/**
 * 存档。profile: { money, completedMissions, best? }，一般直接传 missions.snapshot()
 * 再加 money；best 省略时按当前值合并。
 * 返回 true 表示写成功（存储被禁时返回 false，但游戏继续跑）。
 * 用法：saveGame({ money: world.state.money, completedMissions: missions.state.completed })
 */
export function saveGame(profile) {
  const prev = loadSave() || blankSave();
  const save = blankSave();
  if (profile && typeof profile.money === 'number' && Number.isFinite(profile.money)) {
    save.money = Math.max(0, Math.floor(profile.money));
  } else {
    save.money = prev.money;
  }
  if (profile && Array.isArray(profile.completedMissions)) {
    save.completedMissions = profile.completedMissions.filter((id) => typeof id === 'string');
  } else {
    save.completedMissions = prev.completedMissions;
  }
  save.best = mergeBest(prev.best, profile && profile.best ? profile.best : null);
  // 当前金钱也计入最佳持有金钱。
  save.best.money = Math.max(save.best.money, save.money);
  save.best.missionsCompleted = Math.max(save.best.missionsCompleted, save.completedMissions.length);
  try {
    save.savedAt = Date.now();
  } catch {
    save.savedAt = 0;
  }
  try {
    return writeRaw(JSON.stringify(save));
  } catch {
    return false;
  }
}

/**
 * 从 world.state 直接取数存档的快捷方式（main.js 在任务完成 / 结算时调用）。
 * world.state 须有 money；missions 可传可不传（不传则只存钱与旧任务进度）。
 */
export function saveFromWorld(state, missions) {
  const profile = { money: typeof state.money === 'number' ? state.money : 0 };
  if (missions && typeof missions.snapshot === 'function') {
    const snap = missions.snapshot();
    profile.completedMissions = snap.completedMissions;
    profile.best = snap.best;
  }
  return saveGame(profile);
}

/** 删档（新游戏时用）。 */
export function clearSave() {
  removeRaw();
}
