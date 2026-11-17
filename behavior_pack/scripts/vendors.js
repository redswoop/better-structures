// Village vendors: a reason to visit the big villages.
//   Smith: takes what you pick up out exploring and hands back gear.
//   Cartographer: sells directions to a ruin or village nobody has found yet.
// Together with the ruins' loot this makes a loop: the village sends you out,
// the ruin fills your bag, the village turns the bag into better gear.
import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

// Set by main.js, so this file needn't import the automatic-placement code.
export const hooks = { scout: null, autoOn: () => false };

const M = "minecraft:";
const nice = (id) => id.replace(M, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// What the smith makes. Costs are things a player collects anyway.
export const SMITH = [
  { give: ["iron_sword", 1], cost: { rotten_flesh: 24 } },
  { give: ["iron_pickaxe", 1], cost: { bone: 24 } },
  { give: ["bow", 1], also: ["arrow", 24], cost: { string: 12 } },
  { give: ["shield", 1], cost: { gunpowder: 10 } },
  { give: ["iron_helmet", 1], cost: { rotten_flesh: 16, bone: 8 } },
  { give: ["iron_chestplate", 1], cost: { rotten_flesh: 32, bone: 16 } },
  { give: ["iron_leggings", 1], cost: { rotten_flesh: 24, string: 12 } },
  { give: ["iron_boots", 1], cost: { bone: 16, string: 8 } },
  { give: ["diamond_sword", 1], cost: { iron_sword: 1, diamond: 3 } },
  { give: ["diamond_pickaxe", 1], cost: { iron_pickaxe: 1, diamond: 3 } },
];
export const MAPS = [
  { label: "Directions to a ruin", kinds: ["desert", "badlands"], cost: { bone: 12 } },
  { label: "Directions to another village", kinds: ["village"], cost: { string: 6 } },
];

const say = (player, who, text) => player.sendMessage(`§6[${who}]§r ${text}`);
const costText = (cost) => Object.entries(cost).map(([id, n]) => `${n} ${nice(id)}`).join(" + ");

/** How many of each item a container holds: {typeId without "minecraft:": amount}. */
export function counts(container) {
  const have = {};
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it) have[it.typeId.replace(M, "")] = (have[it.typeId.replace(M, "")] ?? 0) + it.amount;
  }
  return have;
}

export const missing = (have, cost) =>
  Object.entries(cost).filter(([id, n]) => (have[id] ?? 0) < n).map(([id, n]) => `${n - (have[id] ?? 0)} more ${nice(id)}`);

/** Remove a cost from a container. Call only after `missing` came back empty. */
export function take(container, cost) {
  for (const [id, n] of Object.entries(cost)) {
    let left = n;
    for (let i = 0; i < container.size && left > 0; i++) {
      const it = container.getItem(i);
      if (!it || it.typeId !== M + id) continue;
      if (it.amount <= left) { left -= it.amount; container.setItem(i, undefined); }
      else { it.amount -= left; left = 0; container.setItem(i, it); }
    }
  }
}

function hand(player, container, id, n) {
  while (n > 0) {
    const stack = new ItemStack(M + id, Math.min(n, 64));
    n -= stack.amount;
    const over = container.addItem(stack);
    if (over) { try { player.dimension.spawnItem(over, player.location); } catch {} }
  }
}

/** Do one smith trade. Returns a line to tell the player. */
export function smithTrade(player, offer) {
  const container = player.getComponent("inventory")?.container;
  if (!container) return "I can't see your pack.";
  const lack = missing(counts(container), offer.cost);
  if (lack.length) return `Not yet. Bring ${lack.join(" and ")}.`;
  take(container, offer.cost);
  hand(player, container, offer.give[0], offer.give[1]);
  if (offer.also) hand(player, container, offer.also[0], offer.also[1]);
  return `Here: §e${nice(offer.give[0])}§r${offer.also ? ` and ${offer.also[1]} ${nice(offer.also[0])}s` : ""}.`;
}

async function smith(player) {
  const have = counts(player.getComponent("inventory").container);
  const f = new ActionFormData().title("Smith").body("Bring me what you find out there and I'll make it into something useful.");
  for (const o of SMITH) f.button(`${nice(o.give[0])}${missing(have, o.cost).length ? "" : " §2(ready)§r"}\n${costText(o.cost)}`);
  const r = await f.show(player);
  if (r.canceled) return;
  say(player, "Smith", smithTrade(player, SMITH[r.selection]));
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export function bearing(from, to) {
  const angle = Math.atan2(to.x - from.x, -(to.z - from.z)); // north is -z
  return COMPASS[Math.round((angle / (Math.PI / 4)) + 8) % 8];
}

async function cartographer(player) {
  const have = counts(player.getComponent("inventory").container);
  const f = new ActionFormData().title("Cartographer").body("I know what lies out there that nobody has reached yet.");
  for (const m of MAPS) f.button(`${m.label}${missing(have, m.cost).length ? "" : " §2(ready)§r"}\n${costText(m.cost)}`);
  const r = await f.show(player);
  if (r.canceled) return;
  const offer = MAPS[r.selection];
  const container = player.getComponent("inventory").container;
  const lack = missing(counts(container), offer.cost);
  if (lack.length) return say(player, "Cartographer", `Maps aren't free. Bring ${lack.join(" and ")}.`);
  if (!hooks.autoOn() || !hooks.scout) {
    return say(player, "Cartographer", "The wilds are empty in this world: automatic structures are off. Turn them on from the Structure Wand and come back.");
  }
  say(player, "Cartographer", "Let me check my notes...");
  const found = await hooks.scout(player.dimension, player.location, offer.kinds);
  if (found.busy) return say(player, "Cartographer", "Ask me again in a moment.");
  if (!found.site) return say(player, "Cartographer", "Nothing unexplored anywhere near here. Keep your goods.");
  take(container, offer.cost);
  const p = player.location, s = found.site;
  const far = Math.round(Math.hypot(s.x - p.x, s.z - p.z));
  say(player, "Cartographer", `There's ${found.what === "village" ? "a village" : `a ${found.what} ruin`} about §e${far} blocks to the ${bearing(p, s)}§r, near x ${s.x}, z ${s.z}.`);
}

export function openShop(player, kind) {
  (kind === "smith" ? smith(player) : cartographer(player)).catch((e) => player.sendMessage(`§c[vendor] ${e}`));
}

function standAt(dim, x, z) {
  let b = dim.getTopmostBlock({ x, z });
  return { x: x + 0.5, y: (b ? b.y : 64) + 1, z: z + 0.5 };
}

/**
 * Put a smith and a cartographer in a village, at opposite corners of its
 * centre piece. Replaces any vendors already nearby. Returns what was spawned.
 */
export function spawnVendors(dim, box) {
  const mid = { x: (box[0] + box[3]) / 2, y: box[1], z: (box[2] + box[5]) / 2 };
  try {
    for (const old of dim.getEntities({ tags: ["bs_vendor"], location: mid, maxDistance: 48 })) old.remove();
  } catch {}
  const made = [];
  for (const [kind, name, x, z] of [["smith", "§6Smith", box[0] + 2, box[2] + 2], ["cartographer", "§bCartographer", box[3] - 2, box[5] - 2]]) {
    for (const type of ["minecraft:npc", "minecraft:villager_v2"]) {
      try {
        const e = dim.spawnEntity(type, standAt(dim, x, z));
        e.nameTag = name;
        // An NPC keeps its own name and look; give the two vendors different ones.
        try {
          const npc = e.getComponent("minecraft:npc");
          if (npc) { npc.name = name; npc.skinIndex = kind === "smith" ? 4 : 12; }
        } catch {}
        e.addTag("bs_vendor");
        e.addTag("bs_" + kind);
        made.push(`${kind}: ${type.replace(M, "")}`);
        break;
      } catch {}
    }
  }
  return made;
}

function onInteract(ev) {
  const target = ev.target;
  if (!target?.hasTag?.("bs_vendor")) return;
  ev.cancel = true; // no trade screen or NPC editor: ours instead
  const player = ev.player, kind = target.hasTag("bs_smith") ? "smith" : "cartographer";
  system.run(() => openShop(player, kind));
}
// Which event exists depends on the script API version; report it for tests.
export const interactEvent = world.beforeEvents.playerInteractWithEntity ? "before" : world.afterEvents.playerInteractWithEntity ? "after" : "none";
if (interactEvent === "before") world.beforeEvents.playerInteractWithEntity.subscribe(onInteract);
else if (interactEvent === "after") world.afterEvents.playerInteractWithEntity.subscribe((ev) => onInteract({ target: ev.target, player: ev.player }));
