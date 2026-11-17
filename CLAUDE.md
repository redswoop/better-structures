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

## Sites (jigsaw assembly)

A site is a multi-piece structure such as a village. `tools/pools.py <group> <data/<ns> dir>` exports the Java template pools and structure definitions to `build/<group>.pools.json`; `build.sh` bakes the reachable ones into `scripts/data.js`.

- `scripts/jigsaw.js` plans a site the way Java does (start piece, then pieces snapped onto connectors from weighted pools). No game API, so it's testable.
- `scripts/site.js` builds the plan: ticking areas to load the area, roads draped column by column, buildings on foundations, ground eased around them, villagers spawned.
- Rotation: the planner's quarter turns are clockwise about a piece's origin block, as in Java. `site.js` doesn't assume how Bedrock rotates; `calibrate()` places `bs:calib` in the sky each way and reads the result.
- Only `plains` sites are enabled (`SITE_GROUPS` in `build.sh`). Philip's Ruins sites drape whole ruins over terrain, and draped pieces are placed block by block from baked data with no rotation of block states. Roads only contain cobblestone and air, so they don't care; ruins will.
- A piece attached inside its parent's footprint (a house in the crook of a road bend) is "interior": it only has to fit the parent's footprint and miss its siblings. That mirrors Java and is where most houses come from.

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
