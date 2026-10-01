# ChitChat

Anonymous 1-to-1 stranger chat. No accounts, no names, no message history — press
**Start Chatting** and get paired with a random stranger for a private, real-time text
conversation. Hit **Next** any time for someone new.

**Stack:** Next.js 15 (React 19, TypeScript, Tailwind) frontend on Vercel ·
Node.js + Express + Socket.IO WebSocket backend on Render ·
Upstash Redis (race-safe matchmaking queue, presence, rate limits) ·
Supabase PostgreSQL (session/room/report/block metadata only — **message content is never stored**).

## How it works

```
Browser (Next.js) ──Socket.IO──> Express/Socket.IO server (Render)
        │                                │
        │                         Upstash Redis (Upstash)
        │                         Supabase (Supabase)
```

1. The landing page (`/`) shows a live online count and a safety note.
2. `/searching` creates an anonymous session (random nickname like `CuriousFox42`,
   persisted in `sessionStorage` so a refresh reconnects) and joins the matchmaking queue.
3. The server's `Matchmaker` uses an atomic Redis Lua script so two users can never be
   double-matched or self-matched, even across multiple server instances. Blocked pairs
   are excluded. An in-memory fallback keeps local dev working without Redis.
4. `/chat` is the private room: exactly 2 members, server-validated on every message.
   Typing indicators, presence pings, partner-left / reconnect handling, **Next**,
   **Leave**, **Report** and **Block** are all built in.
5. Safety runs server-side on every message: length limits (500 chars), message rate
   limits, duplicate/flood detection, a profanity mask, and suspicious-activity signals
   (links, ALL-CAPS shouting, excessive repeats). Reports can trigger temporary
   matchmaking bans. Optional Cloudflare Turnstile blocks bots at session creation.

## Repository layout

```
chitchat/
├── apps/
│   ├── server/                 # Socket.IO backend (Render)
│   │   ├── src/
│   │   │   ├── index.ts        # startup, graceful shutdown
│   │   │   ├── server.ts       # Express + Socket.IO wiring, all event handlers
│   │   │   ├── config.ts       # env parsing/validation
│   │   │   ├── identity.ts     # anonymous session ids + nickname generator
│   │   │   ├── profanity.ts    # word-list mask + spam/suspicion signals
│   │   │   ├── ratelimit.ts    # token-bucket rate limiter
│   │   │   ├── store.ts        # session/room store (memory + Upstash Redis)
│   │   │   ├── matchmaker.ts   # atomic Redis Lua matchmaking (+ in-memory fallback)
│   │   │   └── db.ts           # Supabase persistence (metadata only)
│   │   └── tests/              # vitest unit + WebSocket integration tests
│   └── web/                    # Next.js frontend (Vercel)
│       └── src/
│           ├── app/            # /, /searching, /chat, /safety, /privacy, /terms, 404
│           ├── components/ui.tsx
│           └── lib/            # socket singleton, session storage
├── supabase/migrations/001_init.sql
├── render.yaml                 # Render blueprint (free web service)
├── .env.example
└── package.json                # npm workspaces
```

## Local development

**Prerequisites:** Node.js 20+, npm 10+.

```bash
npm install
npm run dev            # runs server (:4000) + web (:3000) concurrently
```

Open two browser windows/tabs at `http://localhost:3000`, click **Start Chatting** in
both, and they will be matched into a private room.

Optional integrations (all optional for local dev — the app degrades gracefully):

| Variable | Purpose | Without it |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Shared matchmaking queue across instances | In-memory queue (single instance only) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Persist sessions/rooms/reports/blocks metadata | Metadata kept in memory only |
| `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Bot check on session creation | No CAPTCHA |
| `NEXT_PUBLIC_SOCKET_URL` | Where the frontend finds the socket server | `http://localhost:4000` |
| `ALLOWED_ORIGINS` | CORS allow-list for the socket server | `http://localhost:3000` |

Copy `.env.example` to `.env` and fill in what you need. Never commit `.env`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | server + web in watch mode |
| `npm run typecheck` | `tsc --noEmit` for server and web |
| `npm run lint` | ESLint for both apps |
| `npm test` | vitest unit + integration tests (server) |
| `npm run build` | production builds of server and web |

## Testing

- **Unit tests** (`apps/server/tests/`): nickname/session generation, profanity mask,
  spam signals, token-bucket limiter, matchmaking (pairing, self-match, duplicates,
  blocks, reports/bans).
- **Integration tests**: real Socket.IO clients against a live server — session start,
  matchmaking of two clients, bidirectional message relay, typing, unauthorized/oversized/duplicate
  messages, malicious HTML transmitted as inert text, Next, disconnect cleanup, report,
  block, and session resume.

```bash
npm test            # watch mode off; run once with: npm test -- --run
```

## Deployment

### 1. Supabase (PostgreSQL)
1. Create a free project at supabase.com.
2. In the SQL editor, run `supabase/migrations/001_init.sql`.
3. Copy the project URL and the **service role** key (server-side only — never expose it
   to the browser) into env vars.

### 2. Upstash (Redis)
1. Create a free Redis database at upstash.com.
2. Copy the REST URL and REST token into env vars.

### 3. Backend → Render
1. Push this repo to GitHub.
2. In Render: **New → Blueprint** and point it at the repo — `render.yaml` defines the
   free `chitchat-server` web service (root `apps/server`, health check `/health`).
3. Set the env vars from `.env.example` (Upstash, Supabase, `ALLOWED_ORIGINS` = your
   Vercel URL).
4. Note the service URL, e.g. `https://chitchat-server.onrender.com`.
   (Free tier sleeps after ~15 min idle — first load can take ~30–60 s; the UI says so.)

### 4. Frontend → Vercel
1. In Vercel: **Add New → Project**, import the same repo, set **Root Directory** to
   `apps/web`.
2. Set `NEXT_PUBLIC_SOCKET_URL` to the Render service URL and `NEXT_PUBLIC_APP_URL` to
   the Vercel URL.
3. Deploy.

### 5. Optional: Cloudflare Turnstile
Create a Turnstile widget, set `TURNSTILE_SECRET_KEY` on Render and
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` on Vercel — the `/searching` page shows the challenge
automatically.

## Privacy & safety notes

- No registration; no names, emails, phones, or social accounts collected.
- Chat **message content is never stored** — not in Redis, not in Postgres, not in logs.
- Supabase holds only session metadata, room metadata, report/block records, all with
  RLS enabled and service-role access from the backend only. Data older than 30 days is
  purged.
- Every socket event validates room membership server-side; users never see internal
  ids, IPs, or technical details.
- Client text is rendered with React's default escaping (no `dangerouslySetInnerHTML`
  anywhere), so HTML/JS in messages is inert text.

## Limitations

- **Render free tier**: the server sleeps after ~15 min of inactivity; cold starts take
  30–60 s. The frontend shows a "waking up" message during this time.
- **Upstash free tier**: ~10k commands/day — fine for an MVP, not for heavy traffic.
- **Supabase free tier**: projects pause after 7 days of inactivity.
- **Single Redis region / in-memory fallback**: the in-memory matchmaking queue works
  for one server instance; use Upstash when running multiple instances.
- **Moderation** is metadata-based (no message content stored), so reported content
  itself can't be reviewed — the trade-off chosen for privacy.

## License

MIT — do whatever you want with it, just don't be creepy.
