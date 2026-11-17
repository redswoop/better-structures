#!/bin/sh
# Copy the pack into the Mac dev packs. Refuses while the game is running.
cd "$(dirname "$0")" || exit 1
if pgrep -f mcpelauncher-client >/dev/null; then echo "The game is running; close it first."; exit 1; fi
./build.sh || exit 1
M="$HOME/Library/Application Support/mcpelauncher/games/com.mojang"
rsync -a --delete behavior_pack/ "$M/development_behavior_packs/BetterStructures/" && echo "installed to dev packs"
