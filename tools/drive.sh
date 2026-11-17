#!/bin/sh
# Launch the game, open the most recently played world, and capture only the
# game window while a test autopilot (copied into the INSTALLED pack, never the
# repo's) drives it. Uses the mouse to click through the menu, so only run it
# with Armen's OK and while nobody is using the Mac. Then quits and puts the
# clean pack and game options back.
#   tools/drive.sh <autorun script> <out dir> [frames, one every 3 s] [scenario]
# The scenario string is for test/autorun_lab.js, e.g. "catalog desert;clusters desert".
# The game opens the world played last: run tools/make_world.py first to pick one.
cd "$(dirname "$0")/.." || exit 1
AUTO="$1"; OUT="$2"; FRAMES="${3:-60}"; SCENARIO="$4"
[ -f "$AUTO" ] && [ -n "$OUT" ] || { echo "usage: drive.sh <autorun script> <out dir> [frames]"; exit 1; }
A="$HOME/Library/Application Support/mcpelauncher"; M="$A/games/com.mojang"
BIN="/Applications/Minecraft Bedrock Launcher.app/Contents/MacOS/mcpelauncher-client"
if pgrep -f mcpelauncher-client >/dev/null; then echo "The game is running; not touching it."; exit 1; fi
/bin/mkdir -p "$OUT"
WINPOS="$OUT/winpos"
swiftc -O tools/winpos.swift -o "$WINPOS" 2>/dev/null || { echo "couldn't build the window finder"; exit 1; }
nap() { python3 -c "import time; time.sleep($1)"; }
size() { /usr/bin/stat -f %z "$1" 2>/dev/null || echo 0; }
OPTS="$M/minecraftpe/options.txt"; /bin/cp -f "$OPTS" "$OUT/options.backup.txt"
cleanup() {
  pkill -f mcpelauncher-client 2>/dev/null; i=0
  while pgrep -f mcpelauncher-client >/dev/null && [ $i -lt 15 ]; do nap 1; i=$((i+1)); done
  pkill -9 -f mcpelauncher-client 2>/dev/null; nap 1
  /bin/cp -f "$OUT/options.backup.txt" "$OPTS"
  ./install.sh >/dev/null && echo "game closed, clean pack reinstalled, options restored"
}
./install.sh >/dev/null || exit 1
INST="$M/development_behavior_packs/BetterStructures/scripts"
printf 'export const SCENARIO = "%s";\n' "$SCENARIO" > "$INST/autorun_scenario.js"
/bin/cp -f "$AUTO" "$INST/autorun.js" && printf '\nimport "./autorun.js";\n' >> "$INST/main.js"
VER=$(/bin/ls "$A/versions" | /usr/bin/grep -E '^[0-9]' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1)
MODS=$(/bin/ls -d "$A/mods/mcpelauncher-updates"/*/arm64-v8a/ | tail -1)
nohup "$BIN" -dg "$A/versions/$VER" -dd "$A" -m "$MODS" -ww 1280 -wh 720 > "$OUT/client.log" 2>&1 &
i=0; while [ -z "$("$WINPOS")" ] && [ $i -lt 60 ]; do nap 1; i=$((i+1)); done
nap 22
set -- $("$WINPOS"); ID=$1; PID=$2; X=$3; Y=$4
[ -n "$ID" ] || { echo "no game window"; cleanup; exit 1; }
osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $PID) to true" >/dev/null 2>&1
nap 2; cliclick c:$((X+640)),$((Y+12)); nap 1          # the first click only focuses the window
try=0
while [ $try -lt 3 ]; do                                 # Play, until the (much smaller) world list shows
  cliclick c:$((X+640)),$((Y+372)); nap 4
  screencapture -x -o -t jpg -l "$ID" "$OUT/menu.jpg"
  [ "$(size "$OUT/menu.jpg")" -lt 550000 ] && break
  try=$((try+1))
done
[ "$(size "$OUT/menu.jpg")" -lt 550000 ] || { echo "couldn't get past the main menu (see $OUT/menu.jpg)"; cleanup; exit 1; }
cliclick c:$((X+576)),$((Y+314))                          # the top world: the one played last
n=0
while [ $n -lt "$FRAMES" ] && pgrep -f mcpelauncher-client >/dev/null; do
  nap 3; n=$((n+1)); screencapture -x -o -t jpg -l "$ID" "$OUT/$(printf 'f%03d' $n).jpg" 2>/dev/null
done
echo "captured $n frames in $OUT"
cleanup
