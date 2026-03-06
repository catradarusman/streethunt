// pages/api/fc-auth.js
// Verifies a Farcaster Quick Auth JWT and upserts the user in Supabase.
// Called once on FC miniapp load to identify / register the user.

import { createClient } from "@farcaster/quick-auth";

const quickAuthClient = createClient();

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
// Derive domain from APP_DOMAIN or APP_URL (strip protocol + trailing slash)
const APP_DOMAIN = (process.env.NEXT_PUBLIC_APP_DOMAIN || process.env.NEXT_PUBLIC_APP_URL || "")
  .replace(/^https?:\/\//, "").replace(/\/$/, "");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "Missing token" });

  // Verify FC Quick Auth JWT
  let payload;
  try {
    payload = await quickAuthClient.verifyJwt({ token, domain: APP_DOMAIN });
  } catch {
    return res.status(401).json({ error: "Invalid FC token" });
  }

  const fid    = Number(payload.sub);
  const userId = `fc_${fid}`;
  const { username, displayName, pfpUrl } = req.body || {};

  const avatarId = pfpUrl
    ? JSON.stringify({ type: "upload", value: pfpUrl })
    : JSON.stringify({ type: "emoji", value: "🎭" });

  const resolvedUsername = username || displayName || `fid_${fid}`;

  if (!SUPABASE_URL || !SUPABASE_SERVICE) {
    // Demo / no DB configured — just return user object
    return res.json({ userId, fid, username: resolvedUsername, avatarId, isNew: false });
  }

  const headers = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_SERVICE,
    "Authorization": `Bearer ${SUPABASE_SERVICE}`,
    "Prefer": "resolution=merge-duplicates,return=representation",
  };

  // Check if user already exists
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}&select=user_id,username,avatar_id,total_score,finds,discovered`,
    { headers: { ...headers, "Prefer": "" } }
  ).catch(() => null);

  const existing = checkRes?.ok ? (await checkRes.json())?.[0] : null;

  if (existing) {
    return res.json({ userId, fid, isNew: false, username: existing.username, avatarId: existing.avatar_id });
  }

  // New FC user — insert into users table
  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user_id:     userId,
      username:    resolvedUsername,
      avatar_id:   avatarId,
      total_score: 0,
      finds:       0,
      discovered:  [],
      updated_at:  new Date().toISOString(),
    }),
  }).catch(() => null);

  if (!upsertRes?.ok) {
    // Insert might have failed due to race condition — try fetching again
    const retryRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}&select=user_id,username,avatar_id`,
      { headers: { ...headers, "Prefer": "" } }
    ).catch(() => null);
    const retryUser = retryRes?.ok ? (await retryRes.json())?.[0] : null;
    if (retryUser) {
      return res.json({ userId, fid, isNew: false, username: retryUser.username, avatarId: retryUser.avatar_id });
    }
  }

  return res.json({ userId, fid, isNew: true, username: resolvedUsername, avatarId });
}
