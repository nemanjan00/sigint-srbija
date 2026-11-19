# MCP server

The map also speaks [MCP](https://modelcontextprotocol.io), so an AI assistant
can search the database directly. It is public, read-only and needs no key.

```
https://sigint.nemanja.top/mcp
```

Transport: Streamable HTTP (stateless, JSON responses).

## Add it to your client

**Claude Code**

```sh
claude mcp add --transport http sigint-srbija https://sigint.nemanja.top/mcp
```

Add `--scope user` to have it in every project, not just the current one.

**Codex CLI**

```sh
codex mcp add sigint-srbija --url https://sigint.nemanja.top/mcp
```

**VS Code (Copilot agent mode)**

```sh
code --add-mcp '{"name":"sigint-srbija","type":"http","url":"https://sigint.nemanja.top/mcp"}'
```

**Cursor** — `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sigint-srbija": {
      "url": "https://sigint.nemanja.top/mcp"
    }
  }
}
```

**Claude Desktop / claude.ai** — Settings → Connectors → Add custom connector,
URL `https://sigint.nemanja.top/mcp`.

**Clients that only run local (stdio) servers** — bridge with
[mcp-remote](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "sigint-srbija": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://sigint.nemanja.top/mcp"]
    }
  }
}
```

**Check it from a shell**

```sh
curl -s https://sigint.nemanja.top/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_frequency","arguments":{"mhz":145.6,"limit":3}}}'
```

## Tools

| tool | what it does |
|---|---|
| `search_emitters` | Text (callsign, DMR ID, holder, site, city), frequency range (`min_mhz` / `max_mhz`, matches TX or RX), area (`near: {lat, lon, radius_km}`, nearest first) and filters: kind, source, sector, owner, station / service type. |
| `find_frequency` | Everything transmitting or receiving on `mhz` ± `tolerance_khz` (default 12.5), closest frequency first. For identifying a signal heard on a scanner or SDR. |
| `get_emitter` | Full record by map `url` or `source` + `key`: source record, other sources' listings of the same station, and for licences the register entry and every assignment on the licence. |
| `database_info` | Sources and fetch times, counts by kind / source / sector, station and service type code tables. |

Every result includes `url`, a link to the item on the map.

Filters shared by `search_emitters` and `find_frequency`: `kinds`
(`repeater`, `digipeater`, `beacon`, `licence`), `sources`, `sectors`,
`owner` (`public`, `private`, `amateur`), `station_types`, `service_types`,
`include_expired`, `include_duplicates`, `limit` (max 200), `offset`.

## Things to ask

- "What is transmitting on 145.600 MHz?"
- "List the 70 cm repeaters within 30 km of Kragujevac."
- "Which ambulance services have radio licences in Novi Sad, and on what frequencies?"
- "Show G4S's base stations in Belgrade."
- "What's licensed on Avala tower?"

## Good to know

- Text matches substrings of text folded to lowercase Latin without
  diacritics, so Cyrillic and Latin both work. Serbian words are inflected:
  search by stem (`hitn` finds *hitna* and *hitnu*).
- Police and military are not in RATEL's public register, and the register has
  no modulation data.
- Licence sector and public/private owner are guessed from the holder's name.
- Positions are WGS 84; `position_source` and `accuracy_m` say how a position
  was obtained and how precise it is.

Self-hosted: the server is at `/mcp` on any instance (`yarn web`); set
`PUBLIC_URL` if links in results should use a different base URL than the
request's host.
