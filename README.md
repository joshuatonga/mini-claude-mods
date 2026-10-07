# mini-claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small plugins of
function hooks that add panes, commands and behaviors to the terminal. This
repo is also a plugin marketplace, so each mod installs with one line.

## Mods

| Mod | What it does | Install |
| --- | --- | --- |
| [model-pick](model-pick/) | `/pick`: fuzzy-search a model + effort combo, with favorites, aliases and the last 5 picks | `/plugin install model-pick --marketplace joshuatonga/mini-claude-mods` |

## Installing

Run the install line from a mod's row inside a Claude Code session. The first
time, Claude Code asks to add the `mini-claude-mods` marketplace (`y`) and for a
scope; after that, `/plugin install <mod>@mini-claude-mods` is enough.

Mods need Claude Code 2.1.292 or newer.

## Developing

```
claude --plugin-dir ./<mod>      # load one mod for a session; saves hot-reload
claude plugin validate ./<mod>   # what it hooks and calls, and anything the engine would refuse
claude plugin test ./<mod>       # its tests
```

Each mod is a folder with `.claude-plugin/plugin.json`, `hooks/hooks.json`,
the hooks module it names, and tests. `.claude-plugin/marketplace.json` at the
root lists them.
