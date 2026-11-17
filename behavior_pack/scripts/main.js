// Better Structures: debug tools for looking at converted structures in game.
// The Structure Wand (given on first join) opens the menu when used; sneak and
// use it to place the last structure again.
//   /scriptevent bs:kit                   get the Structure Wand again
//   /scriptevent bs:menu                  pick a structure from a list
//   /scriptevent bs:showcase <set>        lay out a batch of a set side by side
//   /scriptevent bs:village [small|medium|large] [seed]   build a whole village around you
//   /scriptevent bs:site <site id> [seed]                 build any jigsaw site around you
//   /scriptevent bs:cluster <desert|badlands> [seed]      build a ruin cluster around you
//   /scriptevent bs:auto [on|off]                         automatic sites as you explore (off by default)
//   /scriptevent bs:locate                                where the nearest automatic sites are
//   /scriptevent bs:vendors                               put a smith and a cartographer beside you
//   /scriptevent bs:place <name> [0-3]    place one in front of you, turned 0-3 quarter turns
//   /scriptevent bs:find <text>           list structure names containing <text>
//   /scriptevent bs:undo                  put back what the last placement covered
import { world, system, ItemStack, StructureRotation, StructureSaveMode } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { CATALOG } from "./catalog.js";
import { buildSite, prepareSpot, SITE_IDS } from "./site.js";
import { buildCluster, CLUSTERS } from "./ruins.js";
import { autoOn, setAuto, sitesNear, lastReport, scout } from "./auto.js";
import { hooks, spawnVendors } from "./vendors.js";

hooks.scout = scout;
hooks.autoOn = autoOn;

export const VERSION = "0.5.0";
const PAGE = 40;
const ROTATIONS = [StructureRotation.None, StructureRotation.Rotate90, StructureRotation.Rotate180, StructureRotation.Rotate270];
const NAMES = Object.keys(CATALOG);
// Hand-picked sets that cut across the converted groups.
const SETS = {
  desert: /__(mod_structures__)?(desert_|lost_desert|sand_house)/, // yellow sand
  badlands: /__(ancient_pyramid|the_ruin_temple|badlands_)/, // red sand
};
const GROUPS = [...Object.keys(SETS), ...new Set(NAMES.map((n) => n.split("__")[0]))];
const WAND = "bs:wand";
const SHOW_SPAN = 112; // a showcase batch stays within this many blocks, so its chunks are loaded
const GAP = 14; // room between showcased structures for the ground to ease back
const EDGE = 6; // how far past a structure its ground work reaches
const undo = new Map(); // player id -> { id, dimension, at }
const last = new Map(); // player id -> last structure placed from the menu
const showcased = new Map(); // "player id:group" -> how many of the set earlier showcases covered
const usedAt = new Map(); // player id -> tick the wand last fired, so one tap opens one menu

const say = (player, text) => player.sendMessage(`§6[Structures]§r ${text}`);
const label = (name) => name.split("__").slice(1).join("/");
const dims = (name) => CATALOG[name].join("x");

// The corner to place at so the structure sits just ahead of the player,
// centred on where they're looking. The height comes from the ground later.
function spotAhead(player, name, turns) {
  const [sx, sy, sz] = CATALOG[name];
  const [w, d] = turns % 2 ? [sz, sx] : [sx, sz];
  const v = player.getViewDirection();
  const p = player.location;
  const x = Math.floor(p.x), y = Math.floor(p.y) - 1, z = Math.floor(p.z);
  if (Math.abs(v.x) > Math.abs(v.z)) {
    return { at: { x: v.x > 0 ? x + 3 : x - 2 - w, y, z: z - (d >> 1) }, w, d, sy };
  }
  return { at: { x: x - (w >> 1), y, z: v.z > 0 ? z + 3 : z - 2 - d }, w, d, sy };
}

function place(player, name, turns = 0) {
  if (!CATALOG[name]) return say(player, `No structure called ${name}. Try /scriptevent bs:find <text>`);
  const { at, w, d, sy } = spotAhead(player, name, turns);
  const dim = player.dimension;
  const feet = at.y;
  const id = `bsundo:${player.id.replace(/[^a-z0-9]/gi, "")}`;
  try {
    world.structureManager.delete(id);
  } catch {}
  try {
    // Wide and tall enough to cover the ground work around the structure too.
    const from = { x: at.x - EDGE, y: feet - 16, z: at.z - EDGE };
    world.structureManager.createFromWorld(id, dim, from, { x: at.x + w - 1 + EDGE, y: feet + sy + 24, z: at.z + d - 1 + EDGE },
      { saveMode: StructureSaveMode.Memory, includeEntities: false });
    undo.set(player.id, { id, dim, at: from });
  } catch (e) {
    undo.delete(player.id);
    say(player, `§7(no undo for this one: ${e})`);
  }
  last.set(player.id, name);
  try {
    at.y = prepareSpot(dim, at.x, at.z, w, d);
    world.structureManager.place(`bs:${name}`, dim, at, { rotation: ROTATIONS[turns % 4] });
    say(player, `Placed §e${label(name)}§r (${dims(name)}) at ${at.x} ${at.y} ${at.z}, turned ${turns % 4}.`);
  } catch (e) {
    say(player, `§cCouldn't place ${name}: ${e}`);
  }
}

function undoLast(player) {
  const u = undo.get(player.id);
  if (!u) return say(player, "Nothing to undo.");
  try {
    world.structureManager.place(u.id, u.dim, u.at);
    undo.delete(player.id);
    say(player, "Put the ground back.");
  } catch (e) {
    say(player, `§cUndo failed: ${e}`);
  }
}

const bySize = (group) => NAMES.filter((n) => (SETS[group] ? SETS[group].test(n) : n.startsWith(group + "__")))
  .sort((a, b) => CATALOG[b][0] * CATALOG[b][2] - CATALOG[a][0] * CATALOG[a][2]);

// Lay out the next batch of a set in rows ahead of the player (towards +z),
// one structure per tick. Run it again somewhere else for the following batch.
function showcase(player, group) {
  if (!GROUPS.includes(group)) return say(player, `Sets: ${GROUPS.join(", ")}`);
  const all = bySize(group);
  const key = `${player.id}:${group}`;
  let from = showcased.get(key) ?? 0;
  if (from >= all.length) from = 0;
  const p = player.location;
  const x0 = Math.floor(p.x) - SHOW_SPAN / 2, z0 = Math.floor(p.z) + 8;
  const spots = [];
  let x = 0, z = 0, rowDepth = 0, i = from;
  for (; i < all.length; i++) {
    const [sx, , sz] = CATALOG[all[i]];
    if (x > 0 && x + sx > SHOW_SPAN) { x = 0; z += rowDepth + GAP; rowDepth = 0; }
    if (z + sz > SHOW_SPAN) break;
    spots.push({ name: all[i], at: { x: x0 + x, y: 0, z: z0 + z }, w: sx, d: sz });
    x += sx + GAP;
    rowDepth = Math.max(rowDepth, sz);
  }
  showcased.set(key, i);
  const dim = player.dimension;
  let failed = 0;
  spots.forEach((s, n) => system.runTimeout(() => {
    try {
      s.at.y = prepareSpot(dim, s.at.x, s.at.z, s.w, s.d);
      world.structureManager.place(`bs:${s.name}`, dim, s.at);
    } catch {
      failed++;
    }
    if (n === spots.length - 1) {
      say(player, `Showcase: ${spots.length - failed} of ${group} placed (${from + 1}-${i} of ${all.length}, biggest first)`
        + (failed ? `, §c${failed} failed, probably too far to be loaded§r` : "")
        + (i < all.length ? ". Move on and run it again for the next batch." : ". That's the whole set."));
    }
  }, 2 * n + 1));
  say(player, `Laying out ${spots.length} structures ahead of you (towards +z)...`);
}

// Build a whole jigsaw site (a village) centred on the player.
function site(player, siteId, seed) {
  seed = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 1e9);
  const p = player.location;
  const dim = player.dimension;
  void buildSite(dim, siteId, p, seed, (text) => say(player, text), (box) => {
    // The town centre lands on the player: lift them onto it.
    const q = player.location;
    if (q.x >= box[0] && q.x <= box[3] + 1 && q.z >= box[2] && q.z <= box[5] + 1 && q.y <= box[4] + 1) {
      try { player.teleport({ x: q.x, y: box[4] + 2, z: q.z }); } catch {}
    }
  }).then((built) => {
    if (built?.pieces?.length && siteId.includes("village")) spawnVendors(dim, built.pieces[0].box);
  });
}

const villageId = (size) => SITE_IDS.find((id) => id.includes(`${size}/village`));

function cluster(player, kind, seed) {
  seed = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 1e9);
  say(player, `Building a ${kind} ruin cluster around you (seed ${seed})...`);
  void buildCluster(player.dimension, kind, player.location, seed, (text) => say(player, text));
}

function auto(player, want) {
  if (want === "on" || want === "off") setAuto(want === "on");
  say(player, autoOn()
    ? "Automatic structures are §aon§r in this world: villages and ruins appear as you explore. They reshape the ground, so keep this off in a world with a base you care about."
    : "Automatic structures are §coff§r in this world.");
}

function vendors(player) {
  const p = player.location, x = Math.floor(p.x), z = Math.floor(p.z);
  const made = spawnVendors(player.dimension, [x - 4, Math.floor(p.y), z - 4, x + 4, Math.floor(p.y), z + 4]);
  say(player, made.length ? `A smith and a cartographer are beside you (${made.join(", ")}). Tap one to trade.` : "§cCouldn't place vendors here.");
}

function locate(player) {
  const p = player.location;
  const near = sitesNear(p.x, p.z, 2).slice(0, 6);
  say(player, (autoOn() ? "" : "§7(automatic structures are off, so these won't build)§r ") + "Nearest sites: "
    + near.map((s) => `${s.x} ${s.z} (${Math.round(Math.hypot(s.x - p.x, s.z - p.z))} away, ${s.built ?? "not built yet"})`).join("; ")
    + (lastReport() ? `. Last automatic build: ${lastReport()}` : ""));
}

function giveKit(player) {
  const inv = player.getComponent("inventory")?.container;
  if (!inv) return;
  for (let s = 0; s < inv.size; s++) if (inv.getItem(s)?.typeId === WAND) return say(player, "You already have the Structure Wand.");
  inv.addItem(new ItemStack(WAND, 1));
  say(player, "Here's the §eStructure Wand§r. Use it to open the menu; sneak and use it to repeat the last structure.");
}

function useWand(player) {
  if (usedAt.get(player.id) === system.currentTick) return;
  usedAt.set(player.id, system.currentTick);
  const again = last.get(player.id);
  if (player.isSneaking && again) return place(player, again);
  void menu(player);
}

async function menu(player, group, page = 0) {
  if (!group) {
    const f = new ActionFormData().title(`Better Structures ${VERSION}`).body("Pick a set. Structures appear in front of you.");
    for (const g of GROUPS) f.button(`${g} (${bySize(g).length})`);
    for (const g of GROUPS) f.button(`Showcase ${g}\nlay out a batch side by side`);
    f.button("Undo last");
    const sizes = ["small", "medium", "large"].filter(villageId);
    for (const size of sizes) f.button(`Build a ${size} village here\ncentred on you, can't be undone`);
    const kinds = Object.keys(CLUSTERS);
    for (const kind of kinds) f.button(`Build a ${kind} ruin cluster here\na main ruin with small ones around it`);
    f.button(autoOn() ? "Automatic structures: ON\ntap to turn off" : "Automatic structures: OFF\ntap to turn on for this world");
    f.button("Locate nearby sites");
    f.button("Summon village vendors here\na smith and a cartographer");
    const r = await f.show(player);
    if (r.canceled) return;
    const n = GROUPS.length;
    let i = r.selection;
    if (i < n) return menu(player, GROUPS[i]);
    if ((i -= n) < n) return showcase(player, GROUPS[i]);
    if ((i -= n) === 0) return undoLast(player);
    if ((i -= 1) < sizes.length) return site(player, villageId(sizes[i]));
    if ((i -= sizes.length) < kinds.length) return cluster(player, kinds[i]);
    if ((i -= kinds.length) === 0) return auto(player, autoOn() ? "off" : "on");
    return i === 1 ? locate(player) : vendors(player);
  }
  // Biggest first: those are the ones worth looking at.
  const all = bySize(group);
  const shown = all.slice(page * PAGE, (page + 1) * PAGE);
  const more = (page + 1) * PAGE < all.length;
  const f = new ActionFormData().title(`${group} ${page * PAGE + 1}-${page * PAGE + shown.length} of ${all.length}`);
  for (const n of shown) f.button(`${label(n)}\n${dims(n)}`);
  if (more) f.button("More...");
  const r = await f.show(player);
  if (r.canceled) return;
  if (r.selection === shown.length) return menu(player, group, page + 1);
  place(player, shown[r.selection]);
}

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const player = ev.sourceEntity;
  if (!player || player.typeId !== "minecraft:player") return;
  const args = ev.message.trim().split(/\s+/).filter(Boolean);
  switch (ev.id) {
    case "bs:menu":
      return void menu(player);
    case "bs:place":
      return place(player, args[0], Number(args[1]) || 0);
    case "bs:undo":
      return undoLast(player);
    case "bs:kit":
      return giveKit(player);
    case "bs:village": {
      const id = villageId(args[0] ?? "medium");
      return id ? site(player, id, Number(args[1])) : say(player, "Sizes: small, medium, large");
    }
    case "bs:site":
      return site(player, args[0], Number(args[1]));
    case "bs:cluster":
      return CLUSTERS[args[0]] ? cluster(player, args[0], Number(args[1])) : say(player, `Kinds: ${Object.keys(CLUSTERS).join(", ")}`);
    case "bs:auto":
      return auto(player, args[0]);
    case "bs:locate":
      return locate(player);
    case "bs:vendors":
      return vendors(player);
    case "bs:showcase":
      return showcase(player, args[0]);
    case "bs:find": {
      const hits = NAMES.filter((n) => n.includes(args[0] ?? ""));
      return say(player, `${hits.length} match: ${hits.slice(0, 30).join(", ")}${hits.length > 30 ? " ..." : ""}`);
    }
  }
}, { namespaces: ["bs"] });

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (itemStack?.typeId === WAND) useWand(source);
});

// Touch screens: tapping a block with the wand doesn't always fire itemUse.
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (ev.itemStack?.typeId !== WAND || ev.isFirstEvent === false) return;
  const player = ev.player;
  system.run(() => useWand(player));
});

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const player = ev.player;
  say(player, `Better Structures ${VERSION} loaded: ${NAMES.length} structures.`);
  if (!player.hasTag("bs_kit")) {
    player.addTag("bs_kit");
    giveKit(player);
  }
});
