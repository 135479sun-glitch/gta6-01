// Sunset Bay — the city itself. Deterministic: the same seed builds the same city, so
// screenshots and saves always match. The city only describes the place (roads, blocks,
// buildings, park, beach, landmarks); it never draws anything and never steps the game.
//
// Layout: a grid of avenues (north-south) and streets (east-west), a park in the middle,
// the beach and the sea along the east edge, Coast Garage one block south of the park.

import { AVENUES, AVENUE_NAMES, BEACH, GARAGE, ROAD_HALF, SIDEWALK, STREETS, STREET_NAMES, WORLD } from './config.js';
import { chance, int, pick, range } from './random.js';

const PARK_BLOCK = { avenue: 2, street: 2 }; // between avenues[2..3], streets[2..3]
const GARAGE_BLOCK = { avenue: 3, street: 3 }; // between avenues[3..4], streets[3..4]
const DOWNTOWN_AVENUES = [2, 3, 4];
const DOWNTOWN_STREETS = [1, 2, 3];

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function circleHitsRect(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function createCity(random) {
  const buildings = [];
  const trees = [];
  const props = [];

  const inset = ROAD_HALF + SIDEWALK + 10;

  // --- Blocks and buildings -------------------------------------------------
  for (let ai = 0; ai < AVENUES.length - 1; ai += 1) {
    for (let si = 0; si < STREETS.length - 1; si += 1) {
      const bx0 = AVENUES[ai] + inset;
      const bx1 = AVENUES[ai + 1] - inset;
      const by0 = STREETS[si] + inset;
      const by1 = STREETS[si + 1] - inset;
      const blockW = bx1 - bx0;
      const blockH = by1 - by0;
      if (blockW < 60 || blockH < 60) continue;

      const isPark = ai === PARK_BLOCK.avenue && si === PARK_BLOCK.street;
      const isGarageBlock = ai === GARAGE_BLOCK.avenue && si === GARAGE_BLOCK.street;

      if (isPark) {
        // Central park: lawn, paths and trees, no buildings.
        for (let t = 0; t < 26; t += 1) {
          trees.push({
            x: range(random, bx0 + 14, bx1 - 14),
            y: range(random, by0 + 14, by1 - 14),
            r: range(random, 9, 15),
          });
        }
        props.push({ kind: 'park', x: bx0, y: by0, width: blockW, height: blockH, name: 'Sunset Park' });
        continue;
      }

      const downtown = DOWNTOWN_AVENUES.includes(ai) && DOWNTOWN_STREETS.includes(si);
      const nearBeach = ai >= AVENUES.length - 2;
      const cols = blockW > 220 ? 2 : 1;
      const rows = blockH > 200 ? 2 : 1;
      const cellW = blockW / cols;
      const cellH = blockH / rows;

      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          if (chance(random, 0.18)) continue; // empty lot / courtyard
          const pad = 12;
          const w = range(random, cellW * 0.45, cellW - pad * 2);
          const h = range(random, cellH * 0.45, cellH - pad * 2);
          const x = bx0 + c * cellW + (cellW - w) / 2 + range(random, -6, 6);
          const y = by0 + r * cellH + (cellH - h) / 2 + range(random, -6, 6);
          const building = { x, y, width: w, height: h, type: 'house', name: '' };
          if (downtown && chance(random, 0.55)) {
            building.type = 'tower';
            building.floors = int(random, 6, 18);
          } else if (nearBeach && chance(random, 0.6)) {
            building.type = 'hotel';
            building.name = pick(random, ['Bayview Hotel', 'Palm Court Inn', 'Sunset Suites']);
          } else if (chance(random, 0.35)) {
            building.type = 'shop';
            building.name = pick(random, [
              'Coast Motors', 'Taco Bay', 'Palm Cafe', 'Surf Shop', 'Bay Books',
              'Sunset Diner', 'Coral Grocers', 'Wave Records',
            ]);
          } else {
            building.type = 'house';
          }
          if (isGarageBlock && rectsOverlap(building, GARAGE)) continue;
          buildings.push(building);
        }
      }

      // A few street trees along the block edge.
      if (chance(random, 0.6)) {
        trees.push({ x: bx0 + 8, y: by0 + 8, r: 11 });
        trees.push({ x: bx1 - 8, y: by1 - 8, r: 11 });
      }
    }
  }

  // --- Beach strip east of the last avenue: huts and a lifeguard post -------
  for (let i = 0; i < 5; i += 1) {
    const y = 260 + i * 380 + range(random, -40, 40);
    buildings.push({
      x: BEACH.x0 - 150,
      y,
      width: 90,
      height: 60,
      type: 'shop',
      name: i === 2 ? 'Lifeguard Post' : 'Beach Hut',
    });
  }

  // --- Named landmarks (mission hooks read these) ---------------------------
  const garage = { ...GARAGE };
  const gasStation = {
    kind: 'gas',
    x: AVENUES[1] + inset,
    y: STREETS[4] + inset,
    width: 150,
    height: 110,
    name: 'Sunset Fuel',
  };
  props.push({ kind: 'garage', ...garage });
  props.push(gasStation);

  const landmarks = {
    spawn: { x: AVENUES[3] + ROAD_HALF + 8, y: STREETS[2] + 120 }, // Milo starts on the Coral St sidewalk by the park
    garage: { x: garage.x + garage.width / 2, y: garage.y + garage.height / 2 },
    gasStation: { x: gasStation.x + gasStation.width / 2, y: gasStation.y + gasStation.height / 2 },
    taxiStand: { x: AVENUES[2], y: STREETS[1] - ROAD_HALF - 30 },
    packageDepot: { x: AVENUES[5], y: STREETS[4] + ROAD_HALF + 30 },
    hideout: { x: AVENUES[0] + 60, y: STREETS[5] - 80 },
    park: { x: (AVENUES[2] + AVENUES[3]) / 2, y: (STREETS[2] + STREETS[3]) / 2 },
    beach: { x: BEACH.x0 + 90, y: 1200 },
  };

  const roads = [];
  for (let i = 0; i < AVENUES.length; i += 1) {
    roads.push({ vertical: true, at: AVENUES[i], from: 0, to: WORLD.height, name: AVENUE_NAMES[i] });
  }
  for (let i = 0; i < STREETS.length; i += 1) {
    roads.push({ vertical: false, at: STREETS[i], from: 0, to: BEACH.x0, name: STREET_NAMES[i] });
  }

  // --- Queries used by world.js ---------------------------------------------
  function isRoad(x, y) {
    for (const ax of AVENUES) if (Math.abs(x - ax) <= ROAD_HALF) return true;
    for (const sy of STREETS) if (Math.abs(y - sy) <= ROAD_HALF) return true;
    return false;
  }

  function isSidewalk(x, y) {
    if (isRoad(x, y)) return false;
    for (const ax of AVENUES) {
      if (Math.abs(x - ax) <= ROAD_HALF + SIDEWALK && y >= 0 && y <= WORLD.height) return true;
    }
    for (const sy of STREETS) {
      if (Math.abs(y - sy) <= ROAD_HALF + SIDEWALK && x >= 0 && x <= BEACH.x0) return true;
    }
    return false;
  }

  function buildingAt(x, y, radius) {
    for (const b of buildings) {
      if (circleHitsRect(x, y, radius, b)) return b;
    }
    return null;
  }

  function inWater(x) {
    return x >= BEACH.waterX;
  }

  function clampToWorld(x, y, margin) {
    return {
      x: Math.max(margin, Math.min(WORLD.width - margin, x)),
      y: Math.max(margin, Math.min(WORLD.height - margin, y)),
    };
  }

  /** Nearest point on any road centreline. */
  function nearestRoadPoint(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const ax of AVENUES) {
      const d = Math.abs(x - ax);
      if (d < bestD) { bestD = d; best = { x: ax, y: Math.max(0, Math.min(WORLD.height, y)) }; }
    }
    for (const sy of STREETS) {
      const d = Math.abs(y - sy);
      if (d < bestD) { bestD = d; best = { x: Math.max(0, Math.min(BEACH.x0, x)), y: sy }; }
    }
    return best;
  }

  /** A random point on a random road centreline (traffic / police spawn). */
  function randomRoadPoint(rnd) {
    if (chance(rnd, 0.5)) {
      return { x: pick(rnd, AVENUES), y: range(rnd, 40, WORLD.height - 40) };
    }
    return { x: range(rnd, 40, BEACH.x0 - 40), y: pick(rnd, STREETS) };
  }

  /** A random point on a sidewalk, for pedestrians. */
  function randomSidewalkPoint(rnd) {
    const p = randomRoadPoint(rnd);
    const side = chance(rnd, 0.5) ? 1 : -1;
    if (chance(rnd, 0.5)) {
      return { x: p.x + side * (ROAD_HALF + SIDEWALK / 2), y: p.y };
    }
    return { x: p.x, y: p.y + side * (ROAD_HALF + SIDEWALK / 2) };
  }

  /** The junction grid, for traffic AI routing. */
  function junctions() {
    const list = [];
    for (const ax of AVENUES) {
      for (const sy of STREETS) list.push({ x: ax, y: sy });
    }
    return list;
  }

  return {
    width: WORLD.width,
    height: WORLD.height,
    avenues: AVENUES,
    streets: STREETS,
    roads,
    buildings,
    trees,
    props,
    landmarks,
    garage,
    gasStation,
    beach: { ...BEACH },
    isRoad,
    isSidewalk,
    buildingAt,
    inWater,
    clampToWorld,
    nearestRoadPoint,
    randomRoadPoint,
    randomSidewalkPoint,
    junctions,
  };
}
