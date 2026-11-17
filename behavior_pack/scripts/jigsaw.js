// Plans a jigsaw structure the way Java's worldgen does: start with one piece,
// then keep snapping pieces from template pools onto open connectors.
// Pure logic, no game API: the caller supplies terrain heights and data.

const HORIZONTAL = ["north", "east", "south", "west"];
const STEP = { north: [0, 0, -1], east: [1, 0, 0], south: [0, 0, 1], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };

/** Turn a direction r quarter turns clockwise (seen from above). */
export function rotDir(dir, r) {
  const i = HORIZONTAL.indexOf(dir);
  return i < 0 ? dir : HORIZONTAL[(i + r) % 4];
}

/** Turn a position inside a piece r quarter turns clockwise about the piece's origin block. */
export function rotPos([x, y, z], r) {
  switch (r & 3) {
    case 0: return [x, y, z];
    case 1: return [-z, y, x];
    case 2: return [-x, y, -z];
    default: return [z, y, -x];
  }
}

/** World bounding box [x0, y0, z0, x1, y1, z1] of a piece with origin o, size s, rotation r. */
export function boxOf(o, s, r) {
  const b = rotPos([s[0] - 1, s[1] - 1, s[2] - 1], r);
  return [o[0] + Math.min(0, b[0]), o[1], o[2] + Math.min(0, b[2]), o[0] + Math.max(0, b[0]), o[1] + s[1] - 1, o[2] + Math.max(0, b[2])];
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pool elements in a weighted random order, each once.
function drawOrder(pool, rng) {
  const bag = [];
  pool.e.forEach((el, i) => { for (let n = 0; n < el[0]; n++) bag.push(i); });
  const seen = new Set(), out = [];
  for (const i of shuffled(bag, rng)) if (!seen.has(i)) { seen.add(i); out.push(pool.e[i]); }
  return out;
}

const overlaps = (a, b, flat) =>
  a[0] <= b[3] && a[3] >= b[0] && a[2] <= b[5] && a[5] >= b[2] && (flat || (a[1] <= b[4] && a[4] >= b[1]));
const within = (a, b) => a[0] >= b[0] && a[3] <= b[3] && a[1] >= b[1] && a[4] <= b[4] && a[2] >= b[2] && a[5] <= b[5];
const holds = (b, p) => p[0] >= b[0] && p[0] <= b[3] && p[1] >= b[1] && p[1] <= b[4] && p[2] >= b[2] && p[2] <= b[5];

/**
 * @param site      entry from SITES
 * @param center    {x, z} the start piece is centred here
 * @param rng       () => [0,1)
 * @param firstFree (x, z) => y of the first open block above the ground
 * @param data      {PIECES, POOLS}
 * @param spawnPools ids of pools that stand for a mob to spawn rather than a piece
 * @param canPlace  (box, name) => false to veto a solid piece there (say, over open water)
 * @returns {pieces: [{name, r, o, box, tm, depth}], spawns: [{pool, pos}]}
 */
export function plan({ site, center, rng, firstFree, data, spawnPools = new Set(), depth = site.depth, canPlace }) {
  const { PIECES, POOLS } = data;
  const pieces = [], spawns = [];
  // On the surface every piece needs its own ground: two buildings may not
  // share a footprint even when one sits higher up a slope.
  const surface = site.on_surface;
  const startEl = drawOrder(POOLS[site.start_pool], rng).find((el) => el[1]);
  if (!startEl) return { pieces, spawns };

  const r0 = Math.floor(rng() * 4);
  const s0 = PIECES[startEl[1]].s;
  const far = rotPos([s0[0] - 1, 0, s0[2] - 1], r0);
  const o0 = [center.x - Math.trunc(far[0] / 2), 0, center.z - Math.trunc(far[2] / 2)];
  o0[1] = site.on_surface ? firstFree(center.x, center.z) - 1 + site.start_height : site.start_height;
  const start = { name: startEl[1], r: r0, o: o0, box: boxOf(o0, s0, r0), tm: startEl[2] === "t", depth: 0, inner: [] };
  pieces.push(start);
  const limit = [center.x - site.reach, -Infinity, center.z - site.reach, center.x + site.reach, Infinity, center.z + site.reach];

  const queue = [start];
  while (queue.length) {
    const parent = queue.shift();
    const def = PIECES[parent.name];
    for (const pj of shuffled(def.j, rng)) {
      const front = rotDir(pj.f, parent.r), top = rotDir(pj.u, parent.r);
      const q = rotPos(pj.p, parent.r);
      const at = [parent.o[0] + q[0], parent.o[1] + q[1], parent.o[2] + q[2]];
      const step = STEP[front];
      const meet = [at[0] + step[0], at[1] + step[1], at[2] + step[2]];
      if (spawnPools.has(pj.pool)) {
        spawns.push({ pool: pj.pool, pos: meet });
        continue;
      }
      const pool = POOLS[pj.pool];
      if (!pool) continue;
      const interior = holds(parent.box, meet);
      const candidates = [];
      if (parent.depth !== depth) candidates.push(...drawOrder(pool, rng));
      if (POOLS[pool.fb]) candidates.push(...drawOrder(POOLS[pool.fb], rng));
      let ground = null;

      search:
      for (const [, name, proj] of candidates) {
        if (!name) break; // an "empty" entry: this connector stays open
        const child = PIECES[name];
        for (const r of shuffled([0, 1, 2, 3], rng)) {
          for (const cj of shuffled(child.j, rng)) {
            if (cj.n !== pj.t) continue;
            const cfront = rotDir(cj.f, r);
            if (cfront !== OPPOSITE[front]) continue;
            if (step[1] !== 0 && !(pj.roll || rotDir(cj.u, r) === top)) continue;
            const cq = rotPos(cj.p, r);
            const tm = proj === "t";
            let y;
            if (!parent.tm && !tm) {
              y = meet[1] - cq[1];
            } else {
              ground ??= firstFree(at[0], at[2]);
              y = ground - cq[1];
            }
            const o = [meet[0] - cq[0], y, meet[2] - cq[2]];
            const box = boxOf(o, child.s, r);
            if (interior) {
              // Inside the parent's footprint (a house in the crook of a road bend).
              // A draped piece has no real height, so only the footprint counts.
              const flat = surface || tm || parent.tm;
              const fits = flat ? box[0] >= parent.box[0] && box[3] <= parent.box[3] && box[2] >= parent.box[2] && box[5] <= parent.box[5] : within(box, parent.box);
              if (!fits || parent.inner.some((b) => overlaps(box, b, flat))) continue;
            } else {
              if (!within(box, limit)) continue;
              if (pieces.some((p) => !p.interior && overlaps(box, p.box, surface || tm || p.tm))) continue;
            }
            if (!tm && canPlace && !canPlace(box, name)) continue;
            const piece = { name, r, o, box, tm, depth: parent.depth + 1, inner: [], interior };
            if (interior) parent.inner.push(box);
            pieces.push(piece);
            if (piece.depth <= depth) queue.push(piece);
            break search;
          }
        }
      }
    }
  }
  return { pieces, spawns };
}
