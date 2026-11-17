// Test-only autopilot (see tools/drive.sh): finds a desert, sets down every
// desert ruin with the normal ground preparation, and shows each from two
// angles. The action bar names the piece in view.
import { world, system, GameMode } from "@minecraft/server";
import { prepareSpot } from "./site.js";
import { CATALOG } from "./catalog.js";

const PICK = /__(mod_structures__)?(desert_|lost_desert|sand_house|ancient_pyramid|the_ruin_temple|badlands_)/;
// A desert found on 2026-11-16 in the normal-terrain test world (seed -1148547126759876419).
const KNOWN = { x: 1176, z: 3304 };
const CELL = 46, PER_ROW = 5;
const wait = (n) => new Promise((done) => system.runTimeout(done, n));
let started = false;
const label = (player, text) => { try { player.onScreenDisplay.setActionBar(`§e[autorun] ${text}`); } catch {} };

async function hold(player, from, at, ticks, text) {
  for (let t = 0; t < ticks; t += 10) {
    try { player.teleport(from, { facingLocation: at }); } catch {}
    label(player, text);
    await wait(10);
  }
}

async function run(player) {
  const dim = player.dimension;
  const home = { ...player.location }, mode = player.getGameMode();
  let cycle = true;
  try { cycle = world.gameRules.doDayLightCycle; } catch {}
  try { player.setGameMode(GameMode.Spectator); } catch {}
  for (const c of ["time set noon", "weather clear", "gamerule dodaylightcycle false"]) { try { dim.runCommand(c); } catch {} }
  await wait(100);

  // The stable script API has no biome search (findClosestBiome isn't there),
  // so hop outwards in rings and look for ground that is sand all around.
  const sandy = (x, z) => {
    let hits = 0, n = 0;
    for (let dx = -40; dx <= 40; dx += 20) for (let dz = -40; dz <= 40; dz += 20) {
      try {
        let b = dim.getTopmostBlock({ x: x + dx, z: z + dz });
        while (b && /cactus|deadbush|dead_bush|air/.test(b.typeId)) b = b.below();
        n++;
        if (b && b.y > 62 && /^minecraft:(sand|sandstone)$/.test(b.typeId)) hits++;
      } catch {}
    }
    return n >= 20 && hits >= n - 2;
  };
  let desert;
  const start = { x: Math.floor(home.x), z: Math.floor(home.z) };
  try { player.teleport({ x: KNOWN.x, y: 200, z: KNOWN.z }); } catch {}
  for (let i = 0; i < 12; i++) { label(player, "going to the desert found last time"); await wait(10); }
  if (sandy(KNOWN.x, KNOWN.z)) desert = KNOWN;
  search:
  for (let ring = 1; ring <= 5 && !desert; ring++) {
    const r = ring * 700, steps = ring * 8;
    for (let k = 0; k < steps; k++) {
      const a = (2 * Math.PI * k) / steps;
      const x = start.x + Math.round(r * Math.cos(a)), z = start.z + Math.round(r * Math.sin(a));
      try { player.teleport({ x, y: 200, z }); } catch {}
      for (let i = 0; i < 5; i++) { label(player, `looking for a desert: ring ${ring}, ${k + 1} of ${steps}`); await wait(10); }
      if (sandy(x, z)) { desert = { x, z }; break search; }
    }
  }
  if (!desert) { for (let i = 0; i < 20; i++) { label(player, "NO DESERT FOUND"); await wait(20); } }
  else {
    const ox = Math.floor(desert.x) - 40, oz = Math.floor(desert.z) - 40;
    player.sendMessage(`[autorun] desert at ${ox} ${oz}`);
    player.teleport({ x: ox, y: 200, z: oz });
    for (let i = 0; i < 9; i++) { label(player, `travelling to the desert at ${ox} ${oz}`); await wait(20); }
    const names = Object.keys(CATALOG).filter((n) => PICK.test(n))
      .sort((a, b) => CATALOG[b][0] * CATALOG[b][2] - CATALOG[a][0] * CATALOG[a][2]);
    for (const [i, name] of names.entries()) {
      const [sx, sy, sz] = CATALOG[name];
      const x0 = ox + (i % PER_ROW) * CELL, z0 = oz + Math.floor(i / PER_ROW) * CELL;
      const mid = { x: x0 + sx / 2, y: 0, z: z0 + sz / 2 };
      const short = name.replace(/^ruins__(mod_structures__)?/, "");
      const reach = Math.max(sx, sz);
      // Go there first so the ground is loaded, then prepare it and place.
      try { mid.y = dim.getTopmostBlock({ x: Math.floor(mid.x), z: Math.floor(mid.z) })?.y ?? 70; } catch { mid.y = 70; }
      // Wait until the whole spot, including the eased ground around it, has loaded.
      for (let tries = 0; tries < 12; tries++) {
        await hold(player, { x: mid.x - reach, y: 120, z: mid.z - reach }, mid, 20, `${short}: loading the spot`);
        try {
          if ([[x0 - 8, z0 - 8], [x0 + sx + 8, z0 - 8], [x0 - 8, z0 + sz + 8], [x0 + sx + 8, z0 + sz + 8]].every(([x, z]) => dim.getBlock({ x, y: 64, z }))) break;
        } catch {}
      }
      try {
        const y = prepareSpot(dim, x0, z0, sx, sz);
        world.structureManager.place(`bs:${name}`, dim, { x: x0, y, z: z0 });
        mid.y = y + sy / 2;
      } catch (e) { player.sendMessage(`§c[autorun] ${short}: ${e}`); }
      const tag = `${short} ${sx}x${sy}x${sz}`;
      await hold(player, { x: mid.x - reach * 0.9, y: mid.y + reach * 0.7, z: mid.z - reach * 0.9 }, mid, 50, `${tag} (from above)`);
      await hold(player, { x: mid.x + reach * 0.8, y: mid.y + 2, z: mid.z + reach * 0.6 }, mid, 50, `${tag} (eye level)`);
    }
  }
  for (let i = 0; i < 6; i++) { label(player, "AUTORUN DONE"); await wait(20); }
  try { player.teleport(home); await wait(20); player.setGameMode(mode); } catch {}
  try { dim.runCommand(`gamerule dodaylightcycle ${cycle}`); } catch {}
  for (let i = 0; i < 10; i++) { label(player, "AUTORUN DONE, player restored"); await wait(20); }
}

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn || started) return;
  started = true;
  run(ev.player).catch((e) => ev.player.sendMessage(`§c[autorun] ${e}`));
});
