// Builds villages in the fake world and checks what ended up in it. Proves the
// building logic only: block looks and real terrain need the game.
import { fake, reset, log, typeAt, system, dimension, StructureRotation } from "@minecraft/server";
import { buildSite, forgetRotations } from "../behavior_pack/scripts/site.js";
import { PIECES } from "../behavior_pack/scripts/data.js";
import { rotPos } from "../behavior_pack/scripts/jigsaw.js";

const ROADS = new Set(["minecraft:cobblestone", "minecraft:mossy_cobblestone", "minecraft:grass_path", "minecraft:grass_block", "minecraft:oak_planks"]);
const gentle = fake.ground;
// A small steep hill at the centre and a ridge to one side: the cases that floated.
const hilly = (x, z) => 70 + Math.round(12 * Math.exp(-(x * x + z * z) / 400) + 9 * Math.sin(x / 14) * Math.cos(z / 17)) + (x > 45 ? 8 : 0);
let bad = 0;
const fail = (...a) => { bad++; if (bad < 15) console.log("FAIL", ...a); };

async function run(siteId, seed, clockwise, ground) {
  reset();
  fake.ground = ground ?? gentle;
  forgetRotations();
  fake.clockwise = clockwise;
  const said = [];
  const job = buildSite(dimension, siteId, { x: 0.5, z: 0.5 }, seed, (t) => said.push(t));
  await system.flush();
  const out = await job;
  if (!out) return fail(siteId, seed, said.join(" | "));
  const { pieces, spawns } = out;
  const placed = log.filter((l) => l[0] === "place");
  const rigid = pieces.filter((p) => !p.tm);
  if (placed.length !== rigid.length || out.failed) fail("placed", placed.length, "of", rigid.length, "failed", out.failed);
  for (const p of rigid) {
    const want = clockwise ? p.r : (4 - p.r) % 4;
    const hit = placed.find((l) => l[1] === "bs:" + p.name && l[2].x === p.box[0] && l[2].y === p.box[1] && l[2].z === p.box[2]);
    if (!hit) fail("not placed at its box corner", p.name);
    else if (hit[3] !== Object.values(StructureRotation)[want]) fail("rotation", p.name, hit[3], want);
    // Nothing under a building's solid base should be air or water.
    const def = PIECES[p.name], [sx, , sz] = def.s;
    if (def.base) for (let lx = 0; lx < sx; lx++) for (let lz = 0; lz < sz; lz++) {
      if (def.base[lx * sz + lz] !== "1") continue;
      const q = rotPos([lx, 0, lz], p.r), x = p.o[0] + q[0], z = p.o[2] + q[2];
      const under = typeAt(x, p.box[1] - 1, z);
      if (/air|water|short_grass|leaves/.test(under)) fail("floating", p.name, x, p.box[1] - 1, z, under);
    }
    // Buildings stay on land; only roads cross the pond.
    let wetCols = 0, cols = 0;
    for (let x = p.box[0]; x <= p.box[3]; x++) for (let z = p.box[2]; z <= p.box[5]; z++) { cols++; if (fake.pond(x, z)) wetCols++; }
    if (p.depth > 0 && wetCols / cols > 0.45) fail("built over water", p.name, Math.round(100 * wetCols / cols) + "%");
    // Bulldozed: nothing natural left above the building, and no tree near it.
    for (let x = p.box[0] - 2; x <= p.box[3] + 2; x++) for (let z = p.box[2] - 2; z <= p.box[5] + 2; z++) {
      const inside = x >= p.box[0] && x <= p.box[3] && z >= p.box[2] && z <= p.box[5];
      for (let y = p.box[1] - 2; y < p.box[4] + 30; y++) {
        const t = typeAt(x, y, z);
        if (/log|leaves/.test(t)) fail("tree at", p.name, x, y, z);
        if (inside && y > p.box[4] && t !== "minecraft:air" && !t.startsWith("placed:")) fail("ground left over", p.name, x, y, z, t);
      }
    }
  }
  // Roads lie on top of the (reshaped) ground and bridge the pond with planks.
  const top = (x, z) => { for (let y = 200; y > 0; y--) if (typeAt(x, y, z) !== "minecraft:air") return y; };
  let roadCols = 0, planks = 0, steepest = 0;
  const paved = new Map();
  for (const p of pieces.filter((p) => p.tm)) {
    const tm = PIECES[p.name].tm;
    for (let i = 0; i < tm.b.length; i += 4) {
      if (tm.b[i + 1] !== 0 || tm.pal[tm.b[i + 3]][0] !== "minecraft:cobblestone") continue;
      const q = rotPos([tm.b[i], 0, tm.b[i + 2]], p.r), x = p.o[0] + q[0], z = p.o[2] + q[2];
      const y = top(x, z), t = typeAt(x, y, z);
      roadCols++;
      if (t === "minecraft:oak_planks") planks++;
      if (!ROADS.has(t) && !t.startsWith("placed:")) fail("road missing", p.name, x, y, z, t);
      if (fake.pond(x, z) && t !== "minecraft:oak_planks" && !t.startsWith("placed:")) fail("no bridge", x, z, t);
      if (ROADS.has(t)) paved.set(x + "," + z, y);
    }
  }
  for (const [k, y] of paved) {
    const [x, z] = k.split(",").map(Number);
    for (const n of [(x + 1) + "," + z, x + "," + (z + 1)]) if (paved.has(n)) steepest = Math.max(steepest, Math.abs(paved.get(n) - y));
  }
  if (steepest > 2) fail("road steps", steepest, "blocks between neighbouring columns");
  const areas = log.filter((l) => l[0] === "command" && l[1].startsWith("tickingarea add")).length;
  const removed = log.filter((l) => l[0] === "command" && l[1].startsWith("tickingarea remove")).length;
  if (areas !== 4 || removed < 8) fail("ticking areas", areas, removed);
  const mobs = log.filter((l) => l[0] === "spawn").length;
  if (mobs !== spawns.length || !mobs) fail("spawns", mobs, spawns.length);
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (/gold|iron_block|diamond/.test(typeAt(dx, 312, dz))) fail("calibration markers left behind");
  return `${siteId} seed ${seed}${clockwise ? "" : " (game rotates the other way)"}: ${rigid.length} buildings, ${roadCols} road blocks (${planks} planks), ${mobs} mobs, steepest road step ${steepest}. ${said.at(-1).replace(/§./g, "")}`;
}

for (const [site, seed, cw, ground] of [["plains:small/village_plains", 1, true], ["plains:medium/village_plains", 2, true], ["plains:large/village_plains", 7, true],
  ["plains:large/village_plains", 3, false], ["plains:medium/village_plains", 4, true, hilly], ["plains:large/village_plains", 5, true, hilly]]) {
  console.log((ground ? "HILLY " : "") + await run(site, seed, cw, ground));
}
console.log(bad ? `${bad} PROBLEMS` : "build checks passed");
process.exit(bad ? 1 : 0);
