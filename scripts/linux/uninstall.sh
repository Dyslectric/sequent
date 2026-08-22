#!/bin/sh
#
# Remove what install.sh put down. Use the same privileges you installed with:
# run it as root to undo a system install, as yourself to undo a user one.

set -eu

APP_NAME='Sequent'
APP_ID='sequent'

if [ "$(id -u)" -eq 0 ]; then
  scope='system'
  targets="/opt/$APP_NAME
/usr/local/bin/$APP_ID
/usr/share/applications/$APP_ID.desktop"
  icon_root='/usr/share/icons/hicolor'
  desktop_dir='/usr/share/applications'
else
  scope='user'
  targets="$HOME/.local/bin/$APP_NAME
$HOME/.local/share/applications/$APP_ID.desktop"
  icon_root="$HOME/.local/share/icons/hicolor"
  desktop_dir="$HOME/.local/share/applications"
fi

echo "Removing $APP_NAME ($scope)"

printf '%s\n' "$targets" | while IFS= read -r target; do
  [ -n "$target" ] || continue
  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -rf -- "$target"
    echo "  removed $target"
  fi
done

for size in 32 128 256; do
  icon="$icon_root/${size}x${size}/apps/$APP_ID.png"
  if [ -f "$icon" ]; then
    rm -f -- "$icon"
    echo "  removed $icon"
  fi
done

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -qtf "$icon_root" >/dev/null 2>&1 || true
fi

echo
echo "Done. Saved sheets are untouched — they live in the webview profile, which"
echo "is per-user and separate from the install."

# Tauri names this directory after either the product or the bundle identifier
# depending on version, so report whichever is actually present rather than
# guessing at a path that may not exist.
found=''
for data_dir in "$HOME/.local/share/$APP_NAME" "$HOME/.local/share/dev.$APP_ID.app"; do
  if [ -d "$data_dir" ]; then
    [ -n "$found" ] || echo "Delete this to clear them:"
    echo "  $data_dir"
    found='yes'
  fi
done
[ -n "$found" ] || echo "No profile directory found under ~/.local/share."
