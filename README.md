# LeadFlow

Multi-tenant lead and document platform for German mortgage brokerages. Brokerage teams capture leads, move them through a pipeline, convert them into clients, and collect documents that are checked automatically. One deployment serves many brokerages, each fully isolated from the others.

- **Live app:** `<vercel url>` · **API:** `<render url>` · **Walkthrough video:** `<video url>`
- Roles: platform admin, brokerage admin, advisor, client. The platform admin role exists in the data model but has no screens (see Known limitations).

## Stack

React + TypeScript, Shadcn UI, Tailwind (Vercel/Geist design tokens) · Node + Express 5 · MongoDB Atlas (Mongoose) · JWT + bcrypt · Socket.IO · Cloudinary · Upstash Redis · Resend · Render (API) + Vercel (client).

## How the hard parts work

- **Tenant isolation.** Every tenant collection carries `brokerageId`. A Mongoose plugin (`server/src/lib/tenantPlugin.ts`) reads the brokerage from the verified JWT through `AsyncLocalStorage` and rewrites every query, aggregate and insert. With no tenant context it throws instead of running unscoped (fail closed), so a correct guess of another brokerage's lead id returns nothing. The only opt-outs are explicit `skipTenant(...)` calls (login, seed, startup recovery).
- **Webhook and duplicates.** `POST /api/leads/webhook/:brokerageId` normalizes email and phone and relies on partial unique indexes, not check-then-insert, so simultaneous submissions cannot both succeed. An `Idempotency-Key` header is supported. A new lead and a duplicate return the identical `202`, so the endpoint cannot be used to find out whether an email is already a lead.
- **Concurrent edits.** Stage moves are an atomic compare-and-set on a `version` field. The loser gets `409` plus the current state, and the board corrects itself.
- **Conversion.** Lead to client creates the client, its portal login and the lead update in one MongoDB transaction. A failure anywhere leaves nothing behind.
- **Documents.** Uploads go through the API to Cloudinary as private assets, with the file type decided from the file's content. Checks are simulated (slow, about 15% random failure) as an atomically claimed state machine (`pending -> checking -> verified | failed`) with restart recovery. Files are opened through short-lived signed links.
- **Real time.** Socket.IO, one room per brokerage for staff and one per client. A client only ever receives their own document events.
- **Dashboard cache.** Pipeline counts are cached in Redis under an epoch-versioned key. Invalidation bumps the epoch, so a slow request cannot write stale counts back. If Redis is down, the app keeps working without the cache.
- **Welcome email.** One hardcoded Resend email when a lead enters New: at most once per lead, HTML-escaped, with a per-brokerage daily cap.

## Run locally

```bash
# server
cd server
cp .env.example .env        # fill in the values below
npm install
npm run seed                # two brokerages, users, sample leads; prints the webhook URLs
npm run dev                 # http://localhost:4000

# client
cd client
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Seeded users (all use `SEED_PASSWORD`, default `ChangeMe123!`, so set your own for anything public):
`advisor@muster.test`, `admin@muster.test` (Muster Finanz GmbH) · `advisor@hausbau.test` (Hausbau Partner AG) · `admin@leadflow.test` (platform admin).

### Environment variables

| Variable                                                               | Where                | Purpose                                                                                               |
| ---------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                                                          | server               | Atlas connection string                                                                               |
| `MONGODB_URI_TEST`                                                     | server (tests)       | A separate database whose name contains `test`; tests refuse to run elsewhere                         |
| `JWT_SECRET`                                                           | server               | At least 32 characters; must be identical wherever tokens are verified                                |
| `CLIENT_URL`                                                           | server               | Exact frontend origin (CORS and Socket.IO)                                                            |
| `PORT`                                                                 | server               | Provided by Render                                                                                    |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | server               | Document storage (uploads fail without them)                                                          |
| `UPSTASH_REDIS_URL`                                                    | server               | `rediss://...` URL (the dashboard runs uncached without it)                                           |
| `RESEND_API_KEY`, `EMAIL_FROM`                                         | server               | Welcome email (disabled without the key; the default sender only delivers to your own Resend address) |
| `SEED_PASSWORD`                                                        | server (seed, smoke) | Password for seeded users                                                                             |
| `VITE_API_URL`                                                         | client               | API base URL, baked in at build time                                                                  |

## Tests

```bash
cd server
npm run typecheck && npm run lint && npm test
```

Backend tests use Node's built-in runner with Supertest. They run against a dedicated test database and stub Cloudinary, Resend and Redis. Tests are targeted at risky logic, not at a coverage number.

| Question worth asking                               | Where it is tested                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can a correct ID guess reach another tenant's data? | `server/src/lib/tenantPlugin.test.ts`, `server/src/routes/leads.board.test.ts`, `server/src/routes/conversion.test.ts`, `server/src/routes/documents.test.ts`, `server/src/routes/dashboard.test.ts` |
| Are duplicate leads detected within a tenant?       | `server/src/routes/leads.webhook.test.ts`, `server/src/lib/normalize.test.ts`                                                                                                                        |
| What if two advisors move the same lead at once?    | `server/src/routes/leads.board.test.ts`                                                                                                                                                              |
| Is webhook ingestion idempotent under bursts?       | `server/src/routes/leads.webhook.test.ts`                                                                                                                                                            |
| Is conversion all-or-nothing?                       | `server/src/routes/conversion.test.ts`                                                                                                                                                               |
| Do the right sockets get the right events?          | `server/src/lib/socket.test.ts`, `server/src/routes/documents.test.ts`                                                                                                                               |
| Is the cache correct and race-free?                 | `server/src/routes/dashboard.test.ts`                                                                                                                                                                |
| Is the welcome email sent at most once?             | `server/src/routes/welcomeEmail.test.ts`                                                                                                                                                             |

**Consciously not tested (time):** frontend unit and component tests, end-to-end browser tests, real calls to Cloudinary, Resend and Upstash (stubbed in tests, checked by hand), and load tests.

After a deploy: `cd server && npm run smoke -- <api url>` checks a running instance end to end.

## Deployment

**Atlas:** Network Access allows `0.0.0.0/0` (Render's free tier has no fixed IP). Use a database user's credentials in the URI, not your Atlas login.

**Render (API), Web Service:**

| Setting           | Value                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Root Directory    | `server`                                                                       |
| Build Command     | `npm install --include=dev && npm run build`                                   |
| Start Command     | `npm start`                                                                    |
| Health Check Path | `/health`                                                                      |
| Environment       | every server variable above except `PORT`, `MONGODB_URI_TEST`, `SEED_PASSWORD` |

**Vercel (client):** Root Directory `client`, framework Vite, environment variable `VITE_API_URL` set to the Render URL (no trailing slash). `client/vercel.json` rewrites all routes to `index.html`.

**Order:** deploy the API, deploy the client with `VITE_API_URL`, set `CLIENT_URL` on Render to the Vercel URL, then start the API once on the new database (it builds its indexes at boot) and seed it:

```powershell
cd server
$env:MONGODB_URI = "<production connection string>"
$env:SEED_PASSWORD = "<a password you will share privately>"
npm run seed
Remove-Item Env:MONGODB_URI, Env:SEED_PASSWORD
```

## Troubleshooting

### Hit during the build

| Symptom                                                                                                        | Cause                                                                                               | Fix                                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `tsc -b` reports `Cannot find module '@/...'` while `npm run dev` works                                        | The `@` alias was added to `client/tsconfig.json`, but `tsc -b` compiles `client/tsconfig.app.json` | Add `"paths": { "@/*": ["./src/*"] }` to `client/tsconfig.app.json`                                    |
| `TS7016 Could not find a declaration file for module 'express'` (or `bcrypt`, `jsonwebtoken`) after an install | An install left `devDependencies` incomplete                                                        | Reinstall the `@types/*` packages and check `server/package.json`                                      |
| `'eslint' is not recognized`                                                                                   | Same cause: eslint missing from `devDependencies`                                                   | `npm i -D eslint typescript-eslint`                                                                    |
| `bad auth: authentication failed`                                                                              | The URI holds the wrong database-user credentials, not an IP problem                                | Use the Database Access user; URL-encode special characters in the password                            |
| `req.params.id` is typed `string \| string[]`                                                                  | Express 5 types do not infer params once middleware precedes the handler                            | `String(req.params.id)`                                                                                |
| Seed fails with `E11000 ... phone`                                                                             | A hand-posted lead already owns that normalized phone number                                        | The seed treats duplicates as already present                                                          |
| Unique-index tests fail after `dropDatabase()`                                                                 | The drop removed the indexes                                                                        | Call `Model.syncIndexes()` in test setup                                                               |
| Tenant context missing after multer, so queries throw                                                          | `AsyncLocalStorage` context does not survive stream callbacks                                       | Re-bind with `bindTenant` after the upload middleware                                                  |
| Hausbau showed 4 leads instead of 3                                                                            | A lead posted by hand during a manual webhook test                                                  | Not a bug: delete the stray test lead                                                                  |
| Resend rejects a welcome email                                                                                 | The default sender only delivers to your own Resend address                                         | Verify a domain and set `EMAIL_FROM`; the failure is recorded on the lead and never breaks the request |

### Anticipated for deployment (not yet encountered)

| Symptom                                                               | Likely cause                                                                        | First thing to try                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| CORS errors between client and API, including the Socket.IO handshake | `CLIENT_URL` differs from the real frontend origin (Vercel preview URLs differ too) | Make `CLIENT_URL` match the production origin exactly, then restart the API |
| Refreshing `/dashboard` on Vercel gives a 404                         | Missing SPA rewrite                                                                 | `client/vercel.json`                                                        |
| `invalid signature` right after deploying                             | `JWT_SECRET` differs between environments                                           | Use one value everywhere; old tokens stop working when it changes           |
| First request takes about a minute                                    | Render's free instance was asleep                                                   | Expected: a known limitation, not a bug                                     |
| Mongoose connection timeout                                           | Atlas allowlist or connection string                                                | Allow `0.0.0.0/0`; recheck the URI                                          |
| The client still calls `localhost`                                    | `VITE_API_URL` is baked in at build time                                            | Set it on Vercel, then redeploy                                             |

## Known limitations

- The webhook is unauthenticated. The welcome email's daily cap limits the damage. A per-brokerage signing secret and rate limiting would fix it.
- Client portal logins use a one-time temporary password with no reset or forced change. Expiring invite links would fix it.
- Document checks are simulated and run in-process on one instance. A real queue (BullMQ on Redis) would replace them.
- JWTs are stateless: a deactivated user keeps access until the token expires (8 hours), and sockets outlive tokens.
- Socket.IO uses the in-memory adapter, so it runs on a single instance. A Redis adapter would fix it.
- The platform admin role has no screens. There is no advisor or client management UI, no consent or opt-out for the welcome email, and no documents checklist.
- Render's free tier spins down after inactivity.
