#!/usr/bin/env bash
# Install our build into the official Chatbox install path on this machine.
# Reads xyz.chatboxapp.app userData (your real chats), version stays 0.0.1.
#
# Prereq: a successful `UPDATE_CHANNEL=latest pnpm exec electron-builder build --publish never`
#         run left release/build/win-unpacked/ populated.
#
# WARNING: electron-builder's installAppDeps will clobber the *root* package.json
# down to 17 lines. After running it, ALWAYS:
#   git diff package.json
#   git checkout HEAD -- package.json   # if it changed
# release/app/package.json is the one that should change (productName etc).
set -euo pipefail

INSTALL="/c/Users/Laptop/AppData/Local/Programs/Chatbox"
BUILD="$(git rev-parse --show-toplevel)/release/build/win-unpacked"

if [ ! -f "$BUILD/Chatbox.exe" ]; then
  echo "ERROR: $BUILD/Chatbox.exe missing — run electron-builder first."
  exit 1
fi

# Refuse to clobber a running app.
if tasklist 2>/dev/null | grep -qi 'Chatbox.exe'; then
  echo "ERROR: Chatbox is running. Quit it (and the tray icon) first."
  exit 1
fi

# Snapshot ASAR before replacing — keep last 3.
RES="$INSTALL/resources"
TS=$(date +%Y%m%d-%H%M%S)
cp "$RES/app.asar" "$RES/app.asar.bak-$TS"
ls -t "$RES"/app.asar.bak-* 2>/dev/null | tail -n +4 | xargs -r rm

# Copy new asar over.
cp "$BUILD/resources/app.asar" "$RES/app.asar"
[ -d "$BUILD/resources/app.asar.unpacked" ] && \
  rsync -a --delete "$BUILD/resources/app.asar.unpacked/" "$RES/app.asar.unpacked/"

echo "OK — installed asar at $RES/app.asar (backup: app.asar.bak-$TS)"
