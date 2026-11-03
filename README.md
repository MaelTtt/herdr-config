# herdr-config

My herdr setup, styled after the Zeron app.

- **Theme** `zeron`: near-black surfaces, violet accent (`#8b7cf6`).
- **Layout** `zeron`: flat borderless content area, slim sidebar and bars.
- **Sidebar mod** `zeron-sessions`: projects as foldable groups, each tab a session row
  (`project @ host`, age, title, git branch).
- **Droid** in herdr-app's "Start an agent" menu, with the Factory logo.
- **hc template** `droid` (`hc run --bg droid "<task>"`).

- **Usage readout** at the bottom of the sidebar (`bin/usage.py`): Claude 5h and weekly limits,
  and Droid's 5h, weekly and monthly limits. Cached, refreshed every 5 minutes.

## Usage setup

- **Claude**: nothing to do if you're signed in. It reads the OAuth token from
  `~/.cli-proxy-api/claude-*.json` or `~/.claude/.credentials.json`, only to ask Anthropic for
  your own usage. It never refreshes, prints or stores the token.
- **Droid**: create an API key at <https://app.factory.ai/settings/api-keys> and put it in
  `~/.config/herdr-app/secrets/factory-api-key` (mode 600) or in `$FACTORY_API_KEY`. Keep it out of this repo.
- The Claude endpoint (`/api/oauth/usage`) is undocumented and rate limited, so the script
  backs off on errors and shows the last good numbers as "stale".

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
