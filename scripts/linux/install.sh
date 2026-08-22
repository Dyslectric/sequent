#!/bin/sh
#
# Install Sequent from the extracted tarball.
#
# Run as root for a system-wide install, or as yourself for a per-user one:
#
#   sudo ./install.sh      -> /opt/Sequent, /usr/share/applications
#   ./install.sh           -> ~/.local/bin/Sequent, ~/.local/share/applications
#
# POSIX sh on purpose: a minimal container may not have bash.

set -eu

APP_NAME='Sequent'
APP_ID='sequent'
COMMENT='A math sheet that decides whether each line is true'

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
binary="$here/$APP_ID"

if [ ! -f "$binary" ]; then
  echo "install.sh: cannot find $APP_ID next to this script" >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  scope='system'
  # /opt holds the payload; the launcher goes somewhere already on PATH.
  app_dir="/opt/$APP_NAME"
  exec_path="$app_dir/$APP_ID"
  link_path="/usr/local/bin/$APP_ID"
  desktop_dir='/usr/share/applications'
  icon_root='/usr/share/icons/hicolor'
else
  scope='user'
  # ~/.local/bin is already on PATH on any freedesktop system, so the binary
  # itself lives there and needs no launcher alongside it.
  app_dir="$HOME/.local/bin"
  exec_path="$app_dir/$APP_NAME"
  link_path=''
  desktop_dir="$HOME/.local/share/applications"
  icon_root="$HOME/.local/share/icons/hicolor"
fi

echo "Installing $APP_NAME ($scope)"

install -d "$app_dir" "$desktop_dir"
install -m 755 "$binary" "$exec_path"
echo "  binary        $exec_path"

if [ -n "$link_path" ]; then
  install -d "$(dirname -- "$link_path")"
  ln -sf "$exec_path" "$link_path"
  echo "  command       $link_path"
fi

# Icons go into the hicolor theme so `Icon=sequent` resolves by name rather
# than by an absolute path that would break if the app is ever moved.
for size in 32 128 256; do
  source_icon="$here/icons/${size}x${size}.png"
  [ -f "$source_icon" ] || continue
  target_dir="$icon_root/${size}x${size}/apps"
  install -d "$target_dir"
  install -m 644 "$source_icon" "$target_dir/$APP_ID.png"
done
echo "  icons         $icon_root/*/apps/$APP_ID.png"

desktop_file="$desktop_dir/$APP_ID.desktop"
cat > "$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME
Comment=$COMMENT
Exec=$exec_path %U
Icon=$APP_ID
Terminal=false
Categories=Education;Science;Math;
Keywords=math;algebra;logic;proof;calculator;
StartupNotify=true
StartupWMClass=$APP_NAME
EOF
chmod 644 "$desktop_file"
echo "  desktop entry $desktop_file"

# Best effort: without these the entry still works, it just may not appear in
# the launcher until the next login.
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -qtf "$icon_root" >/dev/null 2>&1 || true
fi

echo
echo "Done. Launch it from your applications menu, or run:"
if [ -n "$link_path" ]; then
  echo "  $APP_ID"
else
  echo "  $exec_path"
  case ":${PATH}:" in
    *":$app_dir:"*) ;;
    *) echo
       echo "Note: $app_dir is not on your PATH, so the bare command will not"
       echo "work until you add it. The menu entry is unaffected." ;;
  esac
fi
echo
echo "Sequent needs a WebKitGTK runtime (libwebkit2gtk-4.1-0 or your"
echo "distribution's equivalent). Uninstall with ./uninstall.sh."
