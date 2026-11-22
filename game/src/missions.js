// Sunset Bay — missions.js
// 3 个递进任务：第一单 → 限时送件 → 甩掉警察。主角 Milo，城市 Sunset Bay。
// 本文件只含任务规则与流程，不画、不碰浏览器、不碰 localStorage（存档见 save.js）。
//
// ── 与 world.js 的约定（工人 A 若还没改完 world.js，按此对接；本文件按此假设写）──
// world.state 须有：
//   player: { x, y, inCar: boolean, carId: string|number|null }
//     玩家位置用世界坐标；开车时 player.x/y 仍可用（world 负责同步到所驾车辆位置，
//     若不同步，本文件会优先读所驾车辆的 x/y，见 playerPosition）。
//   cars: [{ id, kind: 'taxi'|'civilian'|'police'|..., x, y, ... }]
//     任务 1 需要一辆 kind === 'taxi' 的车；若没有，退化为“上离玩家最近的车”。
//   wanted: 0–5 的通缉星级（world 的警察系统负责增减；任务 3 只读取它）。
//   money: 玩家金钱（数字）；任务完成时本文件直接累加奖励。
//   elapsed: 游戏内累计秒数（可选，用于记录用时；没有则用性能计时回退）。
// world.state.mission 由本文件创建并维护，render.js / HUD 直接读它画标记与目标文字。
//
// 任务流程（每个任务都一样）：接取 → 指引标记（state.mission.target）→
// 完成给钱（state.money += reward）→ 解锁下一单；三单做完出“湾区小有名气”结算。
//
// 用法（main.js / world.js 里）：
//   import { createMissions, MISSION_EVENT_DONE } from './missions.js';
//   const missions = createMissions(world);          // world = { state }
//   missions.start();                                // 接下一单（按顺序解锁）
//   const events = missions.update(STEP);            // 每步调用，返回事件位标志
//   if (events & MISSION_EVENT_DONE) sound.missionDone();
//   // HUD / render 读 world.state.mission.objective 与 .target 画目标。

export const MISSION_EVENT_STAGE = 1; // 进入下一阶段（目标/标记变了）
export const MISSION_EVENT_DONE = 2; // 一个任务完成（钱已到账）
export const MISSION_EVENT_FAILED = 4; // 任务失败（限时到，可重接）
export const MISSION_EVENT_ALL_DONE = 8; // 三单全部做完，结算出炉
export const MISSION_EVENT_ACCEPTED = 16; // 接到新任务

export const MISSION_IDS = ['first-fare', 'package-run', 'lose-the-heat'];

/** 默认任务点（世界坐标）。city.js 的实际尺寸若不同，集成时用 options.places 覆盖。 */
export const DEFAULT_PLACES = {
  taxiStand: { x: 640, y: 1560, radius: 70, label: '出租车停靠点' },
  passenger: { x: 1480, y: 920, radius: 70, label: '乘客 · Palm Row' },
  dropoff: { x: 2520, y: 620, radius: 80, label: 'Bayview 酒店' },
  warehouse: { x: 520, y: 520, radius: 70, label: '仓库 · 取包裹' },
  crosstown: { x: 2720, y: 1920, radius: 80, label: '城南收货点' },
  hideout: { x: 880, y: 2040, radius: 80, label: '藏身处 · Coast Garage' },
};

/** 甩掉警察：通缉归零后还需保持这么久不被重新发现，才算甩掉。 */
export const ESCAPE_HOLD_SECONDS = 3;
/** 限时送件：从接单起算的总时限（秒）。 */
export const PACKAGE_TIME_LIMIT = 75;

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function playerPosition(world) {
  const state = world.state;
  const player = state.player;
  if (player && player.inCar && player.carId !== null && player.carId !== undefined) {
    const car = (state.cars || []).find((c) => c.id === player.carId);
    if (car) return { x: car.x, y: car.y };
  }
  return { x: player ? player.x : 0, y: player ? player.y : 0 };
}

/** 玩家是否在指定车里。carId 为 null 时只要在任意车里即可。 */
function playerInCar(world, carId) {
  const player = world.state.player;
  if (!player || !player.inCar) return false;
  return carId === null || carId === undefined || player.carId === carId;
}

function nearTarget(world, target) {
  if (!target) return false;
  const pos = playerPosition(world);
  return dist(pos.x, pos.y, target.x, target.y) <= target.radius;
}

/**
 * 任务定义。stage.check(world, ctrl) 返回 'done' | 'failed' | null（进行中）。
 * stage.target 为 null 表示该阶段没有地图标记（例如“先惹出 2 星通缉”）。
 * 阶段进入时调用 stage.onEnter(world, ctrl)（可用来记时间、锁定目标车辆等）。
 */
export const MISSION_DEFS = [
  {
    id: 'first-fare',
    title: '第一单 · First Fare',
    reward: 120,
    briefing: 'Milo 的第一单：开上出租车，去 Palm Row 接乘客，送到 Bayview 酒店。',
    stages: [
      {
        id: 'get-taxi',
        text: '上出租车（靠近出租车按 E）',
        target: (places) => places.taxiStand,
        onEnter(world, ctrl) {
          ctrl.pickTaxi(world);
        },
        check(world, ctrl) {
          return playerInCar(world, ctrl.taxiId) ? 'done' : null;
        },
      },
      {
        id: 'pickup',
        text: '去 Palm Row 接乘客',
        target: (places) => places.passenger,
        check(world) {
          return nearTarget(world, world.state.mission.target) ? 'done' : null;
        },
      },
      {
        id: 'dropoff',
        text: '把乘客送到 Bayview 酒店',
        target: (places) => places.dropoff,
        check(world) {
          return nearTarget(world, world.state.mission.target) ? 'done' : null;
        },
      },
    ],
  },
  {
    id: 'package-run',
    title: '限时送件 · Package Run',
    reward: 250,
    briefing: '仓库有个急件，75 秒内送过城。抄近路、别撞车，超时这单就黄了。',
    timeLimit: PACKAGE_TIME_LIMIT,
    stages: [
      {
        id: 'collect',
        text: '去仓库取包裹',
        target: (places) => places.warehouse,
        check(world) {
          return nearTarget(world, world.state.mission.target) ? 'done' : null;
        },
      },
      {
        id: 'deliver',
        text: '限时送到城南收货点',
        target: (places) => places.crosstown,
        check(world) {
          return nearTarget(world, world.state.mission.target) ? 'done' : null;
        },
      },
    ],
  },
  {
    id: 'lose-the-heat',
    title: '甩掉警察 · Lose the Heat',
    reward: 400,
    briefing: '这单带点风险：先把通缉搞到 2 星，再甩掉警车，开到 Coast Garage 藏身处。',
    stages: [
      {
        id: 'heat-up',
        text: '把通缉搞到 2 星（偷车、撞车都会涨星）',
        target: null,
        check(world) {
          return (world.state.wanted || 0) >= 2 ? 'done' : null;
        },
      },
      {
        id: 'escape',
        text: '甩掉警车：保持 3 秒不被通缉',
        target: null,
        check(world, ctrl) {
          if ((world.state.wanted || 0) > 0) {
            ctrl.escapeHeld = 0;
            return null;
          }
          ctrl.escapeHeld += ctrl.lastDt;
          return ctrl.escapeHeld >= ESCAPE_HOLD_SECONDS ? 'done' : null;
        },
      },
      {
        id: 'hideout',
        text: '开到藏身处 · Coast Garage',
        target: (places) => places.hideout,
        check(world) {
          return nearTarget(world, world.state.mission.target) ? 'done' : null;
        },
      },
    ],
  },
];

export function missionDef(id) {
  return MISSION_DEFS.find((def) => def.id === id) || null;
}

export function createMissions(world, options = {}) {
  const places = { ...DEFAULT_PLACES, ...(options.places || {}) };
  const state = world.state;

  // world.state.mission 是任务的唯一事实来源，render/HUD/save 都读它。
  if (!state.mission) {
    state.mission = {
      activeId: null,
      stageIndex: 0,
      stageId: null,
      objective: '',
      target: null,
      timer: null,
      timeLimit: null,
      completed: [],
      rewardsEarned: 0,
      allDone: false,
      finale: null,
      failed: null,
    };
  }
  const mission = state.mission;
  if (!Array.isArray(mission.completed)) mission.completed = [];
  if (typeof mission.rewardsEarned !== 'number') mission.rewardsEarned = 0;

  const ctrl = {
    world,
    places,
    taxiId: null,
    escapeHeld: 0,
    lastDt: 0,
    /** 任务进行中的每步计时（秒），用于记录用时与最佳成绩。 */
    activeElapsed: 0,
    pickTaxi,
  };

  /** 下一个可接的任务（按顺序解锁）；全部做完返回 null。 */
  function nextMissionId() {
    for (const id of MISSION_IDS) {
      if (!mission.completed.includes(id)) return id;
    }
    return null;
  }

  function currentDef() {
    return mission.activeId ? missionDef(mission.activeId) : null;
  }

  function enterStage(index) {
    const def = currentDef();
    if (!def) return;
    const stage = def.stages[index];
    mission.stageIndex = index;
    mission.stageId = stage.id;
    mission.objective = stage.text;
    mission.target = stage.target ? { ...stage.target(places) } : null;
    if (stage.onEnter) stage.onEnter(world, ctrl);
  }

  /**
   * 接任务。id 省略时接下一单；已完成 / 顺序未到 / 已有进行中的任务时返回 false。
   * 返回 true 表示接取成功。
   */
  function start(id) {
    const wanted = id || nextMissionId();
    if (!wanted) return false;
    if (mission.activeId) return false;
    if (mission.completed.includes(wanted)) return false;
    const def = missionDef(wanted);
    if (!def) return false;
    // 顺序解锁：只能接第一个未完成的任务。
    if (wanted !== nextMissionId()) return false;
    mission.activeId = wanted;
    mission.failed = null;
    mission.timeLimit = def.timeLimit || null;
    mission.timer = def.timeLimit || null;
    ctrl.activeElapsed = 0;
    ctrl.escapeHeld = 0;
    ctrl.taxiId = null;
    enterStage(0);
    return true;
  }

  /** 放弃当前任务（不计失败，可重接）。 */
  function abandon() {
    if (!mission.activeId) return false;
    mission.activeId = null;
    mission.stageId = null;
    mission.objective = '';
    mission.target = null;
    mission.timer = null;
    mission.timeLimit = null;
    return true;
  }

  /**
   * 选任务 1 的出租车：world 里 kind === 'taxi' 的车，离玩家最近的一辆；
   * 没有出租车时退化为离玩家最近的任意车（stage 文本仍提示上车，见 pickTaxi 注释）。
   */
  function pickTaxi(worldRef) {
    const cars = (worldRef.state.cars || []).filter((c) => c && typeof c.x === 'number');
    if (cars.length === 0) {
      ctrl.taxiId = null;
      return null;
    }
    const pos = playerPosition(worldRef);
    let best = null;
    let bestDist = Infinity;
    for (const car of cars) {
      const score = car.kind === 'taxi' ? 0 : 100000;
      const d = score + dist(pos.x, pos.y, car.x, car.y);
      if (d < bestDist) {
        bestDist = d;
        best = car;
      }
    }
    ctrl.taxiId = best ? best.id : null;
    // 标记会跟随这辆车移动：目标点每步刷新为该车位置（update 里做）。
    return best;
  }

  /** 任务 1 的标记跟随出租车：若车在移动，目标点就是车当前的位置。 */
  function refreshTaxiTarget() {
    if (mission.activeId !== 'first-fare' || mission.stageId !== 'get-taxi') return;
    if (ctrl.taxiId === null || ctrl.taxiId === undefined) return;
    const car = (state.cars || []).find((c) => c.id === ctrl.taxiId);
    if (car) {
      mission.target = { x: car.x, y: car.y, radius: 70, label: '出租车' };
    }
  }

  function completeMission(def, events) {
    state.money = (typeof state.money === 'number' ? state.money : 0) + def.reward;
    mission.rewardsEarned += def.reward;
    mission.completed.push(def.id);
    mission.activeId = null;
    mission.stageId = null;
    mission.objective = '';
    mission.target = null;
    mission.timer = null;
    mission.timeLimit = null;
    let result = events | MISSION_EVENT_DONE;
    if (mission.completed.length >= MISSION_IDS.length) {
      mission.allDone = true;
      mission.finale = {
        title: '湾区小有名气',
        text: `Milo 跑完了三单，赚了 $${mission.rewardsEarned}。Sunset Bay 开始传他的名字了。`,
        totalEarned: mission.rewardsEarned,
      };
      result |= MISSION_EVENT_ALL_DONE;
    }
    return result;
  }

  /**
   * 每步调用（main.js 的固定步进里，world.step 之后）。
   * 返回事件位标志：MISSION_EVENT_*。失败时 mission.failed 有原因，可重接。
   */
  function update(dt) {
    ctrl.lastDt = dt;
    if (!mission.activeId) return 0;
    const def = currentDef();
    if (!def) return 0;
    let events = 0;
    ctrl.activeElapsed += dt;

    if (mission.timer !== null && mission.timer !== undefined) {
      mission.timer -= dt;
      if (mission.timer <= 0) {
        mission.timer = 0;
        mission.failed = { missionId: def.id, reason: 'time-up', text: '超时了，这单黄了。再接一次？' };
        mission.activeId = null;
        mission.stageId = null;
        mission.objective = '';
        mission.target = null;
        mission.timeLimit = null;
        return MISSION_EVENT_FAILED;
      }
    }

    refreshTaxiTarget();
    const stage = def.stages[mission.stageIndex];
    if (!stage) return 0;
    const result = stage.check(world, ctrl);
    if (result === 'done') {
      if (mission.stageIndex + 1 < def.stages.length) {
        enterStage(mission.stageIndex + 1);
        events |= MISSION_EVENT_STAGE;
      } else {
        events |= completeMission(def, events);
      }
    }
    return events;
  }

  /** 当前任务目标文字（HUD 用）；没任务时返回下一单的提示。 */
  function objectiveText() {
    if (mission.activeId) return mission.objective;
    const next = nextMissionId();
    if (!next) return '三单全部完成！';
    return `下一单：${missionDef(next).title}（按 M 接单）`;
  }

  /** 给 save.js 的快照：已完成任务 + 赚到的钱 + 最佳成绩候选。 */
  function snapshot() {
    return {
      completedMissions: [...mission.completed],
      rewardsEarned: mission.rewardsEarned,
      best: {
        missionsCompleted: mission.completed.length,
        money: typeof state.money === 'number' ? state.money : 0,
      },
    };
  }

  /** 从存档恢复已完成任务（钱由调用方先写回 state.money，再调此函数）。 */
  function restore(saved) {
    if (!saved) return;
    if (Array.isArray(saved.completedMissions)) {
      mission.completed = saved.completedMissions.filter((id) => MISSION_IDS.includes(id));
    }
    if (mission.completed.length >= MISSION_IDS.length) {
      mission.allDone = true;
      mission.finale = {
        title: '湾区小有名气',
        text: `Milo 跑完了三单，赚了 $${mission.rewardsEarned}。Sunset Bay 开始传他的名字了。`,
        totalEarned: mission.rewardsEarned,
      };
    }
  }

  return {
    state: mission,
    defs: MISSION_DEFS,
    places,
    nextMissionId,
    currentDef,
    start,
    abandon,
    update,
    objectiveText,
    snapshot,
    restore,
    pickTaxi,
  };
}

/** 供 world.js 的警察/偷车逻辑调用：通缉 +n（ clamp 0–5）。 */
export function addWanted(world, amount) {
  const state = world.state;
  const next = Math.max(0, Math.min(5, (state.wanted || 0) + amount));
  state.wanted = next;
  return next;
}

/** 供修车铺（Coast Garage）调用：花钱清星后把通缉归零。 */
export function clearWanted(world) {
  world.state.wanted = 0;
  return 0;
}
