# Self-hosting memoriam

Sync is optional, and needs a server only to connect storage. Everything here runs on your own
Cloudflare account: one Worker serves the app and `/api`, and a D1 database holds the connections.
`apps/api/wrangler.toml` carries placeholders, and `.dev.vars.example` lists every key.

The Worker connects an account through OAuth, keeps its refresh token encrypted, and mints access
tokens for the devices connected to it. It never sees a passage: those go straight from the browser
to the storage provider. It is the shared kit's server behind this app's own entry
(`docs/ARCHITECTURE.md` §10, "The server"), which runs none of the kit's change relay, connect gate
or entitlement policy, and no WebDAV: every device connected to an account may sync.

Budget about fifteen minutes, plus however long the provider app registration takes. Dropbox is
minutes; Google is the longest.

> **Run every command below from the repository root.** `wrangler` is a dependency of `apps/api`
> and not of the root, which is why the commands reach it as
> `pnpm --filter @memoriam/api exec wrangler` rather than by changing directory. Running
> `pnpm run deploy` from inside `apps/api` gets that package's own `deploy`, which does not build
> the app first. `deploy` is also one of pnpm's own commands, so the `run` is required.

## What you need

- A **Cloudflare account**. Workers Free is enough for personal use; see [Cost](#cost) before
  running an instance for other people.
- **Node 22.13 or later and pnpm 10** (`corepack enable`).
- **An app registration at each storage provider you want to offer**, named "memoriam". Every
  OAuth provider needs its own, which is why `ENABLED_PROVIDERS` defaults to `dropbox` alone.
- A **domain** on Cloudflare, if you want something other than
  `<worker>.<subdomain>.workers.dev`.

## 1. Clone and configure

```bash
git clone <this repository's URL> memoriam
cd memoriam
pnpm install
cp .dev.vars.example apps/api/.dev.vars
```

Fill in `apps/api/.dev.vars`. `.dev.vars.example` documents every key, including the exact
redirect URI, scopes and account types each provider wants.

- **`ENABLED_PROVIDERS`** is any of `dropbox`, `onedrive` and `gdrive`, comma-separated. Listing a
  provider commits the deployment to having its credentials: the Worker **refuses to boot**
  without them, rather than starting up and failing at the first connect.
- **`SECRETS_KEY`** is 32 random bytes, base64: `openssl rand -base64 32`. A value that does not
  decode to exactly 32 bytes is refused at boot.

## 2. Register the provider apps

The full instructions for each are in [`.dev.vars.example`](../.dev.vars.example), next to the
keys they fill in. In summary:

| Provider | Where | The thing people get wrong |
|---|---|---|
| **Dropbox** | App Console → Scoped access, App folder | The app name is **permanent** and must be `memoriam` |
| **OneDrive** | Entra app registration | The display name must be `memoriam`, and the platform **Web**, not SPA: the exchange happens on the server, with the secret |
| **Google Drive** | Cloud console → OAuth client, Web application | Testing status caps you at 100 test users and expires refresh tokens after 7 days |

The names matter. Dropbox and OneDrive name the app folder in the user's storage after the app,
and memoriam looks for its library in a folder called `memoriam`.

Each redirect URI is `<APP_ORIGIN>/api/auth/connect/<provider>/callback`, so they all change when
you move from `http://localhost:5173` to your real domain. Register both if you want to keep
developing against the same app.

### Google Drive, in more detail

- **Use a Cloud project of its own.** Disconnecting revokes the grant at Google, and Google's
  revoke takes every scope the user granted to the whole project, from every client in it.
- **Consent screen.** App name "memoriam". Scopes `openid`, `email` and
  `https://www.googleapis.com/auth/drive.file`. `drive.file` reaches only files the app made, and
  is not a sensitive scope.
- **The Drive API** has to be enabled in the project.
- **Leaving Testing.** While the app is in Testing, only listed test users can connect, and every
  refresh token expires after 7 days: each device is asked to connect again once a week. Publish
  the app to production to lift both. With only non-sensitive scopes, publishing needs no
  verification; brand verification only puts the app's name and logo on the consent screen.

## 3. Run it locally first

```bash
pnpm db:migrate       # create and migrate the local D1 database
pnpm --filter @memoriam/web run build
pnpm dev              # Vite on :5173, wrangler dev on :8787
```

Vite passes `/api` to the Worker, so the app and the API share an origin, as they do in
production, where one Worker serves both. `wrangler dev` serves the built app as well, which is
why the web app is built first.

Connect an account and add a passage. If it syncs here, the only things left that can be wrong in
production are the origin, the secrets and the database.

## 4. Create the D1 database

```bash
pnpm --filter @memoriam/api exec wrangler login
pnpm --filter @memoriam/api exec wrangler d1 create memoriam
```

That prints a `database_id`. Put it in `apps/api/wrangler.toml`, replacing the placeholder:

```toml
[[d1_databases]]
binding = "DB"
database_name = "memoriam"
database_id = "paste-it-here"
```

This is the one edit to a tracked file that self-hosting requires. It is not a secret: it names a
database only your account can reach.

## 5. Set the secrets

`.dev.vars` is for local development, and is gitignored. A deployed Worker reads its secrets from
Cloudflare, so set each one:

```bash
w() { pnpm --filter @memoriam/api exec wrangler "$@"; }

w secret put APP_ORIGIN               # https://memoriam.example.com
w secret put SECRETS_KEY
w secret put DROPBOX_CLIENT_ID
w secret put DROPBOX_CLIENT_SECRET
# …and the pair for each other provider in ENABLED_PROVIDERS
```

**`APP_ORIGIN` has no default, and the Worker will not boot without it.** Every OAuth redirect URI
is derived from it, and a wrong guess would send users' consent somewhere that is not you.

`ENABLED_PROVIDERS` is not a secret, and lives in `[vars]` in `apps/api/wrangler.toml`. Edit it
there.

`SECRETS_KEY_ID` defaults to `k1`, and only needs setting when you rotate `SECRETS_KEY`, which is
what it is for. `MICROSOFT_TENANT` defaults to `common`, and only needs setting for a
single-tenant Entra registration. It is set as a secret like the rest, since `wrangler.toml` has
no `[vars]` entry for it.

Treat `SECRETS_KEY` like the database itself: it encrypts every stored refresh token, and whoever
holds both holds every account connected to the instance.

## 6. Deploy

```bash
pnpm --filter @memoriam/api exec wrangler d1 migrations apply memoriam --remote
pnpm run deploy
```

`pnpm run deploy` builds the core package, then the web app, then the Worker, then deploys. The
order matters, and so does being at the repository root.

Migrations are separate from deploys on purpose.
`pnpm --filter @memoriam/api run deploy:migrate` does both, in order, when you want them together.

For a custom domain, add a route in the Cloudflare dashboard (Workers → your Worker → Settings →
Domains & Routes). Then make `APP_ORIGIN` match it exactly, scheme and all, and add the matching
redirect URIs at each provider.

The app is served with `Strict-Transport-Security: max-age=63072000`: a browser that has loaded it
once will not reach that host over plain HTTP again for two years. It says nothing about your
other hosts, on purpose. If every subdomain under the one you serve from is yours to commit to
HTTPS, add `; includeSubDomains` to that line in `apps/web/public/_headers` before you deploy.
`apps/web/tests/csp.test.ts` holds the default, and will fail on your fork once you change it, so
change its assertion with it.

## 7. Check it

- `curl https://memoriam.example.com/api/config` answers the providers you enabled.
- Connecting an account goes to the provider and comes back to `?connect=ok`.
- A passage appears in the app folder in your storage within a few seconds.
- `wrangler tail` shows no errors. No passage ever appears in the logs, because none ever reaches
  the Worker.

## Cost

Workers Free is enough for one person. The Worker is only involved in connecting an account and in
minting access tokens, never in reading or writing a passage, so a browser costs it tens of
requests a day against a limit of 100,000. Static assets are free and unlimited on both plans.

Running an instance for other people, two things to know:

- **Free stops at 100,000 requests a day, until 00:00 UTC**, which would stop token refresh for
  every user at once. Workers Paid bills per request instead, lifts the CPU limit, and keeps logs
  for longer. `wrangler.toml` already sets `limits.cpu_ms = 50` to cap runaway cost; it is
  harmless on Free.
- **Back up D1**, with `wrangler d1 export` on a schedule. The database holds encrypted refresh
  tokens and connection metadata. It never holds a passage: those are in the user's own storage
  and their browser.

Check Cloudflare's own pricing pages before relying on any of this.

## Throttling

By default nothing is throttled. The three requests that make the Worker call a provider
(starting a connect, its callback, and minting a token) can be limited through a `RateLimiter` of
your own, passed to `createApp`:

```ts
import { createApp, parseEnv, type RateLimiter } from '@memoriam/api';
```

It is asked with a key such as `connect:<address>` or `token:<connection>`, and answers whether
the request may go ahead, with a `retryAfter` in seconds when it may not. That goes in a Worker
entry of your own: copy `apps/api/src/worker.ts`, pass `rateLimiter` to its `createApp`, and
point `main` in `wrangler.toml` at your copy.

## Updating

```bash
git pull
pnpm install
pnpm --filter @memoriam/api exec wrangler d1 migrations apply memoriam --remote
pnpm run deploy
```

Deploy from a release tag rather than from `main`. Each release's notes say whether it carries a
migration. The security of your instance is the security of the commit you deployed: see
[`SECURITY.md`](../SECURITY.md).

The D1 migrations come with the server, in the shared kit's `@skysa/server`, which `pnpm install`
puts at `apps/api/node_modules/@skysa/server/migrations`. `apps/api/wrangler.toml` points
`migrations_dir` there. A `wrangler.toml` of your own points it at that folder, from wherever your
file is. A table of your own, for a rate limiter say, goes in a database of your own:
`wrangler d1 migrations create` against this one would write its migration into `node_modules`,
where the next install removes it.

### A database from before the kit

Before the server was the kit's, this repository kept a migration of its own, `0000_init`, which
made the same two tables the kit's migrations make, under the name of the kit's first. No release
carried it, but a Worker deployed from `main` in that time has it. Migrated as it is, such a
database fails at the kit's second migration and changes nothing, since wrangler takes the kit's
first for the one it applied. Reset it onto the kit's migrations instead: drop its two tables and
wrangler's record of what it applied, then apply them all.

Check first that it is such a database. The reset drops every connection, so it is for this
database alone, not for a migration that failed for another reason:

```bash
pnpm --filter @memoriam/api exec wrangler d1 execute memoriam --remote \
  --command "SELECT name FROM d1_migrations"
```

It is one when that lists `0000_init.sql` and nothing else, and `apply` above stopped at
`0001_connection_per_provider.sql` with `no such table: main.connections`. Then:

```bash
pnpm --filter @memoriam/api exec wrangler d1 execute memoriam --remote \
  --command "DROP TABLE IF EXISTS grants; DROP TABLE IF EXISTS storage_connections; DROP TABLE IF EXISTS d1_migrations;"
pnpm --filter @memoriam/api exec wrangler d1 migrations apply memoriam --remote
```

Run the two one after the other, at a quiet time. Between them the deployed Worker has no tables,
and answers every request with an error, a connect finishing its callback then included.

The database holds the connections to storage accounts and nothing else, so that is what goes. No
passage is in it, and the reset touches none of the passages in the storage accounts. Each device
finds its connection gone, as if it had been disconnected from another device, and lets its
library go, keeping every passage. Connecting again binds the library to the account once more,
and its first sync merges what the two hold.

What a device had not sent yet is forgotten as it lets go, though, as on any disconnect. An edit
survives, since the device keeps the passage and sends it when it connects again, but a delete or
a move does not: the account still has the passage where it was, and the first sync brings it back
there. So before the reset, let each device sync.

Two other things go with it. The refresh tokens it held are dropped, not revoked: each account's
earlier grant to the app stays listed at its provider until the account's owner removes it there.
And the record of which devices were revoked goes too, so a revoked device's credential could be
used to connect again; like any new device, it would have to go through the provider's consent for
an account it can sign in to.

A local database from before, made by `pnpm db:migrate`, is reset the same way with `--local` in
place of `--remote`, or by deleting `apps/api/.wrangler/state`.

## When it will not boot

The Worker refuses to start rather than starting up wrong. It answers every request with
`server_misconfigured`, and logs `Invalid environment:` followed by one line per problem: all of
them, not just the first. The three that catch people:

| The line | What to do |
|---|---|
| `APP_ORIGIN: Invalid input: expected string, received undefined` | There is no default; set it. (`Invalid URL` instead means it is set but malformed: usually the scheme is missing.) |
| `SECRETS_KEY: SECRETS_KEY must be base64 of exactly 32 bytes` | Generate one: `openssl rand -base64 32` |
| `DROPBOX_CLIENT_SECRET: required because ENABLED_PROVIDERS includes "dropbox"` | Register that provider's app, or take it out of `ENABLED_PROVIDERS` |

A setting that boots but does nothing is logged once, as `Environment:` and a line saying why,
and the Worker starts. `RELAY` is one: the kit's server reads it, but this app runs no change
relay, so take it out. The setting is read even so, and a value other than `true`, `false`, `1` or
`0` is refused.
