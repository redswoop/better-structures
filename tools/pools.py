#!/usr/bin/env python3
"""Export a Java mod's jigsaw rules for the in-game assembler.

  pools.py <group> <data/<namespace> dir>

Reads worldgen/template_pool and worldgen/structure under the namespace dir and
writes build/<group>.pools.json: every pool (elements resolved to our converted
structure names) and every jigsaw structure definition ("site"). Run after
convert.py, since it needs build/*.json to resolve names.
"""
import glob, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    group, data = sys.argv[1], os.path.abspath(sys.argv[2])
    ns = os.path.basename(data)
    names = {}
    for f in glob.glob(os.path.join(ROOT, "build", "*.json")):
        if f.endswith(".pools.json"):
            continue
        for name, info in json.load(open(f))["structures"].items():
            if info.get("java_id"):
                names[info["java_id"]] = name
    pools, missing = {}, set()
    base = os.path.join(data, "worldgen", "template_pool")
    for f in sorted(glob.glob(os.path.join(base, "**", "*.json"), recursive=True)):
        pid = ns + ":" + os.path.relpath(f, base)[:-5].replace(os.sep, "/")
        d = json.load(open(f))
        elements = []
        for e in d["elements"]:
            el = e["element"]
            kind = el["element_type"].split(":")[-1]
            if kind == "list_pool_element":  # stacked pieces: the first one carries the connectors
                el = el["elements"][0]
                kind = el["element_type"].split(":")[-1]
            piece = None
            if kind in ("single_pool_element", "legacy_single_pool_element"):
                loc = el["location"]
                piece = names.get(loc if ":" in loc else "minecraft:" + loc)
                if piece is None:
                    missing.add(loc)
                    continue  # a piece we didn't convert (other mods' blocks): leave it out
            elements.append([e["weight"], piece, "t" if el.get("projection") == "terrain_matching" else "r"])
        pools[pid] = {"fallback": d.get("fallback", "minecraft:empty"), "elements": elements}
    sites = {}
    base = os.path.join(data, "worldgen", "structure")
    for f in sorted(glob.glob(os.path.join(base, "**", "*.json"), recursive=True)):
        d = json.load(open(f))
        if not d.get("type", "").endswith("jigsaw") or d.get("start_pool") not in pools:
            continue
        if not any(e[1] for e in pools[d["start_pool"]]["elements"]):
            continue
        key = group + ":" + os.path.relpath(f, base)[:-5].replace(os.sep, "/")
        sh = d.get("start_height", {})
        sites[key] = {"start_pool": d["start_pool"], "depth": d.get("size", 5),
                      "start_height": sh.get("absolute", 0) if isinstance(sh, dict) else 0,
                      "on_surface": bool(d.get("project_start_to_heightmap")),
                      "reach": d.get("max_distance_from_center", 80),
                      "start_jigsaw": d.get("start_jigsaw_name"), "biomes": d.get("biomes"),
                      "adapt": d.get("terrain_adaptation", "none")}
    # Keep only pools a site can actually reach.
    json.dump({"pools": pools, "sites": sites}, open(os.path.join(ROOT, "build", group + ".pools.json"), "w"), indent=1)
    print(f"{group}: {len(pools)} pools, {len(sites)} sites, {len(missing)} pool pieces not converted")


if __name__ == "__main__":
    main()
