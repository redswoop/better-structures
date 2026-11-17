// Ruin clusters and automatic placement in the fake world. Logic only.
import { fake, reset, log, typeAt, system, dimension } from "@minecraft/server";
import { planCluster, buildCluster, CLUSTERS, CLUSTER_REACH } from "../behavior_pack/scripts/ruins.js";
import { classify, siteOf, sitesNear, setAuto, CELL } from "../behavior_pack/scripts/auto.js";
import { mulberry32 } from "../behavior_pack/scripts/jigsaw.js";
import { CATALOG } from "../behavior_pack/scripts/catalog.js";

let bad = 0;
const fail = (...a) => { bad++; if (bad < 12) console.log("FAIL", ...a); };
const dunes = (x, z) => 70 + Math.round(4 * Math.sin(x / 9) + 3 * Math.cos(z / 11));
const land = (surface, ground = dunes, pond = () => false) => { reset(); fake.surface = () => surface; fake.ground = ground; fake.pond = pond; fake.tree = () => false; };

// Every listed piece exists.
for (const [kind, def] of Object.entries(CLUSTERS)) for (const [name] of [...def.main, ...def.minor]) if (!CATALOG[name]) fail("missing piece", kind, name);

// Layouts: a main ruin plus two to four small ones, apart from each other and within reach.
for (const kind of Object.keys(CLUSTERS)) {
  const sizes = [];
  for (let seed = 1; seed <= 60; seed++) {
    const ps = planCluster(kind, { x: 100, z: -40 }, mulberry32(seed));
    sizes.push(ps.length);
    if (!ps[0]?.main || ps.length < 2) fail("thin cluster", kind, seed, ps.length);
    for (const [i, a] of ps.entries()) {
      if (Math.max(Math.abs(a.x0 - 100), Math.abs(a.x0 + a.w - 100), Math.abs(a.z0 + 40), Math.abs(a.z0 + a.d + 40)) > CLUSTER_REACH + 16) fail("out of reach", kind, seed, a.name);
      for (const b of ps.slice(i + 1)) if (a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.z0 < b.z0 + b.d && b.z0 < a.z0 + a.d) fail("overlap", kind, seed, a.name, b.name);
    }
  }
  console.log(`${kind}: ${Math.min(...sizes)} to ${Math.max(...sizes)} ruins per cluster`);
}

// Building on dunes: each ruin sits in the sand, never on air.
land("minecraft:sand");
const said = [];
const job = buildCluster(dimension, "desert", { x: 0, z: 0 }, 5, (t) => said.push(t));
await system.flush();
const pieces = await job;
if (!pieces) fail("cluster didn't build", said.join(" | "));
for (const p of pieces ?? []) {
  let under = 0, above = 0;
  for (let x = p.x0; x < p.x0 + p.w; x++) for (let z = p.z0; z < p.z0 + p.d; z++) {
    if (/air/.test(typeAt(x, p.y - 1, z))) under++;
    if (dunes(x, z) >= p.y) above++;
  }
  if (under) fail("floating", p.name, under);
  if (above < p.w * p.d * 0.5) fail("not set into the dune", p.name, above, p.w * p.d);
}
console.log(said.at(-1)?.replace(/§./g, ""));

// Reading the ground.
const want = (label, got, expected) => { if (got !== expected) fail("classify", label, got, "expected", expected); };
land("minecraft:sand"); want("sand", classify(dimension, 0, 0), "desert");
land("minecraft:red_sand"); want("red sand", classify(dimension, 0, 0), "badlands");
land("minecraft:grass_block"); want("grass", classify(dimension, 0, 0), "village");
land("minecraft:grass_block", dunes, (x, z) => x > -10); want("half lake", classify(dimension, 0, 0), null);
land("minecraft:grass_block", (x) => 70 + Math.round(x * 0.9)); want("mountainside", classify(dimension, 0, 0), null);
land("minecraft:stone"); want("stone", classify(dimension, 0, 0), null);
// A sandy sea floor is not a desert (seen in the game: a ruin built in the ocean).
reset(); fake.surface = () => "minecraft:sand"; fake.ground = () => 60; fake.pond = () => true; fake.tree = () => false;
want("sandy sea floor", classify(dimension, 0, 0), null);

// Sites are fixed per world key, spread out, and about three cells in four have one.
let filled = 0;
for (let cx = -10; cx < 10; cx++) for (let cz = -10; cz < 10; cz++) {
  const s = siteOf(cx, cz, 1234);
  if (!s) continue;
  filled++;
  const again = siteOf(cx, cz, 1234);
  if (again.x !== s.x || again.z !== s.z || again.seed !== s.seed) fail("site not stable", cx, cz);
  if (s.x < cx * CELL + 90 || s.x > (cx + 1) * CELL - 90 || s.z < cz * CELL + 90 || s.z > (cz + 1) * CELL - 90) fail("site too near its cell edge", cx, cz, s);
}
if (filled < 260 || filled > 340) fail("share of cells with a site", filled, "of 400");

// Automatic placement: nothing while off; one build when a player walks up; never twice.
land("minecraft:sand");
const near = sitesNear(0, 0, 2)[0];
const player = { dimension, location: { x: near.x + 20, y: 80, z: near.z - 30 } };
fake.players = [player];
system.interval(); await system.flush();
if (log.some((l) => l[0] === "place")) fail("built while automatic placement was off");
setAuto(true);
system.interval(); await system.flush();
const first = log.filter((l) => l[0] === "place").length;
if (first < 2) fail("automatic placement didn't build", first);
if (sitesNear(0, 0, 2).find((s) => s.id === near.id).built !== "desert") fail("site not recorded", sitesNear(0, 0, 2)[0]);
system.interval(); await system.flush();
if (log.filter((l) => l[0] === "place").length !== first) fail("built the same site twice");
console.log(`automatic placement: ${filled} of 400 cells hold a site; a desert site built ${first} ruins when a player came near, once`);
console.log(bad ? `${bad} PROBLEMS` : "cluster and automatic placement checks passed");
process.exit(bad ? 1 : 0);
