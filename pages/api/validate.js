// pages/api/validate.js
// Server-side validation — Anthropic API key never touches the client
// Reference images loaded from Supabase DB — manage stickers without redeploying
// Auth: supports both Supabase JWT (web) and Farcaster Quick Auth JWT (miniapp)

import Anthropic from "@anthropic-ai/sdk";
import { createClient as createFcAuthClient } from "@farcaster/quick-auth";

const fcAuthClient = createFcAuthClient();

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON;

// Fallback sticker definitions — must match DEFAULT_STICKERS in App.jsx
const DEFAULT_STICKERS = {
  s1: { id:"s1", name:"Dead Eye",    active:true, reference_url:null },
  s2: { id:"s2", name:"Neon Reaper", active:true, reference_url:null },
  s3: { id:"s3", name:"Grin",        active:true, reference_url:null },
  s4: { id:"s4", name:"Void King",   active:true, reference_url:null },
  s5: { id:"s5", name:"Rust Face",   active:true, reference_url:null },
  s6: { id:"s6", name:"Ghost Tag",   active:true, reference_url:null },
  s7: { id:"s7", name:"Gold Tooth",  active:true, reference_url:null },
  s8: { id:"s8", name:"Static",      active:true, reference_url:null },
};

// Per-user rate limit: max 10 calls per 60 seconds
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CALLS = 10;
function isRateLimited(userId) {
  const now = Date.now();
  const calls = (rateLimitMap.get(userId) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (calls.length >= RATE_MAX_CALLS) return true;
  rateLimitMap.set(userId, [...calls, now]);
  return false;
}

// Fetch sticker config from Supabase DB
async function getStickerFromDB(stickerId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/stickers?id=eq.${encodeURIComponent(stickerId)}&select=id,name,reference_url,active`,
      { headers: { "apikey": SUPABASE_ANON, "Content-Type": "application/json" } }
    );
    const data = await res.json();
    return data?.[0] || null;
  } catch {
    return null;
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

// Decode JWT payload without verification — used to detect FC vs Supabase token
function getJwtIssuer(token) {
  try {
    const raw = token.split(".")[1];
    const padded = raw + "=".repeat((4 - raw.length % 4) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString()).iss || "";
  } catch { return ""; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Require an auth token — either Supabase JWT (web) or FC Quick Auth JWT (miniapp)
  const token = (req.headers["authorization"] || "").replace("Bearer ", "").trim();
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let userId;
  const iss = getJwtIssuer(token);

  if (iss.includes("farcaster") || iss.includes("auth.farcaster")) {
    // Farcaster Quick Auth JWT
    try {
      const appDomain = (process.env.NEXT_PUBLIC_APP_DOMAIN || process.env.NEXT_PUBLIC_APP_URL || "")
        .replace(/^https?:\/\//, "").replace(/\/$/, "");
      const payload = await fcAuthClient.verifyJwt({ token, domain: appDomain });
      userId = `fc_${Number(payload.sub)}`;
    } catch {
      return res.status(401).json({ error: "Unauthorized" });
    }
  } else {
    // Supabase JWT — existing path
    const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${token}` },
    }).catch(() => null);
    if (!authCheck || !authCheck.ok) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const authUser = await authCheck.json().catch(() => null);
    userId = authUser?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
  }

  if (isRateLimited(userId)) {
    return res.status(429).json({ valid: false, confidence: 0, reason: "Too many requests. Please wait a moment." });
  }

  const { userPhotoBase64, referenceId, stickerName } = req.body;

  if (!userPhotoBase64 || !referenceId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const sticker = (await getStickerFromDB(referenceId)) || DEFAULT_STICKERS[referenceId] || null;

    if (!sticker) {
      return res.status(400).json({ error: "Unknown sticker" });
    }

    if (!sticker.active) {
      return res.status(400).json({ error: "This sticker is no longer active" });
    }

    let messages;
    const name = sticker.name || stickerName;

    // Try to fetch reference image from Supabase Storage
    const refUrl = sticker.reference_url;
    let refBase64 = null;
    let refMimeType = "image/jpeg";

    if (refUrl && !refUrl.includes("your-project")) {
      try {
        const refResponse = await fetch(refUrl);
        if (refResponse.ok) {
          const refBuffer = await refResponse.arrayBuffer();
          refBase64 = Buffer.from(refBuffer).toString("base64");
          refMimeType = (refResponse.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
        }
      } catch {}
    }

    if (refBase64) {
      // CONCEPT-BASED VALIDATION — Claude checks same subject/concept, not exact visual match
      messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are validating a scavenger hunt game called Street Hunt.\n\nA player photographed something in the real world that they believe matches the target called "${name}".\n\nHere is the REFERENCE IMAGE — the shape or concept players need to find:`,
            },
            {
              type: "image",
              source: { type: "base64", media_type: refMimeType, data: refBase64 },
            },
            {
              type: "text",
              text: `Here is the PLAYER'S PHOTO — what they actually photographed:`,
            },
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: userPhotoBase64 },
            },
            {
              type: "text",
              text: `Does the player's photo show the same shape or concept as the reference?\n\nValidation rules:\n- The player's photo does NOT need to be a sticker — it can be ANY real-world object that displays the matching shape or concept: a sticker, a sign, a billboard, a printed t-shirt, a logo on a wall, street art, a label, a badge, graffiti, etc.\n- Focus on the CONCEPT and RECOGNISABLE SHAPE/SUBJECT, not the exact visual style or medium\n- Art style differences are completely fine: pixel art, graffiti, paintbrush, minimal, detailed, colourful, monochrome — all OK\n- Size, proportions, and orientation variations are fine\n- Extra elements or decorations around the main shape are fine\n- Different angles, lighting, or distances are fine\n- Partial visibility is fine as long as the core concept is still recognisable\n- Weathering, fading, or damage is fine\n- The background and surface do not matter\n- INVALID: screenshots of the app, a photo that clearly shows a completely different subject or concept, completely unidentifiable blurry photos, selfies with nothing relevant visible\n\nExample: if the reference shows an upward arrow, a photo of a road sign with an upward arrow, a billboard with an upward arrow, a t-shirt print with an upward arrow, or a painted arrow on a wall are all valid — not just stickers.\n\nBe generous. If a reasonable person would say "yes, that photo contains the same shape or concept", it is valid.\n\nRespond with JSON only, no markdown, no other text:\n{"valid": true, "confidence": 85, "reason": "one sentence"}`,
            },
          ],
        },
      ];
    } else {
      // DESCRIPTION-ONLY — no reference image uploaded yet
      messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are validating a scavenger hunt game called Street Hunt.\n\nA player claims to have found and photographed something matching the target called "${name}".`,
            },
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: userPhotoBase64 },
            },
            {
              type: "text",
              text: `Does this photo show a real-world object that could plausibly match the target named "${name}"?\n\nValidation rules:\n- Must be a real-world photo, not a screenshot\n- The subject can be anything in the real world: a sticker, sign, billboard, t-shirt print, logo, street art, label, graffiti, etc.\n- Must be in focus enough to see what it is\n- INVALID: selfies, blank walls, completely unrelated objects, screenshots\n\nRespond with JSON only, no markdown, no other text:\n{"valid": true, "confidence": 70, "reason": "one sentence"}`,
            },
          ],
        },
      ];
    }

    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 150,
      messages,
    });

    const text = response.content[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return res.status(200).json({ valid: false, confidence: 0, reason: "Could not analyze photo." });
    }

    const result = JSON.parse(jsonMatch[0]);
    return res.status(200).json({
      valid:      Boolean(result.valid),
      confidence: Number(result.confidence) || 0,
      reason:     String(result.reason) || "",
    });

  } catch (err) {
    console.error("Validation error:", err);
    return res.status(500).json({ valid: false, confidence: 0, reason: "Server error. Please try again." });
  }
}
