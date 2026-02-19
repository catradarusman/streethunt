// pages/api/validate.js
// Server-side validation — Anthropic API key never touches the client
// Reference images loaded from Supabase DB — manage stickers without redeploying

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON;

// Fetch sticker config from Supabase DB
async function getStickerFromDB(stickerId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/stickers?id=eq.${stickerId}&select=id,name,reference_url,active`,
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userPhotoBase64, referenceId, stickerName } = req.body;

  if (!userPhotoBase64 || !referenceId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const sticker = await getStickerFromDB(referenceId);

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
          refMimeType = refResponse.headers.get("content-type") || "image/jpeg";
        }
      } catch {}
    }

    if (refBase64) {
      // FULL VISUAL COMPARISON — Claude sees reference + user photo
      messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are validating a street art sticker hunt game called Street Hunt.\n\nA player found a sticker called "${name}" hidden in the real world and photographed it.\n\nHere is the REFERENCE IMAGE — what the sticker is supposed to look like:`,
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
              text: `Does the player's photo show the same sticker as the reference?\n\nValidation rules:\n- The sticker design and artwork must match the reference\n- Different angles, lighting, or distances are fine\n- Partial visibility is fine as long as the design is recognisable\n- Weathering, fading, or slight damage is fine\n- The background (wall, street, surface) does not matter\n- INVALID: screenshots of the app, photos of other stickers, blurry unidentifiable photos, selfies\n\nBe reasonably lenient — street photos are imperfect. If the key design elements match, it is valid.\n\nRespond with JSON only, no markdown, no other text:\n{"valid": true, "confidence": 85, "reason": "one sentence"}`,
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
              text: `You are validating a street art sticker hunt game called Street Hunt.\n\nA player claims to have found and photographed a street art sticker called "${name}".`,
            },
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: userPhotoBase64 },
            },
            {
              type: "text",
              text: `Does this photo show a real street art sticker or tag photographed in the real world?\n\nValidation rules:\n- Must be a real-world photo, not a screenshot\n- Must show a sticker, tag, paste-up, or street art marking\n- Must be in focus enough to see what it is\n- INVALID: selfies, blank walls, unrelated objects, screenshots\n\nRespond with JSON only, no markdown, no other text:\n{"valid": true, "confidence": 70, "reason": "one sentence"}`,
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
    const jsonMatch = text.match(/\{[\s\S]*?\}/);

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
