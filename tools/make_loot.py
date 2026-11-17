#!/usr/bin/env python3
"""Write our own chest loot for the ruins: behavior_pack/loot_tables/bs/*.json.

Three tiers, each a step up, so the deeper or bigger the place the better the
haul. tools/convert.py points every ruin chest at one of them (TIER_OF there).
Edit the lists here and rerun; no reconversion is needed for a rebalance.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def item(name, weight, count=None, enchant=None, book=False):
    e = {"type": "item", "name": "minecraft:" + name, "weight": weight}
    fns = []
    if count:
        fns.append({"function": "set_count", "count": {"min": count[0], "max": count[1]}})
    if enchant:
        fns.append({"function": "enchant_with_levels", "levels": {"min": enchant[0], "max": enchant[1]}, "treasure": True})
    if book:
        fns.append({"function": "enchant_randomly"})
    if fns:
        e["functions"] = fns
    return e


SUPPLIES = [item("bread", 10, (2, 5)), item("cooked_beef", 6, (1, 4)), item("arrow", 10, (4, 12)), item("bone", 8, (2, 6)),
            item("string", 6, (1, 4)), item("coal", 8, (2, 8)), item("gunpowder", 5, (1, 4)), item("torch", 8, (4, 10))]

TABLES = {
    # Small ruins and side rooms: useful, with a real chance of iron.
    "ruin_common": [
        ((3, 5), SUPPLIES + [item("iron_ingot", 10, (1, 4)), item("gold_ingot", 6, (1, 3)), item("emerald", 4, (1, 2)),
                             item("iron_pickaxe", 3), item("iron_shovel", 3), item("iron_sword", 3), item("shield", 2),
                             item("lapis_lazuli", 4, (2, 6)), item("redstone", 4, (2, 6))]),
        ((0, 1), [item("diamond", 1), item("book", 2, book=True), item("saddle", 1), item("golden_apple", 1)]),
    ],
    # Pyramids, towers and large ruins: iron gear, often enchanted, and diamonds.
    "ruin_treasure": [
        ((2, 3), SUPPLIES + [item("iron_ingot", 12, (2, 6)), item("gold_ingot", 10, (2, 5)), item("emerald", 8, (1, 4)),
                             item("experience_bottle", 6, (2, 5))]),
        ((1, 2), [item("iron_sword", 6, enchant=(8, 20)), item("iron_axe", 4, enchant=(8, 20)), item("iron_pickaxe", 5, enchant=(8, 20)),
                  item("bow", 4, enchant=(8, 20)), item("crossbow", 3, enchant=(8, 20)),
                  item("iron_helmet", 4, enchant=(5, 15)), item("iron_chestplate", 4, enchant=(5, 15)),
                  item("iron_leggings", 4, enchant=(5, 15)), item("iron_boots", 4, enchant=(5, 15)), item("shield", 3)]),
        ((1, 1), [item("diamond", 10, (1, 3)), item("book", 8, book=True), item("golden_apple", 6), item("saddle", 4),
                  item("name_tag", 4), item("ender_pearl", 4, (1, 2)), item("iron_block", 4, (1, 2)),
                  item("diamond_pickaxe", 1), item("diamond_sword", 1), item("netherite_scrap", 1)]),
    ],
    # The best rooms: diamonds every time, diamond gear, a real shot at netherite.
    "ruin_vault": [
        ((2, 3), [item("diamond", 12, (2, 5)), item("emerald", 8, (3, 8)), item("gold_ingot", 8, (4, 10)),
                  item("iron_block", 6, (1, 3)), item("gold_block", 5, (1, 2)), item("experience_bottle", 6, (4, 10))]),
        ((1, 2), [item("diamond_sword", 5, enchant=(15, 30)), item("diamond_pickaxe", 5, enchant=(15, 30)),
                  item("diamond_axe", 3, enchant=(15, 30)), item("diamond_helmet", 3, enchant=(12, 25)),
                  item("diamond_chestplate", 3, enchant=(12, 25)), item("diamond_leggings", 3, enchant=(12, 25)),
                  item("diamond_boots", 3, enchant=(12, 25)), item("bow", 3, enchant=(20, 30)), item("book", 6, book=True)]),
        ((1, 1), [item("netherite_scrap", 8, (1, 2)), item("netherite_ingot", 1), item("enchanted_golden_apple", 2),
                  item("golden_apple", 8, (1, 2)), item("totem_of_undying", 2), item("diamond_block", 2), item("ender_pearl", 5, (2, 4))]),
    ],
}


def main():
    out = os.path.join(ROOT, "behavior_pack", "loot_tables", "bs")
    os.makedirs(out, exist_ok=True)
    for name, pools in TABLES.items():
        table = {"pools": [{"rolls": {"min": r[0], "max": r[1]}, "entries": entries} for r, entries in pools]}
        json.dump(table, open(os.path.join(out, name + ".json"), "w"), indent=1)
    print("loot tables:", ", ".join(TABLES))


if __name__ == "__main__":
    main()
