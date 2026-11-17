#!/bin/sh
# Run all three lab worlds back to back. Takes about twelve minutes.
#   tools/labs.sh <out dir>
cd "$(dirname "$0")/.." || exit 1
OUT="$1"; [ -n "$OUT" ] || { echo "usage: labs.sh <out dir>"; exit 1; }
run() { python3 tools/make_world.py "$1" && tools/drive.sh test/autorun_lab.js "$OUT/$1" "$2" "$3" 2>&1 | /usr/bin/grep -v Killed; }
if [ "$2" = "round2" ]; then
  # Loot tables rolled in the game, then automatic placement on natural terrain
  # in the normal-terrain test world.
  run sand 40 "loot"
  python3 tools/make_world.py --touch "ngMDaG6Px-U=" && tools/drive.sh test/autorun_lab.js "$OUT/natural" 125 "autotour" 2>&1 | /usr/bin/grep -v Killed
elif [ "$2" = "recheck" ]; then
  run sand 60 "catalog desert;auto"
  run grass 130 "villages;auto"
else
  run sand 85 "catalog desert;clusters desert;auto"
  run red_sand 70 "catalog badlands;clusters badlands"
  run grass 130 "villages;auto"
fi
echo "ALL LABS DONE"
