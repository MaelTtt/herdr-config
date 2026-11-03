#!/bin/sh
# Installs this herdr setup: Zeron theme and layout, session sidebar, Droid in the
# "Start an agent" menu, and the hc droid template. Safe to re-run.
# Existing files that differ are saved as <file>.bak first.
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
APP=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
CORE=${HERDR_CORE_HOME:-$HOME/.config/herdr-core}

put() { # put <from> <to>
  mkdir -p "$(dirname "$2")"
  if [ -e "$2" ] && ! cmp -s "$1" "$2"; then cp "$2" "$2.bak"; fi
  cp "$1" "$2"
}

for f in themes/zeron.json layouts/zeron.json layouts/zeron.svg icons/droid.svg \
         mods/zeron-sessions/main.js mods/zeron-sessions/mod.json bin/usage.py; do
  put "$SRC/herdr-app/$f" "$APP/$f"
done
chmod +x "$APP/bin/usage.py"
put "$SRC/herdr-core/templates/droid.md" "$CORE/templates/droid.md"

# settings.json and programs.json are the user's own: merge instead of replacing.
if command -v python3 >/dev/null 2>&1; then
  python3 - "$APP" "$SRC" <<'EOF'
import json, os, sys
app, src = sys.argv[1], sys.argv[2]

def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

settings = os.path.join(app, "settings.json")
s = load(settings)
s["theme"] = "zeron"
save(settings, s)

programs = os.path.join(app, "programs.json")
p = load(programs)
p.setdefault("programs", {}).update(load(os.path.join(src, "herdr-app", "programs.json"))["programs"])
save(programs, p)
EOF
else
  echo "python3 not found: copy herdr-app/programs.json to $APP and set \"theme\": \"zeron\" in $APP/settings.json by hand."
fi

# Switch the running app to the layout; harmless if herdr-app isn't open.
herdr-app do layout.switch '{"name":"zeron"}' >/dev/null 2>&1 || true

echo "Installed. In herdr-app, press Ctrl+Shift+L if the Zeron layout isn't showing."
