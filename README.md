# Street Hunt

A real-world scavenger hunt PWA. Find targets hidden around the city, photograph them, earn points, own the map.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Next.js 14 (PWA) |
| Auth | Supabase magic link (passwordless) |
| Database | Supabase Postgres |
| Storage | Supabase Storage (avatars + sticker images) |
| AI Validation | Claude Vision API — `claude-opus-4-6` (server-side) |
| Maps | Leaflet + OpenStreetMap |

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

-- Row Level Security
alter table users enable row level security;
alter table drops enable row level security;

create policy "Users can read all profiles" on users for select using (true);
create policy "Users can update own profile" on users for update using (auth.uid()::text = user_id);
create policy "Users can insert own profile" on users for insert with check (auth.uid()::text = user_id);

create policy "Anyone can read drops" on drops for select using (true);
create policy "Users can insert own drops" on drops for insert with check (auth.uid()::text = user_id);

create policy "Anyone can read stickers" on stickers for select using (true);
```

### 4. Supabase: storage buckets

Create two public buckets:

| Bucket name | Purpose |
|---|---|
| `avatars` | Player avatar photos |
| `stickers` | Sticker art and reference images for Claude validation |

Dashboard → Storage → New bucket → set Public: ✅

### 5. Supabase: auth redirect URLs

Dashboard → Auth → URL Configuration → Redirect URLs:
- `http://localhost:3000` (local dev)
- Your production Vercel domain

### 6. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Admin Panel

The admin panel lets you manage stickers and upload reference images without touching the Supabase Dashboard.

**Access:** `/admin` (e.g. `http://localhost:3000/admin` or `https://your-app.vercel.app/admin`)

**Password:** the value of your `ADMIN_SECRET` env var

**What you can do:**
- View and edit all sticker fields (name, rarity, pts, hint, color, active)
- Upload **art images** (displayed in the sticker grid)
- Upload **reference images** (used by Claude for photo validation)
- Add new stickers

> Reference images are stored in the `stickers` Supabase Storage bucket. Once uploaded via the admin panel, Claude will use them automatically for the next validation request — no redeployment needed.

---

## Deploy to Vercel

Connect your GitHub repo to Vercel for automatic deployments:

1. Push to GitHub → Vercel auto-builds and deploys
2. Set all env vars from `.env.example` in Vercel Dashboard → Settings → Environment Variables
3. Set `NEXT_PUBLIC_APP_URL` to your production Vercel domain (e.g. `https://streethunt.vercel.app`)
4. After first deploy, update your Supabase Auth redirect URLs to include the Vercel production URL

---

## How AI validation works

```
User selects sticker from grid
  → Camera captures photo
  → POST /api/validate (server-side only)
  → Fetch reference image from Supabase Storage (stored in stickers.reference_url)
  → Claude receives: reference image + user photo
  → Claude checks: does the photo show the same concept/subject as the reference?
  → Claude returns: { valid, confidence, reason }
  → Valid: pin drops on map, points awarded
  → Invalid: retry screen with tips
  → Fallback: if no reference image uploaded yet, Claude checks for any real-world object matching the target name
```

**Validation approach — concept recognition, not exact match:**

Claude validates based on the *concept or subject* shown, not a pixel-perfect visual comparison. If the reference is an upward arrow, any real-world object showing an upward arrow is valid — sticker, sign, billboard, t-shirt, graffiti, etc.

| What's accepted | What's rejected |
|---|---|
| Different art styles (pixel, graffiti, paintbrush, minimal) | A photo of a clearly different subject |
| Size, proportion, or orientation variations | Screenshots of the app |
| Extra decorations on top of the main design | Completely blurry/unidentifiable photos |
| Different angles, lighting, distances | Selfies with nothing relevant visible |
| Weathering, fading, or partial visibility | |

The Anthropic API key never touches the browser.

---

## Scoring

| Bonus | Points |
|---|---|
| Base (by rarity) | 10 / 20 / 35 / 50 |
| Rarity multiplier | Common +0 / Rare +5 / Epic +15 / Legendary +30 |
| First global find | +50 |
| Pioneer drop (first in city) | +15 |

---

## PWA installation

**Android:** Chrome → menu → "Add to Home Screen"
**iOS:** Safari → Share → "Add to Home Screen"

Magic link emails on iOS: if the link opens in Safari instead of the installed PWA, tap Share → Open in Chrome (or your browser where the app is installed).
