// Ruin clusters: a main ruin with a few small ones scattered around it, like
// the remains of a settlement. The Java mod has no placement rules for these
// pieces, so the rules here are ours.
import { world, StructureRotation } from "@minecraft/server";
import { CATALOG } from "./catalog.js";
import { mulberry32 } from "./jigsaw.js";
import { prepareSpot, loadArea, unload, ticks } from "./site.js";

const R = "ruins__", M = "ruins__mod_structures__";
// [name, weight]. `ground` is what the surface must be for the cluster to belong.
export const CLUSTERS = {
  desert: {
    ground: /^minecraft:(sand|sandstone)$/,
    main: [[R + "desert_pyramid", 2], [R + "desert_ruin1", 3], [M + "desert_ruin7", 3], [M + "desert_ruin4", 3], [R + "desert_ruin3", 3], [M + "desert_ruin6", 2]],
    minor: [[R + "desert_ruin2", 3], [M + "desert_ruin5", 3], [M + "desert_ruin8", 3], [M + "desert_ruin9", 2], [R + "lost_desert_ruin1", 3]],
  },
  badlands: {
    ground: /^minecraft:(red_sand|red_sandstone|.*terracotta|hardened_clay)$/,
    main: [[R + "the_ruin_temple", 3], [R + "ancient_pyramid1", 2], [R + "ancient_pyramid2", 2]],
    minor: [[R + "badlands_ruin1", 3], [R + "badlands_ruin2", 3]],
  },
};
export const CLUSTER_REACH = 48; // nothing in a cluster is further than this from its centre
const ROTATIONS = [StructureRotation.None, StructureRotation.Rotate90, StructureRotation.Rotate180, StructureRotation.Rotate270];
const SPACE = 5; // clear ground between two ruins

function pick(list, rng) {
  const have = list.filter(([n]) => CATALOG[n]);
  let roll = rng() * have.reduce((n, e) => n + e[1], 0);
  return have.find((e) => (roll -= e[1]) < 0)?.[0];
}

/**
 * Lay out a cluster. Pure: no game calls except through `usable`.
 * @param usable (x0, z0, w, d) => false to refuse a spot (water, wrong ground)
 * @returns [{name, turns, x0, z0, w, d, main}]
 */
export function planCluster(kind, center, rng, usable = () => true) {
  const def = CLUSTERS[kind];
  const out = [];
  const rect = (name, cx, cz, turns) => {
    const [sx, , sz] = CATALOG[name];
    const [w, d] = turns % 2 ? [sz, sx] : [sx, sz];
    return { name, turns, x0: Math.round(cx - w / 2), z0: Math.round(cz - d / 2), w, d };
  };
  const clash = (a) => out.some((b) => a.x0 < b.x0 + b.w + SPACE && b.x0 < a.x0 + a.w + SPACE && a.z0 < b.z0 + b.d + SPACE && b.z0 < a.z0 + a.d + SPACE);
  const mainName = pick(def.main, rng);
  if (!mainName) return out;
  const main = { ...rect(mainName, center.x, center.z, Math.floor(rng() * 4)), main: true };
  if (!usable(main.x0, main.z0, main.w, main.d)) return out;
  out.push(main);
  const want = 2 + Math.floor(rng() * 3);
  const inner = Math.max(main.w, main.d) / 2 + 8;
  for (let n = 0, tries = 0; n < want && tries < 40; tries++) {
    const name = pick(def.minor, rng);
    if (!name) break;
    const angle = rng() * Math.PI * 2, far = inner + rng() * (CLUSTER_REACH - inner - 10);
    const r = rect(name, center.x + Math.cos(angle) * far, center.z + Math.sin(angle) * far, Math.floor(rng() * 4));
    if (clash(r) || !usable(r.x0, r.z0, r.w, r.d)) continue;
    out.push(r);
    n++;
  }
  return out;
}

/** Build a cluster centred on a spot. Returns the pieces placed, or undefined. */
export async function buildCluster(dim, kind, center, seed, tell = () => {}) {
  const def = CLUSTERS[kind];
  if (!def) return tell(`§cNo cluster kind ${kind}. Kinds: ${Object.keys(CLUSTERS).join(", ")}`);
  center = { x: Math.floor(center.x), z: Math.floor(center.z) };
  let areas = [];
  try {
    areas = await loadArea(dim, center, CLUSTER_REACH);
    // A ruin needs dry land: more than a quarter water under it and it's skipped.
    const usable = (x0, z0, w, d) => {
      let wet = 0, n = 0;
      for (let x = x0; x < x0 + w; x += 3) for (let z = z0; z < z0 + d; z += 3) {
        n++;
        const b = dim.getTopmostBlock({ x, z });
        // The topmost block under water is the bed, so check what's above it too.
        if (!b || /water|ice$|kelp|seagrass/.test(b.typeId) || /water|kelp|seagrass/.test(b.above()?.typeId ?? "")) wet++;
      }
      return wet / n <= 0.25;
    };
    const pieces = planCluster(kind, center, mulberry32(seed), usable);
    if (!pieces.length) return tell("§cNo room for a ruin here (too much water?).");
    for (const p of pieces) {
      // Set at the level of its lower side, so on a slope it is dug into the
      // rise behind it. No extra sinking: on flat ground that left a ring.
      const y = prepareSpot(dim, p.x0, p.z0, p.w, p.d, { low: true });
      world.structureManager.place(`bs:${p.name}`, dim, { x: p.x0, y, z: p.z0 }, { rotation: ROTATIONS[p.turns] });
      p.y = y;
      await ticks(2);
    }
    tell(`§aDone§r: a ${kind} ruin cluster of ${pieces.length} (${pieces.map((p) => p.name.replace(/^ruins__(mod_structures__)?/, "")).join(", ")}).`);
    return pieces;
  } catch (e) {
    tell(`§cCluster stopped: ${e}`);
  } finally {
    unload(dim, areas);
  }
}
