// Test-only autopilot. tools/drive.sh copies this into the INSTALLED pack (never
// the repo's behavior_pack) so a launched game tests itself with no keyboard:
// it builds a village on the nearest hilltop, then moves the camera around it
// while drive.sh captures the game window. The action bar labels each view.
import { world, system, GameMode } from "@minecraft/server";
import { buildSite } from "./site.js";

const SITE = "plains:medium/village_plains", SEED = 7, HOLD = 70; // ticks per camera position
const FAR = [[700, 600], [-900, 400], [1300, -500], [300, -1300], [-1500, -1400], [2000, 1100]];
const wait = (n) => new Promise((done) => system.runTimeout(done, n));
let started = false;

function label(player, text) {
  try { player.onScreenDisplay.setActionBar(`§e[autorun] ${text}`); } catch {}
}

async function look(player, center, dx, dy, dz, text) {
  for (let t = 0; t < HOLD; t += 10) {
    try { player.teleport({ x: center.x + dx, y: center.y + dy, z: center.z + dz }, { facingLocation: center }); } catch {}
    label(player, text);
    await wait(10);
  }
}

async function run(player) {
  const dim = player.dimension;
  // Remember how the player was, to put them back at the end.
  const home = { ...player.location }, mode = player.getGameMode();
  let cycle = true;
  try { cycle = world.gameRules.doDayLightCycle; } catch {}
  try { player.setGameMode(GameMode.Spectator); } catch { try { player.runCommand("gamemode spectator"); } catch {} }
  for (const c of ["time set noon", "weather clear", "gamerule dodaylightcycle false"]) { try { dim.runCommand(c); } catch {} }
  label(player, "waiting for the world to load");
  await wait(100);

  // Look for untouched, dry, hilly ground: try spots until one qualifies.
  let best = null, bestScore = -1;
  for (const [fx, fz] of FAR) {
    player.teleport({ x: fx, y: 220, z: fz });
    for (let i = 0; i < 9; i++) { label(player, `looking for hilly land near ${fx} ${fz}`); await wait(20); }
    let wet = 0, n = 0, lo = 999, top = null;
    for (let dx = -56; dx <= 56; dx += 4) for (let dz = -56; dz <= 56; dz += 4) {
      try {
        let b = dim.getTopmostBlock({ x: fx + dx, z: fz + dz });
        while (b && /leaves|log|air|grass$|fern|flower|snow_layer/.test(b.typeId)) b = b.below();
        if (!b) continue;
        n++;
        if (/water|ice|kelp|seagrass/.test(b.typeId)) { wet++; continue; }
        lo = Math.min(lo, b.y);
        if (!top || b.y > top.y) top = { x: b.x, y: b.y, z: b.z };
      } catch {}
    }
    if (!top || !n) continue;
    const dry = 1 - wet / n, relief = top.y - lo;
    const score = dry * Math.min(relief, 25);
    player.sendMessage(`[autorun] ${fx} ${fz}: ${Math.round(dry * 100)}% dry, ${relief} blocks of relief`);
    if (score > bestScore) { bestScore = score; best = top; }
    if (dry > 0.9 && relief >= 10) break;
  }
  const p = player.location;
  const center = best ?? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  player.sendMessage(`[autorun] hilltop at ${center.x} ${center.y} ${center.z}`);

  await look(player, center, -60, 45, -60, "before: the natural ground");
  let done = false;
  const job = buildSite(dim, SITE, center, SEED, (t) => player.sendMessage(t)).then(() => { done = true; });
  for (let i = 0; i < 400 && !done; i++) await look(player, center, -60, 45, -60, "building...");
  await job;

  const views = [
    [-70, 50, -70, "overview from the north-west"], [70, 50, -70, "overview from the north-east"],
    [70, 50, 70, "overview from the south-east"], [-70, 50, 70, "overview from the south-west"],
    [0, 95, 1, "straight down"],
    [-32, 14, -6, "low, from the west"], [32, 14, 6, "low, from the east"], [6, 14, -32, "low, from the north"], [-6, 14, 32, "low, from the south"],
    [-48, 8, -48, "edge of the village, north-west"], [48, 8, 48, "edge of the village, south-east"],
  ];
  for (const [dx, dy, dz, text] of views) await look(player, center, dx, dy, dz, text);
  for (let i = 0; i < 10; i++) { label(player, "AUTORUN DONE"); await wait(20); }
  // Put the player and the world back: the test worlds have cheats off, so
  // nobody could undo spectator mode by hand.
  try { player.teleport(home); await wait(20); player.setGameMode(mode); } catch {}
  try { dim.runCommand(`gamerule dodaylightcycle ${cycle}`); } catch {}
  for (let i = 0; i < 10; i++) { label(player, "AUTORUN DONE, player restored"); await wait(20); }
}

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn || started) return;
  started = true;
  run(ev.player).catch((e) => ev.player.sendMessage(`§c[autorun] ${e}`));
});
