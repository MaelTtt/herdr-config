# herdr-config

My herdr setup, styled after the Zeron app.

- **Theme** `zeron`: near-black surfaces, violet accent (`#8b7cf6`).
- **Layout** `zeron`: flat borderless content area, slim sidebar and bars.
- **Sidebar mod** `zeron-sessions`: projects as foldable groups, each tab a session row
  (`project @ host`, age, title, git branch).
- **Droid** in herdr-app's "Start an agent" menu, with the Factory logo.
- **hc template** `droid` (`hc run --bg droid "<task>"`).

## Install

```sh
git clone <this repo> ~/herdr-config
sh ~/herdr-config/install.sh
```

The script copies files into `~/.config/herdr-app` and `~/.config/herdr-core`
(`HERDR_APP_HOME` and `HERDR_CORE_HOME` override those). Files it would change are saved
as `*.bak`. `settings.json` and `programs.json` are merged, not replaced: it only sets
`"theme": "zeron"` and adds the `droid` program entry.

## Notes

- Needs `droid` on the PATH for the menu entry to show as installed.
- `icons/droid.svg` is derived from Factory's logo.
- The `zeron-sessions` mod reads the terminal's hostname with `hostname`.
- To go back to the stock look, switch layout with `Ctrl+Shift+L` and pick another theme in Settings.
