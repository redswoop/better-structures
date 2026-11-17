// Automatic placement: sites appear on their own as players explore.
// The world is cut into square cells. Each cell may hold one site at a spot
// fixed by the world's own random key, so a world always has the same sites.
// A site is built the first time a player comes near it, and what gets built
// depends on the ground found there, because the script API can't ask for the
// biome: sand means desert ruins, red sand badlands ruins, grass a village.
//
// Off until someone turns it on for the world: it reshapes ground, so it must
// never run by surprise in a world with a base in it.
import { world, system } from "@minecraft/server";
import { buildSite, loadArea, unload, ticks, SITE_IDS } from "./site.js";
import { buildCluster, CLUSTERS } from "./ruins.js";
import { spawnVendors } from "./vendors.js";

export const CELL = 320; // blocks per cell: about one site every 300 to 400 blocks
const EDGE = 96; // a site keeps this far from its cell's edge
const NEAR = 150; // a site is built when a player gets this close
const CHANCE = 0.75; // share of cells that hold a site
const SOFT = /air$|leaves|_log$|grass$|fern|flower|dandelion|poppy|tulip|bush|snow_layer|cactus|deadbush|dead_bush/;
let busy = false;
let report = ""; // what the last automatic build said, for /scriptevent bs:locate
export const lastReport = () => report;

const flag = (k, v) => (v === undefined ? world.getDynamicProperty(k) : world.setDynamicProperty(k, v));
export const autoOn = () => flag("bs:auto") === true;
export const setAuto = (on) => flag("bs:auto", on);

function key() {
  let k = flag("bs:key");
  if (typeof k !== "number") { k = Math.floor(Math.random() * 2 ** 31); flag("bs:key", k); }
  return k;
}

function hash(a, b, c) {
  let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The site of a cell: {x, z, seed} or null if the cell is empty. Pure. */
export function siteOf(cx, cz, k) {
  if (hash(cx, cz, k) > CHANCE) return null;
  const span = CELL - 2 * EDGE;
  return {
    x: cx * CELL + EDGE + Math.floor(hash(cx, cz, k + 1) * span),
    z: cz * CELL + EDGE + Math.floor(hash(cx, cz, k + 2) * span),
    seed: Math.floor(hash(cx, cz, k + 3) * 2 ** 31),
  };
}

const done = () => { try { return JSON.parse(flag("bs:built") ?? "{}"); } catch { return {}; } };
const mark = (id, what) => { const d = done(); d[id] = what; flag("bs:built", JSON.stringify(d)); };

/**
 * What the ground around a spot calls for: "desert", "badlands", "village" or
 * null. Returns undefined if the area isn't loaded yet.
 */
export function classify(dim, x, z) {
  const count = {};
  let n = 0, wet = 0, lo = 999, hi = -999;
  for (let dx = -48; dx <= 48; dx += 12) for (let dz = -48; dz <= 48; dz += 12) {
    let b;
    try { b = dim.getTopmostBlock({ x: x + dx, z: z + dz }); } catch { return undefined; }
    if (!b) return undefined;
    while (b && SOFT.test(b.typeId)) b = b.below();
    if (!b) continue;
    n++;
    // In the game the topmost block under the sea is the sea BED, not the
    // water, so a sandy sea floor looks like desert unless we look above it.
    if (/water|ice$|kelp|seagrass/.test(b.typeId) || /water|kelp|seagrass/.test(b.above()?.typeId ?? "")) { wet++; continue; }
    lo = Math.min(lo, b.y); hi = Math.max(hi, b.y);
    for (const kind of Object.keys(CLUSTERS)) if (CLUSTERS[kind].ground.test(b.typeId)) count[kind] = (count[kind] ?? 0) + 1;
    if (b.typeId === "minecraft:grass_block") count.village = (count.village ?? 0) + 1;
  }
  if (!n) return null;
  for (const kind of Object.keys(CLUSTERS)) if ((count[kind] ?? 0) / n >= 0.75) return kind;
  // A village wants mostly grass, little water, and no cliffs.
  if ((count.village ?? 0) / n >= 0.7 && wet / n <= 0.15 && hi - lo <= 24) return "village";
  return null;
}

async function build(dim, id, site, tell) {
  busy = true;
  try {
    // The site is usually further away than the game keeps loaded around a
    // player, so load it before looking at the ground.
    let what;
    const areas = await loadArea(dim, site, 40);
    try { what = classify(dim, site.x, site.z); } finally { unload(dim, areas); }
    await ticks(2); // let the game drop those areas before the build asks for its own
    if (what === undefined) return; // still not readable: try again later
    mark(id, what ?? "none");
    if (!what) return;
    if (what === "village") {
      const size = ["small", "medium", "medium", "large"][site.seed % 4];
      const siteId = SITE_IDS.find((s) => s.includes(`${size}/village`));
      const built = siteId && await buildSite(dim, siteId, site, site.seed, tell);
      if (built?.pieces?.length) spawnVendors(dim, built.pieces[0].box);
    } else {
      await buildCluster(dim, what, site, site.seed, tell);
    }
  } finally {
    busy = false;
  }
}

/**
 * Find the nearest site nobody has reached that would be one of `kinds`, by
 * loading and reading the ground at each candidate. Doesn't build it: that
 * happens when a player gets there. Returns {site, what}, {} or {busy: true}.
 */
export async function scout(dim, from, kinds) {
  if (busy) return { busy: true };
  busy = true;
  try {
    for (const s of sitesNear(from.x, from.z, 2).filter((c) => c.built === undefined).slice(0, 8)) {
      let what;
      const areas = await loadArea(dim, s, 40);
      try { what = classify(dim, s.x, s.z); } finally { unload(dim, areas); }
      await ticks(2);
      if (what === undefined) continue;
      if (!what) { mark(s.id, "none"); continue; }
      if (kinds.includes(what)) return { site: s, what };
    }
    return {};
  } finally {
    busy = false;
  }
}

/** Sites of the cells around a spot, nearest first: [{id, x, z, seed, built}]. */
export function sitesNear(x, z, reach = 2) {
  const k = key(), d = done(), out = [];
  const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
  for (let cx = cx0 - reach; cx <= cx0 + reach; cx++) for (let cz = cz0 - reach; cz <= cz0 + reach; cz++) {
    const s = siteOf(cx, cz, k);
    if (s) out.push({ id: `${cx},${cz}`, ...s, built: d[`${cx},${cz}`] });
  }
  return out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
}

system.runInterval(() => {
  if (busy || !autoOn()) return;
  for (const player of world.getPlayers()) {
    const dim = player.dimension;
    if (dim.id !== "minecraft:overworld") continue;
    const p = player.location;
    const next = sitesNear(p.x, p.z, 1).find((s) => s.built === undefined && Math.hypot(s.x - p.x, s.z - p.z) <= NEAR);
    if (next) {
      void build(dim, next.id, next, (text) => {
        report = `site ${next.x} ${next.z}: ${text.replace(/§./g, "")}`;
        console.warn(`[bs auto] ${report}`);
      }).catch((e) => { report = `site ${next.x} ${next.z}: failed, ${e}`; });
      return;
    }
  }
}, 40);
