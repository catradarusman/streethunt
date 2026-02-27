// pages/api/admin/stickers.js
// Protected: requires x-admin-secret header matching ADMIN_SECRET env var
// GET  — list all stickers
// POST — create new sticker
// PUT  — update sticker by id

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET     = process.env.ADMIN_SECRET;

function auth(req, res) {
  if (!ADMIN_SECRET || req.headers["x-admin-secret"] !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function supabaseHeaders() {
  return {
    "apikey": SUPABASE_SERVICE,
    "Authorization": `Bearer ${SUPABASE_SERVICE}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };
}

export default async function handler(req, res) {
  if (!auth(req, res)) return;

  if (req.method === "GET") {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/stickers?order=id`,
      { headers: supabaseHeaders() }
    );
    const data = await r.json();
    return res.status(r.ok ? 200 : 500).json(data);
  }

  if (req.method === "POST") {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/stickers`,
      {
        method: "POST",
        headers: supabaseHeaders(),
        body: JSON.stringify(req.body),
      }
    );
    const data = await r.json();
    return res.status(r.ok ? 201 : 400).json(data);
  }

  if (req.method === "PUT") {
    const { id, ...fields } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/stickers?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: supabaseHeaders(),
        body: JSON.stringify(fields),
      }
    );
    const data = await r.json();
    return res.status(r.ok ? 200 : 400).json(data);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
