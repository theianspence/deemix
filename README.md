# Deemix (multi-user, proxy-auth fork)

A self-hosted, **multi-user** Deemix that runs **behind a reverse proxy** for
authentication and keeps a **global download history**. Forked from
[bambanah/deemix](https://github.com/bambanah/deemix) (originally by the very
talented [RemixDev](https://gitlab.com/RemixDev)).

What this fork changes:

- **Proxy-header authentication** — identity is delegated entirely to a reverse
  proxy (Authentik / Authelia / Traefik Forward Auth / Caddy). There is no
  in-app login. Every request must carry a trusted user header or it gets a 401.
- **One shared Deezer account** — admins configure a single ARL; every user
  searches and downloads through it.
- **Global download history** (SQLite) — every track download is recorded with
  the requesting user, and an "already downloaded / missing" indicator is shown
  across search and album/playlist views.
- **Two tiers** — admins (a configurable group) manage the ARL/config and see
  stats; standard users search, download, view history, and delete their own
  history entries.
- **Docker-only**, SQLite-only deployment. The Electron `gui` package has been
  removed.

### Packages in this repo

- **deezer-sdk** — wrapper for Deezer's [API](https://developers.deezer.com/api)
- **deemix** — the download engine (unchanged by this fork)
- **webui** — [Vue.js](https://vuejs.org/) + [Express](https://expressjs.com/)
  web interface (all fork changes live here)

## Authentication

The app trusts identity headers injected by an upstream proxy on **every**
request and attaches `req.user = { username, groups, name, isAdmin }`. If the
configured user header is missing, the request is rejected with `401` — the app
is never meant to be reachable without the proxy in front of it.

Header names and the admin group are configurable:

| Env var             | Purpose                                 | Default         |
| ------------------- | --------------------------------------- | --------------- |
| `AUTH_USER_HEADER`  | Header with the authenticated username  | `Remote-User`   |
| `AUTH_GROUP_HEADER` | Header with comma/pipe-separated groups | `Remote-Groups` |
| `AUTH_NAME_HEADER`  | Header with the display name (optional) | `Remote-Name`   |
| `ADMIN_GROUP`       | Group whose members are admins          | `admins`        |

A user is an **admin** when `ADMIN_GROUP` appears in their groups header.

> **Local / no-proxy use:** set `DEEMIX_SINGLE_USER=true` to bypass header auth
> and run as a single local admin (also how `pnpm dev` and the test suite run).
> In production keep `DEEMIX_SINGLE_USER=false` so the proxy is enforced.

### User tiers

- **Admin** — manage the shared Deezer ARL and all app config, view system stats
  (total downloads, per-user counts, download-dir disk usage), delete any
  history entry.
- **Standard user** — search the catalog, download albums, view the global
  library, delete only their own entries.

### Download permissions

Downloads are scoped by type:

- **Albums** — any authenticated user.
- **Individual tracks** — admins, plus members of `TRACK_DOWNLOAD_GROUP`.
- **Playlists** — admins, plus members of `PLAYLIST_DOWNLOAD_GROUP`.
- **Whole-artist / discography** — admins, plus members of
  `DISCOGRAPHY_DOWNLOAD_GROUP`.

With the groups unset (the default), only admins can download tracks, playlists,
and discographies; everyone else is albums-only. The UI hides the download
controls a user isn't permitted to use, and the server rejects them as a
backstop.

## Library & indicators

Every completed download writes one SQLite row **per track** (Deezer id, title,
artist, album, type, file path, timestamp, `requested_by`, success/failed) to
`DEEMIX_DB_PATH` (default `/config/history.db`).

- The **Library** page (all users) presents those tracks **grouped into albums**
  (and playlists / singles) — a cover-art grid with an aggregate status
  (Downloaded / Partial / Missing), track count and requester. Click an album to
  see its tracks. Management is album-level: you can remove your own albums from
  the library, admins can remove any. Removing an album only deletes the history
  rows — the files on disk are kept.
- **"Already downloaded" indicator** — on search results and album/track views a
  badge shows **Downloaded** (a success row exists _and_ the recorded file is
  still on disk) or **Missing** (success row exists but the file is gone). The
  Deezer track id is the cross-reference key, not the filename or tags.

> The history DB uses SQLite's rollback journal (not WAL) on purpose: `/config`
> is typically a bind mount, and WAL's shared-memory coordination is unreliable
> over Docker Desktop bind mounts (a fresh connection can read zero rows). The
> rollback journal persists reliably on every filesystem.

## Deployment (Docker Compose)

```bash
# from the repo root
docker compose up -d --build
```

The provided [`docker-compose.yml`](./docker-compose.yml) defines a single
`deemix` service (no Redis, no Postgres — SQLite only), mounts `./downloads` and
`./config`, and is **not** published to the host: route your reverse proxy to
`deemix:6595` on a shared Docker network.

### Environment variables

| Variable                     | Description                              | Default              |
| ---------------------------- | ---------------------------------------- | -------------------- |
| `DEEMIX_SINGLE_USER`         | Bypass proxy auth as a local admin       | `false`              |
| `ADMIN_GROUP`                | Group granting admin                     | `admins`             |
| `DEEMIX_DB_PATH`             | SQLite history DB path                   | `/config/history.db` |
| `AUTH_USER_HEADER`           | Username header                          | `Remote-User`        |
| `AUTH_GROUP_HEADER`          | Groups header                            | `Remote-Groups`      |
| `AUTH_NAME_HEADER`           | Display-name header                      | `Remote-Name`        |
| `TRACK_DOWNLOAD_GROUP`       | Group allowed to download tracks         | _(admins only)_      |
| `PLAYLIST_DOWNLOAD_GROUP`    | Group allowed to download playlists      | _(admins only)_      |
| `DISCOGRAPHY_DOWNLOAD_GROUP` | Group allowed to download discographies  | _(admins only)_      |
| `FAVORITES_GROUP`            | Group allowed to view the Favorites page | _(everyone)_         |
| `CHARTS_GROUP`               | Group allowed to view the Charts page    | _(everyone)_         |
| `DEEMIX_MUSIC_DIR`           | Download directory                       | `/downloads`         |
| `DEEMIX_DATA_DIR`            | Config directory                         | `/config`            |
| `DEEMIX_SERVER_PORT`         | Listen port                              | `6595`               |
| `PUID` / `PGID`              | UID/GID for downloaded files             | `1000` / `1000`      |

## Reverse proxy examples

deemix only needs the proxy to (a) authenticate the user and (b) forward the
identity headers upstream. The defaults match **Authelia** out of the box; other
providers just need the header names pointed at theirs.

### Authelia (via Traefik forward-auth)

Authelia returns `Remote-User`, `Remote-Groups`, `Remote-Name` — the deemix
defaults. Configure the Traefik middleware to copy them upstream:

```yaml
http:
  middlewares:
    authelia:
      forwardAuth:
        address: "http://authelia:9091/api/authz/forward-auth"
        authResponseHeaders:
          - "Remote-User"
          - "Remote-Groups"
          - "Remote-Name"
          - "Remote-Email"
  routers:
    deemix:
      rule: "Host(`deemix.example.com`)"
      service: deemix
      middlewares: ["authelia"]
```

No deemix env changes needed. Put users in a `admins` group (or set
`ADMIN_GROUP`) to grant admin.

### Authentik (Proxy Provider / forward auth)

Authentik forwards `X-authentik-username`, `X-authentik-groups` (pipe-separated),
and `X-authentik-name`. Point deemix at them:

```yaml
environment:
  AUTH_USER_HEADER: "X-authentik-username"
  AUTH_GROUP_HEADER: "X-authentik-groups"
  AUTH_NAME_HEADER: "X-authentik-name"
  ADMIN_GROUP: "admins"
```

Create an `admins` group in Authentik and add your admins to it.

### Traefik Forward Auth (Authelia) / Caddy

Any forward-auth provider works as long as it injects a username header (and,
for admin support, a groups header). For nginx `auth_request`, copy the headers
with `auth_request_set` + `proxy_set_header`; for Caddy's `forward_auth`, use
`copy_headers Remote-User Remote-Groups Remote-Name`. Set `AUTH_USER_HEADER` /
`AUTH_GROUP_HEADER` / `AUTH_NAME_HEADER` to whatever your provider emits.

## Developing

This repo uses [pnpm](https://pnpm.io/) and
[Turborepo](https://turbo.build/repo/docs).

```bash
corepack enable          # enable pnpm
pnpm install             # install deps (also regenerates the lockfile)
DEEMIX_SINGLE_USER=true pnpm dev   # dev server on :6595, auth bypassed as admin
```

Useful checks:

```bash
pnpm --filter deemix-webui type-check
pnpm --filter deemix-webui test
pnpm --filter deemix-webui build
```

> **Native dependency note:** this fork adds `better-sqlite3` for the history DB.
> It ships prebuilt binaries (fine on Windows/macOS/glibc Linux); on Alpine
> (musl) the Docker image compiles it using the `python3`/`make`/`g++` already
> installed in the builder stage.

### Building the Docker image

```bash
docker build -t deemix .
```
