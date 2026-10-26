#!/usr/bin/env bash
# Android CDP e2e lane: runs vitest against the Readest app installed on an
# adb-connected device or emulator. Soft-skips (exit 0) when no adb, no
# device, or no installed app is found, unless READEST_ANDROID_REQUIRE_DEVICE=true.
# Select a device with ANDROID_SERIAL when several are attached.
set -uo pipefail
cd "$(dirname "$0")/.."

PKG="${READEST_ANDROID_PACKAGE:-com.bilingify.readest}"
REQUIRE_DEVICE="${READEST_ANDROID_REQUIRE_DEVICE:-false}"

fail_or_skip() {
  echo "[test:android] $1"
  if [ "$REQUIRE_DEVICE" = "true" ]; then exit 1; fi
  exit 0
}

if ! command -v adb >/dev/null 2>&1; then
  fail_or_skip "adb not found — skipping Android e2e lane"
fi

DEVICES=$(adb devices | tail -n +2 | awk '$2 == "device" { print $1 }')
if [ -z "$DEVICES" ]; then
  fail_or_skip "no adb device/emulator connected — start an emulator before running this lane"
fi

if ! adb shell pm list packages "$PKG" 2>/dev/null | grep -q "package:$PKG"; then
  fail_or_skip "$PKG is not installed on the device — install the debug APK first"
fi

exec pnpm exec vitest run --config vitest.android.config.mts "$@"
