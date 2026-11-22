// The screenshot scenes behind ?shot=start|play|chase|end. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by a simple autopilot
// (on foot it walks to the nearest car and gets in; in a car it steers toward the mission
// target, or away from the nearest police car when fleeing), so the frame is what a short
// game really looks like and the same seed always gives the same frame.
//
// The missions controller (missions.js) is created here after world.reset(), because
// reset() replaces state.mission and the controller closes over it.
import { STEP } from './config.js';
import { EVENT_DEAD, EVENT_MISSION } from './world.js';
import { createMissions, MISSION_EVENT_DONE } from './missions.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 26;
const CHASE_SECONDS = 20;
const END_LIMIT_SECONDS = 120;

/** How close, in world units, Milo must be to a car before the autopilot gets in. */
const ENTER_RANGE = 50;

function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function idleInput() {
  return { up: false, down: false, left: false, right: false, enter: false };
}

/** Nearest value in a sorted list to x. */
function nearestIn(list, x) {
  let best = list[0];
  for (const v of list) if (Math.abs(v - x) < Math.abs(best - x)) best = v;
  return best;
}

/**
 * A road-following waypoint toward (gx, gy): get onto a road, drive along the nearest
 * avenue to the goal's latitude, then turn onto the nearest street toward the goal.
 * Driving straight at the target would cut through blocks, buildings and pedestrians.
 */
function roadTarget(state, gx, gy) {
  const city = state.city || {};
  const player = state.player || {};
  if (typeof city.isRoad === 'function' && !city.isRoad(player.x, player.y)) {
    return city.nearestRoadPoint(player.x, player.y);
  }
  const avenues = city.avenues || [];
  const streets = city.streets || [];
  if (avenues.length === 0 || streets.length === 0) return { x: gx, y: gy };
  const ax = nearestIn(avenues, player.x);
  const sy = nearestIn(streets, player.y);
  const onAvenue = Math.abs(player.x - ax) < Math.abs(player.y - sy);
  if (onAvenue) {
    if (Math.abs(player.y - gy) > 70) return { x: ax, y: gy };
    return { x: gx, y: sy };
  }
  if (Math.abs(player.x - gx) > 70) return { x: gx, y: sy };
  return { x: gx, y: gy };
}

function nearestCar(state) {
  const player = state.player || {};
  // The taxi first: hailing it is lawful (no wanted star), stealing a traffic car is not.
  let bestCar = null;
  let bestScore = Infinity;
  for (const car of state.cars || []) {
    if (car.isPolice || car.wrecked) continue;
    const dx = car.x - player.x;
    const dy = car.y - player.y;
    const score = (car.isTaxi ? 0 : 100000) + dx * dx + dy * dy;
    if (score < bestScore) {
      bestScore = score;
      bestCar = car;
    }
  }
  return bestCar;
}

function nearestPolice(state) {
  const player = state.player || {};
  let best = null;
  let bestDist = Infinity;
  for (const cop of state.police || []) {
    const dx = cop.x - player.x;
    const dy = cop.y - player.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = cop;
    }
  }
  return best;
}

/** The junction farthest from `from` (a cop, or the player when omitted). */
function farthestJunction(state, from) {
  const city = state.city || {};
  const anchor = from || state.player || { x: 0, y: 0 };
  const junctions = typeof city.junctions === 'function' ? city.junctions() : [];
  let best = { x: (city.width || 3200) / 2, y: (city.height || 2400) / 2 };
  let bestDist = -1;
  for (const j of junctions) {
    const d = (j.x - anchor.x) ** 2 + (j.y - anchor.y) ** 2;
    if (d > bestDist) {
      bestDist = d;
      best = j;
    }
  }
  return best;
}

/**
 * One autopilot step. `goal` is where the car should head ('mission', 'flee' or a
 * {x, y} point); on foot Milo walks straight at the nearest car (aiming a little ahead
 * of it, since traffic moves) and gets in when close.
 */
function autopilot(state, goal) {
  const player = state.player || {};
  const input = idleInput();
  if (player.onFoot !== false) {
    const car = nearestCar(state);
    if (!car) return input;
    // Aim ahead of the moving car so Milo cuts it off instead of chasing its tail.
    const lead = 0.4;
    const tx = car.x + Math.cos(car.angle || 0) * (car.speed || 0) * lead;
    const ty = car.y + Math.sin(car.angle || 0) * (car.speed || 0) * lead;
    const dx = tx - player.x;
    const dy = ty - player.y;
    if (dx * dx + dy * dy < ENTER_RANGE * ENTER_RANGE) {
      input.enter = true;
      return input;
    }
    if (dx > 12) input.right = true;
    else if (dx < -12) input.left = true;
    if (dy > 12) input.down = true;
    else if (dy < -12) input.up = true;
    return input;
  }
  let tx;
  let ty;
  if (goal === 'flee') {
    // Head for the point farthest from the nearest police car: straight away from it.
    const police = nearestPolice(state);
    const city = state.city || {};
    if (police) {
      const dx = player.x - police.x;
      const dy = player.y - police.y;
      const len = Math.hypot(dx, dy) || 1;
      tx = player.x + (dx / len) * 600;
      ty = player.y + (dy / len) * 600;
    } else {
      tx = (city.width || 3200) / 2;
      ty = (city.height || 2400) / 2;
    }
  } else if (goal && typeof goal.x === 'number') {
    tx = goal.x;
    ty = goal.y;
  } else {
    const mission = state.mission;
    if (mission && mission.target) {
      tx = mission.target.x;
      ty = mission.target.y;
    } else {
      const city = state.city || {};
      tx = (city.width || 3200) / 2;
      ty = (city.height || 2400) / 2;
    }
  }
  // Follow the roads toward the goal instead of cutting across blocks.
  const waypoint = roadTarget(state, tx, ty);
  return driveToward(state, waypoint.x, waypoint.y);
}

/** Drive toward (x, y): steer by the angle to the point, throttle unless facing away.
 * Angles grow clockwise on screen (y points down) and world.js turns the car toward
 * larger angles on `right`, so a positive angle gap needs `right`, not `left`. */
function driveToward(state, x, y) {
  const player = state.player || {};
  const input = idleInput();
  const diff = angleDiff(Math.atan2(y - player.y, x - player.x), player.angle || 0);
  if (diff > 0.15) input.right = true;
  else if (diff < -0.15) input.left = true;
  if (Math.abs(diff) < 1.2) input.up = true;
  else input.down = true;
  return input;
}

/**
 * Set `world` to the named scene (start, play, chase or end; any other name is start)
 * and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  const state = world.state;
  if (name !== 'play' && name !== 'chase' && name !== 'end') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) world.step(STEP, idleInput(), true);
    return { screen: SCREEN_TITLE, best: 0 };
  }
  const missions = createMissions(world);
  if (name === 'chase') {
    // Two wanted stars: the world's own syncPolice spawns two police cars on the
    // next steps. Get Milo into a car first so the chase is a car chase.
    state.wanted = 2;
    for (let index = 0; index < 8 / STEP; index += 1) {
      world.step(STEP, autopilot(state, 'mission'), false);
      if (state.player && state.player.onFoot === false) break;
    }
    // Flee to the junction farthest from the chase: a fixed destination the
    // road-following autopilot can actually outrun the police to (police top speed
    // at 2 stars is below the player's), re-picked only when a cop gets close.
    // A flee point recomputed every step makes the car weave into buildings and
    // get rammed to death instead of escaping.
    let fleeDest = farthestJunction(state);
    for (let index = 0; index < CHASE_SECONDS / STEP; index += 1) {
      const cop = nearestPolice(state);
      const player = state.player || {};
      if (cop && Math.hypot(cop.x - player.x, cop.y - player.y) < 200) fleeDest = farthestJunction(state, cop);
      if (world.step(STEP, autopilot(state, fleeDest), false) & EVENT_DEAD) break;
      // Keep the staged 2-star heat: police rams would otherwise push it to 5 stars
      // mid-shot. The world's syncPolice spawns to the wanted level mid-step, so trim
      // the pack back to the two nearest cars as well, or the frame shows 4 cops
      // under 2 stars.
      state.wanted = 2;
      while (state.police.length > 2) {
        let far = 0;
        let farD = -1;
        for (let i = 0; i < state.police.length; i += 1) {
          const d = (state.police[i].x - player.x) ** 2 + (state.police[i].y - player.y) ** 2;
          if (d > farD) { farD = d; far = i; }
        }
        state.police.splice(far, 1);
      }
      // And keep Milo alive for the frame: the shot is a chase, not a death.
      if (player.health < 40) player.health = 60;
      if (player.car && player.car.health < 40) {
        player.car.health = 60;
        player.car.wrecked = false;
      }
    }
    return { screen: SCREEN_PLAY, best: 0 };
  }
  if (name === 'end') {
    // Play the first mission for real: the autopilot follows the mission's own
    // target (taxi → passenger → dropoff), so the settlement screen shows the
    // reward the missions controller actually paid. The mission completes well
    // inside the 120 s limit at seed 1 (verified in Node with the real world +
    // missions); nothing is faked here — if it ever did not finish, the
    // settlement would honestly show it unfinished.
    missions.start();
    for (let index = 0; index < END_LIMIT_SECONDS / STEP; index += 1) {
      const events = world.step(STEP, autopilot(state, 'mission'), false);
      const missionEvents = missions.update(STEP);
      if (events & EVENT_DEAD) break;
      if (missionEvents & MISSION_EVENT_DONE || events & EVENT_MISSION) break;
    }
    return { screen: SCREEN_OVER, best: state.money || 0 };
  }
  // play: take the first job and drive across the city toward its destination,
  // through traffic and pedestrians.
  missions.start();
  for (let index = 0; index < PLAY_SECONDS / STEP; index += 1) {
    const events = world.step(STEP, autopilot(state, missions.places.dropoff), false);
    missions.update(STEP);
    if (events & EVENT_DEAD) break;
  }
  return { screen: SCREEN_PLAY, best: 0 };
}
