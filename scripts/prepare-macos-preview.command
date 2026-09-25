#!/bin/bash
set -euo pipefail

# Operates only on OKNote.app next to this script. No global Gatekeeper changes.
preview_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
preview_app="$preview_dir/OKNote.app"
preview_entitlements="$preview_dir/preview-entitlements.plist"
if [[ "$(uname -s)" != "Darwin" || ! -d "$preview_app" ]]; then
  printf '%s\n' 'Please run on macOS with this script beside the extracted OKNote.app.'
  exit 1
fi
if [[ ! -f "$preview_entitlements" ]]; then
  printf '%s\n' 'Missing preview-entitlements.plist; keep all extracted preview files together.'
  exit 1
fi
if [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$preview_app/Contents/Info.plist")" != 'com.oknote.app' ]]; then
  printf '%s\n' 'Unexpected application identifier; no changes made.'
  exit 1
fi
printf '%s\n' 'This is an unsigned OKNote test build, not an Apple-notarized release.'
printf '%s\n' 'This script will ad-hoc sign this app and remove its download quarantine attribute only.'
printf 'Prepare this local test copy? [y/N] '
read -r preview_answer
if [[ "$preview_answer" != 'y' && "$preview_answer" != 'Y' ]]; then exit 0; fi
# Sign nested code inside out. App processes need V8 JIT permission on Apple
# Silicon; libraries and frameworks do not receive application entitlements.
while IFS= read -r -d '' preview_binary; do
  if /usr/bin/file -b "$preview_binary" | /usr/bin/grep -q 'Mach-O'; then
    /usr/bin/codesign --force --sign - "$preview_binary"
  fi
done < <(/usr/bin/find "$preview_app/Contents/Frameworks" -type f -print0)
while IFS= read -r -d '' preview_bundle; do
  if [[ "$preview_bundle" == *.app ]]; then
    /usr/bin/codesign --force --sign - --entitlements "$preview_entitlements" "$preview_bundle"
  else
    /usr/bin/codesign --force --sign - "$preview_bundle"
  fi
done < <(/usr/bin/find "$preview_app/Contents/Frameworks" -depth -type d \( -name '*.framework' -o -name '*.app' \) -print0)
/usr/bin/codesign --force --sign - --entitlements "$preview_entitlements" "$preview_app"
/usr/bin/codesign --verify --deep --strict "$preview_app"
if /usr/bin/xattr -p com.apple.quarantine "$preview_app" >/dev/null 2>&1; then
  /usr/bin/xattr -dr com.apple.quarantine "$preview_app"
fi
printf '%s\n' 'Prepared. Move OKNote.app to Applications, then open it. No system-wide security settings changed.'
