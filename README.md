# Reverse Recruiting Assistant

A personal agent for one Admin that finds new Jobs and, once approved, emails an Application directly to the people who can hire at the Company.

See `GLOSSARY.md` for the language and `docs/adr/` for the decisions, starting with [ADR 0004](docs/adr/0004-typescript-functions-on-modal.md).

## Environment variables

Copy `.env.example` to `.env.local`. The dashboard and Functions each validate only their own variables, in `src/lib/env.ts`.

| Variable             | Used by              | Purpose                                           |
| -------------------- | -------------------- | ------------------------------------------------- |
| `DATABASE_URL`       | Dashboard, Functions | Supabase transaction pooler connection, port 6543 |
| `FUNCTIONS_SECRET`   | Dashboard, Functions | Bearer secret that protects Function routes       |
| `GOOGLE_CLIENT_ID`   | Dashboard, Functions | Google OAuth client, for Gmail and Drive          |
| `GOOGLE_CLIENT_SECRET` | Dashboard, Functions | Google OAuth client secret                      |
| `APIFY_TOKENS`       | Functions            | Comma-separated Apify tokens: Job Boards, Decision Makers |
| `FIRECRAWL_API_KEY`  | Functions, Dashboard | Firecrawl key: Job Feeds, Job pages, Company pages; optional on the dashboard, for Add Job |
| `TELEGRAM_BOT_TOKEN` | Functions            | Telegram bot that sends Failure Alerts            |
| `TELEGRAM_CHAT_ID`   | Functions            | The Admin's Telegram chat                         |
| `DASHBOARD_URL`      | Functions            | Public dashboard URL, linked from Failure Alerts  |
| `DISABLE_SEND`       | Functions            | `true` refuses Send whatever the Sending setting says; Compose sets it |
| `DASHBOARD_PASSWORD` | Dashboard            | Password for signing in                           |
| `FUNCTIONS_BASE_URL` | Dashboard            | Modal web endpoint, or the local worker           |

Generate `FUNCTIONS_SECRET` with `openssl rand -hex 32`.

## Google setup

1. In Google Cloud, enable the Gmail API and the Google Drive API.
2. On the OAuth consent screen, add the scopes `gmail.send` and `drive.readonly`, and nothing else.
3. Publish the app as **In production**, even though it stays unverified. In **Testing**, Google expires refresh tokens every 7 days, which silently disconnects Gmail. Clicking through the "unverified app" warning once is expected.
4. Create an OAuth client of type **Web application** with both redirect URIs:
   - `http://localhost:3000/google/callback`, for Compose
   - `https://<your dashboard>/google/callback`, for production
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`, Vercel and the Modal Secret.
6. Sign in to the dashboard. On first entry it asks you to connect Google and choose the Resume Folder.
7. Share the Resume Folder as "Anyone with the link". The app can only read Drive, so it warns about the sharing instead of changing it.

## Migrations

Dev and production share one Supabase project, so a migration reaches production as soon as it's applied from dev. Migrations must be backward-compatible: the version already running has to keep working against the new schema.

A destructive change, such as dropping or renaming a column, takes two releases. The first stops using the old shape, and the second removes it.

Apply a migration from dev with `npm run db:migrate` before pushing code that needs it. Every push to `master` also applies pending migrations, but Vercel doesn't wait for them, and a failed migration stops only the Modal deploy.

## Development

```sh
docker compose up --build
```

This starts the dashboard on http://localhost:3000 and the worker behind it, using `.env.local`. There is no scheduler and no ngrok. Compose points `FUNCTIONS_BASE_URL` at the worker itself, and sets `DISABLE_SEND=true` so testing can't email real Decision Makers. Start it with `DISABLE_SEND=false docker compose up` to send, with Sending also turned on in Settings.

Run the checks with `npm test` and `npm run typecheck`.

## Production

A push to `master` runs `.github/workflows/deploy.yml`, which applies migrations over the direct connection and then runs `modal deploy`. A failed migration stops the Modal deploy. Vercel deploys the dashboard on the same push.

### Secrets

| Where          | Secret                                                                                                        | Purpose                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Modal          | `DATABASE_URL`, `FUNCTIONS_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APIFY_TOKENS`, `FIRECRAWL_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DASHBOARD_URL` | Runtime variables for Functions           |
| Vercel         | `DATABASE_URL`, `FUNCTIONS_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DASHBOARD_PASSWORD`, `FUNCTIONS_BASE_URL`, `FIRECRAWL_API_KEY` | Runtime variables for the dashboard       |
| GitHub Actions | `DIRECT_DATABASE_URL`                                                                                         | Direct database connection for migrations |
| GitHub Actions | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`                                                                        | Modal token for `modal deploy`            |
| GitHub Actions | `TIMEZONE` (variable, not secret), e.g. `Africa/Algiers`; defaults to `UTC`                                   | Timezone of the scheduled Job Collection  |

GitHub-hosted runners have no IPv6, and Supabase's direct host is IPv6-only without its IPv4 add-on. Without the add-on, set `DIRECT_DATABASE_URL` to the session pooler connection, port 5432.

Create the Modal Secret, with `modal.env` holding only its nine variables:

```sh
modal secret create reverse-recruiting-agent --from-dotenv modal.env
```

Set `FUNCTIONS_BASE_URL` in Vercel to the web endpoint URL that `modal deploy` prints.

### Deploying by hand

```sh
TIMEZONE=Africa/Algiers modal deploy modal_app.py
```

On Windows, set `PYTHONUTF8=1` first, or the Modal CLI can fail while printing build logs.
