// Test-only: does a ticking area made by script actually load ground far from
// the player, and how far around the player is ground readable anyway?
import { world, system } from "@minecraft/server";
const wait = (n) => new Promise((done) => system.runTimeout(done, n));
let started = false;
world.afterEvents.playerSpawn.subscribe(async (ev) => {
  if (!ev.initialSpawn || started) return;
  started = true;
  const player = ev.player, dim = player.dimension;
  const lines = [];
  const show = async (secs) => { for (let i = 0; i < secs * 2; i++) { try { player.onScreenDisplay.setActionBar("§e" + lines.join("\n")); } catch {} await wait(10); } };
  const readable = (x, z) => { try { return !!dim.getBlock({ x, y: 0, z }); } catch { return false; } };
  await wait(100);
  const p = player.location, px = Math.floor(p.x), pz = Math.floor(p.z);
  let reach = 0;
  for (let d = 16; d <= 400; d += 16) { if (readable(px + d, pz)) reach = d; else break; }
  lines.push(`readable around player: ${reach} blocks`);
  const fx = px + 2000, fz = pz + 2000;
  for (const [label, cmd] of [
    ["box", `tickingarea add ${fx} 0 ${fz} ${fx + 63} 0 ${fz + 63} bs_diag_a`],
    ["circle", `tickingarea add circle ${fx + 500} 0 ${fz} 3 bs_diag_b`],
  ]) {
    let res = "?";
    try { res = "successCount " + dim.runCommand(cmd).successCount; } catch (e) { res = "threw " + e; }
    lines.push(`${label}: ${res}`);
  }
  await show(1);
  for (const t of [2, 5, 10, 20]) {
    await show(t === 2 ? 2 : t === 5 ? 3 : t === 10 ? 5 : 10);
    lines.push(`after ${t}s: box ${readable(fx + 32, fz + 32) ? "LOADED" : "not loaded"}, circle ${readable(fx + 500, fz) ? "LOADED" : "not loaded"}`);
  }
  for (const n of ["bs_diag_a", "bs_diag_b"]) { try { dim.runCommand(`tickingarea remove ${n}`); } catch {} }
  lines.push("DIAG DONE");
  await show(12);
});
