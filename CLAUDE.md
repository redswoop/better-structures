# Better Structures

A Bedrock add-on that ports buildings from Java structure mods: ruins, villages and, later, giant temples. Shared Bedrock notes are in `../CLAUDE.md`.

**Public since 2026-11-16 at github.com/redswoop/better-structures, by Armen's decision** after being told the buildings are other people's work (Philip's Ruins is all rights reserved, ChoiceTheorem's Overhauled Village is CC-BY-NC-ND). The original mod jars in `sources/` are git-ignored and must stay out of the repo. Keep the credits in `README.md`, and no kids' names anywhere, including test player names.

## Layout

- `sources/`: the Java mod jars the buildings come from.
- `tools/convert.py`: turns Java `.nbt` templates into `behavior_pack/structures/bs/<group>__<name>.mcstructure` and writes `build/<group>.json` (sizes, jigsaw connectors, a report of what didn't convert).
- `tools/data/java_to_bedrock.json.gz`: Java block state to Bedrock block state, built from GeyserMC's `blocks.nbt` (indexed by Java state id) joined with the state ids in Mojang's `reports/blocks.json` for the same Java version (26.3, Bedrock 1.26.60). To rebuild it, run the server jar's data generator with `--reports`; that needs Java 25.
- `behavior_pack/scripts/main.js`: the Structure Wand (`bs:wand`, given on first join, opens the menu) and debug commands (`/scriptevent bs:menu`, `bs:place`, `bs:find`, `bs:undo`, `bs:kit`, `bs:showcase <set>`, `bs:village [size] [seed]`, `bs:site <id> [seed]`). The wand has no resource pack: it borrows the vanilla `blaze_rod` icon.
- `build.sh` regenerates `scripts/catalog.js` and checks versions. `install.sh` runs it and copies the pack to the Mac dev packs, refusing while the game runs.

## Commands

- `npm test`: plans villages on fake terrain, then builds them in a fake world (`node_modules/@minecraft/` holds hand-written fakes, not npm packages). It proves logic only; looks need the real game.
- `node test/plan.mjs [seed]`: prints a map of one planned village.
- `./install.sh`: build and copy to the Mac dev packs. After a version bump, repoint test worlds as in `../tower-wand/CLAUDE.md`.

## Clusters and automatic placement (0.4.0)

- `scripts/ruins.js`: a cluster is one main ruin plus two to four small ones within 48 blocks, each sunk a block into the ground (`prepareSpot` with `sink` and `low`). The piece lists and the ground each kind needs are in `CLUSTERS`. Philip's Ruins has no placement rules for its desert and badlands pieces, so these rules are ours.
- `scripts/auto.js`: the world is cut into 320-block cells; about three in four hold one site at a spot fixed by a random key saved in the world. A site is built the first time a player comes within 150 blocks. What gets built is read from the ground (`classify`), because the stable script API has no biome lookup: sand means a desert cluster, red sand a badlands cluster, mostly-grass gentle dry land a village.
- Automatic placement is OFF until turned on per world (wand menu or `/scriptevent bs:auto on`). It reshapes ground, so it must never start by surprise in a world with a base in it.

## Village vendors (0.5.0)

`scripts/vendors.js`. Every village built by the pack gets a smith and a cartographer at opposite corners of its centre piece (`spawnVendors`); the wand menu and `/scriptevent bs:vendors` put a pair beside you. They are vanilla `minecraft:npc` entities tagged `bs_vendor`, with a villager as fallback. Tapping one is caught by `world.beforeEvents.playerInteractWithEntity`, cancelled, and replaced with our form.

- Smith: `SMITH` lists offers, paid in things players collect anyway (rotten flesh, bones, string, gunpowder), up to diamond tools for an iron tool plus diamonds.
- Cartographer: `MAPS`. Uses `scout` in `auto.js` to load and read the ground at the nearest unreached sites, and charges only if it finds one. Needs automatic structures on.
- Seen in the game on 2026-11-16: both NPCs spawn, the shop forms display, a trade moves items. NOT seen: a real tap opening the shop, and the names and skins set through the `minecraft:npc` component.

## Sites (jigsaw assembly)

A site is a multi-piece structure such as a village. `tools/pools.py <group> <data/<ns> dir>` exports the Java template pools and structure definitions to `build/<group>.pools.json`; `build.sh` bakes the reachable ones into `scripts/data.js`.

- `scripts/jigsaw.js` plans a site the way Java does (start piece, then pieces snapped onto connectors from weighted pools). No game API, so it's testable.
- `scripts/site.js` builds the plan. In order: ticking areas load the area; `survey` samples the ground every 2 blocks and blurs it; the planner runs on that smoothed ground; `grade` bulldozes the real ground to the smoothed shape near every road and building (fading out over 9 blocks) and fells whole trees; roads are draped; each building gets a level pad at its doorway's ground height; `blend` eases the ground around the pads; villagers spawn.
- Fell trees before placing anything. `fell` follows connected logs, so a tree cut next to an existing building eats its log walls and foundations. `grade` clears every column later ground work can touch for that reason.
- On surface sites two buildings may not share a footprint even at different heights (`surface` in `jigsaw.js`): the lower one's pad would dig out the upper one's foundation.
- `prepareSpot` does the same ground work for a single structure placed from the wand or a showcase: median ground height, level pad, trees felled, edges eased.
- Rotation: the planner's quarter turns are clockwise about a piece's origin block, as in Java. `site.js` doesn't assume how Bedrock rotates; `calibrate()` places `bs:calib` in the sky each way and reads the result.
- Only `plains` sites are enabled (`SITE_GROUPS` in `build.sh`). Philip's Ruins sites drape whole ruins over terrain, and draped pieces are placed block by block from baked data with no rotation of block states. Roads only contain cobblestone and air, so they don't care; ruins will.
- A piece attached inside its parent's footprint (a house in the crook of a road bend) is "interior": it only has to fit the parent's footprint and miss its siblings. That mirrors Java and is where most houses come from.

## Driving the game (only with Armen's OK)

Worked on 2026-11-16 with game 1.26.62, while Armen was away from the Mac:

1. Game closed. `./install.sh`, then copy `test/autorun.js` into the installed pack's `scripts/` and append `import "./autorun.js";` to the installed `main.js`. Never add it to the repo's pack.
2. Start one client: `mcpelauncher-client -dg <versions/latest> -dd <data dir> -m <mods .../arm64-v8a/> -ww 1280 -wh 720`. The `-u minecraft://?load=` argument no longer opens a world; the game stays at the main menu.
3. After about 25 s, find the window titled "Minecraft" with `CGWindowListCopyWindowInfo` (its owner name is "Minecraft Bedrock Launcher"). Bring that process to the front, click the title bar once (the first click only focuses), then click Play at window point (640, 372) and the top world row at (576, 314). Check each screen with `screencapture -x -o -t jpg -l <window id>` before the next click: the world list is about 400 KB, the main menu about 800 KB.
4. `autorun.js` labels each camera position on the action bar, so the captures explain themselves. It restores the player's position, game mode and the daylight rule at the end; the test worlds have cheats off, so a player left in spectator can't fix it by hand.
5. Quit with `pkill`, restore `minecraftpe/options.txt` from a backup taken before step 2, and run `./install.sh` again to remove the autopilot.

`tools/drive.sh <autorun script> <out dir> [frames] [scenario]` does all of the above. It opens the world played last, so pick the world first with `tools/make_world.py <sand|red_sand|grass>`, which copies the flat template world to `bs_lab_<surface>` with that surface, creative mode and cheats on. `test/autorun_lab.js` runs the scenario steps on ground it shapes itself (dunes, hills, trees, a lake), so nothing has to be found:

```sh
python3 tools/make_world.py sand     && tools/drive.sh test/autorun_lab.js <out>/lab_sand 85 "catalog desert;clusters desert;auto"
python3 tools/make_world.py red_sand && tools/drive.sh test/autorun_lab.js <out>/lab_red 70 "catalog badlands;clusters badlands"
python3 tools/make_world.py grass    && tools/drive.sh test/autorun_lab.js <out>/lab_grass 110 "villages;auto"
```

`tools/labs.sh <out dir>` runs all three (about twelve minutes); add `recheck` for just sand and grass. Both scripts refuse while the game is running, and the driver clicks with the real mouse. Armen allows closing and restarting his game for this (2026-11-16).

Run on 2026-11-16 with 0.4.0, all seen working in the real game: every desert and badlands piece, clusters of both kinds on dunes, villages on a steep hill, in a dense forest and beside a lake (buildings stay on land, the road bridges), and automatic placement building a desert cluster on sand and a village on grass.

What those runs taught, so it isn't relearned:
- A ticking area made by `runCommand` does load ground far from the player (seen at 2,000 blocks, within 2 s). Ground is readable only 64 blocks around a player otherwise.
- `loadArea` once checked a spot one block outside the area it asked for. When that block fell in the next chunk the wait could never finish. Keep every probe inside the areas.
- Read the ground only after loading it, and leave a couple of ticks between dropping ticking areas and asking for new ones with the same names.
- JavaScript's `a ^ b` is signed. A hash that ends in an xor needs `>>> 0` before dividing, or the "random" number goes negative. That bug dug a ring of pits around every ruin.
- Custom `FlatWorldLayers` in `level.dat` are honoured without a `preset_id`.
- `getTopmostBlock` skips water: under a sea or lake it returns the BED. A sandy sea floor read as "desert" and a ruin was built in the open ocean. Anything that asks "is this water?" must also look at the block above. The fake now behaves the same way.
- Bedrock's clouds sit near y 128. A test camera above that sees only cloud; `tools/labs.sh <out> round2` still has camera trouble on natural terrain, so those builds are confirmed by their reports, not by sight.
- Loot: `tools/make_loot.py` writes three tiers to `loot_tables/bs/`; `TIER_OF` in `convert.py` maps each Java loot table to one. Rolled in the game with `/loot spawn`: all three work. Rebalancing needs only `make_loot.py` and a build.
- In the lab, make water after shaping hills and keep the ground flat where the lake goes, or the lake ends up underground. `test/autorun.js` builds a village on hilly land; `test/autorun_desert.js` sets down every desert and badlands piece in a desert.

The stable script API (2.0.0) has no biome lookup: `dimension.findClosestBiome` is "not a function". The desert tour finds desert by checking that the ground is sand across a wide area, which took about four minutes of hopping the first time. The normal-terrain test world has a desert around x 1176, z 3304, and the tour tries that first.

`getTopmostBlock` returns the top of whatever is there, including earlier test builds, so pick test spots from natural blocks only.

## Converting

```sh
unzip -q sources/<mod>.jar 'data/*' -d /some/empty/dir
python3 tools/convert.py <group> /some/empty/dir/data/<ns>/structure[/sub] [--skip-modded]
```

`--skip-modded` drops pieces that contain other mods' blocks. For CTOV those are exactly the mod-compat pieces its base template pools don't use.

## Known gaps

- Philip's Ruins custom blocks (bone bricks, obsidian bricks and so on) are swapped for vanilla lookalikes in `SUBS`. Porting them as real custom blocks needs a resource pack.
- Chests point at vanilla Bedrock loot tables chosen by keyword (`loot_for`). The mods' own loot isn't ported.
- Saved entities (mobs, paintings, armor stands, item frames) are dropped. Skulls, signs and banners lose their contents.
- Double chests come out as two single chests.
