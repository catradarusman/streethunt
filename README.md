# 🔍 Street Hunt

A real-world sticker scavenger hunt PWA. Find stickers hidden around the city, photograph them, earn points, own the map.

## Stack

- **Frontend** — React + Next.js (PWA)
- **Auth** — Supabase magic link (no password)
- **Database** — Supabase Postgres
- **Storage** — Supabase Storage (avatar photos)
- **AI Validation** — Claude vision API (server-side)
- **Maps** — Leaflet + OpenStreetMap

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-username/street-hunt.git
cd street-hunt
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON` | Supabase Dashboard → Settings → API |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` for local dev |

### 3. Supabase setup

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

-- Row Level Security
alter table users enable row level security;
alter table drops enable row level security;

create policy "Users can read all profiles" on users for select using (true);
create policy "Users can update own profile" on users for update using (auth.uid()::text = user_id);
create policy "Users can insert own profile" on users for insert with check (auth.uid()::text = user_id);

create policy "Anyone can read drops" on drops for select using (true);
create policy "Users can insert own drops" on drops for insert with check (auth.uid()::text = user_id);
```

### 4. Supabase Storage

- Dashboard → Storage → New bucket
- Name: `avatars`
- Public: ✅ on

### 5. Supabase Auth redirect URLs

- Dashboard → Auth → URL Configuration
- Add to Redirect URLs: `http://localhost:3000` (dev) and your production domain

### 6. Add sticker reference images

Place your actual sticker artwork in `/public/stickers/`:

```
public/stickers/
  dead-eye.jpg
  neon-reaper.jpg
  grin.jpg
  void-king.jpg
  rust-face.jpg
  ghost-tag.jpg
  gold-tooth.jpg
  static.jpg
```

These are the reference images Claude compares user photos against.

### 7. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Set the same env vars from `.env.example` in Vercel Dashboard → Settings → Environment Variables.

**Important:** After deploying, update your Supabase redirect URLs to include your Vercel production URL.

---

## How AI validation works

```
User selects sticker from grid
  → Camera captures photo
  → POST /api/validate (server-side)
  → Claude receives: reference sticker image + user photo
  → Claude returns: { valid, confidence, reason }
  → Valid: pin drops on map, points awarded
  → Invalid: retry screen with tips
```

The Anthropic API key never touches the browser.

---

## PWA installation

**Android:** Chrome → menu → "Add to Home Screen"  
**iOS:** Safari → Share → "Add to Home Screen"

Magic link emails on iOS: if the link opens in Safari instead of the installed PWA, tap Share → Open in Chrome (or your browser where the app is installed).
