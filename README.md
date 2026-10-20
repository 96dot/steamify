# Steamify

A [Millennium](https://steambrew.app) plugin that makes non-Steam games in your Steam library look like official Steam games.

Steamify matches each non-Steam shortcut to its Steam store page and copies the official name, library artwork, icon and store details onto it. For games that aren't on Steam (console games, emulated games, older PC releases), it uses Wikipedia and Wikidata instead, and can optionally use SteamGridDB for artwork.

## Features

**Games on Steam**
- Official name (for example "Dragon Age" becomes "Dragon Age: Origins - Ultimate Edition").
- Library artwork: cover, hero, logo and wide capsule. The logo uses the same placement as the official page.
- The official game icon.
- A store info panel on the game page, built from Steam's own styles: box art, description, developer, publisher, release date and features.
- A links bar: Store Page, DLC, Community Hub, Discussions and Guides.

**Games not on Steam**
- Description, developer, publisher, release date, platforms and game modes from Wikipedia and Wikidata. No account or key is needed.
- Box art from Wikipedia, used when it is portrait-shaped.
- Optional: high-resolution cover, hero, logo and icon from [SteamGridDB](https://www.steamgriddb.com) once you add a free API key.
- Links to Wikipedia, PCGamingWiki, IGDB, the official site and SteamGridDB, when they exist.

**Everything is reversible**
- Before Steamify changes anything, it backs up your existing custom artwork and icon.
- **Unlink** restores the original artwork, icon and name.

**Auto-match**
- On startup, new shortcuts are linked when their name clearly matches a store game. Edition suffixes such as "GOTY" or "Ultimate Edition" still count as a match.
- Shortcuts with no store match are then looked up on Wikipedia. Only articles that Wikipedia describes as a game are linked automatically.
- Anything else can be linked by hand from the search dialog.

## Install

1. Install [Millennium](https://steambrew.app) (v3.6 or newer).
2. Download `steamify.star` from the [latest release](../../releases/latest).
3. Copy it to `<Steam>\millennium\plugins\`.
4. Restart Steam, then enable **Steamify** under *Steam → Millennium → Plugins*.

## Usage

- **Game page:** open a non-Steam game in your library.
  - Linked games show the info panel and a links bar.
  - Unlinked games show a single link that opens the search dialog.
  - **Steamify…** in the links bar opens the dialog for a game that is already linked.
- **Search dialog:**
  - Search the **Steam store** or **Wikipedia**. You can also enter a Steam AppID directly.
  - **Don't link this game** stops auto-match from touching that shortcut.
- **Settings:** *Millennium → Plugins → Steamify → Configure*.
  - Toggle each kind of change (name, artwork, icon, info panel, auto-link, Wikipedia).
  - Set a SteamGridDB key.
  - Run auto-match on demand.
  - Change, re-apply or unlink each non-Steam game.

### SteamGridDB key (optional)

1. Sign in at steamgriddb.com.
2. Open *Preferences → API* and copy your key.
3. Paste it into the **SteamGridDB API key** field in Steamify's settings.
4. Press **Re-apply** on games that are linked to Wikipedia.

The key is stored in Millennium's plugin config on your PC. It is only sent to steamgriddb.com.

## Where things are stored

| What | Where |
| --- | --- |
| Links and settings | Millennium plugin config (`steamify`) |
| Metadata cache (7 days) | `<Steam>\millennium\data\steamify\store-cache.json` |
| Backups of your original artwork | `<Steam>\millennium\data\steamify\backup\<shortcut id>\` |
| Downloaded icons | `<Steam>\userdata\<account>\config\grid\steamify_<shortcut id>_icon.*` |
| Log | `<Steam>\millennium\data\steamify\steamify.log` |

Artwork is set through Steam's own custom-artwork API, so it lands in the usual `grid` folder.

## Data sources

| Source | Used for |
| --- | --- |
| `store.steampowered.com` | Store search and app details |
| `api.steamcmd.net` | Steam's library asset paths and logo placement (a mirror of the client's app info) |
| `shared.steamstatic.com` | Steam artwork and icons |
| `en.wikipedia.org`, `www.wikidata.org` | Data for games that aren't on Steam |
| `www.steamgriddb.com` | Artwork, only when you have set a key |

## Building from source

Requires [Bun](https://bun.sh) (or Node) and Millennium installed.

```bash
bun install
./node_modules/.bin/starlight pack --release -o dist
```

The plain `starlight pack` command writes a debug build straight into your Millennium plugins folder.

To type-check, run `pack` first, because it generates the backend typings:

```bash
bun ./node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json
```

### Layout

**Backend** (`backend/`, LuaJIT)

| File | Contents |
| --- | --- |
| `main.lua` | Plugin entry point |
| `store.lua` | Steam store and app info lookups |
| `wiki.lua` | Wikidata, Wikipedia and SteamGridDB |
| `storage.lua` | Links, settings and backups |
| `net.lua` | HTTP helpers |
| `base64.lua` | Binary-safe base64 |
| `paths.lua` | File locations |

**Frontend** (`frontend/`, TypeScript and React)

| File | Contents |
| --- | --- |
| `index.tsx` | Plugin entry point |
| `linker.ts` | Applies a link, unlinks and auto-matches |
| `gamepage.ts` | Injects the game page info panel and links bar |
| `components.tsx` | Settings panel and search dialog |
| `matching.ts` | Name matching |
| `api.ts` | Backend calls and image downloads |

### Notes on the Millennium APIs

- Lua's `http` module (and `utils.base64_encode`) cut binary data at the first NUL byte.
  - Images are downloaded in the frontend, where Steam's and Wikimedia's CDNs allow cross-origin requests.
  - Otherwise the backend saves them to a file with Windows' `URLDownloadToFile` via LuaJIT FFI.
  - Base64 is done in pure Lua.
- Use `require("json")` for cjson. `require("cjson")` fails.
- Millennium's IPC may already have decoded JSON strings returned by `---@ffi` functions, so the frontend accepts either form.
- Shortcut appids are larger than 2³¹. Format them with `%.0f`, not `%d`.

## License

MIT
