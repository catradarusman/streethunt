# Street Hunt

A real-world scavenger hunt PWA. Find targets hidden around the city, photograph them, earn points, own the map.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Next.js 14.2.35 (PWA) |
| Auth | Supabase magic link — PKCE flow (passwordless) |
| Database | Supabase Postgres |
| Storage | Supabase Storage (avatars + sticker images) |
| Validation | Claude Vision API — `claude-opus-4-6` (server-side) |
| Maps | Leaflet + OpenStreetMap |
| Geolocation | Browser Geolocation API + Nominatim (reverse geocoding) |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/catradarusman/streethunt.git
cd streethunt
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to find it | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Public |
| `NEXT_PUBLIC_SUPABASE_ANON` | Supabase → Settings → API | Public |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | Server-only |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` for local dev | Public |
| `ADMIN_SECRET` | Any password you choose | Server-only |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role | Server-only |

> `ADMIN_SECRET` and `SUPABASE_SERVICE_KEY` are used exclusively by the admin panel API routes. Never prefix them with `NEXT_PUBLIC_`.

### 3. Supabase: database tables

Run this SQL in Supabase Dashboard → SQL Editor:

```sql
-- Users table
create table users (
  user_id text primary key,
  username text unique not null,
  avatar_id text not null,
  total_score int default 0,
  finds int default 0,
  discovered text[] default '{}',
  updated_at timestamptz default now()
);

-- Drops table
create table drops (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(user_id),
  sticker_id text not null,
  lat float not null,
  lng float not null,
  city text,
  pts int default 0,
  pioneer boolean default false,
  created_at timestamptz default now()
);

-- Stickers table
create table stickers (
  id text primary key,
  name text not null,
  rarity text default 'Common',
  pts int default 10,
  hint text,
  color text default '#ffffff',
  art_url text,
  reference_url text,
  active boolean default true
);

-- Pioneer claims table (atomic first-finder tracking)
create table pioneer_claims (
  sticker_id text primary key,
  user_id    text not null references users(user_id),
  claimed_at timestamptz default now()
);

-- Row Level Security
alter table users enable row level security;
alter table drops enable row level security;
alter table stickers enable row level security;
alter table pioneer_claims enable row level security;

create policy "Users can read all profiles" on users for select using (true);
create policy "Users can update own profile" on users for update using (auth.uid()::text = user_id);
create policy "Users can insert own profile" on users for insert with check (auth.uid()::text = user_id);

create policy "Anyone can read drops" on drops for select using (true);
create policy "Users can insert own drops" on drops for insert with check (auth.uid()::text = user_id);

create policy "Anyone can read stickers" on stickers for select using (true);

create policy "Anyone can read pioneer claims" on pioneer_claims for select using (true);
create policy "Users can claim pioneer" on pioneer_claims for insert with check (auth.uid()::text = user_id);

-- Atomic pioneer claim RPC (INSERT ... ON CONFLICT DO NOTHING, returns true if this call won)
create or replace function claim_pioneer(p_sticker_id text, p_user_id text)
returns boolean language plpgsql security definer as $$
declare rows_inserted int;
begin
  insert into pioneer_claims(sticker_id, user_id)
  values (p_sticker_id, p_user_id)
  on conflict (sticker_id) do nothing;
  get diagnostics rows_inserted = row_count;
  return rows_inserted > 0;
end;
$$;
```

### 4. Supabase: storage buckets

Create two public buckets:

| Bucket name | Purpose |
|---|---|
| `avatars` | Player avatar photos |
| `stickers` | Sticker art and reference images for validation |

Dashboard → Storage → New bucket → set Public: ✅

### 5. Supabase: auth redirect URLs

Dashboard → Auth → URL Configuration:

- **Redirect URLs:** add `http://localhost:3000` (local dev) and your production Vercel domain
- **Auth Flow:** set to **PKCE** (default for new projects)

The app uses PKCE flow. A code verifier is generated in the browser that requests the magic link and must be present when the link is clicked. If the link is opened on a **different device or browser** than where it was requested, auth fails gracefully with the message: *"This link was opened on a different device. Enter your email here to get a new link on this device."* The app also supports the implicit flow (`#access_token=` hash redirect) as a fallback.

### 6. Supabase: email provider (Resend)

Supabase's built-in email quota is very low and unsuitable for production. Configure a custom SMTP provider via [Resend](https://resend.com):

1. Create a Resend account and add your sending domain (e.g. `yourdomain.com`)
2. Resend will show the DNS records you need to add (DKIM TXT + SPF TXT) — add them at your DNS provider (Cloudflare, Namecheap, etc.)
3. Click **Verify DNS Records** in Resend → wait for status to become **Verified** (DNS propagation can take up to 48 hours)
4. In Resend → API Keys, create a key and note your `from` address (e.g. `noreply@yourdomain.com`)
5. In Supabase Dashboard → Authentication → SMTP Settings → enable Custom SMTP and enter your Resend credentials

> If the domain is not yet **Verified** in Resend, magic link emails will fail with a `403` error: *"The domain is not verified."* No emails will be sent until DNS verification completes.

### 7. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Demo Mode

Demo mode activates automatically when `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON` are not set in `.env.local`. Useful for testing the full UI without a Supabase project.

In demo mode:
- No email is sent — the magic link step is simulated with a short delay
- All Supabase reads and writes are skipped
- GPS falls back to a demo area (Jakarta + random offset)
- Validation still calls the real `/api/validate` endpoint — `ANTHROPIC_API_KEY` is still required
- Profile and score are stored in `localStorage` only (cleared on sign-out)

---

## Session & Offline Support

The app is offline-first using `localStorage` as a cache layer (`streethunt_cache_v1`).

- **First sign-in:** profile is fetched from Supabase and written to localStorage
- **Return visits:** app loads from cache instantly with no spinner, then syncs from Supabase in background
- **Auto-login:** returning users are logged back in automatically — no new magic link needed
- **Score protection:** if a background DB sync returns a stale or zero value, `Math.max(local, remote)` always preserves the higher score
- **Offline indicator:** an `OnlineStatus` banner appears when the device has no network connection

---

## User Flow & Screens

```
AUTH
  → enter email → "Check your email"
  → click magic link in email
      new user  → username + avatar setup → DASHBOARD
      returning → DASHBOARD (auto, restored from cache or Supabase)

DASHBOARD
  → stats bar + score + leaderboard + mini map
  → "I FOUND A MATCH" → FIND (sticker selector grid)
      → select sticker → CAMERA
          → capture photo → VALIDATING
              → match   → SUCCESS MODAL (score breakdown + pioneer badge)
              → no match → FAILED (retry tips)
  → MAP → full-screen Leaflet map with all drop pins
  → PROFILE → stats grid, sticker collection, sign out
```

---

## Avatar System

Players choose an avatar during sign-up. It cannot be changed afterwards.

| Option | Description |
|---|---|
| 🪦 Headstone | Emoji avatar |
| 💀 Skull | Emoji avatar |
| 🖼️ Upload | Custom photo, uploaded to the `avatars` Supabase Storage bucket |

Uploaded photos are stored at `{userId}/avatar.{ext}`. If the upload fails, the app falls back to storing a base64 preview locally.

---

## Admin Panel

The admin panel lets you manage stickers and upload reference images without touching the Supabase Dashboard.

**Access:** `/admin` (e.g. `http://localhost:3000/admin`)

**Password:** the value of your `ADMIN_SECRET` env var

**What you can do:**
- View and edit all sticker fields (name, rarity, pts, hint, color, active)
- Upload **art images** (displayed in the sticker grid)
- Upload **reference images** (used for photo validation)
- Add new stickers
- Deactivate stickers (they stay in the DB but won't appear to players)

> Reference images are stored in the `stickers` Supabase Storage bucket. Once uploaded, they are used automatically for the next validation request — no redeployment needed.

**Validation modes:**

| Mode | How it works |
|---|---|
| With reference image | Validator receives both the reference image and the user's photo and checks for a conceptual match |
| Without reference image | Falls back to name-only — validator checks if the photo plausibly shows an object matching the sticker name |

Upload a reference image via the admin panel for more accurate and consistent validation.

---

## Deploy to Vercel

Connect your GitHub repo to Vercel for automatic deployments:

1. Push to GitHub → Vercel auto-builds and deploys
2. Set all env vars from `.env.example` in Vercel Dashboard → Settings → Environment Variables
3. Set `NEXT_PUBLIC_APP_URL` to your production Vercel domain (e.g. `https://streethunt.vercel.app`)
4. After first deploy, update your Supabase Auth redirect URLs to include the production URL

---

## How validation works

```
User selects sticker from grid
  → Camera opens → device GPS captured via navigator.geolocation (once per session)
  → Camera captures photo
  → POST /api/validate (server-side only)
  → Fetch reference image from Supabase Storage (stickers.reference_url)
  → Validator receives: reference image + user photo
  → Checks: does the photo show the same concept/subject as the reference?
  → Returns: { valid, confidence, reason }
  → Valid:
      → Coordinates from device GPS (required; capture is blocked if GPS unavailable)
      → City name resolved via Nominatim reverse geocoding
      → Pin drops on map at real location, points awarded
  → Invalid: retry screen with tips
  → Fallback: if no reference image uploaded, validator checks for any real-world
    object matching the target name
```

**Concept recognition, not exact match:**

The validator checks the *concept or subject* shown, not pixel-perfect similarity. If the reference is an upward arrow, any real-world upward arrow is valid — sticker, sign, billboard, graffiti, t-shirt, etc.

| Accepted | Rejected |
|---|---|
| Different art styles (pixel, graffiti, paintbrush, minimal) | A photo of a clearly different subject |
| Size, proportion, or orientation variations | Screenshots of the app |
| Extra decorations on top of the main design | Completely blurry/unidentifiable photos |
| Different angles, lighting, distances | Selfies with nothing relevant visible |
| Weathering, fading, or partial visibility | |

The API key and model details never reach the browser. The in-app validation screen shows generic copy only.

---

## Dashboard

The main screen shows your current score, a progress bar toward the next milestone, and three inline stats:

| Badge | Meaning |
|---|---|
| 💀 N found | Unique sticker types you've discovered |
| 🏆 #N | Your current leaderboard rank |
| 📸 N | Total validated captures (all-time) |

📸 increments on every successful validation and is persisted to cache and Supabase alongside your score.

---

## Leaderboard

- Displays the top 10 players ranked by total score, highest first
- Sorted at both DB level (`ORDER BY total_score DESC`) and client-side as a safety net
- **Refreshes automatically every 10 seconds** — other players' scores appear without any action from you
- Re-fetches 800ms after your own score changes, giving the DB write time to commit before the read fires
- Each fetch aborts any in-flight request before starting a new one (prevents stale responses overwriting fresh data)
- **Score is anti-regression protected** — if a DB sync returns a stale or zero value, the local score is always preserved (`Math.max` between local state and DB value)
- Leaderboard reads are sent with the user's Bearer token so the `users` table RLS SELECT policy is satisfied — a missing token causes the query to return no rows and the leaderboard will show only the current user

---

## Scoring

| Bonus | Points |
|---|---|
| Base (by rarity) | Common 10 / Rare 20 / Epic 35 / Legendary 50 |
| Rarity multiplier | Common +0 / Rare +5 / Epic +15 / Legendary +30 |
| First find (your first ever capture) | +50 |
| Pioneer drop (first of that sticker in the DB) | +15 |

---

## Map & Location

- When the camera opens, the app requests device GPS via `navigator.geolocation` — **the browser permission prompt appears only once per session**
- GPS is captured once and reused for all subsequent submissions in the same session
- If permission is denied or GPS is unavailable, capture is blocked with an error: *"Location unavailable. Enable GPS and try again."* — drops are never recorded with a fake location
- In demo mode (Supabase not configured), GPS denial falls back to a demo area (Jakarta + random offset) so the full flow can still be tested
- After a successful submission, the city name is resolved from the coordinates via **Nominatim** (OpenStreetMap reverse geocoding)
  - Free service, no API key required
  - Falls back to `"Unknown"` if the request fails
  - Nominatim's usage policy allows low-frequency requests; one call per submission is well within limits

---

## PWA installation

**Android:** Chrome → menu → "Add to Home Screen"
**iOS:** Safari → Share → "Add to Home Screen"

Magic link emails on iOS: if the link opens in Safari instead of the installed PWA, tap Share → Open in Chrome (or your browser where the app is installed).

> Because the app uses PKCE auth, the magic link must be opened in the **same browser** where you requested it. If it opens in a different browser, you'll be prompted to enter your email again to get a new link in the correct browser.

> If the sign-in screen shows **"Too many attempts. Please wait a few minutes and try again."** — Supabase has rate-limited OTP requests for that email address. Wait ~5 minutes before requesting another magic link.

---

## Security

| Layer | Control |
|---|---|
| API authentication | All `/api/validate` calls require a valid Supabase Bearer token — unauthenticated calls return 401 |
| Rate limiting | `/api/validate` is limited to **10 calls per user per 60 seconds**; excess returns 429 |
| HTTP security headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=self, geolocation=self` applied to all routes |
| Admin auth | Admin panel API routes check `x-admin-secret` header against `ADMIN_SECRET` env var on every request |
| File uploads | Upload API enforces MIME type whitelist (`image/jpeg`, `image/png`, `image/webp`, `image/gif`) and strips path components to prevent path traversal |
| XSS | All user-controlled and external strings (usernames, city names from Nominatim) are HTML-escaped before insertion into Leaflet map popup `innerHTML` |
| GPS integrity | Capture is blocked with an error if GPS is unavailable — drops are never recorded with placeholder coordinates (except in demo mode) |
| Anthropic key | Never exposed to the browser — all Claude API calls are made server-side in `/api/validate` only |
| Supabase service key | Never exposed to the browser — used only in `/api/admin/upload` and `/api/admin/stickers` |

---

## Changelog

### 2026-03-06
- **Security: rate limiting** — `/api/validate` now enforces 10 calls/60s per authenticated user (prevents Anthropic API cost abuse)
- **Security: upload validation** — admin upload API now whitelists MIME types and sanitizes storage paths against traversal attacks
- **Security: HTTP headers** — added `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` via `next.config.js`
- **Security: XSS fix** — all user-controlled values in Leaflet map popup HTML are now HTML-escaped via `escHtml()` helper
- **Bug fix: pioneer race condition** — replaced client-side `drops` count check with an atomic Postgres RPC (`claim_pioneer`) using `INSERT ... ON CONFLICT DO NOTHING`; only one user can win the pioneer bonus per sticker regardless of concurrent finds
- **Bug fix: double-submit** — camera capture now uses a `useRef` guard to prevent concurrent submissions in the same render tick
- **Bug fix: GPS fallback** — in production, capture is now blocked if GPS is unavailable instead of silently recording a fake location; demo mode retains the Jakarta placeholder for testing
- **Bug fix: leaderboard stale response** — `fetchLb` now aborts in-flight requests via `AbortController` before starting a new one
- **Dependency: Next.js 14.2.5 → 14.2.35** — patches 1 critical + 12 high CVEs (cache poisoning, auth bypass, SSRF)
- **Bug fix: leaderboard stale score** — `totalScore` in the 10-second interval was always stale (captured as 0 at mount); now reads from a `useRef` that tracks the latest value, ensuring `Math.max(DB, local)` uses the correct score
- **Bug fix: error boundary** — added `ErrorBoundary` class component wrapping the app; any React crash now shows a "SOMETHING BROKE / RELOAD" screen instead of a blank white page
- **PWA icons** — generated `icon-192.png` and `icon-512.png` matching the app visual identity; fixes broken "Add to Home Screen" icon
