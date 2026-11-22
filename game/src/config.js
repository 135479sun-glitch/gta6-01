// Sunset Bay — every tuning number and colour in one place.
// The world is a fixed-size 2D top-down city (3200 x 2400 px); the renderer scales it to
// the window and follows the camera, so no rule below depends on the screen size.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Whole-city size in world pixels. East edge is the beach and the sea. */
export const WORLD = { width: 3200, height: 2400 };

/** Sunset Bay street grid: avenues run north-south, streets run east-west. */
export const AVENUES = [240, 640, 1040, 1440, 1840, 2240, 2640];
export const STREETS = [200, 560, 920, 1280, 1640, 2000];
export const ROAD_HALF = 48; // half the asphalt width; sidewalks sit just outside it
export const SIDEWALK = 16;

/** Road names, west to east (avenues) and north to south (streets). */
export const AVENUE_NAMES = [
  'Sunset Blvd',
  'Palm Row',
  'Bayview Ave',
  'Coral St',
  'Marina Dr',
  'Seagull Way',
  'Boardwalk Ave',
];
export const STREET_NAMES = [
  'Ocean Ave',
  'Harbor St',
  'Sunset Terrace',
  'Jacaranda Ln',
  'Pelican St',
  'Lighthouse Rd',
];

export const BEACH = { x0: 2840, waterX: 3060 }; // sand starts here, sea starts here

/** Milo on foot. */
export const PLAYER = {
  radius: 14,
  walkSpeed: 230,
  health: 100,
  enterRange: 56, // how close a car must be to press E and get in
};

/** Arcade driving: one car model, tuned for feel, not realism. */
export const CAR = {
  radius: 18,
  length: 44,
  width: 22,
  accel: 520, // px/s^2 forward
  brake: 950, // px/s^2 when S is held while moving forward
  reverseAccel: 320,
  maxSpeed: 640,
  maxReverse: 170,
  turnRate: 2.9, // rad/s at full lock, scaled down at very low speed
  drag: 0.55, // per-second speed decay when coasting
  grip: 6.0, // how fast lateral slide is killed (arcade grip)
  health: 100,
};

/** AI traffic cars. */
export const TRAFFIC = {
  count: 14,
  minSpeed: 130,
  maxSpeed: 195,
  slowNearJunction: 130, // start easing off this far from a junction
  slowFactor: 0.45,
  radius: 18,
};

/** Pedestrians on the sidewalks. */
export const PEDS = {
  count: 24,
  minSpeed: 45,
  maxSpeed: 85,
  fleeSpeed: 210,
  fleeRange: 110, // a car this close and closing makes a ped dodge
  radius: 10,
};

/** Wanted level 0-5 and the police response. */
export const WANTED = {
  max: 5,
  stealCar: 1,
  hitPedestrian: 1,
  hitPolice: 2,
  sightRange: 540, // a cop inside this range keeps the heat on
  decaySeconds: 18, // unseen for this long: lose one star
  policeSpeed: [0, 430, 470, 510, 550, 600], // by stars, index = wanted level
  policeAccel: 420,
  policeSpawnDistance: 420, // cops spawn this far from the player, on a road
};

/** Coast Garage (Pay'n Spray style): drive in, pay, lose the heat. */
export const GARAGE = {
  costPerStar: 50,
  x: 1520,
  y: 1360,
  width: 150,
  height: 104,
  name: 'Coast Garage',
};

/** Collision damage. */
export const DAMAGE = {
  buildingHitBase: 6, // + speed/80 on a hard hit
  carHitBase: 5,
  pedHitPlayer: 12, // an AI car hitting Milo on foot
  policeRam: 10,
  wreckSpeed: 420, // hitting a building above this speed wrecks the car badly
};

export const MONEY_START = 50;

export const PALETTE = {
  // Sun, sea and sand.
  sky: '#ffd9a0',
  grass: '#7ec850',
  parkGrass: '#5da83f',
  sand: '#f2ddab',
  sea: '#2e9fd8',
  seaDeep: '#1f7fb8',
  // Roads and pavements.
  road: '#3d4450',
  roadLine: '#f7d774',
  sidewalk: '#c9c2b4',
  curb: '#9d968a',
  // Buildings by type.
  tower: '#8fa3b8',
  towerGlass: '#5b7d9e',
  house: '#e8a87c',
  shop: '#f2c94c',
  hotel: '#e07a9a',
  garage: '#4f9d69',
  roof: '#6b5d4f',
  // People and cars.
  player: '#ff7847',
  playerCar: '#ff7847',
  taxi: '#f7c948',
  police: '#2f6fd0',
  policeLight: '#ff3b30',
  ped: '#e8e8e8',
  carColors: ['#d94f3d', '#3d7dd9', '#e8e8e8', '#2fbf71', '#f2a541', '#8e6fc0', '#4fc3f7'],
  // HUD.
  panel: 'rgba(20, 26, 38, 0.72)',
  text: '#fff7e6',
  muted: '#c9bfa8',
  star: '#ffd94d',
  health: '#58d68d',
  damage: '#e5534b',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Keyboard: the input layer (worker C) maps these codes into the step() input object. */
export const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  enter: ['KeyE'],
  action: ['Space'],
  pause: ['KeyP', 'Escape'],
  mission: ['KeyM'],
};

/** Where the save lives (this browser only). */
export const SAVE_KEY = 'sunset-bay.save.v1';
export const BEST_KEY = 'sunset-bay.best';
