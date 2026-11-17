// Places single structures and a showcase batch on a forested hillside in the
// fake world and checks the ground was prepared. Logic only, not looks.
import { fake, reset, log, typeAt, system, subs, dimension } from "@minecraft/server";
import { picks } from "@minecraft/server-ui";
import { CATALOG } from "../behavior_pack/scripts/catalog.js";
await import("../behavior_pack/scripts/main.js");

fake.ground = (x, z) => 70 + Math.round(10 * Math.sin(x / 12) + 8 * Math.cos(z / 15));
fake.pond = () => false;
fake.tree = (x, z) => (x * 7 + z * 13) % 11 === 0; // dense forest
let bad = 0;
const fail = (...a) => { bad++; if (bad < 12) console.log("FAIL", ...a); };
const msgs = [];
const player = { id: "-7", typeId: "minecraft:player", isSneaking: false, location: { x: 0.5, y: 80, z: 0.5 }, dimension,
  getViewDirection: () => ({ x: 0, y: 0, z: 1 }), sendMessage: (m) => msgs.push(m), hasTag: () => true, addTag() {},
  getComponent: () => ({ container: { size: 0, getItem() {}, addItem() {} } }) };

function check(name, at) {
  const [sx, sy, sz] = CATALOG[name];
  let under = 0;
  for (let x = at.x - 2; x < at.x + sx + 2; x++) for (let z = at.z - 2; z < at.z + sz + 2; z++) {
    const inside = x >= at.x && x < at.x + sx && z >= at.z && z < at.z + sz;
    for (let y = at.y - 3; y < at.y + sy + 30; y++) {
      const t = typeAt(x, y, z);
      if (/log|leaves/.test(t)) fail("tree at", name, x, y, z);
      if (inside && y >= at.y + sy && t !== "minecraft:air") fail("ground over", name, x, y, z, t);
    }
    if (inside && /air|short_grass/.test(typeAt(x, at.y - 1, z))) under++;
  }
  if (under) fail("floating", name, under, "columns with nothing underneath");
}

reset();
subs.script({ id: "bs:place", message: "ruins__the_ruin_temple", sourceEntity: player });
player.location = { x: 300.5, y: 80, z: 300.5 }; // well clear of the temple
subs.script({ id: "bs:showcase", message: "plains", sourceEntity: player });
await system.flush();
if (process.argv[2]) console.log(msgs.join("\n"));
const placed = log.filter((l) => l[0] === "place");
for (const [, id, at] of placed) check(id.slice(3), at);
const levels = new Set(placed.map((l) => l[2].y));
// One temple plus one showcase batch (a batch is what fits in the loaded area).
if (placed.length < 15 || msgs.some((m) => m.includes("failed"))) fail("placed", placed.length, msgs.at(-1));
if (levels.size < 4) fail("structures weren't set at their own ground heights", [...levels]);
console.log(`${placed.length} structures placed on a forested hillside at ${levels.size} different heights`);
console.log(bad ? `${bad} PROBLEMS` : "placement checks passed");
process.exit(bad ? 1 : 0);
