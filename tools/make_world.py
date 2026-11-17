#!/usr/bin/env python3
"""Make a flat test world by copying the flat template world and rewriting its
settings: surface, creative mode, cheats on, our pack at the current version.

  make_world.py <sand|red_sand|grass>
  make_world.py --touch <world folder>   only move an existing world to the top of the list

Writes minecraftWorlds/bs_lab_<surface> (replacing an earlier one) and marks it
as played just now, so it is the top world in the game's list. Only run with
the game closed. Old chunks near the origin come along from the template, so
tests work far from there.
"""
import json, os, shutil, struct, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nbt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLDS = os.path.expanduser("~/Library/Application Support/mcpelauncher/games/com.mojang/minecraftWorlds")
TEMPLATE = "ez1BFp4Wx4Y="
SURFACES = {  # biome id, layers from the bottom up
    "sand": (2, [("bedrock", 1), ("sandstone", 40), ("sand", 8)]),
    "red_sand": (37, [("bedrock", 1), ("red_sandstone", 40), ("red_sand", 8)]),
    "grass": (1, [("bedrock", 1), ("stone", 34), ("dirt", 6), ("grass_block", 1)]),
}


def touch(folder):
    """Mark an existing world as played just now, so it is the top of the list."""
    path = os.path.join(WORLDS, folder, "level.dat")
    raw = open(path, "rb").read()
    r = nbt.Reader(raw[8:], little=True, typed=True)
    t = r.num("b"); r.string()
    d = r.payload(t)
    d["LastPlayed"] = nbt.L(int(time.time()))
    w = nbt.Writer(True)
    w.num("b", nbt.COMPOUND); w.string(""); w.payload(d)
    body = b"".join(w.out)
    open(path, "wb").write(raw[:4] + struct.pack("<i", len(body)) + body)
    print(f"'{d['LevelName']}' ({folder}) is now the most recently played world")


def main():
    if subprocess.run(["pgrep", "-f", "mcpelauncher-client"], capture_output=True).returncode == 0:
        sys.exit("The game is running; not touching worlds.")
    if sys.argv[1] == "--touch":
        return touch(sys.argv[2])
    surface = sys.argv[1]
    biome, layers = SURFACES[surface]
    dst = os.path.join(WORLDS, "bs_lab_" + surface)
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(os.path.join(WORLDS, TEMPLATE), dst)
    raw = open(os.path.join(dst, "level.dat"), "rb").read()
    version = struct.unpack("<i", raw[:4])[0]
    r = nbt.Reader(raw[8:], little=True, typed=True)
    t = r.num("b"); r.string()
    d = r.payload(t)
    name = "BS Lab " + surface.replace("_", " ")
    d["LevelName"] = name
    d["FlatWorldLayers"] = json.dumps({
        "biome_id": biome,
        "block_layers": [{"block_name": "minecraft:" + b, "count": n} for b, n in layers],
        "encoding_version": 6, "world_version": "version.post_1_18"}, separators=(",", ":")) + "\n"
    d["LastPlayed"] = nbt.L(int(time.time()))
    d["GameType"] = nbt.I(1)
    d["commandsEnabled"] = nbt.B(1)
    d["cheatsEnabled"] = nbt.B(1)
    w = nbt.Writer(True)
    w.num("b", nbt.COMPOUND); w.string(""); w.payload(d)
    body = b"".join(w.out)
    open(os.path.join(dst, "level.dat"), "wb").write(struct.pack("<ii", version, len(body)) + body)
    open(os.path.join(dst, "levelname.txt"), "w").write(name)
    bp = json.load(open(os.path.join(ROOT, "behavior_pack", "manifest.json")))["header"]
    json.dump([{"pack_id": bp["uuid"], "version": bp["version"]}], open(os.path.join(dst, "world_behavior_packs.json"), "w"))
    print(f"made '{name}' in {os.path.basename(dst)} ({sum(n for _, n in layers)} layers, top at y {-64 + sum(n for _, n in layers) - 1})")


if __name__ == "__main__":
    main()
