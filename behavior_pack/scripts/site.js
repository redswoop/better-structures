// Builds a planned jigsaw site (a village) into the world: loads the area,
// drapes roads over the ground, sets buildings on foundations, blends the
// ground around them and moves the villagers in.
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
const SOFT = /air$|leaves|_log$|_wood$|_stem$|vine|grass$|fern|flower|dandelion|poppy|tulip|orchid|allium|bluet|daisy|cornflower|lily|bush|sapling|(brown|red)_mushroom$|bamboo|snow_layer|sugar_cane|reeds|cactus|pumpkin|melon|bee_nest|azalea|carpet|web$|kelp|seagrass|petals|cocoa|leaf_litter|firefly|mangrove_roots|propagule/;
const WATER = /water$/;
const ROAD = [["minecraft:cobblestone", 2], ["minecraft:mossy_cobblestone", 1], ["minecraft:grass_path", 5], ["minecraft:grass_block", 4]];
const ROAD_TOTAL = ROAD.reduce((n, r) => n + r[1], 0);
const BLEND = 5; // how many blocks out from a building the ground is eased towards it
const MAX_STEP = 12; // taller differences than this are left as cliffs
const MARGIN = 24;

let rotationTable = null; // our quarter turns -> the game's StructureRotation, found by experiment
export const forgetRotations = () => { rotationTable = null; }; // for tests

class Terrain {
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

// Remove the tree or plants standing on a column.
function clearSoft(dim, x, z, t) {
  for (let y = t.raw; y > t.y; y--) {
    const b = dim.getBlock({ x, y, z });
    if (b && !b.isAir && SOFT.test(b.typeId)) b.setType("minecraft:air");
  }
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

const ticks = (n) => new Promise((done) => system.runTimeout(done, n));

// Keep the whole site loaded while it's planned and built.
async function loadArea(dim, center, reach) {
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
  const probes = [];
  for (let x = -r; x <= r; x += 16) for (let z = -r; z <= r; z += 16) probes.push({ x: center.x + x, y: 64, z: center.z + z });
  for (let tries = 0; tries < 120; tries++) {
    let missing = 0;
    for (const p of probes) {
      try { if (!dim.getBlock(p)) missing++; } catch { missing++; }
    }
    if (!missing) return names;
    await ticks(5);
  }
  unload(dim, names);
  throw new Error("the area didn't load in time");
}

function unload(dim, names) {
  for (const n of names) {
    try { dim.runCommand(`tickingarea remove ${n}`); } catch {}
  }
}

function buildRoad(dim, terrain, piece, rng, roadColumns) {
  const { tm } = PIECES[piece.name];
  const perms = tm.pal.map(([name, states]) => BlockPermutation.resolve(name, states));
  for (let i = 0; i < tm.b.length; i += 4) {
    const ly = tm.b[i + 1], name = tm.pal[tm.b[i + 3]][0];
    const q = rotPos([tm.b[i], 0, tm.b[i + 2]], piece.r);
    const x = piece.o[0] + q[0], z = piece.o[2] + q[2];
    const t = terrain.top(x, z);
    const y = t.y + ly;
    if (ly === 0 && name === "minecraft:cobblestone") {
      roadColumns.add(x + "," + z);
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

function buildRigid(dim, terrain, piece, rotations) {
  const def = PIECES[piece.name];
  const [x0, y0, z0, x1, , z1] = piece.box;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) clearSoft(dim, x, z, terrain.top(x, z));
  if (def.base) {
    const fill = FOUNDATION[def.fb] ?? def.fb;
    const [sx, , sz] = def.s;
    for (let lx = 0; lx < sx; lx++) for (let lz = 0; lz < sz; lz++) {
      if (def.base[lx * sz + lz] !== "1") continue;
      const q = rotPos([lx, 0, lz], piece.r);
      const x = piece.o[0] + q[0], z = piece.o[2] + q[2];
      const t = terrain.top(x, z);
      if (y0 - 1 - t.floor > MAX_STEP * 2) continue;
      for (let y = t.floor + 1; y < y0; y++) setType(dim, x, y, z, fill);
    }
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
    const door = PIECES[p.name].j.find((j) => j.f !== "up" && j.f !== "down");
    const level = p.o[1] + (door ? door.p[1] : 0) - 1; // the ground the building expects around it
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
    clearSoft(dim, x, z, t);
    const sandy = /sand/.test(t.type);
    if (want < t.y) {
      for (let y = t.y; y > want; y--) setType(dim, x, y, z, "minecraft:air");
    } else {
      const fill = sandy ? "minecraft:sandstone" : "minecraft:dirt";
      for (let y = t.y; y < want; y++) setType(dim, x, y, z, fill);
    }
    setType(dim, x, want, z, t.type);
    changed++;
  }
  return changed;
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
      const { pieces, spawns } = plan({ site, center, rng, firstFree: (x, z) => terrain.firstFree(x, z), data, spawnPools: SPAWN_POOLS });
      await ticks(1);
      const roads = pieces.filter((p) => p.tm), rigid = pieces.filter((p) => !p.tm);
      tell(`Building ${rigid.length} buildings and ${roads.length} stretches of road...`);
      const roadColumns = new Set();
      let failed = 0;
      for (const p of roads) {
        try { buildRoad(dim, terrain, p, rng, roadColumns); } catch (e) { failed++; console.warn(`[bs] road ${p.name}: ${e}`); }
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
      tell(`§aDone§r in ${((Date.now() - started) / 1000).toFixed(1)}s: ${rigid.length} buildings, ${roads.length} road pieces, ${moved} villagers and animals, ${eased} ground columns eased`
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
