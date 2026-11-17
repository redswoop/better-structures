#!/usr/bin/env python3
"""Convert Java structure templates (.nbt) into Bedrock .mcstructure files.

  convert.py <group> <java structure dir> [--skip-modded]

Writes behavior_pack/structures/bs/<group>__<name>.mcstructure (loaded in game
as "bs:<group>__<name>"), plus build/<group>.json with sizes, jigsaw connectors
and a report of everything that didn't convert cleanly.

Block states come from data/java_to_bedrock.json.gz (GeyserMC mappings, MIT).
"""
import gzip, json, os, re, sys, glob, collections
import nbt
from nbt import B, S, I, F, Lst, Tag

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MAP = json.load(gzip.open(os.path.join(HERE, "data", "java_to_bedrock.json.gz"), "rt"))
STATES, DEFAULTS = MAP["states"], MAP["defaults"]
VERSION = (1 << 24) | (26 << 16) | (60 << 8)  # 1.26.60, what the mapping targets

# Java blocks renamed since older mod versions were saved.
RENAMES = {"grass": "short_grass", "grass_path": "dirt_path", "chain": "iron_chain"}

# Mod blocks with no Bedrock twin yet: nearest vanilla look. Suffixes
# (_stairs, _slab, _wall) are handled by SUFFIX below.
SUBS = {
    "philipsruins:obsidian_brick": "polished_blackstone_bricks",
    "philipsruins:obsidian_brick_stairs": "polished_blackstone_brick_stairs",
    "philipsruins:obsidian_brick_slab": "polished_blackstone_brick_slab",
    "philipsruins:obsidian_brick_wall": "polished_blackstone_brick_wall",
    "philipsruins:dark_brick": "deepslate_bricks",
    "philipsruins:bone_bricks": "quartz_bricks",
    "philipsruins:bone_bricks_stairs": "quartz_stairs",
    "philipsruins:bone_bricks_slab": "quartz_slab",
    "philipsruins:bone_bricks_wall": "diorite_wall",
    "philipsruins:chiseled_bone_bricks": "chiseled_quartz_block",
    "philipsruins:fractured_bone_bricks": "bone_block",
    "philipsruins:cracked_bone": "bone_block",
    "philipsruins:bone_chunk_block": "bone_block",
    "philipsruins:sculk_bone_bricks": "deepslate_tiles",
    "philipsruins:sculk_bone_bricks_stairs": "deepslate_tile_stairs",
    "philipsruins:sculk_bone_bricks_slab": "deepslate_tile_slab",
    "philipsruins:sculk_bone_block": "sculk",
    "philipsruins:infested_sculk_bone_bricks": "deepslate_tiles",
    "philipsruins:sand_stone_brick": "cut_sandstone",
    "philipsruins:red_sand_stone_brick": "cut_red_sandstone",
    "philipsruins:sandstone_tiles": "smooth_sandstone",
    "philips_ruins:dungeonblock": "stone_bricks",
}

BED_COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
              "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"]

# Which of our loot tiers (tools/make_loot.py) each Java loot table becomes.
# The mod's own tables are thin, and the desert one isn't in the jar at all.
TIER_OF = [
    (r"high|value|fortress", "ruin_vault"),
    (r"low|level_one|ruin_loot$|ancient_ruins", "ruin_common"),
    (r"philipsruins:", "ruin_treasure"),
]


def loot_for(table):
    t = (table or "").lower()
    if "village" in t:
        return "loot_tables/chests/village/village_plains_house.json"
    for pattern, tier in TIER_OF:
        if re.search(pattern, t):
            return f"loot_tables/bs/{tier}.json"
    return "loot_tables/chests/simple_dungeon.json"


def parse_state(s):
    """'minecraft:foo[a=b,c=d]' -> ('minecraft:foo', {a: b, c: d})"""
    m = re.match(r"([^\[]+)(?:\[(.*)\])?$", s.strip())
    props = dict(kv.split("=", 1) for kv in m.group(2).split(",")) if m.group(2) else {}
    name = m.group(1)
    return (name if ":" in name else "minecraft:" + name), props


def key_of(name, props):
    return name + ("[" + ",".join(f"{k}={v}" for k, v in sorted(props.items())) + "]" if props else "")


class Report:
    def __init__(self):
        self.subbed = collections.Counter()
        self.unknown = collections.Counter()
        self.block_entities = collections.Counter()
        self.entities = collections.Counter()


def to_bedrock(name, props, rep):
    """Java block -> (bedrock palette entry, waterlogged). None means leave the
    spot untouched (structure void)."""
    if name == "minecraft:structure_void":
        return None, False
    if name in SUBS:
        rep.subbed[name] += 1
        name = "minecraft:" + SUBS[name]
    if not name.startswith("minecraft:"):
        rep.unknown[name] += 1
        return None, False
    short = name[10:]
    short = RENAMES.get(short, short)
    if short not in DEFAULTS:
        rep.unknown[name] += 1
        return None, False
    key = key_of(short, {k: str(v) for k, v in props.items()})
    if key not in STATES:
        # Fill in or drop properties that differ between versions or substitutes.
        _, dprops = parse_state(DEFAULTS[short])
        merged = {k: str(props.get(k, v)) for k, v in dprops.items()}
        key = key_of(short, merged)
        if key not in STATES:
            key = DEFAULTS[short]
    bname, bstates = STATES[key]
    states = {k: (B(v) if t == "b" else I(v) if t == "i" else v) for k, (t, v) in bstates.items()}
    entry = {"name": "minecraft:" + bname, "states": states, "version": I(VERSION)}
    return entry, str(props.get("waterlogged", "false")) == "true"


def block_entity(java_name, props, bnbt, pos, rep):
    """Bedrock block entity data for the blocks that need it to look right."""
    x, y, z = pos
    base = {"x": I(x), "y": I(y), "z": I(z), "isMovable": B(1)}
    short = java_name.split(":", 1)[1]
    bid = (bnbt or {}).get("id", "")
    if short.endswith("_bed"):
        color = short[:-4]
        return {**base, "id": "Bed", "color": B(BED_COLORS.index(color) if color in BED_COLORS else 14)}
    if short.startswith("potted_"):
        plant = short[7:]
        plant = {"azalea_bush": "azalea", "flowering_azalea_bush": "flowering_azalea"}.get(plant, plant)
        if plant in DEFAULTS:
            bname, bstates = STATES[DEFAULTS[plant]]
            st = {k: (B(v) if t == "b" else I(v) if t == "i" else v) for k, (t, v) in bstates.items()}
            return {**base, "id": "FlowerPot",
                    "PlantBlock": {"name": "minecraft:" + bname, "states": st, "version": I(VERSION)}}
        return None
    if short in ("chest", "trapped_chest", "barrel"):
        out = {**base, "id": "Barrel" if short == "barrel" else "Chest", "Items": Lst(nbt.COMPOUND, []),
               "Findable": B(0)}
        if bnbt and bnbt.get("LootTable"):
            out["LootTable"] = loot_for(bnbt["LootTable"])
        return out
    if short == "spawner":
        ent = "minecraft:zombie"
        try:
            ent = bnbt["SpawnData"]["entity"]["id"]
        except (KeyError, TypeError):
            pass
        return {**base, "id": "MobSpawner", "EntityIdentifier": ent, "Delay": S(20),
                "MinSpawnDelay": S(200), "MaxSpawnDelay": S(800), "SpawnCount": S(4),
                "MaxNearbyEntities": S(6), "RequiredPlayerRange": S(16), "SpawnRange": S(4),
                "DisplayEntityWidth": F(0.8), "DisplayEntityHeight": F(1.8), "DisplayEntityScale": F(1.0)}
    if bid:
        rep.block_entities[bid] += 1
    return None


def convert(path, rep):
    s = nbt.load(path)
    sx, sy, sz = s["size"]
    palette = s["palettes"][0] if "palettes" in s else s["palette"]
    vol = sx * sy * sz
    layer0, layer1 = [-1] * vol, [-1] * vol
    out_palette, index, pos_data, jigsaws = [], {}, {}, []

    def pal_index(entry):
        k = json.dumps(entry, sort_keys=True, default=lambda t: [t.t, t.v])
        if k not in index:
            index[k] = len(out_palette)
            out_palette.append(entry)
        return index[k]

    water = None
    modded = False
    for b in s["blocks"]:
        x, y, z = b["pos"]
        if b["state"] >= len(palette):  # broken file (seen in one mod-compat piece)
            modded = True
            continue
        p = palette[b["state"]]
        name, props = p["Name"], p.get("Properties", {})
        bnbt = b.get("nbt")
        if name == "minecraft:jigsaw" and bnbt:
            jigsaws.append({"pos": [x, y, z], "orientation": props.get("orientation"),
                            "name": bnbt.get("name"), "target": bnbt.get("target"),
                            "pool": bnbt.get("pool"), "joint": bnbt.get("joint")})
            name, props = parse_state(bnbt.get("final_state") or "minecraft:air")
            bnbt = None
        elif name == "minecraft:structure_block":
            name, props, bnbt = "minecraft:air", {}, None
        if not name.startswith("minecraft:") and name not in SUBS:
            modded = True
        entry, wet = to_bedrock(name, props, rep)
        if entry is None:
            continue
        i = (x * sy + y) * sz + z
        layer0[i] = pal_index(entry)
        if wet:
            if water is None:
                water = pal_index({"name": "minecraft:water", "states": {"liquid_depth": I(0)}, "version": I(VERSION)})
            layer1[i] = water
        be = block_entity(name, props, bnbt, (x, y, z), rep)
        if be:
            pos_data[str(i)] = {"block_entity_data": be}
    for e in s.get("entities", []):
        rep.entities[e["nbt"].get("id")] += 1

    root = {
        "format_version": I(1),
        "size": Lst(nbt.INT, [I(sx), I(sy), I(sz)]),
        "structure": {
            "block_indices": Lst(nbt.LIST, [Lst(nbt.INT, [I(v) for v in layer0]), Lst(nbt.INT, [I(v) for v in layer1])]),
            "entities": Lst(nbt.COMPOUND, []),
            "palette": {"default": {"block_palette": Lst(nbt.COMPOUND, out_palette),
                                    "block_position_data": pos_data}},
        },
        "structure_world_origin": Lst(nbt.INT, [I(0), I(0), I(0)]),
    }
    return root, {"size": [sx, sy, sz], "jigsaws": jigsaws, "modded": modded}


def main():
    group, src = sys.argv[1], sys.argv[2]
    skip_modded = "--skip-modded" in sys.argv
    out_dir = os.path.join(ROOT, "behavior_pack", "structures", "bs")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    for old in glob.glob(os.path.join(out_dir, group + "__*.mcstructure")):
        os.remove(old)
    rep, catalog, skipped = Report(), {}, []
    for path in sorted(glob.glob(os.path.join(src, "**", "*.nbt"), recursive=True)):
        rel = os.path.relpath(path, src)[:-4]
        name = group + "__" + re.sub(r"[^a-z0-9_]", "_", rel.lower().replace(os.sep, "__"))
        one = Report()
        root, info = convert(path, one)
        if skip_modded and (info["modded"] or one.unknown):
            skipped.append(rel)
            continue
        for a in ("subbed", "unknown", "block_entities", "entities"):
            getattr(rep, a).update(getattr(one, a))
        nbt.dump(root, os.path.join(out_dir, name + ".mcstructure"))
        m = re.search(r"/data/([^/]+)/structures?/(.+)\.nbt$", os.path.abspath(path).replace(os.sep, "/"))
        catalog[name] = {"size": info["size"], "jigsaws": info["jigsaws"], "source": rel,
                         "java_id": f"{m.group(1)}:{m.group(2)}" if m else None}
    json.dump({"structures": catalog, "skipped_modded": skipped,
               "report": {"substituted": dict(rep.subbed), "unknown_blocks": dict(rep.unknown),
                          "block_entities_dropped": dict(rep.block_entities),
                          "entities_dropped": dict(rep.entities)}},
              open(os.path.join(ROOT, "build", group + ".json"), "w"), indent=1)
    print(f"{group}: {len(catalog)} converted, {len(skipped)} skipped (mod-compat pieces)")
    for label, c in (("substituted", rep.subbed), ("UNKNOWN (left as holes)", rep.unknown),
                     ("block entities without data", rep.block_entities), ("entities dropped", rep.entities)):
        if c:
            print(f"  {label}: " + ", ".join(f"{k} x{v}" for k, v in c.most_common(12)))


if __name__ == "__main__":
    main()
