// Plans villages on fake terrain and checks the layout. Proves the planning
// logic only: how a village looks needs the real game.
//   node test/plan.mjs [seed]   prints a map of one village
import { plan, mulberry32 } from "../behavior_pack/scripts/jigsaw.js";
import * as data from "../behavior_pack/scripts/data.js";

const hills = (x, z) => 70 + Math.round(6 * Math.sin(x / 25) + 5 * Math.cos(z / 30));
const SPAWN = new Set(["minecraft:village/plains/villagers", "minecraft:village/common/iron_golem", "minecraft:village/common/cats", "ctov:village/common/animals", "ctov:village/common/bees"]);

function make(siteId, seed, firstFree = hills) {
  return plan({ site: data.SITES[siteId], center: { x: 0, z: 0 }, rng: mulberry32(seed), firstFree, data, spawnPools: SPAWN });
}

let bad = 0;
for (const siteId of Object.keys(data.SITES)) {
  const counts = [], houses = [], beds = [];
  for (let seed = 1; seed <= 40; seed++) {
    const { pieces, spawns } = make(siteId, seed);
    const outer = pieces.filter((p) => !p.interior);
    // No two buildings may share a block, nested in a road bend or not.
    const solid = pieces.filter((p) => !p.tm);
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i].box, b = solid[j].box;
      if (a[0] <= b[3] && a[3] >= b[0] && a[2] <= b[5] && a[5] >= b[2] && a[1] <= b[4] && a[4] >= b[1]) { bad++; if (bad < 10) console.log("BUILDINGS OVERLAP", siteId, seed, solid[i].name, solid[j].name); }
    }
    for (let i = 0; i < outer.length; i++) for (let j = i + 1; j < outer.length; j++) {
      const a = outer[i].box, b = outer[j].box;
      if (a[0] <= b[3] && a[3] >= b[0] && a[2] <= b[5] && a[5] >= b[2] && a[1] <= b[4] && a[4] >= b[1]) { bad++; console.log("OVERLAP", siteId, seed, outer[i].name, outer[j].name); }
    }
    for (const p of outer) if (Math.max(Math.abs(p.box[0]), Math.abs(p.box[3]), Math.abs(p.box[2]), Math.abs(p.box[5])) > data.SITES[siteId].reach) { bad++; console.log("OUT OF REACH", p.name); }
    // A rigid piece next to a road should sit at the ground by its door.
    for (const p of outer) if (!p.tm && p.depth > 0 && /house|jobsite/.test(p.name)) {
      const g = hills(Math.round((p.box[0] + p.box[3]) / 2), Math.round((p.box[2] + p.box[5]) / 2));
      if (Math.abs(p.o[1] - g) > 8) { bad++; console.log("FLOATING", siteId, seed, p.name, p.o[1], g); }
    }
    counts.push(pieces.length);
    houses.push(pieces.filter((p) => /__(house|jobsite)__/.test(p.name)).length);
    beds.push(spawns.filter((s) => s.pool.endsWith("villagers")).length);
  }
  const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  console.log(`${siteId}: pieces ${avg(counts)} (min ${Math.min(...counts)}, max ${Math.max(...counts)}), buildings ${avg(houses)}, villagers ${avg(beds)}`);
}

const seed = Number(process.argv[2] ?? 7);
const { pieces } = make("plains:large/village_plains", seed);
const R = 100, rows = [];
for (let z = -R; z <= R; z += 2) {
  let row = "";
  for (let x = -R; x <= R; x++) {
    const p = pieces.find((p) => !p.interior && x >= p.box[0] && x <= p.box[3] && z >= p.box[2] && z <= p.box[5]);
    row += !p ? " " : p.tm ? "." : p.depth === 0 ? "#" : /decos?__/.test(p.name) ? "*" : p.name.split("__")[1][0].toUpperCase();
  }
  rows.push(row.trimEnd());
}
console.log(rows.filter((r, i) => rows.slice(0, i + 1).some((x) => x) && rows.slice(i).some((x) => x)).join("\n"));
console.log(bad ? `${bad} PROBLEMS` : "layout checks passed");
process.exit(bad ? 1 : 0);
