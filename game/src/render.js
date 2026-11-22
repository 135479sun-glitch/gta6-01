// Drawing only for Sunset Bay: the world's state and the current screen in, pixels out.
// The camera follows Milo (on foot or in a car) across the city; a fixed 1280x720 logical
// viewport is scaled to fit the window and centred, the margin filled with the backdrop
// colour. A second, small canvas in the page is the minimap. Flat shapes and canvas text:
// roads, blocks, buildings, parks, the beach and the sea, traffic, police, pedestrians,
// Milo, the HUD (wanted stars, money, health, speed, mission objective, clock), the
// minimap, crash sparks and brake smoke, and the title / pause / missions / settlement
// panels. This module never changes the world and never reads the keyboard.
//
// It reads the shapes world.js / city.js / missions.js actually produce:
//   state.city: { width, height, avenues[], streets[], roads[], buildings[], trees[],
//                 props[], landmarks, garage, beach { x0, waterX } }
//   state.cars: [{ x, y, angle, speed, color, isPlayer, isTaxi, isPolice, wrecked }]
//   state.police: [{ x, y, angle, speed, color }]  (police are NOT in state.cars)
//   state.pedestrians: [{ x, y, angle, speed, state: 'walk'|'flee'|'down', color }]
//   state.player: { x, y, angle, health, onFoot, car, speed, invulnerable }
//   state.camera: { x, y } — the CENTRE of the view, maintained by world.js
//   state.mission: missions.js shape { activeId, objective, target {x,y,radius,label},
//                    timer, completed[], allDone, finale } (or world.js's bare shape)
import { CAR, FONT, PALETTE, WORLD } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_MISSIONS = 'missions';

/** The logical viewport the camera shows, in world units. */
const VIEW = { width: 1280, height: 720 };

/** Sunset Bay's own colours; anything config.js already defines wins over these. */
const SUNSET = {
  backdrop: '#1a2233',
  sky: '#ffd9a0',
  sea: '#2e9fd8',
  seaDeep: '#1f7fb8',
  sand: '#f2ddab',
  grass: '#7ec850',
  parkGrass: '#5da83f',
  road: '#3d4450',
  roadLine: '#f7d774',
  sidewalk: '#c9c2b4',
  curb: '#9d968a',
  tower: '#8fa3b8',
  towerGlass: '#5b7d9e',
  house: '#e8a87c',
  shop: '#f2c94c',
  hotel: '#e07a9a',
  garage: '#4f9d69',
  roof: '#6b5d4f',
  player: '#ff7847',
  playerCar: '#ff7847',
  taxi: '#f7c948',
  police: '#2f6fd0',
  policeLight: '#ff3b30',
  policeWhite: '#f2f4f6',
  ped: '#e8e8e8',
  tree: '#3f7a3a',
  panel: 'rgba(20, 26, 38, 0.72)',
  text: '#fff7e6',
  muted: '#c9bfa8',
  star: '#ffd94d',
  health: '#58d68d',
  damage: '#e5534b',
};

const C = { ...SUNSET, ...PALETTE };

/** Minimap size in CSS pixels; the element itself is sized in index.html. */
const MAP = { width: 220, height: 150 };

const STAR = '★';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cachedLabel(prefix) {
  let value = null;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

export function createRenderer(canvas, minimapCanvas) {
  const context = canvas.getContext('2d');
  const mapContext = minimapCanvas ? minimapCanvas.getContext('2d') : null;
  const view = { scale: 1, x: 0, y: 0 };
  const camera = { x: 0, y: 0 };
  const moneyLabel = cachedLabel('$');
  const speedLabel = cachedLabel('');
  const clockLabel = cachedLabel('');
  // Transient effects (crash sparks, brake smoke), fed by main.js via addEffect().
  const effects = [];

  /** Crash sparks / brake smoke at a world point; drawn until they fade. */
  function addEffect(kind, x, y) {
    if (effects.length > 40) effects.shift();
    effects.push({ kind, x, y, ttl: kind === 'spark' ? 0.5 : 0.9, max: kind === 'spark' ? 0.5 : 0.9, seed: Math.random() * Math.PI * 2 });
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / VIEW.width, height / VIEW.height);
    view.x = (width - VIEW.width * view.scale) / 2;
    view.y = (height - VIEW.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align) {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, y);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function citySize(state) {
    const city = state.city || {};
    return { width: city.width || WORLD.width, height: city.height || WORLD.height };
  }

  /** Where the camera sits this frame. world.js keeps state.camera as the view CENTRE. */
  function updateCamera(state) {
    const size = citySize(state);
    const cam = state.camera;
    let cx;
    let cy;
    if (cam && Number.isFinite(cam.x)) {
      cx = cam.x;
      cy = cam.y;
    } else {
      const player = state.player || {};
      cx = player.x || 0;
      cy = player.y || 0;
    }
    camera.x = clamp(cx - VIEW.width / 2, 0, Math.max(0, size.width - VIEW.width));
    camera.y = clamp(cy - VIEW.height / 2, 0, Math.max(0, size.height - VIEW.height));
  }

  // ---- city ----

  function drawCity(state) {
    const city = state.city || {};
    const size = citySize(state);
    const beach = city.beach || { x0: 2840, waterX: 3060 };
    // Ground: grass everywhere, then sand and sea along the east edge.
    context.fillStyle = C.grass;
    context.fillRect(0, 0, size.width, size.height);
    context.fillStyle = C.sand;
    context.fillRect(beach.x0, 0, beach.waterX - beach.x0, size.height);
    context.fillStyle = C.sea;
    context.fillRect(beach.waterX, 0, size.width - beach.waterX, size.height);
    context.fillStyle = C.seaDeep;
    context.fillRect(beach.waterX + 60, 0, size.width - beach.waterX - 60, size.height);
    // A few wave lines where the sea meets the sand.
    context.strokeStyle = 'rgba(255,255,255,0.55)';
    context.lineWidth = 3;
    for (let y = 40; y < size.height; y += 160) {
      context.beginPath();
      context.moveTo(beach.waterX + 6, y);
      context.quadraticCurveTo(beach.waterX + 26, y + 18, beach.waterX + 6, y + 36);
      context.stroke();
    }

    // Park lawns and street trees.
    for (const prop of city.props || []) {
      if (prop.kind === 'park') {
        context.fillStyle = C.parkGrass;
        context.fillRect(prop.x, prop.y, prop.width, prop.height);
      }
    }
    for (const tree of city.trees || []) {
      context.fillStyle = C.tree;
      context.beginPath();
      context.arc(tree.x, tree.y, tree.r || 12, 0, Math.PI * 2);
      context.fill();
    }

    // Roads: sidewalk border, asphalt, dashed centre lines, street names.
    const roadHalf = 48;
    for (const road of city.roads || []) {
      if (road.vertical) {
        context.fillStyle = C.sidewalk;
        context.fillRect(road.at - roadHalf - 16, road.from, (roadHalf + 16) * 2, road.to - road.from);
        context.fillStyle = C.road;
        context.fillRect(road.at - roadHalf, road.from, roadHalf * 2, road.to - road.from);
        context.strokeStyle = C.roadLine;
        context.lineWidth = 3;
        context.setLineDash([26, 22]);
        context.beginPath();
        context.moveTo(road.at, road.from);
        context.lineTo(road.at, road.to);
        context.stroke();
        context.setLineDash([]);
      } else {
        context.fillStyle = C.sidewalk;
        context.fillRect(road.from, road.at - roadHalf - 16, road.to - road.from, (roadHalf + 16) * 2);
        context.fillStyle = C.road;
        context.fillRect(road.from, road.at - roadHalf, road.to - road.from, roadHalf * 2);
        context.strokeStyle = C.roadLine;
        context.lineWidth = 3;
        context.setLineDash([26, 22]);
        context.beginPath();
        context.moveTo(road.from, road.at);
        context.lineTo(road.to, road.at);
        context.stroke();
        context.setLineDash([]);
      }
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `13px ${FONT}`;
    context.fillStyle = 'rgba(255,255,255,0.75)';
    for (const road of city.roads || []) {
      if (!road.name) continue;
      if (road.vertical) {
        context.save();
        context.translate(road.at - roadHalf - 24, (road.from + road.to) / 2);
        context.rotate(-Math.PI / 2);
        context.fillText(road.name, 0, 0);
        context.restore();
      } else {
        context.fillText(road.name, (road.from + road.to) / 2, road.at - roadHalf - 24);
      }
    }

    // Buildings, coloured by type; towers get glass windows, shops and hotels get names.
    for (const b of city.buildings || []) {
      let body = C.house;
      if (b.type === 'tower') body = C.tower;
      else if (b.type === 'shop') body = C.shop;
      else if (b.type === 'hotel') body = C.hotel;
      context.fillStyle = body;
      context.fillRect(b.x, b.y, b.width, b.height);
      context.fillStyle = C.roof;
      context.fillRect(b.x, b.y, b.width, Math.min(10, b.height / 4));
      if (b.type === 'tower') {
        context.fillStyle = C.towerGlass;
        const cols = Math.max(1, Math.floor(b.width / 26));
        const rows = Math.max(1, Math.floor(b.height / 30));
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            if ((row * cols + col) % 3 === 0) continue;
            context.fillRect(b.x + 7 + col * 26, b.y + 16 + row * 30, 12, 14);
          }
        }
      }
      if (b.name) {
        context.font = `bold 12px ${FONT}`;
        context.fillStyle = 'rgba(20,20,20,0.75)';
        context.fillText(b.name, b.x + b.width / 2, b.y + b.height / 2);
      }
    }

    // Coast Garage and the gas station, as marked lots.
    for (const prop of city.props || []) {
      if (prop.kind === 'garage') {
        context.fillStyle = C.garage;
        context.fillRect(prop.x, prop.y, prop.width, prop.height);
        context.fillStyle = '#fff';
        context.font = `bold 13px ${FONT}`;
        context.fillText('COAST GARAGE', prop.x + prop.width / 2, prop.y + prop.height / 2);
      } else if (prop.kind === 'gas') {
        context.fillStyle = '#c65a3a';
        context.fillRect(prop.x, prop.y, prop.width, prop.height);
        context.fillStyle = '#fff';
        context.font = `bold 13px ${FONT}`;
        context.fillText('SUNSET FUEL', prop.x + prop.width / 2, prop.y + prop.height / 2);
      }
    }

    // The hideout landmark, where mission 3 ends.
    const hideout = city.landmarks && city.landmarks.hideout;
    if (hideout) {
      context.fillStyle = '#5a4a8a';
      context.beginPath();
      context.arc(hideout.x, hideout.y, 22, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#fff';
      context.font = `bold 13px ${FONT}`;
      context.fillText('HIDEOUT', hideout.x, hideout.y);
    }
  }

  // ---- actors ----

  function drawCar(car) {
    const w = CAR.length || 44;
    const h = CAR.width || 22;
    context.save();
    context.translate(car.x, car.y);
    context.rotate(car.angle || 0);
    // Shadow.
    context.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(context, -w / 2 + 3, -h / 2 + 3, w, h, 7);
    context.fill();
    // Body. Wrecked cars go dark grey.
    let body = car.color || '#d94f3d';
    if (car.wrecked) body = '#55595f';
    else if (car.isPolice) body = C.police;
    else if (car.isTaxi) body = C.taxi;
    else if (car.isPlayer) body = C.playerCar;
    context.fillStyle = body;
    roundRect(context, -w / 2, -h / 2, w, h, 7);
    context.fill();
    if (car.isPolice) {
      context.fillStyle = C.policeWhite;
      context.fillRect(-w / 6, -h / 2, w / 3, h);
    }
    // Windshield and rear window.
    context.fillStyle = 'rgba(180,220,240,0.9)';
    context.fillRect(w / 6, -h / 2 + 4, 8, h - 8);
    context.fillRect(-w / 4, -h / 2 + 4, 6, h - 8);
    // Wheels.
    context.fillStyle = '#14161c';
    context.fillRect(-w / 2 + 6, -h / 2 - 3, 10, 5);
    context.fillRect(w / 2 - 16, -h / 2 - 3, 10, 5);
    context.fillRect(-w / 2 + 6, h / 2 - 2, 10, 5);
    context.fillRect(w / 2 - 16, h / 2 - 2, 10, 5);
    // Headlights.
    context.fillStyle = '#fff6c9';
    context.fillRect(w / 2 - 2, -h / 2 + 4, 3, 5);
    context.fillRect(w / 2 - 2, h / 2 - 9, 3, 5);
    // Police light bar, flashing with the car's speed (the chase keeps it strobing).
    if (car.isPolice) {
      const phase = Math.floor((car.x + car.y + (car.speed || 0)) / 40) % 2 === 0;
      context.fillStyle = phase ? C.policeLight : '#2f7bff';
      context.fillRect(-4, -h / 2 + 2, 8, 6);
      context.fillStyle = phase ? '#2f7bff' : C.policeLight;
      context.fillRect(-4, h / 2 - 8, 8, 6);
    }
    // Taxi sign.
    if (car.isTaxi) {
      context.fillStyle = '#111';
      context.fillRect(-8, -5, 16, 10);
      context.fillStyle = '#ffe14d';
      context.font = `bold 8px ${FONT}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('TAXI', 0, 0);
    }
    context.restore();
  }

  function drawPed(ped) {
    context.save();
    context.translate(ped.x, ped.y);
    context.rotate(ped.angle || 0);
    if (ped.state === 'down') {
      // Knocked down: flat and grey.
      context.fillStyle = 'rgba(0,0,0,0.3)';
      context.beginPath();
      context.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#9a9a9a';
      context.beginPath();
      context.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }
    context.fillStyle = 'rgba(0,0,0,0.25)';
    context.beginPath();
    context.arc(2, 2, 8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = ped.color || C.ped;
    context.beginPath();
    context.arc(0, 0, 8, 0, Math.PI * 2);
    context.fill();
    // Facing tick.
    context.strokeStyle = 'rgba(255,255,255,0.8)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(11, 0);
    context.stroke();
    context.restore();
  }

  function drawMilo(player) {
    if (!player) return;
    // Blink while invulnerable after a hit: hidden on every other tenth of a second.
    if (player.invulnerable > 0 && Math.floor(player.invulnerable * 10) % 2 === 0) return;
    context.save();
    context.translate(player.x, player.y);
    context.rotate(player.angle || 0);
    context.fillStyle = 'rgba(0,0,0,0.3)';
    context.beginPath();
    context.arc(2, 3, 11, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = C.player;
    context.beginPath();
    context.arc(0, 0, 10, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffd9a0';
    context.beginPath();
    context.arc(3, 0, 5, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#fff';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(14, 0);
    context.stroke();
    context.restore();
  }

  function drawEffects() {
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      const fx = effects[i];
      fx.ttl -= 1 / 60;
      if (fx.ttl <= 0) {
        effects.splice(i, 1);
        continue;
      }
      const life = fx.ttl / fx.max;
      if (fx.kind === 'spark') {
        context.strokeStyle = `rgba(255, ${Math.floor(180 * life + 40)}, 60, ${life})`;
        context.lineWidth = 2;
        for (let k = 0; k < 5; k += 1) {
          const a = (k / 5) * Math.PI * 2 + fx.seed;
          context.beginPath();
          context.moveTo(fx.x, fx.y);
          context.lineTo(fx.x + Math.cos(a) * 18 * life, fx.y + Math.sin(a) * 18 * life);
          context.stroke();
        }
      } else if (fx.kind === 'smoke') {
        context.fillStyle = `rgba(200,200,200,${0.45 * life})`;
        context.beginPath();
        context.arc(fx.x, fx.y, 6 + 14 * (1 - life), 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  /** Is there a live mission with a target to point at? */
  function activeMission(state) {
    const mission = state.mission;
    if (!mission) return null;
    if (mission.activeId) return mission;
    if (mission.id && !mission.done && mission.objective) return mission;
    return null;
  }

  /** A pulsing beacon over the mission target, plus an arrow at the viewport edge. */
  function drawMissionMarker(state) {
    const mission = activeMission(state);
    if (!mission || !mission.target) return;
    const t = mission.target;
    const pulse = 1 + 0.25 * Math.sin((state.elapsed || 0) * 4);
    context.save();
    context.strokeStyle = C.star;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(t.x, t.y, (t.radius || 26) * pulse, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = C.star;
    context.beginPath();
    context.arc(t.x, t.y, 6, 0, Math.PI * 2);
    context.fill();
    context.font = `bold 14px ${FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.fillStyle = '#fff';
    context.fillText(t.label || mission.title || 'GO', t.x, t.y - 32);
    context.restore();
    // Off-screen arrow: point from the viewport centre toward the target.
    const cx = camera.x + VIEW.width / 2;
    const cy = camera.y + VIEW.height / 2;
    if (t.x < camera.x || t.x > camera.x + VIEW.width || t.y < camera.y || t.y > camera.y + VIEW.height) {
      const angle = Math.atan2(t.y - cy, t.x - cx);
      const ax = cx + Math.cos(angle) * (VIEW.width / 2 - 60);
      const ay = cy + Math.sin(angle) * (VIEW.height / 2 - 60);
      context.save();
      context.translate(ax, ay);
      context.rotate(angle);
      context.fillStyle = C.star;
      context.beginPath();
      context.moveTo(16, 0);
      context.lineTo(-10, -10);
      context.lineTo(-10, 10);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  function drawWorld(state) {
    drawCity(state);
    drawMissionMarker(state);
    for (const car of state.cars || []) drawCar(car);
    for (const cop of state.police || []) drawCar(cop);
    for (const ped of state.pedestrians || []) drawPed(ped);
    const player = state.player || {};
    if (player.onFoot !== false) drawMilo(player);
    drawEffects();
  }

  // ---- HUD (screen space) ----

  function clockText(state) {
    const minutes = state.clockMinutes ?? 9 * 60;
    const hour = Math.floor(minutes / 60) % 24;
    const minute = Math.floor(minutes) % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function drawHud(state) {
    context.textBaseline = 'top';
    // Wanted stars, top left.
    const wanted = state.wanted || 0;
    let stars = '';
    for (let i = 0; i < 5; i += 1) stars += i < wanted ? STAR : '☆';
    context.font = `28px ${FONT}`;
    context.fillStyle = wanted > 0 ? C.damage : 'rgba(255,255,255,0.55)';
    context.textAlign = 'left';
    context.fillText(stars, 20, 16);
    // Money under the stars.
    text(moneyLabel(state.money || 0), 20, 52, 26, C.star, 'left');
    // Clock, top centre.
    text(clockLabel(clockText(state)), VIEW.width / 2, 18, 26, C.text, 'center');
    // Mission objective, under the clock.
    const mission = activeMission(state);
    let objective = '按 M 查看任务，按 Space 接下一单';
    if (mission) {
      objective = mission.timer != null
        ? `${mission.objective}  ·  ${Math.max(0, Math.ceil(mission.timer))}s`
        : mission.objective;
    } else if (state.mission && state.mission.allDone) {
      objective = '三单全部完成！湾区小有名气的司机。';
    }
    context.font = `20px ${FONT}`;
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.fillText(objective, VIEW.width / 2, 52);
    // Health bar, bottom left.
    const health = (state.player && state.player.health) ?? 100;
    context.fillStyle = 'rgba(0,0,0,0.45)';
    context.fillRect(20, VIEW.height - 46, 220, 22);
    context.fillStyle = health > 50 ? C.health : health > 25 ? C.star : C.damage;
    context.fillRect(22, VIEW.height - 44, 216 * clamp(health / 100, 0, 1), 18);
    context.font = `15px ${FONT}`;
    context.fillStyle = '#fff';
    context.textAlign = 'left';
    context.fillText(`MILO  ${Math.round(health)}`, 26, VIEW.height - 43);
    // Speed, bottom right (0 on foot).
    const player = state.player || {};
    const kmh = Math.round(Math.abs(player.speed || 0) * 0.18);
    text(speedLabel(`${kmh} km/h`), VIEW.width - 20, VIEW.height - 48, 26, C.text, 'right');
    // Controls hint, bottom centre.
    context.font = `14px ${FONT}`;
    context.fillStyle = 'rgba(255,255,255,0.6)';
    context.textAlign = 'center';
    context.fillText(player.onFoot === false ? 'W 加速 · S 刹车/倒车 · A/D 转向 · E 下车 · P 暂停' : 'WASD 移动 · E 上车 · Space 接单 · M 任务 · P 暂停', VIEW.width / 2, VIEW.height - 24);
  }

  // ---- minimap ----

  function drawMinimap(state) {
    if (!mapContext) return;
    const size = citySize(state);
    const scaleX = MAP.width / size.width;
    const scaleY = MAP.height / size.height;
    const city = state.city || {};
    const beach = city.beach || { x0: 2840, waterX: 3060 };
    mapContext.setTransform(1, 0, 0, 1, 0, 0);
    mapContext.clearRect(0, 0, MAP.width, MAP.height);
    mapContext.fillStyle = 'rgba(20,26,40,0.85)';
    mapContext.fillRect(0, 0, MAP.width, MAP.height);
    mapContext.fillStyle = C.grass;
    mapContext.fillRect(0, 0, MAP.width, MAP.height);
    mapContext.fillStyle = C.sand;
    mapContext.fillRect(beach.x0 * scaleX, 0, (beach.waterX - beach.x0) * scaleX, MAP.height);
    mapContext.fillStyle = C.sea;
    mapContext.fillRect(beach.waterX * scaleX, 0, (size.width - beach.waterX) * scaleX, MAP.height);
    mapContext.fillStyle = C.road;
    for (const road of city.roads || []) {
      if (road.vertical) {
        mapContext.fillRect((road.at - 48) * scaleX, road.from * scaleY, Math.max(1, 96 * scaleX), (road.to - road.from) * scaleY);
      } else {
        mapContext.fillRect(road.from * scaleX, (road.at - 48) * scaleY, (road.to - road.from) * scaleX, Math.max(1, 96 * scaleY));
      }
    }
    const mission = activeMission(state);
    if (mission && mission.target) {
      mapContext.fillStyle = C.star;
      mapContext.beginPath();
      mapContext.arc(mission.target.x * scaleX, mission.target.y * scaleY, 4, 0, Math.PI * 2);
      mapContext.fill();
    }
    if (city.garage) {
      mapContext.fillStyle = C.garage;
      mapContext.fillRect((city.garage.x + city.garage.width / 2) * scaleX - 2, (city.garage.y + city.garage.height / 2) * scaleY - 2, 4, 4);
    }
    const hideout = city.landmarks && city.landmarks.hideout;
    if (hideout) {
      mapContext.fillStyle = '#5a4a8a';
      mapContext.fillRect(hideout.x * scaleX - 2, hideout.y * scaleY - 2, 4, 4);
    }
    for (const cop of state.police || []) {
      mapContext.fillStyle = '#ff3b30';
      mapContext.fillRect(cop.x * scaleX - 2, cop.y * scaleY - 2, 4, 4);
    }
    for (const car of state.cars || []) {
      mapContext.fillStyle = car.isPlayer ? '#fff' : '#ffd34d';
      mapContext.fillRect(car.x * scaleX - 2, car.y * scaleY - 2, 4, 4);
    }
    const player = state.player || {};
    mapContext.fillStyle = C.player;
    mapContext.strokeStyle = '#fff';
    mapContext.lineWidth = 1;
    mapContext.beginPath();
    mapContext.arc((player.x || 0) * scaleX, (player.y || 0) * scaleY, 4, 0, Math.PI * 2);
    mapContext.fill();
    mapContext.stroke();
    // Viewport rectangle.
    mapContext.strokeStyle = 'rgba(255,255,255,0.7)';
    mapContext.strokeRect(camera.x * scaleX, camera.y * scaleY, VIEW.width * scaleX, VIEW.height * scaleY);
  }

  // ---- panels ----

  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const lineHeight = 32;
    const height = 150 + lines.length * lineHeight + 64;
    const x = (VIEW.width - width) / 2;
    const y = (VIEW.height - height) / 2;
    context.fillStyle = C.panel;
    roundRect(context, x, y, width, height, 12);
    context.fill();
    context.textBaseline = 'alphabetic';
    text(title, VIEW.width / 2, y + 76, 46, accent || C.star, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], VIEW.width / 2, y + 140 + index * lineHeight, 21, C.muted, 'center');
    }
    text(prompt, VIEW.width / 2, y + height - 34, 22, C.text, 'center');
  }

  const TITLE_LINES = [
    '阳光海滨城市 Sunset Bay —— 开车、接单、甩掉警察。',
    'WASD 移动 / 驾驶 · E 上下车 · Space 接单 · M 任务 · P 暂停',
    '偷车与撞人会涨通缉星；进 Coast Garage 花钱清星。',
    '',
  ];
  const PAUSED_LINES = ['城市在等你回来。', '按 P 或 Space 继续，按 M 查看任务。'];
  const MISSION_LINES = [
    '1 · 第一单 First Fare —— 开出租车接乘客送到目的地。',
    '2 · 限时送件 Package Run —— 限时内把包裹送过城。',
    '3 · 甩掉警察 Lose the Heat —— 先到 2 星，再甩掉警车开到藏身处。',
    '三单做完，你就是湾区小有名气的司机。',
  ];

  /**
   * Paint one frame: the city through the camera, then the HUD or a panel.
   * `best` is the best money held; `saveInfo` ({ hasSave, money, missionsDone }) is
   * shown on the title screen when a save exists.
   */
  function draw(state, screen, best, saveInfo) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = C.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    updateCamera(state);
    context.setTransform(view.scale, 0, 0, view.scale, view.x - camera.x * view.scale, view.y - camera.y * view.scale);
    drawWorld(state);
    // Back to screen space for the HUD and panels.
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    if (screen === SCREEN_TITLE) {
      // A warm sunset wash over the city behind the title.
      context.fillStyle = 'rgba(255, 170, 80, 0.18)';
      context.fillRect(0, 0, VIEW.width, VIEW.height);
      if (saveInfo && saveInfo.hasSave) {
        TITLE_LINES[3] = `继续：$${saveInfo.money || 0} · 已完成任务 ${saveInfo.missionsDone || 0} / 3`;
      } else if (best > 0) {
        TITLE_LINES[3] = `最佳成绩 $${best}`;
      } else {
        TITLE_LINES[3] = '新的一天，新的第一单。';
      }
      drawPanel('SUNSET BAY', TITLE_LINES, '按 Space 或点击开始', C.star);
      drawMinimap(state);
      return;
    }
    drawHud(state);
    drawMinimap(state);
    if (screen === SCREEN_PAUSED) {
      drawPanel('已暂停', PAUSED_LINES, '按 P 继续');
    } else if (screen === SCREEN_MISSIONS) {
      drawPanel('任务 · MISSIONS', MISSION_LINES, '按 Space 接下一单 · 按 M 返回');
    } else if (screen === SCREEN_OVER) {
      const mission = state.mission || {};
      const done = mission.completed ? mission.completed.length : 0;
      const overLines = [
        `完成任务 ${done} / 3`,
        `口袋里的钱 $${state.money || 0}`,
        mission.allDone && mission.finale
          ? mission.finale.text
          : state.dead ? 'Milo 倒下了。Sunset Bay 还在等他回来。' : 'Milo 还会回来。下一单在等你。',
      ];
      drawPanel('结算 · SUNSET BAY', overLines, '按 Space 再来一局');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, addEffect };
}
