// Sunset Bay — the rules and the state. No drawing, no browser in here: walking and
// driving, stealing cars, traffic AI, pedestrians, wanted level and police chases,
// collisions, money, health and the mission hook. step() advances one fixed 1/60 s step.
//
// Input contract (the input layer, worker C, builds this object each step):
//   { up, down, left, right }  — held keys (WASD / arrows)
//   { enter }                  — edge-triggered: E was pressed on this step only
// step() returns event bit flags so the caller can play sounds / announce without
// the world knowing about screens or sound.
//
// State shape (workers B and C read this):
//   state.city        — the city object from city.js (roads, buildings, landmarks)
//   state.player      — { x, y, angle, health, onFoot, inCar, car, carId, speed, invulnerable }
//                       inCar/carId mirror onFoot/car for missions.js (player.car is the
//                       car object itself; player.carId is its numeric id, null on foot).
//   state.cars        — traffic cars + the player's car (car.isPlayer, car.isTaxi,
//                       car.kind: 'taxi' | 'civilian' | 'police' for missions.js)
//   state.police      — police cars chasing the player (not in state.cars)
//   state.pedestrians — people on the sidewalks
//   state.wanted      — 0-5 stars; state.police.length always equals state.wanted
//   state.money, state.elapsed, state.clockMinutes, state.camera {x, y}
//   state.mission     — missions.js owns this object (createMissions fills it:
//                       { activeId, stageIndex, stageId, objective, target, timer,
//                       timeLimit, completed, rewardsEarned, allDone, finale, failed }).
//                       The world only creates the empty shape and never pays rewards —
//                       missions.js adds money itself when a mission completes.
//   state.dead        — true once Milo's health hits 0 (reset to play again)
//   state.stats       — { carsStolen, pedsHit, distanceDriven }

import { CAR, DAMAGE, GARAGE, MONEY_START, PALETTE, PEDS, PLAYER, TRAFFIC, WANTED } from './config.js';
import { createCity } from './city.js';
import { createRandom, pick, range } from './random.js';

export const EVENT_HIT = 1;
export const EVENT_STEAL = 2;
export const EVENT_WANTED = 4;
export const EVENT_DEAD = 8;
export const EVENT_MONEY = 16;
export const EVENT_MISSION = 32;

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export function createWorld(random) {
  const city = createCity(random);
  const placementSeed = Math.floor(random() * 2147483647);
  // Runtime choices (traffic turns, ped respawns, police spawns) also come from a
  // seeded stream, so the same seed plays the same game every time.
  const runtimeRandom = createRandom(placementSeed ^ 0x9e3779b9);

  const player = {
    x: 0, y: 0, angle: 0, health: PLAYER.health,
    onFoot: true, inCar: false, car: null, carId: null, speed: 0, invulnerable: 0,
  };
  /** Empty mission shape; missions.js (createMissions) fills and owns this object. */
  function emptyMission() {
    return {
      activeId: null, stageIndex: 0, stageId: null, objective: '', target: null,
      timer: null, timeLimit: null, completed: [], rewardsEarned: 0,
      allDone: false, finale: null, failed: null,
    };
  }
  const state = {
    city,
    player,
    cars: [],
    police: [],
    pedestrians: [],
    wanted: 0,
    money: MONEY_START,
    elapsed: 0,
    clockMinutes: 9 * 60, // 09:00 in the morning
    camera: { x: 0, y: 0 },
    mission: emptyMission(),
    dead: false,
    stats: { carsStolen: 0, pedsHit: 0, distanceDriven: 0 },
    unseenTimer: 0,
  };

  let nextCarId = 1;

  // --- Spawning -------------------------------------------------------------
  function makeCar(x, y, angle, opts = {}) {
    const car = {
      id: nextCarId,
      x, y, angle,
      speed: opts.speed ?? 0,
      color: opts.color ?? pick(createRandom(nextCarId * 7919 + placementSeed), PALETTE.carColors),
      health: CAR.health,
      isPlayer: false,
      isTaxi: opts.isTaxi ?? false,
      isPolice: opts.isPolice ?? false,
      kind: opts.isPolice ? 'police' : opts.isTaxi ? 'taxi' : 'civilian',
      owner: opts.owner ?? 'traffic', // 'traffic' | 'player'
      wrecked: false,
      hitCooldown: 0, // seconds until the next crash can hurt this car again
      ai: opts.ai ?? null,
    };
    nextCarId += 1;
    return car;
  }

  /** Pick a neighbouring junction of (ax, sy), never the one we just came from. */
  function pickNextJunction(ax, sy, fromAx, fromSy, rnd) {
    const options = [];
    if (ax > 0) options.push({ ax: ax - 1, sy });
    if (ax < city.avenues.length - 1) options.push({ ax: ax + 1, sy });
    if (sy > 0) options.push({ ax, sy: sy - 1 });
    if (sy < city.streets.length - 1) options.push({ ax, sy: sy + 1 });
    const forward = options.filter((o) => !(o.ax === fromAx && o.sy === fromSy));
    return pick(rnd, forward.length > 0 ? forward : options);
  }

  function spawnTrafficCar(rnd, near) {
    const junctions = city.junctions();
    const start = pick(rnd, junctions);
    const ax = city.avenues.indexOf(start.x);
    const sy = city.streets.indexOf(start.y);
    const next = pickNextJunction(ax, sy, ax, sy, rnd);
    const car = makeCar(start.x, start.y, 0, {
      speed: range(rnd, TRAFFIC.minSpeed, TRAFFIC.maxSpeed),
      ai: {
        ax, sy, fromAx: ax, fromSy: sy,
        nextAx: next.ax, nextSy: next.sy,
        cruise: range(rnd, TRAFFIC.minSpeed, TRAFFIC.maxSpeed),
      },
    });
    car.angle = Math.atan2(city.streets[next.sy] - start.y, city.avenues[next.ax] - start.x);
    if (near) {
      car.x = near.x + range(rnd, -60, 60);
      car.y = near.y + range(rnd, -60, 60);
      const rp = city.nearestRoadPoint(car.x, car.y);
      car.x = rp.x;
      car.y = rp.y;
    }
    return car;
  }

  function spawnPedestrian(rnd) {
    const p = city.randomSidewalkPoint(rnd);
    return {
      x: p.x, y: p.y,
      angle: range(rnd, 0, TAU),
      speed: range(rnd, PEDS.minSpeed, PEDS.maxSpeed),
      state: 'walk', // 'walk' | 'flee' | 'down'
      stateTimer: 0,
      tx: p.x, ty: p.y,
      color: pick(rnd, ['#e8e8e8', '#ffd166', '#7fb3d5', '#f1948a', '#a9dfbf', '#d7bde2']),
    };
  }

  function spawnPolice(rnd) {
    let p = city.randomRoadPoint(rnd);
    for (let tries = 0; tries < 8; tries += 1) {
      if (dist(p.x, p.y, player.x, player.y) >= WANTED.policeSpawnDistance) break;
      p = city.randomRoadPoint(rnd);
    }
    const cop = makeCar(p.x, p.y, 0, { isPolice: true, owner: 'police', color: PALETTE.police });
    cop.angle = Math.atan2(player.y - p.y, player.x - p.x);
    return cop;
  }

  function reset() {
    const rnd = createRandom(placementSeed);
    nextCarId = 1;
    player.x = city.landmarks.spawn.x;
    player.y = city.landmarks.spawn.y;
    player.angle = -Math.PI / 2;
    player.health = PLAYER.health;
    player.onFoot = true;
    player.inCar = false;
    player.car = null;
    player.carId = null;
    player.speed = 0;
    player.invulnerable = 0;

    state.cars = [];
    for (let i = 0; i < TRAFFIC.count; i += 1) {
      state.cars.push(spawnTrafficCar(rnd));
    }
    // One taxi waits by the taxi stand (mission 1's ride; taxis are for hire, not theft).
    const taxi = spawnTrafficCar(rnd, city.landmarks.taxiStand);
    taxi.isTaxi = true;
    taxi.kind = 'taxi';
    taxi.color = PALETTE.taxi;
    state.cars.push(taxi);

    state.police = [];
    state.pedestrians = [];
    for (let i = 0; i < PEDS.count; i += 1) {
      state.pedestrians.push(spawnPedestrian(rnd));
    }

    state.wanted = 0;
    state.money = MONEY_START;
    state.elapsed = 0;
    state.clockMinutes = 9 * 60;
    state.camera.x = player.x;
    state.camera.y = player.y;
    // A mission already in progress (missions.js owns the object) survives a reset;
    // a fresh world gets the empty shape.
    if (!state.mission || !Array.isArray(state.mission.completed)) state.mission = emptyMission();
    state.dead = false;
    state.stats = { carsStolen: 0, pedsHit: 0, distanceDriven: 0 };
    state.unseenTimer = 0;
  }

  // --- Wanted ---------------------------------------------------------------
  function setWanted(level, events) {
    const next = clamp(level, 0, WANTED.max);
    if (next === state.wanted) return events;
    state.wanted = next;
    return events | EVENT_WANTED;
  }

  function syncPolice(rnd) {
    while (state.police.length < state.wanted) {
      state.police.push(spawnPolice(rnd));
    }
    while (state.police.length > state.wanted) {
      // Lose the farthest cop first.
      let far = 0;
      let farD = -1;
      for (let i = 0; i < state.police.length; i += 1) {
        const d = dist(state.police[i].x, state.police[i].y, player.x, player.y);
        if (d > farD) { farD = d; far = i; }
      }
      state.police.splice(far, 1);
    }
  }

  // --- Entering / leaving cars ----------------------------------------------
  function nearestEnterableCar() {
    let best = null;
    let bestD = PLAYER.enterRange;
    for (const car of state.cars) {
      if (car.wrecked || car.isPolice) continue;
      const d = dist(player.x, player.y, car.x, car.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function enterCar(car, events) {
    player.onFoot = false;
    player.inCar = true;
    player.car = car;
    player.carId = car.id;
    player.angle = car.angle;
    player.speed = 0;
    car.isPlayer = true;
    car.ai = null;
    if (car.owner !== 'player' && !car.isTaxi) {
      car.owner = 'player';
      state.stats.carsStolen += 1;
      events = setWanted(state.wanted + WANTED.stealCar, events);
      events |= EVENT_STEAL;
    } else if (car.owner !== 'player') {
      car.owner = 'player'; // hailing the taxi is lawful; no star
    }
    return events;
  }

  function exitCar(events) {
    const car = player.car;
    if (!car) return events;
    car.isPlayer = false;
    player.car = null;
    player.carId = null;
    player.onFoot = true;
    player.inCar = false;
    // Step out beside the driver's door.
    const side = car.angle + Math.PI / 2;
    player.x = car.x + Math.cos(side) * 34;
    player.y = car.y + Math.sin(side) * 34;
    player.angle = car.angle;
    player.speed = 0;
    const held = city.clampToWorld(player.x, player.y, PLAYER.radius + 2);
    player.x = held.x;
    player.y = held.y;
    return events;
  }

  // --- Collisions -------------------------------------------------------------
  function pushOutOfBuildings(body, radius) {
    const b = city.buildingAt(body.x, body.y, radius);
    if (!b) return null;
    const cx = clamp(body.x, b.x, b.x + b.width);
    const cy = clamp(body.y, b.y, b.y + b.height);
    let dx = body.x - cx;
    let dy = body.y - cy;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d === 0) {
      // Centre inside the rect: push out along the shortest side.
      const left = body.x - b.x;
      const right = b.x + b.width - body.x;
      const top = body.y - b.y;
      const bottom = b.y + b.height - body.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) { dx = -1; dy = 0; d = 1; body.x = b.x - radius; }
      else if (m === right) { dx = 1; dy = 0; d = 1; body.x = b.x + b.width + radius; }
      else if (m === top) { dx = 0; dy = -1; d = 1; body.y = b.y - radius; }
      else { dx = 0; dy = 1; d = 1; body.y = b.y + b.height + radius; }
      return b;
    }
    const push = (radius - d) / d;
    body.x += dx * push;
    body.y += dy * push;
    return b;
  }

  function damagePlayer(amount, events) {
    if (player.invulnerable > 0 || state.dead) return events;
    player.health -= amount;
    player.invulnerable = 0.5;
    events |= EVENT_HIT;
    if (player.health <= 0) {
      player.health = 0;
      state.dead = true;
      events |= EVENT_DEAD;
    }
    return events;
  }

  // --- Player -----------------------------------------------------------------
  function stepPlayerOnFoot(dt, input, events) {
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (mx !== 0 || my !== 0) {
      const len = Math.sqrt(mx * mx + my * my);
      mx /= len;
      my /= len;
      player.x += mx * PLAYER.walkSpeed * dt;
      player.y += my * PLAYER.walkSpeed * dt;
      player.angle = Math.atan2(my, mx);
    }
    pushOutOfBuildings(player, PLAYER.radius);
    const held = city.clampToWorld(player.x, player.y, PLAYER.radius + 2);
    player.x = held.x;
    player.y = held.y;
    if (player.x > city.beach.waterX - PLAYER.radius) player.x = city.beach.waterX - PLAYER.radius;
    if (input.enter) {
      const car = nearestEnterableCar();
      if (car) events = enterCar(car, events);
    }
    return events;
  }

  function stepPlayerDriving(dt, input, events) {
    const car = player.car;
    if (!car) { player.onFoot = true; player.inCar = false; player.carId = null; return events; }
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const speedRatio = clamp(Math.abs(car.speed) / CAR.maxSpeed, 0, 1);
    const turn = CAR.turnRate * (0.35 + 0.65 * speedRatio) * (car.speed < 0 ? -1 : 1);
    car.angle += steer * turn * dt;

    if (input.up) car.speed += CAR.accel * dt;
    if (input.down) {
      if (car.speed > 5) car.speed -= CAR.brake * dt;
      else car.speed -= CAR.reverseAccel * dt;
    }
    if (!input.up && !input.down) {
      car.speed -= car.speed * CAR.drag * dt;
      if (Math.abs(car.speed) < 4) car.speed = 0;
    }
    car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);

    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    const prevSpeed = car.speed;
    car.x += fx * car.speed * dt;
    car.y += fy * car.speed * dt;
    state.stats.distanceDriven += Math.abs(car.speed) * dt;

    // Buildings, sea and world edge.
    if (pushOutOfBuildings(car, CAR.radius) || city.inWater(car.x) || car.x <= CAR.radius || car.x >= state.city.width - CAR.radius || car.y <= CAR.radius || car.y >= state.city.height - CAR.radius) {
      const impact = Math.abs(prevSpeed);
      if (impact > 90 && car.hitCooldown <= 0) {
        const dmg = DAMAGE.buildingHitBase + impact / 80;
        car.health -= dmg;
        car.hitCooldown = 0.5; // one crash per half second, not one per step
        events = damagePlayer(dmg * 0.4, events);
        events |= EVENT_HIT;
      }
      car.speed *= -0.25;
      if (city.inWater(car.x)) car.x = city.beach.waterX - CAR.radius;
      const held = city.clampToWorld(car.x, car.y, CAR.radius);
      car.x = held.x;
      car.y = held.y;
    }
    if (car.health <= 0 && !car.wrecked) {
      car.wrecked = true;
      car.speed = 0;
    }

    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    player.speed = car.speed;

    if (input.enter) events = exitCar(events);
    return events;
  }

  // --- Traffic AI -------------------------------------------------------------
  function stepTrafficCar(car, dt) {
    if (car.isPlayer || car.wrecked || !car.ai) return;
    const ai = car.ai;
    const tx = city.avenues[ai.nextAx];
    const ty = city.streets[ai.nextSy];
    const d = dist(car.x, car.y, tx, ty);
    if (d < 10) {
      // Reached the junction: pick the next leg.
      const fromAx = ai.ax;
      const fromSy = ai.sy;
      ai.ax = ai.nextAx;
      ai.sy = ai.nextSy;
      ai.fromAx = fromAx;
      ai.fromSy = fromSy;
      const next = pickNextJunction(ai.ax, ai.sy, fromAx, fromSy, runtimeRandom);
      ai.nextAx = next.ax;
      ai.nextSy = next.sy;
      return;
    }
    const targetAngle = Math.atan2(ty - car.y, tx - car.x);
    car.angle = angleLerp(car.angle, targetAngle, Math.min(1, 6 * dt));
    const cruise = d < TRAFFIC.slowNearJunction ? ai.cruise * TRAFFIC.slowFactor : ai.cruise;
    car.speed += (cruise - car.speed) * Math.min(1, 2 * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
  }

  // --- Pedestrians --------------------------------------------------------------
  function stepPedestrian(ped, dt, events) {
    if (ped.state === 'down') {
      ped.stateTimer -= dt;
      if (ped.stateTimer <= 0) {
        // Get up somewhere else and walk on.
        const spot = city.randomSidewalkPoint(runtimeRandom);
        ped.x = spot.x;
        ped.y = spot.y;
        ped.state = 'walk';
        ped.stateTimer = 0;
      }
      return events;
    }
    if (ped.state === 'flee') {
      ped.stateTimer -= dt;
      ped.x += Math.cos(ped.angle) * PEDS.fleeSpeed * dt;
      ped.y += Math.sin(ped.angle) * PEDS.fleeSpeed * dt;
      const held = city.clampToWorld(ped.x, ped.y, PEDS.radius + 2);
      ped.x = held.x;
      ped.y = held.y;
      if (ped.stateTimer <= 0) ped.state = 'walk';
      return events;
    }
    // Walk: head for the current target, then pick a new sidewalk point nearby.
    const d = dist(ped.x, ped.y, ped.tx, ped.ty);
    if (d < 12) {
      const spot = city.randomSidewalkPoint(runtimeRandom);
      ped.tx = spot.x;
      ped.ty = spot.y;
    }
    ped.angle = Math.atan2(ped.ty - ped.y, ped.tx - ped.x);
    ped.x += Math.cos(ped.angle) * ped.speed * dt;
    ped.y += Math.sin(ped.angle) * ped.speed * dt;

    // Dodge: a car closing in fast makes the ped run aside.
    const allCars = [...state.cars, ...state.police];
    for (const car of allCars) {
      if (car.wrecked || Math.abs(car.speed) < 40) continue;
      const cd = dist(ped.x, ped.y, car.x, car.y);
      if (cd > PEDS.fleeRange) continue;
      const toPedX = (ped.x - car.x) / cd;
      const toPedY = (ped.y - car.y) / cd;
      const closing = toPedX * Math.cos(car.angle) + toPedY * Math.sin(car.angle);
      if (closing > 0.5) {
        // Run perpendicular to the car's path, away from the road.
        const side = Math.sign(toPedX * -Math.sin(car.angle) + toPedY * Math.cos(car.angle)) || 1;
        ped.angle = car.angle + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        ped.state = 'flee';
        ped.stateTimer = 0.9;
        break;
      }
    }
    return events;
  }

  // --- Police AI ------------------------------------------------------------------
  function stepPoliceCar(cop, dt, events) {
    const targetAngle = Math.atan2(player.y - cop.y, player.x - cop.x);
    cop.angle = angleLerp(cop.angle, targetAngle, Math.min(1, 4.5 * dt));
    const top = WANTED.policeSpeed[state.wanted] || WANTED.policeSpeed[1];
    cop.speed += (top - cop.speed) * Math.min(1, 1.5 * dt);
    cop.x += Math.cos(cop.angle) * cop.speed * dt;
    cop.y += Math.sin(cop.angle) * cop.speed * dt;
    pushOutOfBuildings(cop, CAR.radius);
    const held = city.clampToWorld(cop.x, cop.y, CAR.radius);
    cop.x = held.x;
    cop.y = held.y;
    return events;
  }

  // --- Car-vs-car and car-vs-ped collisions --------------------------------------
  function collideCars(a, b, events) {
    const d = dist(a.x, a.y, b.x, b.y);
    const min = CAR.radius * 2;
    if (d >= min || d === 0) return events;
    const nx = (b.x - a.x) / d;
    const ny = (b.y - a.y) / d;
    const overlap = (min - d) / 2;
    a.x -= nx * overlap;
    a.y -= ny * overlap;
    b.x += nx * overlap;
    b.y += ny * overlap;
    const impact = Math.abs(a.speed - b.speed);
    if (impact > 60) {
      a.health -= DAMAGE.carHitBase + impact / 120;
      b.health -= DAMAGE.carHitBase + impact / 120;
      const swap = a.speed;
      a.speed = b.speed * 0.4;
      b.speed = swap * 0.4;
      if (a.isPlayer || b.isPlayer) {
        events |= EVENT_HIT;
        const other = a.isPlayer ? b : a;
        if (other.isPolice) events = setWanted(state.wanted + WANTED.hitPolice, events);
        events = damagePlayer(DAMAGE.carHitBase * 0.5, events);
      }
    }
    return events;
  }

  function collidePlayerCarWithPed(car, ped, events) {
    if (ped.state === 'down') return events;
    const d = dist(car.x, car.y, ped.x, ped.y);
    if (d >= CAR.radius + PEDS.radius) return events;
    if (Math.abs(car.speed) > 50) {
      // Hit and run: the ped goes down, the law notices.
      ped.state = 'down';
      ped.stateTimer = 4;
      state.stats.pedsHit += 1;
      events = setWanted(state.wanted + WANTED.hitPedestrian, events);
      events |= EVENT_HIT;
      car.speed *= 0.85;
    } else {
      // Gentle nudge: push the ped aside, no harm done.
      const nx = (ped.x - car.x) / (d || 1);
      const ny = (ped.y - car.y) / (d || 1);
      ped.x += nx * 30;
      ped.y += ny * 30;
    }
    return events;
  }

  // --- The step -------------------------------------------------------------------
  /**
   * One fixed step. `input` is { up, down, left, right, enter } (see the contract
   * at the top of this file); `enter` must be edge-triggered by the caller.
   * `harmless` runs the city as a backdrop (title screen): traffic and peds move,
   * nothing hurts the player and no stars are earned.
   */
  function step(dt, input = {}, harmless = false) {
    let events = 0;
    const rnd = runtimeRandom;
    state.elapsed += dt;
    state.clockMinutes = (state.clockMinutes + dt) % (24 * 60);
    if (player.invulnerable > 0) player.invulnerable = Math.max(0, player.invulnerable - dt);

    if (!state.dead) {
      if (player.onFoot) events = stepPlayerOnFoot(dt, input, events);
      else events = stepPlayerDriving(dt, input, events);
    }

    for (const car of state.cars) stepTrafficCar(car, dt);
    for (const ped of state.pedestrians) events = stepPedestrian(ped, dt, events);
    for (const cop of state.police) events = stepPoliceCar(cop, dt, events);

    // Car-vs-car: player car against traffic and police, plus traffic separation.
    const allCars = [...state.cars, ...state.police];
    for (let i = 0; i < allCars.length; i += 1) {
      for (let j = i + 1; j < allCars.length; j += 1) {
        if (!harmless) events = collideCars(allCars[i], allCars[j], events);
        else {
          const d = dist(allCars[i].x, allCars[i].y, allCars[j].x, allCars[j].y);
          if (d < CAR.radius * 2 && d > 0) {
            const nx = (allCars[j].x - allCars[i].x) / d;
            const ny = (allCars[j].y - allCars[i].y) / d;
            const push = (CAR.radius * 2 - d) / 2;
            allCars[i].x -= nx * push;
            allCars[i].y -= ny * push;
            allCars[j].x += nx * push;
            allCars[j].y += ny * push;
          }
        }
      }
    }

    // Player car vs pedestrians; AI car vs Milo on foot.
    if (!harmless && !state.dead) {
      if (player.car) {
        for (const ped of state.pedestrians) {
          events = collidePlayerCarWithPed(player.car, ped, events);
        }
      } else {
        for (const car of allCars) {
          if (car.wrecked) continue;
          const d = dist(player.x, player.y, car.x, car.y);
          if (d < CAR.radius + PLAYER.radius && Math.abs(car.speed) > 40) {
            events = damagePlayer(DAMAGE.pedHitPlayer, events);
            const nx = (player.x - car.x) / (d || 1);
            const ny = (player.y - car.y) / (d || 1);
            player.x += nx * 40;
            player.y += ny * 40;
          }
        }
      }
    }

    // Wrecked cars stop being a threat and stop moving.
    for (const car of allCars) {
      if (car.hitCooldown > 0) car.hitCooldown -= dt;
      if (car.health <= 0 && !car.wrecked) {
        car.wrecked = true;
        car.speed = 0;
      }
    }

    // --- Wanted: spawn / decay ---------------------------------------------------
    if (!harmless) {
      syncPolice(rnd);
      if (state.wanted > 0) {
        let seen = false;
        for (const cop of state.police) {
          if (dist(cop.x, cop.y, player.x, player.y) < WANTED.sightRange) { seen = true; break; }
        }
        if (seen) state.unseenTimer = 0;
        else {
          state.unseenTimer += dt;
          if (state.unseenTimer >= WANTED.decaySeconds) {
            state.unseenTimer = 0;
            events = setWanted(state.wanted - 1, events);
            syncPolice(rnd);
          }
        }
      }

      // --- Coast Garage: drive in, pay, lose the heat (and fix the car) ----------
      if (player.car && state.wanted > 0) {
        const g = city.garage;
        const car = player.car;
        if (car.x > g.x && car.x < g.x + g.width && car.y > g.y && car.y < g.y + g.height) {
          const cost = GARAGE.costPerStar * state.wanted;
          if (state.money >= cost) {
            state.money -= cost;
            state.wanted = 0;
            state.police = [];
            car.health = CAR.health;
            car.wrecked = false;
            events |= EVENT_MONEY | EVENT_WANTED;
          }
        }
      }

      // Slow health regen when the heat is off.
      if (state.wanted === 0 && player.health > 0 && player.health < PLAYER.health) {
        player.health = Math.min(PLAYER.health, player.health + 2 * dt);
      }
    }

    // --- Camera follows the player -------------------------------------------------
    const tx = clamp(player.x, 640, state.city.width - 640);
    const ty = clamp(player.y, 360, state.city.height - 360);
    state.camera.x += (tx - state.camera.x) * Math.min(1, 5 * dt);
    state.camera.y += (ty - state.camera.y) * Math.min(1, 5 * dt);

    return events;
  }

  reset();
  return { state, reset, step };
}
