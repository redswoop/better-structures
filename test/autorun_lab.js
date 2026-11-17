// Test-only autopilot for the flat lab worlds (tools/make_world.py). It builds
// its own test terrain, so nothing needs finding: dunes, hills, trees, ponds.
// tools/drive.sh writes the steps to run into autorun_scenario.js, e.g.
//   "catalog desert;clusters desert;auto"
// The action bar says what each view shows.
import { world, system, GameMode } from "@minecraft/server";
import { buildSite, prepareSpot, loadArea, unload, SITE_IDS } from "./site.js";
import { buildCluster } from "./ruins.js";
import { setAuto, sitesNear, lastReport } from "./auto.js";
import { CATALOG } from "./catalog.js";
import { SCENARIO } from "./autorun_scenario.js";
import { spawnVendors, openShop, smithTrade, counts, SMITH, interactEvent } from "./vendors.js";
import { ItemStack } from "@minecraft/server";
import { uiManager } from "@minecraft/server-ui";

const SETS = {
  desert: /__(mod_structures__)?(desert_|lost_desert|sand_house)/,
  badlands: /__(ancient_pyramid|the_ruin_temple|badlands_)/,
};
const wait = (n) => new Promise((done) => system.runTimeout(done, n));
let started = false, player, dim;
const label = (text) => { try { player.onScreenDisplay.setActionBar(`§e[lab] ${text}`); } catch {} };
const speck = (x, z) => { let h = (Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

async function view(from, at, ticks, text) {
  for (let t = 0; t < ticks; t += 10) {
    try { player.teleport(from, { facingLocation: at }); } catch {}
    label(text);
    await wait(10);
  }
}

// Go to a spot and wait for it to load. Returns the flat ground's height and surface block.
async function arrive(x, z, text) {
  for (let i = 0; i < 40; i++) {
    await view({ x: x - 30, y: 60, z: z - 30 }, { x, y: 0, z }, 10, text);
    try {
      const b = dim.getTopmostBlock({ x, z });
      if (b) return { y: b.y, surface: b.typeId, under: b.below()?.typeId ?? b.typeId };
    } catch {}
  }
  throw new Error(`the ground at ${x} ${z} never loaded`);
}

// Raise or lower the flat ground within r of a centre: height(dx, dz) in blocks.
async function sculpt(cx, cz, r, ground, height) {
  let n = 0;
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    const h = Math.round(height(dx, dz));
    if (!h) continue;
    const x = cx + dx, z = cz + dz;
    if (h > 0) {
      for (let y = ground.y; y < ground.y + h; y++) dim.setBlockType({ x, y, z }, ground.under);
      dim.setBlockType({ x, y: ground.y + h, z }, ground.surface);
    } else {
      for (let y = ground.y; y > ground.y + h; y--) dim.setBlockType({ x, y, z }, "minecraft:air");
      dim.setBlockType({ x, y: ground.y + h, z }, ground.surface);
    }
    if (++n % 400 === 0) { label("shaping the test terrain"); await wait(1); }
  }
}

async function trees(cx, cz, r, share) {
  let n = 0;
  for (let dx = -r; dx <= r; dx += 2) for (let dz = -r; dz <= r; dz += 2) {
    const x = cx + dx, z = cz + dz;
    if (speck(x, z) > share) continue;
    const top = dim.getTopmostBlock({ x, z });
    if (!top || top.typeId !== "minecraft:grass_block") continue;
    const y = top.y;
    for (let h = 1; h <= 5; h++) dim.setBlockType({ x, y: y + h, z }, "minecraft:oak_log");
    for (let ly = 4; ly <= 7; ly++) {
      const w = ly < 6 ? 2 : 1;
      for (let ax = -w; ax <= w; ax++) for (let az = -w; az <= w; az++) {
        if ((ax || az || ly > 5) && Math.abs(ax) + Math.abs(az) < 2 * w) dim.setBlockType({ x: x + ax, y: y + ly, z: z + az }, "minecraft:oak_leaves");
      }
    }
    if (++n % 25 === 0) { label("planting the test forest"); await wait(1); }
  }
}

async function pond(cx, cz, radius, ground) {
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    if (Math.hypot(dx, dz) > radius - speck(cx + dx, cz + dz) * 3) continue;
    for (let y = ground.y; y > ground.y - 3; y--) dim.setBlockType({ x: cx + dx, y, z: cz + dz }, "minecraft:water");
  }
  await wait(1);
}

async function withArea(cx, cz, reach, work) {
  const areas = await loadArea(dim, { x: cx, z: cz }, reach);
  try { await work(); } finally { unload(dim, areas); }
}

// Every piece of a set, side by side, each on ground prepared the normal way.
async function catalog(set, ox, oz) {
  const names = Object.keys(CATALOG).filter((n) => SETS[set].test(n)).sort((a, b) => CATALOG[b][0] * CATALOG[b][2] - CATALOG[a][0] * CATALOG[a][2]);
  const CELL = 44, PER_ROW = 3;
  for (let row = 0; row * PER_ROW < names.length; row++) {
    const rowNames = names.slice(row * PER_ROW, (row + 1) * PER_ROW);
    const cz = oz + row * CELL + 20, cx = ox + (PER_ROW * CELL) / 2;
    await arrive(cx, cz, `${set} pieces, row ${row + 1}`);
    await withArea(cx, cz, 62, async () => {
      const spots = [];
      for (const [i, name] of rowNames.entries()) {
        const [sx, sy, sz] = CATALOG[name];
        const x0 = ox + i * CELL + ((CELL - sx) >> 1), z0 = oz + row * CELL + ((CELL - sz) >> 1);
        try {
          const y = prepareSpot(dim, x0, z0, sx, sz, { low: true });
          world.structureManager.place(`bs:${name}`, dim, { x: x0, y, z: z0 });
          spots.push({ name, mid: { x: x0 + sx / 2, y: y + sy / 2, z: z0 + sz / 2 }, reach: Math.max(sx, sz, sy), sx, sy, sz });
        } catch (e) { player.sendMessage(`§c[lab] ${name}: ${e}`); }
        await wait(2);
      }
      const y0 = spots[0]?.mid.y ?? 0;
      await view({ x: cx - 70, y: y0 + 50, z: cz - 70 }, { x: cx, y: y0, z: cz }, 40, `${set} row ${row + 1}: ${rowNames.map((n) => n.replace(/^ruins__(mod_structures__)?/, "")).join(", ")}`);
      for (const s of spots) {
        const tag = `${s.name.replace(/^ruins__(mod_structures__)?/, "")} ${s.sx}x${s.sy}x${s.sz}`;
        await view({ x: s.mid.x - s.reach * 0.85, y: s.mid.y + s.reach * 0.45, z: s.mid.z - s.reach * 0.85 }, s.mid, 30, tag);
        await view({ x: s.mid.x + s.reach * 0.8, y: s.mid.y - s.sy / 2 + 4, z: s.mid.z + s.reach * 0.5 }, s.mid, 30, `${tag}, low`);
      }
    });
  }
}

// Clusters built on dunes the script makes first.
async function clusters(kind, ox, oz) {
  for (const [i, seed] of [11, 22, 33].entries()) {
    const cx = ox + i * 170, cz = oz;
    const ground = await arrive(cx, cz, `${kind} cluster ${i + 1}: getting there`);
    await withArea(cx, cz, 70, () => sculpt(cx, cz, 74, ground, (dx, dz) => 3.5 * Math.sin((dx + 40 * i) / 9) * Math.cos(dz / 13) + 2.5 * Math.sin((dx + dz) / 21)));
    let said = "";
    await buildCluster(dim, kind, { x: cx, z: cz }, seed, (t) => { said = t.replace(/§./g, ""); });
    const at = { x: cx, y: ground.y + 4, z: cz };
    await view({ x: cx - 55, y: ground.y + 45, z: cz - 55 }, at, 50, `${kind} cluster ${i + 1}: ${said}`);
    await view({ x: cx + 50, y: ground.y + 30, z: cz + 40 }, at, 40, `${kind} cluster ${i + 1} from the other side`);
    await view({ x: cx + 34, y: ground.y + 9, z: cz - 26 }, at, 40, `${kind} cluster ${i + 1}, low`);
  }
}

// Villages on a hill, in a forest on a slope, and beside a lake.
async function villages(ox, oz) {
  const medium = SITE_IDS.find((s) => s.includes("medium/village")), small = SITE_IDS.find((s) => s.includes("small/village"));
  const cases = [
    ["on a steep little hill", medium, (g, cx, cz) => sculpt(cx, cz, 60, g, (dx, dz) => 14 * Math.exp(-(dx * dx + dz * dz) / 500))],
    ["in a forest on rolling hills", medium, async (g, cx, cz) => {
      await sculpt(cx, cz, 100, g, (dx, dz) => 6 + 6 * Math.sin(dx / 16) * Math.cos(dz / 19) + dx / 14);
      await trees(cx, cz, 100, 0.09);
    }],
    ["beside a lake", small, async (g, cx, cz) => {
      // Gentle rises, flat where the lake goes so the water is at the surface.
      const shore = (dx, dz) => Math.min(1, Math.max(0, (Math.hypot(dx - 45, dz - 10) - 34) / 10));
      await sculpt(cx, cz, 100, g, (dx, dz) => shore(dx, dz) * (2 + 2 * Math.sin(dx / 23) + 2 * Math.cos(dz / 17)));
      await pond(cx + 45, cz + 10, 34, g);
    }],
  ];
  for (const [i, [what, siteId, shape]] of cases.entries()) {
    const cx = ox + i * 330, cz = oz;
    const ground = await arrive(cx, cz, `village ${what}: getting there`);
    await withArea(cx, cz, 80, () => shape(ground, cx, cz));
    const at = { x: cx, y: ground.y + 6, z: cz };
    await view({ x: cx - 75, y: ground.y + 55, z: cz - 75 }, at, 40, `before: ${what}`);
    let said = "";
    let done = false;
    const job = buildSite(dim, siteId, { x: cx, z: cz }, 7 + i, (t) => { said = t.replace(/§./g, ""); }).then(() => { done = true; });
    for (let k = 0; k < 200 && !done; k++) await view({ x: cx - 75, y: ground.y + 55, z: cz - 75 }, at, 20, `village ${what}: ${said}`);
    await job;
    await view({ x: cx - 75, y: ground.y + 55, z: cz - 75 }, at, 50, `village ${what}: ${said}`);
    await view({ x: cx + 75, y: ground.y + 55, z: cz + 75 }, at, 40, `village ${what}, from the other corner`);
    await view({ x: cx - 34, y: ground.y + 20, z: cz - 8 }, at, 40, `village ${what}, low from the west`);
    await view({ x: cx + 30, y: ground.y + 20, z: cz + 12 }, at, 40, `village ${what}, low from the east`);
    await view({ x: cx + 8, y: ground.y + 16, z: cz - 46 }, at, 40, `village ${what}, north edge`);
    await view({ x: cx + 70, y: ground.y + 40, z: cz + 10 }, { x: cx + 30, y: ground.y, z: cz + 10 }, 40, `village ${what}, east side from above`);
  }
}

// Automatic placement: turn it on, walk up to the nearest site, and watch.
async function auto(ox, oz) {
  setAuto(true);
  const site = sitesNear(ox, oz, 2)[0];
  const ground = await arrive(site.x + 30, site.z + 30, `automatic site at ${site.x} ${site.z}: getting there`);
  const at = { x: site.x, y: ground.y + 4, z: site.z };
  let built;
  for (let i = 0; i < 40 && built === undefined; i++) {
    await view({ x: site.x - 60, y: ground.y + 48, z: site.z - 60 }, at, 20, `waiting for the automatic site at ${site.x} ${site.z}`);
    built = sitesNear(site.x, site.z, 1).find((s) => s.id === site.id)?.built;
  }
  // Deciding comes first; wait for the build itself to report.
  for (let i = 0; i < 50 && !lastReport(); i++) await view({ x: site.x - 60, y: ground.y + 48, z: site.z - 60 }, at, 20, `site decided: ${built ?? "nothing"}; waiting for the build`);
  await view({ x: site.x - 60, y: ground.y + 48, z: site.z - 60 }, at, 80, `automatic: ${lastReport() || "no report"}`);
  await view({ x: site.x + 40, y: ground.y + 14, z: site.z + 30 }, at, 60, `automatic, low: ${lastReport() || "no report"}`);
  setAuto(false);
}

// Roll each of our loot tables in the game and list what came out, then read a
// chest inside a placed pyramid.
async function loot(ox, oz) {
  const ground = await arrive(ox, oz, "loot: getting there");
  const at = { x: ox + 0.5, y: ground.y + 2, z: oz + 0.5 };
  for (const table of ["ruin_common", "ruin_treasure", "ruin_vault"]) {
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      try { ok += dim.runCommand(`loot spawn ${at.x} ${at.y} ${at.z} loot "bs/${table}"`).successCount; } catch {}
    }
    await wait(10);
    const got = {};
    let stacks = 0;
    for (const e of dim.getEntities({ type: "minecraft:item", location: at, maxDistance: 16 })) {
      try {
        const it = e.getComponent("item").itemStack;
        const name = it.typeId.replace("minecraft:", "");
        got[name] = (got[name] ?? 0) + it.amount;
        stacks++;
        e.remove();
      } catch {}
    }
    const best = Object.entries(got).filter(([n]) => /diamond|netherite|iron_(sword|axe|pick|helm|chest|legg|boot|block)|golden_apple|totem|emerald|book|gold_block/.test(n))
      .sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} ${n}`).join(", ");
    await view({ x: ox - 14, y: ground.y + 10, z: oz - 14 }, at, 100, `${table} x12: ${ok} rolls ok, ${stacks} stacks. ${best || "nothing notable"}`);
  }
  // A real chest in a real structure.
  const name = "ruins__desert_pyramid", [sx, sy, sz] = CATALOG[name];
  const x0 = ox + 30, z0 = oz;
  await arrive(x0 + 10, z0 + 10, "loot: going to the pyramid spot");
  const y = prepareSpot(dim, x0, z0, sx, sz, { low: true });
  world.structureManager.place(`bs:${name}`, dim, { x: x0, y, z: z0 });
  await wait(20);
  let chests = 0, filled = 0, sample = "";
  for (let x = x0; x < x0 + sx; x++) for (let yy = y; yy < y + sy; yy++) for (let z = z0; z < z0 + sz; z++) {
    const b = dim.getBlock({ x, y: yy, z });
    if (!b || !/chest$/.test(b.typeId)) continue;
    chests++;
    try {
      const c = b.getComponent("inventory")?.container;
      let n = 0;
      for (let i = 0; c && i < c.size; i++) { const it = c.getItem(i); if (it) { n++; if (sample.length < 60) sample += `${it.amount} ${it.typeId.replace("minecraft:", "")}, `; } }
      if (n) filled++;
    } catch {}
  }
  await view({ x: x0 - 16, y: y + 22, z: z0 - 16 }, { x: x0 + sx / 2, y: y + 8, z: z0 + sz / 2 }, 120, `pyramid: ${chests} chests, ${filled} already hold items. ${sample}`);
}

// Automatic placement on natural terrain: visit the site nearest each spot.
async function autotour() {
  const SPOTS = [[1176, 3304], [700, 600], [-900, 400], [300, -1300], [2000, 1100], [-1500, -1400], [60, 300]];
  setAuto(true);
  const tally = {};
  for (const [n, [sx, sz]] of SPOTS.entries()) {
    const site = sitesNear(sx, sz, 1)[0];
    if (!site) continue;
    let top = 80;
    for (let i = 0; i < 40; i++) {
      await view({ x: site.x - 40, y: 200, z: site.z - 40 }, { x: site.x, y: 80, z: site.z }, 10, `site ${n + 1} of ${SPOTS.length} at ${site.x} ${site.z}: getting there`);
      try { const b = dim.getTopmostBlock({ x: site.x, z: site.z }); if (b) { top = b.y; break; } } catch {}
    }
    const at = { x: site.x, y: top, z: site.z };
    // Stay under the clouds (about y 128 in Bedrock).
    const high = { x: site.x - 45, y: Math.min(top + 34, 122), z: site.z - 45 };
    const already = sitesNear(site.x, site.z, 1).find((s) => s.id === site.id)?.built;
    const state = () => sitesNear(site.x, site.z, 1).find((s) => s.id === site.id)?.built;
    for (let i = 0; i < 40 && state() === undefined; i++) await view(high, at, 20, `site ${n + 1} at ${site.x} ${site.z}: reading the ground`);
    const what = state() ?? "undecided";
    tally[what] = (tally[what] ?? 0) + 1;
    if (what === "none" || what === "undecided") { await view(high, at, 60, `site ${n + 1} at ${site.x} ${site.z}: ${what === "none" ? "nothing fits this ground" : "never decided"}`); continue; }
    const mine = () => already !== undefined || (lastReport().startsWith(`site ${site.x} ${site.z}:`) && /Done|stopped|failed|No room|water/.test(lastReport()));
    for (let i = 0; i < 70 && !mine(); i++) await view(high, at, 20, `site ${n + 1}: ${what}, building. ${lastReport().startsWith(`site ${site.x}`) ? lastReport() : ""}`);
    const said = already !== undefined ? "built on an earlier run" : mine() ? lastReport() : "no report";
    await view(high, at, 70, `site ${n + 1} (${what}): ${said}`);
    await view({ x: site.x + 50, y: Math.min(top + 30, 122), z: site.z + 50 }, at, 50, `site ${n + 1} (${what}) from the other corner`);
    await view({ x: site.x + 30, y: top + 14, z: site.z - 22 }, at, 50, `site ${n + 1} (${what}), low`);
  }
  setAuto(false);
  const sum = Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ");
  for (let i = 0; i < 8; i++) { label(`TOUR DONE: ${sum}`); await wait(20); }
}

// Vendors: do they appear, does the shop menu show, does a trade go through?
async function vendors(ox, oz) {
  const ground = await arrive(ox, oz, "vendors: getting there");
  const made = spawnVendors(dim, [ox - 4, ground.y, oz - 4, ox + 4, ground.y, oz + 4]);
  await wait(20);
  let seen = [];
  try { seen = dim.getEntities({ tags: ["bs_vendor"], location: { x: ox, y: ground.y, z: oz }, maxDistance: 20 }).map((e) => `${e.typeId.replace("minecraft:", "")} "${e.nameTag.replace(/§./g, "")}"`); } catch (e) { seen = [String(e)]; }
  const at = { x: ox, y: ground.y + 1.5, z: oz };
  await view({ x: ox + 1, y: ground.y + 4, z: oz + 9 }, at, 80, `vendors: ${made.join("; ") || "NONE SPAWNED"} | found ${seen.join(", ")} | interact event: ${interactEvent}`);
  await view({ x: ox - 2, y: ground.y + 2.2, z: oz - 0.5 }, { x: ox - 1.5, y: ground.y + 2, z: oz - 3.5 }, 50, "vendors: the smith, close up");
  // A trade, with goods put in the pack first.
  const c = player.getComponent("inventory").container;
  c.addItem(new ItemStack("minecraft:bone", 30));
  const said = smithTrade(player, SMITH.find((o) => o.give[0] === "iron_pickaxe")).replace(/§./g, "");
  const have = counts(c);
  await view({ x: ox + 1, y: ground.y + 4, z: oz + 9 }, at, 70, `trade: "${said}" pack now: ${have.iron_pickaxe ?? 0} iron pickaxe, ${have.bone ?? 0} bone`);
  // The shop menu itself, on screen.
  openShop(player, "smith");
  for (let i = 0; i < 8; i++) await wait(10);
  try { uiManager.closeAllForms(player); } catch {}
  openShop(player, "cartographer");
  for (let i = 0; i < 8; i++) await wait(10);
  try { uiManager.closeAllForms(player); } catch {}
  await wait(10);
}

async function run() {
  const home = { ...player.location }, mode = player.getGameMode();
  try { player.setGameMode(GameMode.Spectator); } catch {}
  for (const c of ["time set noon", "weather clear", "gamerule dodaylightcycle false", "gamerule domobspawning false"]) { try { dim.runCommand(c); } catch {} }
  await wait(80);
  for (const [i, step] of SCENARIO.split(";").entries()) {
    const [what, arg] = step.trim().split(" ");
    const ox = 6000 + i * 1500, oz = 0;
    try {
      if (what === "catalog") await catalog(arg, ox, oz);
      else if (what === "clusters") await clusters(arg, ox, oz);
      else if (what === "villages") await villages(ox, oz);
      else if (what === "auto") await auto(ox, oz);
      else if (what === "loot") await loot(ox, oz);
      else if (what === "vendors") await vendors(ox + 400, oz + 400);
      else if (what === "autotour") await autotour();
    } catch (e) {
      player.sendMessage(`§c[lab] ${step}: ${e}`);
      for (let k = 0; k < 6; k++) { label(`FAILED ${step}: ${e}`); await wait(20); }
    }
  }
  for (let i = 0; i < 6; i++) { label("LAB DONE"); await wait(20); }
  try { player.teleport(home); await wait(20); player.setGameMode(mode); } catch {}
  for (let i = 0; i < 8; i++) { label("LAB DONE, player restored"); await wait(20); }
}

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn || started) return;
  started = true;
  player = ev.player; dim = player.dimension;
  run().catch((e) => player.sendMessage(`§c[lab] ${e}`));
});
