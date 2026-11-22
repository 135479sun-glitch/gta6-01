// Boot and the one loop for Sunset Bay: input is read every frame, the world advances in
// fixed 1/60 s steps (several in a slow frame, none in a fast one), and the renderer paints
// what is there. The game moves between five screens: title, play, paused, missions and
// settlement. Missions are driven by missions.js (update after every world step); saves go
// through save.js; sound is the sound.js singleton.
//
// ?seed=N fixes the city and the traffic. ?shot=start|play|chase|end (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets window.__shotReady for
// a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_DEAD, EVENT_HIT, EVENT_MISSION, EVENT_MONEY, EVENT_STEAL, EVENT_WANTED } from './world.js';
import { createMissions, MISSION_EVENT_ALL_DONE, MISSION_EVENT_DONE, MISSION_EVENT_FAILED, MISSION_EVENT_STAGE } from './missions.js';
import { hasSave, loadSave, saveFromWorld } from './save.js';
import { sound } from './sound.js';
import { ACTION_CONFIRM, ACTION_ENTER_EXIT, ACTION_MISSIONS, ACTION_PAUSE, ACTION_USE, createInput } from './input.js';
import { createRenderer, SCREEN_MISSIONS, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const minimap = document.getElementById('minimap');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas, minimap);

function readBest() {
  try {
    const save = loadSave();
    if (save) return save.best.money || save.money || 0;
  } catch {
    return 0;
  }
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveInfo() {
  try {
    const save = loadSave();
    if (!save) return { hasSave: false, money: 0, missionsDone: 0 };
    return { hasSave: true, money: save.money, missionsDone: (save.completedMissions || []).length };
  } catch {
    return { hasSave: false, money: 0, missionsDone: 0 };
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let info = saveInfo();
  let accumulator = 0;
  let last = performance.now();
  let smokeTimer = 0;
  // The missions controller closes over world.state.mission, which world.reset()
  // replaces — so it is rebuilt after every reset (see startGame).
  let missions = createMissions(world);

  // Screen readers (and anyone watching the page's text) hear the screen changes and events.
  function announce(message) {
    status.textContent = message;
  }

  /** Re-apply the save after a reset: money and finished missions carry over. */
  function applySave() {
    const save = loadSave();
    if (!save) return;
    world.state.money = save.money || 0;
    if (missions && missions.restore) missions.restore(save);
  }

  function startGame() {
    world.reset();
    missions = createMissions(world);
    applySave();
    accumulator = 0;
    screen = SCREEN_PLAY;
    sound.click();
    announce('Sunset Bay. 正在游戏中。按 Space 接下一单。');
  }

  function writeSave() {
    try {
      saveFromWorld(world.state, missions);
    } catch {
      // Storage can be off (private windows): the game carries on without a save.
    }
    info = saveInfo();
  }

  function endGame() {
    screen = SCREEN_OVER;
    if ((world.state.money || 0) > best) best = world.state.money || 0;
    writeSave();
    sound.stopAll();
    const done = (world.state.mission && world.state.mission.completed ? world.state.mission.completed.length : 0);
    announce(`结算。完成任务 ${done} / 3，钱 $${world.state.money || 0}。最佳 $${best}。`);
  }

  // Returns true when the press changed screens (started the game, resumed, or
  // accepted a mission from the missions screen): the frame's step() must then not
  // also treat the same Space press as "accept a mission" in play.
  function handleActions(actions) {
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        sound.stopAll();
        announce('已暂停。');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('继续游戏。');
      }
      return true;
    }
    if (actions & ACTION_MISSIONS) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_MISSIONS;
        announce('任务列表。');
      } else if (screen === SCREEN_MISSIONS) {
        screen = SCREEN_PLAY;
        announce('继续游戏。');
      }
      return true;
    }
    if (actions & ACTION_CONFIRM) {
      if (screen === SCREEN_TITLE || screen === SCREEN_OVER) {
        startGame();
        return true;
      }
      if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('继续游戏。');
        return true;
      }
      if (screen === SCREEN_MISSIONS) {
        acceptMission();
        return true;
      }
    }
    return false;
  }

  /** Space in play, or Space on the missions screen: take the next job. */
  function acceptMission() {
    if (!missions) return;
    if (missions.start()) {
      screen = SCREEN_PLAY;
      sound.click();
      const def = missions.currentDef();
      announce(`接到任务：${def ? def.title : ''}。${world.state.mission.objective || ''}`);
    } else if (world.state.mission && world.state.mission.activeId) {
      screen = SCREEN_PLAY;
      announce(`正在做：${world.state.mission.objective || ''}`);
    } else {
      announce('三单全部完成了！');
    }
  }

  // `actions` is taken once per frame by frame() and handed in here: the edge flag
  // (E to enter/exit) fires on the first step of the frame only, never twice.
  // `consumed` is true when handleActions already spent the press on a screen change.
  function step(actions, consumed) {
    if (screen === SCREEN_TITLE) {
      // The title screen's backdrop: the city lives, but nothing can hurt Milo.
      world.step(STEP, { up: false, down: false, left: false, right: false, enter: false }, true);
      return;
    }
    const driving = {
      up: input.held.up,
      down: input.held.down,
      left: input.held.left,
      right: input.held.right,
      enter: Boolean(actions & ACTION_ENTER_EXIT),
    };
    if (!consumed && (actions & ACTION_USE)) acceptMission();
    const events = world.step(STEP, driving, false);
    const missionEvents = missions ? missions.update(STEP) : 0;
    const player = world.state.player || {};

    if (events & EVENT_DEAD) {
      endGame();
      return;
    }
    if (missionEvents & MISSION_EVENT_ALL_DONE) {
      sound.missionDone();
      writeSave();
      endGame();
      return;
    }
    if (missionEvents & MISSION_EVENT_DONE) {
      sound.missionDone();
      writeSave();
      announce(`任务完成：${(missions.currentDef() && missions.currentDef().title) || ''}。`);
    } else if (missionEvents & MISSION_EVENT_FAILED) {
      sound.missionFailed();
      announce('任务失败了，可以再接一次。');
    } else if (missionEvents & MISSION_EVENT_STAGE) {
      sound.pickup();
      announce(world.state.mission.objective || '');
    }
    if (events & EVENT_HIT) {
      sound.crash();
      renderer.addEffect('spark', player.x, player.y);
      announce(`撞上了。血量 ${Math.round(player.health || 0)}。`);
    }
    if (events & EVENT_STEAL) announce('偷车了！通缉 +1 星。');
    if (events & EVENT_WANTED) announce(`通缉 ${world.state.wanted || 0} 星。`);
    if (events & EVENT_MONEY) sound.pickup();
    if (events & EVENT_MISSION) sound.missionDone();

    // Brake smoke: hard braking at speed leaves a puff behind the car.
    smokeTimer += 1;
    if (player.onFoot === false && driving.down && Math.abs(player.speed || 0) > 300 && smokeTimer % 6 === 0) {
      const back = (player.angle || 0) + Math.PI;
      renderer.addEffect('smoke', player.x + Math.cos(back) * 24, player.y + Math.sin(back) * 24);
    }

    sound.engine(player.onFoot === false);
    sound.engineSpeed(Math.abs(player.speed || 0) / 640);
    sound.siren((world.state.wanted || 0) > 0);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    const consumed = handleActions(actions);
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      let first = true;
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step(first ? actions : 0, consumed);
        first = false;
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, best, info);
  }

  // Leaving the tab pauses a running game rather than letting the city move unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      sound.stopAll();
      announce('已暂停。');
    }
  });

  announce(hasSave() ? 'Sunset Bay. 有存档，按 Space 继续。' : 'Sunset Bay. 按 Space 或点击开始。');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
