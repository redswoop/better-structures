// Vendor trades against a fake inventory. Logic only.
import { subs, log, reset, dimension, system } from "@minecraft/server";
import { picks } from "@minecraft/server-ui";
import { SMITH, MAPS, counts, missing, take, smithTrade, bearing, spawnVendors, hooks, interactEvent } from "../behavior_pack/scripts/vendors.js";

let bad = 0;
const fail = (...a) => { bad++; console.log("FAIL", ...a); };
function pack(items) {
  const slots = Object.entries(items).flatMap(([id, n]) => { const out = []; while (n > 0) { out.push({ typeId: "minecraft:" + id, amount: Math.min(n, 64) }); n -= 64; } return out; });
  while (slots.length < 36) slots.push(undefined);
  return { size: 36, getItem: (i) => slots[i] && { ...slots[i] }, setItem: (i, it) => { slots[i] = it; },
    addItem(it) { const i = slots.indexOf(undefined); if (i < 0) return it; slots[i] = { typeId: it.typeId, amount: it.amount }; } };
}
const msgs = [];
const playerWith = (items) => { const c = pack(items); return { container: c, dimension, location: { x: 0, y: 70, z: 0 }, sendMessage: (m) => msgs.push(m.replace(/§./g, "")), getComponent: () => ({ container: c }) }; };

// Every offer names real-looking items and a cost.
for (const o of SMITH) if (!o.give?.[0] || !Object.keys(o.cost).length) fail("bad offer", o);

// Too poor: nothing changes.
let p = playerWith({ rotten_flesh: 10 });
let said = smithTrade(p, SMITH[0]);
if (!/14 more Rotten Flesh/.test(said) || counts(p.container).rotten_flesh !== 10 || counts(p.container).iron_sword) fail("poor trade", said, counts(p.container));

// Exactly enough, across stacks: cost leaves, item arrives.
p = playerWith({ rotten_flesh: 70, bone: 30 });
said = smithTrade(p, SMITH.find((o) => o.give[0] === "iron_chestplate"));
let have = counts(p.container);
if (have.rotten_flesh !== 38 || have.bone !== 14 || have.iron_chestplate !== 1) fail("chestplate trade", said, have);

// An upgrade consumes the old tool.
p = playerWith({ iron_sword: 1, diamond: 5 });
smithTrade(p, SMITH.find((o) => o.give[0] === "diamond_sword"));
have = counts(p.container);
if (have.iron_sword || have.diamond !== 2 || have.diamond_sword !== 1) fail("upgrade", have);

// The bow comes with arrows.
p = playerWith({ string: 12 });
smithTrade(p, SMITH.find((o) => o.give[0] === "bow"));
have = counts(p.container);
if (have.bow !== 1 || have.arrow !== 24 || have.string) fail("bow", have);

// Directions.
const want = (a, b) => { if (a !== b) fail("bearing", a, b); };
want(bearing({ x: 0, z: 0 }, { x: 0, z: -100 }), "north"); want(bearing({ x: 0, z: 0 }, { x: 100, z: 0 }), "east");
want(bearing({ x: 0, z: 0 }, { x: -70, z: 70 }), "south-west"); want(bearing({ x: 0, z: 0 }, { x: 5, z: 100 }), "south");

// Spawning puts two tagged vendors at the corners; touching one opens its shop.
reset();
const made = spawnVendors(dimension, [0, 70, 0, 16, 80, 16]);
const spawned = log.filter((l) => l[0] === "spawn").map((l) => l[3]);
if (made.length !== 2 || !spawned[0].hasTag("bs_smith") || !spawned[1].hasTag("bs_cartographer") || !spawned.every((e) => e.hasTag("bs_vendor"))) fail("spawn", made);
if (interactEvent !== "before") fail("interact event", interactEvent);
p = playerWith({ bone: 30 });
const ev = { target: spawned[0], player: p, cancel: false };
picks.push(1); // the iron pickaxe
subs.touch(ev); await system.flush();
if (!ev.cancel || counts(p.container).iron_pickaxe !== 1) fail("touch smith", ev.cancel, counts(p.container), msgs.at(-1));

// Cartographer: off -> explains, keeps goods; on -> charges only when something is found.
p = playerWith({ bone: 12 });
picks.push(0); subs.touch({ target: spawned[1], player: p }); await system.flush();
if (!/automatic structures are off/.test(msgs.at(-1)) || counts(p.container).bone !== 12) fail("cartographer off", msgs.at(-1));
hooks.autoOn = () => true; hooks.scout = async () => ({});
picks.push(0); subs.touch({ target: spawned[1], player: p }); await system.flush();
if (!/Nothing unexplored/.test(msgs.at(-1)) || counts(p.container).bone !== 12) fail("cartographer nothing", msgs.at(-1));
hooks.scout = async (d, from, kinds) => ({ site: { x: 300, z: -400 }, what: kinds[0] });
picks.push(0); subs.touch({ target: spawned[1], player: p }); await system.flush();
if (!/desert ruin about 500 blocks to the north-east/.test(msgs.at(-1)) || counts(p.container).bone) fail("cartographer found", msgs.at(-1), counts(p.container));
console.log(msgs.at(-1));
console.log(bad ? `${bad} PROBLEMS` : "vendor checks passed");
process.exit(bad ? 1 : 0);
