// Builds a planned jigsaw site (a village) into the world. It surveys the
// ground, plans on a smoothed version of it, bulldozes the real ground to that
// shape (felling whole trees), drapes the roads, sets each building on a level
// pad, eases the ground around the pads and moves the villagers in.
import { world, system, BlockPermutation, StructureRotation } from "@minecraft/server";
import { plan, mulberry32, rotPos } from "./jigsaw.js";
import * as data from "./data.js";

const { PIECES, SITES } = data;

// Pools that mean "a mob lives here" rather than "attach a piece".
const SPAWNS = {
  "minecraft:village/plains/villagers": ["minecraft:villager_v2"],
  "minecraft:village/common/iron_golem": ["minecraft:iron_golem"],
  "minecraft:village/common/cats": ["minecraft:cat"],
  "ctov:village/common/animals": ["minecraft:cow", "minecraft:sheep", "minecraft:pig", "minecraft:chicken"],
  "ctov:village/common/bees": ["minecraft:bee"],
};
const SPAWN_POOLS = new Set(Object.keys(SPAWNS));

// Things that sit on the ground without being ground: trees, plants, snow cover.
const SOFT = /air$|leaves|_log$|_wood$|_stem$|mushroom_block|vine|grass$|fern|flower|dandelion|poppy|tulip|orchid|allium|bluet|daisy|cornflower|lily|bush|sapling|(brown|red)_mushroom$|bamboo|snow_layer|sugar_cane|reeds|cactus|pumpkin|melon|bee_nest|azalea|carpet|web$|kelp|seagrass|petals|cocoa|leaf_litter|firefly|mangrove_roots|propagule/;
const WATER = /water$/;
const LOG = /_log$|_wood$|_stem$|mangrove_roots$/;
const CANOPY = /leaves|vine|bee_nest|cocoa|mushroom_block|shroomlight|wart_block|snow_layer/;
const SURVEY_STEP = 2; // the ground is sampled every this many blocks
const SMOOTH = 6; // survey samples averaged each way: about 12 blocks, which turns a cliff into a slope
const GRADE_FULL = 3; // this close to a road or building the ground is fully reshaped
const GRADE_FADE = 9; // and over this many more blocks it fades back to the natural ground
const ROAD = [["minecraft:cobblestone", 2], ["minecraft:mossy_cobblestone", 1], ["minecraft:grass_path", 5], ["minecraft:grass_block", 4]];
const ROAD_TOTAL = ROAD.reduce((n, r) => n + r[1], 0);
const BLEND = 5; // how many blocks out from a building the ground is eased towards it
const MAX_STEP = 12; // taller differences than this are left as cliffs
const MARGIN = 24;
const MAX_WET = 0.3; // a building with more of its footprint than this over water isn't built

let rotationTable = null; // our quarter turns -> the game's StructureRotation, found by experiment
export const forgetRotations = () => { rotationTable = null; }; // for tests

export class Terrain {
  constructor(dim) {
    this.dim = dim;
    this.cache = new Map();
    this.min = dim.heightRange.min;
  }

  // {y: top ground block (or water surface), floor: solid ground, raw: topmost block of any kind, type, wet}
  top(x, z) {
    const key = x + "," + z;
    let t = this.cache.get(key);
    if (t) return t;
    let b = this.dim.getTopmostBlock({ x, z });
    if (!b) throw new Error(`the ground at ${x} ${z} isn't loaded`);
    const raw = b.y;
    while (b.y > this.min && SOFT.test(b.typeId)) b = b.below();
    let surface = b;
    // Either the search stopped on the water surface or went through to the bed.
    while (b.y > this.min && WATER.test(b.typeId)) b = b.below();
    for (let up = surface.above(); up && WATER.test(up.typeId); up = up.above()) surface = up;
    const wet = WATER.test(surface.typeId);
    t = { y: surface.y, floor: b.y, raw, type: wet ? "minecraft:water" : surface.typeId, wet };
    this.cache.set(key, t);
    return t;
  }

  firstFree(x, z) {
    return this.top(x, z).y + 1;
  }
}

function setType(dim, x, y, z, type) {
  dim.setBlockType({ x, y, z }, type);
}

// Cut down a whole tree from one of its logs: every connected log, then the
// leaves around them, so no canopy is left hanging.
function fell(dim, x, y, z, cascade = true) {
  const stack = [[x, y, z]], seen = new Set([x + "," + y + "," + z]);
  let x0 = x, x1 = x, y0 = y, y1 = y, z0 = z, z1 = z, logs = 0;
  while (stack.length && logs < 300) {
    const [cx, cy, cz] = stack.pop();
    const b = dim.getBlock({ x: cx, y: cy, z: cz });
    if (!b || !LOG.test(b.typeId)) continue;
    b.setType("minecraft:air");
    logs++;
    x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const k = (cx + dx) + "," + (cy + dy) + "," + (cz + dz);
      if (!seen.has(k)) { seen.add(k); stack.push([cx + dx, cy + dy, cz + dz]); }
    }
  }
  const neighbours = [];
  for (let ax = x0 - 3; ax <= x1 + 3; ax++) for (let az = z0 - 3; az <= z1 + 3; az++) for (let ay = y0; ay <= y1 + 4; ay++) {
    const b = dim.getBlock({ x: ax, y: ay, z: az });
    if (!b) continue;
    if (CANOPY.test(b.typeId)) b.setType("minecraft:air");
    else if (cascade && LOG.test(b.typeId)) neighbours.push([ax, ay, az]);
  }
  // A neighbouring tree that close has just lost most of its leaves. Take it
  // too, once, so a clearing isn't ringed with bare trunks.
  for (const [ax, ay, az] of neighbours) fell(dim, ax, ay, az, false);
}

// Remove whatever stands on a column: plants go, and a tree goes entirely.
function clearSoft(dim, x, z, t) {
  for (let y = t.raw; y > t.y; y--) {
    const b = dim.getBlock({ x, y, z });
    if (!b || b.isAir) continue;
    if (LOG.test(b.typeId)) fell(dim, x, y, z);
    else if (SOFT.test(b.typeId)) b.setType("minecraft:air");
  }
  t.raw = t.y;
}

// Bulldoze or fill one column so its top is at `level`, keeping its surface block.
function reshape(dim, x, z, t, level) {
  clearSoft(dim, x, z, t);
  if (level < t.y) {
    for (let y = t.y; y > level; y--) setType(dim, x, y, z, "minecraft:air");
  } else if (level > t.y) {
    const fill = /sand/.test(t.type) ? "minecraft:sandstone" : /stone|deepslate|andesite|granite|diorite|tuff/.test(t.type) ? t.type : "minecraft:dirt";
    for (let y = t.y; y < level; y++) setType(dim, x, y, z, fill);
  } else return;
  setType(dim, x, level, z, t.type);
  t.y = t.floor = t.raw = level;
}

// Sample the ground across the site and blur it into the gentle shape the
// village is planned and graded on.
async function survey(terrain, center, r) {
  const n = Math.floor((2 * r) / SURVEY_STEP) + 1, x0 = center.x - r, z0 = center.z - r;
  let h = new Float32Array(n * n), wet = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const t = terrain.top(x0 + i * SURVEY_STEP, z0 + j * SURVEY_STEP);
      h[i * n + j] = t.y;
      if (t.wet) wet++;
    }
    if (i % 6 === 5) await ticks(1);
  }
  const natural = h;
  for (let pass = 0; pass < 2; pass++) {
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const out = new Float32Array(n * n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = -SMOOTH; k <= SMOOTH; k++) {
          const a = Math.min(n - 1, Math.max(0, i + k * di)), b = Math.min(n - 1, Math.max(0, j + k * dj));
          sum += h[a * n + b];
        }
        out[i * n + j] = sum / (2 * SMOOTH + 1);
      }
      h = out;
    }
    await ticks(1);
  }
  let moved = 0;
  for (let k = 0; k < h.length; k++) moved += Math.abs(h[k] - natural[k]);
  return {
    wet: wet / (n * n),
    rough: moved / h.length, // average blocks of cut or fill the smoothing asks for
    at(x, z) {
      const fx = Math.min(n - 1.001, Math.max(0, (x - x0) / SURVEY_STEP)), fz = Math.min(n - 1.001, Math.max(0, (z - z0) / SURVEY_STEP));
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      return h[i * n + j] * (1 - u) * (1 - v) + h[(i + 1) * n + j] * u * (1 - v) + h[i * n + j + 1] * (1 - u) * v + h[(i + 1) * n + j + 1] * u * v;
    },
  };
}

// Reshape the real ground to the smoothed shape wherever something will be
// built, fading back to natural ground a few blocks out.
async function grade(dim, terrain, smooth, seeds, center, r) {
  const w = 2 * r + 1, x0 = center.x - r, z0 = center.z - r, far = GRADE_FULL + GRADE_FADE;
  const dist = new Int8Array(w * w).fill(127);
  let ring = [];
  for (const [x, z] of seeds) {
    const i = x - x0, j = z - z0;
    if (i < 0 || j < 0 || i >= w || j >= w || dist[i * w + j] === 0) continue;
    dist[i * w + j] = 0;
    ring.push(i * w + j);
  }
  for (let d = 1; d <= far && ring.length; d++) {
    const next = [];
    for (const c of ring) {
      const i = Math.floor(c / w), j = c % w;
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || b < 0 || a >= w || b >= w || dist[a * w + b] <= d) continue;
        dist[a * w + b] = d;
        next.push(a * w + b);
      }
    }
    ring = next;
  }
  let changed = 0, n = 0;
  for (let c = 0; c < dist.length; c++) {
    const d = dist[c];
    if (d > far) continue;
    const x = x0 + Math.floor(c / w), z = z0 + (c % w);
    const t = terrain.top(x, z);
    if (t.wet) continue;
    const s = smooth.at(x, z);
    const level = d <= GRADE_FULL ? Math.round(s) : Math.round(t.y + (1 - (d - GRADE_FULL) / GRADE_FADE) * (s - t.y));
    // Every tree that later ground work could touch comes down now, before any
    // building exists: felling follows connected logs and would eat a log wall.
    if (d <= BLEND + 1) clearSoft(dim, x, z, t);
    if (level !== t.y) { reshape(dim, x, z, t, level); changed++; }
    if (++n % 250 === 0) await ticks(1);
  }
  return changed;
}

// Work out how the game's structure rotations line up with the planner's, by
// placing a tiny marker structure high in the sky each way and looking at it.
function calibrate(dim, near) {
  if (rotationTable) return rotationTable;
  const at = { x: Math.floor(near.x), y: dim.heightRange.max - 8, z: Math.floor(near.z) };
  const marks = { "minecraft:gold_block": [0, 0, 0], "minecraft:iron_block": [2, 0, 0], "minecraft:diamond_block": [0, 0, 1] };
  const size = [3, 1, 2];
  const wipe = () => {
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) setType(dim, at.x + dx, at.y, at.z + dz, "minecraft:air");
  };
  const table = [null, null, null, null];
  for (const rot of [StructureRotation.None, StructureRotation.Rotate90, StructureRotation.Rotate180, StructureRotation.Rotate270]) {
    wipe();
    world.structureManager.place("bs:calib", dim, at, { rotation: rot });
    const found = {};
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const id = dim.getBlock({ x: at.x + dx, y: at.y, z: at.z + dz })?.typeId;
      if (marks[id]) found[id] = [dx, dz];
    }
    for (let r = 0; r < 4; r++) {
      const far = rotPos([size[0] - 1, 0, size[2] - 1], r);
      const shift = [Math.max(0, -far[0]), Math.max(0, -far[2])]; // the game puts the min corner at the location
      const ok = Object.entries(marks).every(([id, local]) => {
        const q = rotPos(local, r);
        return found[id] && found[id][0] === q[0] + shift[0] && found[id][1] === q[2] + shift[1];
      });
      if (ok) table[r] = rot;
    }
  }
  wipe();
  if (table.some((t) => t === null)) {
    throw new Error("structure rotation check failed: the game places rotated structures differently than expected");
  }
  rotationTable = table;
  return table;
}

export const ticks = (n) => new Promise((done) => system.runTimeout(done, n));

// Keep the whole site loaded while it's planned and built.
export async function loadArea(dim, center, reach) {
  const r = reach + MARGIN;
  const names = [];
  for (const [i, [sx, sz]] of [[-1, -1], [0, -1], [-1, 0], [0, 0]].entries()) {
    const name = `bs_build${i}`;
    const x0 = center.x + sx * r, z0 = center.z + sz * r;
    try { dim.runCommand(`tickingarea remove ${name}`); } catch {}
    try {
      dim.runCommand(`tickingarea add ${x0} 0 ${z0} ${x0 + r - 1} 0 ${z0 + r - 1} ${name}`);
      names.push(name);
    } catch {}
  }
  // Spots to check, all INSIDE the areas just asked for (which end at r - 1):
  // a spot one block further out can sit in the next chunk and never load.
  const offsets = [];
  for (let d = -r; d < r; d += 16) offsets.push(d);
  offsets.push(r - 1);
  const probes = [];
  for (const x of offsets) for (const z of offsets) probes.push({ x: center.x + x, y: 64, z: center.z + z });
  let missing = 0;
  for (let tries = 0; tries < 120; tries++) {
    missing = 0;
    for (const p of probes) {
      try { if (!dim.getBlock(p)) missing++; } catch { missing++; }
    }
    if (!missing) return names;
    await ticks(5);
  }
  unload(dim, names);
  throw new Error(`the area didn't load in time (${names.length} of 4 ticking areas made, ${missing} of ${probes.length} spots still unloaded, ${2 * r} blocks across)`);
}

export function unload(dim, names) {
  for (const n of names) {
    try { dim.runCommand(`tickingarea remove ${n}`); } catch {}
  }
}

// The columns a road piece paves.
function roadCells(piece) {
  const { tm } = PIECES[piece.name], out = [];
  for (let i = 0; i < tm.b.length; i += 4) {
    if (tm.b[i + 1] !== 0 || tm.pal[tm.b[i + 3]][0] !== "minecraft:cobblestone") continue;
    const q = rotPos([tm.b[i], 0, tm.b[i + 2]], piece.r);
    out.push([piece.o[0] + q[0], piece.o[2] + q[2]]);
  }
  return out;
}

function buildRoad(dim, terrain, piece, rng, smooth) {
  const { tm } = PIECES[piece.name];
  const perms = tm.pal.map(([name, states]) => BlockPermutation.resolve(name, states));
  for (let i = 0; i < tm.b.length; i += 4) {
    const ly = tm.b[i + 1], name = tm.pal[tm.b[i + 3]][0];
    const q = rotPos([tm.b[i], 0, tm.b[i + 2]], piece.r);
    const x = piece.o[0] + q[0], z = piece.o[2] + q[2];
    const t = terrain.top(x, z);
    // Over water the road becomes a plank deck level with the banks, not the water.
    const y = (t.wet ? Math.max(t.y, Math.round(smooth.at(x, z))) : t.y) + ly;
    if (ly === 0 && name === "minecraft:cobblestone") {
      clearSoft(dim, x, z, t);
      let type = "minecraft:oak_planks";
      if (!t.wet) {
        let roll = rng() * ROAD_TOTAL;
        type = ROAD.find((r) => (roll -= r[1]) < 0)[0];
      }
      setType(dim, x, y, z, type);
    } else if (name === "minecraft:air") {
      if (ly > 0) setType(dim, x, y, z, "minecraft:air");
    } else {
      dim.setBlockPermutation({ x, y, z }, perms[tm.b[i + 3]]);
    }
  }
}

const FOUNDATION = { "minecraft:grass_block": "minecraft:dirt", "minecraft:grass_path": "minecraft:dirt", "minecraft:farmland": "minecraft:dirt" };

// The ground level a building expects around it: one below its doorway.
function padLevel(piece) {
  const door = PIECES[piece.name].j.find((j) => j.f !== "up" && j.f !== "down");
  return piece.o[1] + (door ? door.p[1] : 0) - 1;
}

// Level a pad the size of the building's footprint, then set the building on it.
function buildRigid(dim, terrain, piece, rotations) {
  const def = PIECES[piece.name];
  const [x0, y0, z0] = piece.box;
  const pad = padLevel(piece);
  const fill = FOUNDATION[def.fb] ?? def.fb ?? "minecraft:cobblestone";
  const [sx, , sz] = def.s;
  for (let lx = 0; lx < sx; lx++) for (let lz = 0; lz < sz; lz++) {
    const q = rotPos([lx, 0, lz], piece.r);
    const x = piece.o[0] + q[0], z = piece.o[2] + q[2];
    const t = terrain.top(x, z);
    const solid = def.base?.[lx * sz + lz] === "1";
    if (t.wet) {
      // Over water only the building's own base gets a pier, down to the bed.
      if (solid && pad - t.floor <= MAX_STEP * 2) for (let y = t.floor + 1; y <= pad; y++) setType(dim, x, y, z, fill);
      continue;
    }
    if (Math.abs(t.y - pad) > MAX_STEP * 2) continue;
    const from = t.y;
    reshape(dim, x, z, t, pad);
    if (solid) for (let y = Math.min(from, pad) + 1; y <= pad; y++) setType(dim, x, y, z, fill);
  }
  world.structureManager.place(`bs:${piece.name}`, dim, { x: x0, y: y0, z: z0 }, { rotation: rotations[piece.r] });
}

// Ease the ground towards each building so it doesn't sit in a pit or on a ledge.
async function blend(dim, terrain, pieces, roadColumns) {
  const boxes = pieces.filter((p) => !p.tm).map((p) => p.box);
  const inBuilding = (x, z) => boxes.some((b) => x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]);
  const targets = new Map(); // column -> {x, z, d, level}
  for (const p of pieces) {
    if (p.tm) continue;
    const [x0, , z0, x1, , z1] = p.box;
    if (Math.min(x1 - x0, z1 - z0) < 4) continue; // lamps and the like
    const level = padLevel(p);
    for (let x = x0 - BLEND; x <= x1 + BLEND; x++) for (let z = z0 - BLEND; z <= z1 + BLEND; z++) {
      const d = Math.max(x0 - x, x - x1, z0 - z, z - z1);
      if (d < 1) continue;
      const key = x + "," + z;
      const had = targets.get(key);
      if (!had || d < had.d) targets.set(key, { x, z, d, level });
    }
  }
  let changed = 0, n = 0;
  for (const [key, { x, z, d, level }] of targets) {
    if (++n % 400 === 0) await ticks(1);
    if (roadColumns.has(key) || inBuilding(x, z)) continue;
    const t = terrain.top(x, z);
    if (t.wet || Math.abs(t.y - level) > MAX_STEP) continue;
    const want = Math.round(level + ((t.y - level) * d) / (BLEND + 1));
    if (want === t.y) continue;
    reshape(dim, x, z, t, want);
    changed++;
  }
  return changed;
}

// A fixed pseudo-random number in [0, 1) for a column, so edges look ragged
// the same way every time.
const speckle = (x, z) => {
  let h = (Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296; // >>> 0: the xor alone can come out negative
};

/**
 * Prepare the ground for one structure placed on its own: level a pad under
 * it, clear trees, and ease the ground around it with rounded, slightly ragged
 * edges so it doesn't leave a square terrace.
 * @param sink   how many blocks below the typical ground the pad goes (ruins look right half-buried)
 * @param low    take the level from the lower ground under the footprint, not the middle
 * @returns the y the structure's bottom layer should go at
 */
export function prepareSpot(dim, x0, z0, w, d, { sink = 0, low = false, width = BLEND + 2 } = {}) {
  const terrain = new Terrain(dim);
  const tops = [];
  for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) {
    const t = terrain.top(x, z);
    if (!t.wet) tops.push(t.y);
  }
  if (!tops.length) return terrain.top(x0, z0).y;
  tops.sort((a, b) => a - b);
  const level = tops[Math.floor(tops.length * (low ? 0.3 : 0.5))] - sink;
  const x1 = x0 + w - 1, z1 = z0 + d - 1;
  for (let x = x0 - width - 1; x <= x1 + width + 1; x++) for (let z = z0 - width - 1; z <= z1 + width + 1; z++) {
    const dx = Math.max(x0 - x, x - x1, 0), dz = Math.max(z0 - z, z - z1, 0);
    const out = Math.hypot(dx, dz);
    if (out > width + 1) continue;
    const t = terrain.top(x, z);
    if (t.wet) continue;
    if (Math.abs(t.y - level) > MAX_STEP * 2) { clearSoft(dim, x, z, t); continue; }
    if (out === 0) { reshape(dim, x, z, t, level); clearSoft(dim, x, z, t); continue; }
    const share = Math.min(1, out / (width + 1)); // 0 at the structure, 1 at natural ground
    const eased = share * share * (3 - 2 * share);
    reshape(dim, x, z, t, Math.round(level + (t.y - level) * eased + (speckle(x, z) - 0.5) * 0.8));
  }
  return level;
}

function spawnAll(dim, spawns, rng) {
  let count = 0;
  for (const s of spawns) {
    const kinds = SPAWNS[s.pool];
    const type = kinds[Math.floor(rng() * kinds.length)];
    let [x, y, z] = s.pos;
    try {
      for (let up = 0; up < 4 && !dim.getBlock({ x, y, z })?.isAir; up++) y++;
      dim.spawnEntity(type, { x: x + 0.5, y, z: z + 0.5 });
      count++;
    } catch {}
  }
  return count;
}

/**
 * Build a site centred on a spot. Spreads the work over many ticks.
 * @param tell (text) => void, progress messages
 * @param onStart (box) => void, called once the first piece is in
 * @returns a promise of {pieces, spawns} or undefined if it couldn't build
 */
export async function buildSite(dim, siteId, center, seed, tell, onStart) {
  const site = SITES[siteId];
  if (!site) return tell(`§cNo site called ${siteId}. Sites: ${Object.keys(SITES).join(", ")}`);
  center = { x: Math.floor(center.x), z: Math.floor(center.z) };
  {
    let areas = [];
    const started = Date.now();
    try {
      tell(`Loading the area for ${siteId} (seed ${seed})...`);
      areas = await loadArea(dim, center, site.reach);
      const rotations = calibrate(dim, center);
      const terrain = new Terrain(dim);
      const rng = mulberry32(seed);
      const span = site.reach + MARGIN;
      const smooth = await survey(terrain, center, span);
      if (smooth.wet > 0.5) return tell("§cMore than half of this spot is water. Try somewhere drier.");
      // Plan on the smoothed ground: that's what the real ground is about to become.
      // Roads may bridge water, but buildings stay on land. The survey already
      // sampled every other block, so this reads from its cache.
      const dryEnough = (box) => {
        let wet = 0, n = 0;
        for (let x = box[0] - ((box[0] - center.x) & 1); x <= box[3]; x += SURVEY_STEP) for (let z = box[2] - ((box[2] - center.z) & 1); z <= box[5]; z += SURVEY_STEP) {
          n++;
          if (terrain.top(x, z).wet) wet++;
        }
        return !n || wet / n <= MAX_WET;
      };
      const { pieces, spawns } = plan({ site, center, rng, firstFree: (x, z) => Math.round(smooth.at(x, z)) + 1, data, spawnPools: SPAWN_POOLS, canPlace: dryEnough });
      await ticks(1);
      const roads = pieces.filter((p) => p.tm), rigid = pieces.filter((p) => !p.tm);
      tell(`Preparing the ground for ${rigid.length} buildings and ${roads.length} stretches of road`
        + (smooth.rough > 2.5 ? " (rough terrain: expect a lot of earth moved)..." : "..."));
      const seeds = [], roadColumns = new Set();
      for (const p of roads) for (const c of roadCells(p)) { seeds.push(c); roadColumns.add(c[0] + "," + c[1]); }
      for (const p of rigid) for (let x = p.box[0]; x <= p.box[3]; x++) for (let z = p.box[2]; z <= p.box[5]; z++) seeds.push([x, z]);
      const graded = await grade(dim, terrain, smooth, seeds, center, span);
      tell("Building...");
      let failed = 0;
      for (const p of roads) {
        try { buildRoad(dim, terrain, p, rng, smooth); } catch (e) { failed++; console.warn(`[bs] road ${p.name}: ${e}`); }
        await ticks(1);
      }
      rigid.sort((a, b) => a.depth - b.depth);
      for (const [i, p] of rigid.entries()) {
        try { buildRigid(dim, terrain, p, rotations); } catch (e) { failed++; console.warn(`[bs] ${p.name}: ${e}`); }
        if (i === 0) onStart?.(p.box);
        await ticks(1);
      }
      const eased = await blend(dim, terrain, pieces, roadColumns);
      const moved = spawnAll(dim, spawns, rng);
      tell(`§aDone§r in ${((Date.now() - started) / 1000).toFixed(1)}s: ${rigid.length} buildings, ${roads.length} road pieces, ${moved} villagers and animals, ${graded + eased} ground columns reshaped`
        + (failed ? `, §c${failed} pieces failed (see the content log)§r.` : "."));
      return { pieces, spawns, failed };
    } catch (e) {
      tell(`§cBuild stopped: ${e}`);
    } finally {
      unload(dim, areas);
    }
  }
}

export const SITE_IDS = Object.keys(SITES);
