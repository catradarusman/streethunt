// pages/api/validate.js
// Server-side validation — Anthropic API key never touches the client

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Reference images for each sticker — served from /public/stickers/
// In production: replace with actual sticker artwork paths or Supabase Storage URLs
const STICKER_REFERENCES = {
  s1: "/stickers/dead-eye.jpg",
  s2: "/stickers/neon-reaper.jpg",
  s3: "/stickers/grin.jpg",
  s4: "/stickers/void-king.jpg",
  s5: "/stickers/rust-face.jpg",
  s6: "/stickers/ghost-tag.jpg",
  s7: "/stickers/gold-tooth.jpg",
  s8: "/stickers/static.jpg",
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb", // allow base64 photo uploads
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userPhotoBase64, referenceId, stickerName } = req.body;

  if (!userPhotoBase64 || !referenceId) {
    return res.status(400).json({ error: "Missing userPhotoBase64 or referenceId" });
  }

  if (!STICKER_REFERENCES[referenceId]) {
    return res.status(400).json({ error: "Unknown sticker reference" });
  }

  try {
    // Fetch the reference sticker image from the public folder
    // In production with Supabase Storage, replace with the CDN URL fetch
    const refUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}${STICKER_REFERENCES[referenceId]}`;
    const refResponse = await fetch(refUrl);

    let messages;

    if (refResponse.ok) {
      // If reference image is available, do a real visual comparison
      const refBuffer = await refResponse.arrayBuffer();
      const refBase64 = Buffer.from(refBuffer).toString("base64");
      const refMimeType = refResponse.headers.get("content-type") || "image/jpeg";

      messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are validating a street art sticker hunt. 

Reference sticker image (what the sticker looks like):`,
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: refMimeType,
                data: refBase64,
              },
            },
            {
              type: "text",
              text: `User's photo (what they photographed in the real world):`,
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: userPhotoBase64,
              },
            },
            {
              type: "text",
              text: `Does the user's photo show the same sticker as the reference image?

Rules:
- The sticker may appear at different angles, sizes, or lighting conditions
- It may be partially obscured or weathered — that's fine
- The key artwork and shapes should match
- Ignore background differences (wall color, surroundings)
- A clear, deliberate photo of the same sticker design = valid

Respond with JSON only, no other text:
{
  "valid": true or false,
  "confidence": 0-100,
  "reason": "one sentence explanation"
}`,
            },
          ],
        },
      ];
    } else {
      // Reference image not found — validate by description only
      messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are validating a street art sticker hunt for a sticker called "${stickerName}".

The user claims to have found and photographed this sticker in the real world.`,
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: userPhotoBase64,
              },
            },
            {
              type: "text",
              text: `Does this photo clearly show a street art sticker or graffiti tag?

Rules:
- Must be a real photo (not a screenshot of the app)
- Must show some kind of sticker, tag, or street art
- Must be in focus enough to identify it
- Selfies or unrelated photos = invalid

Respond with JSON only, no other text:
{
  "valid": true or false,
  "confidence": 0-100,
  "reason": "one sentence explanation"
}`,
            },
          ],
        },
      ];
    }

    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 200,
      messages,
    });

    // Parse Claude's JSON response
    const text = response.content[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return res.status(200).json({ valid: false, confidence: 0, reason: "Could not analyze photo." });
    }

    const result = JSON.parse(jsonMatch[0]);
    return res.status(200).json({
      valid: Boolean(result.valid),
      confidence: Number(result.confidence) || 0,
      reason: String(result.reason) || "",
    });

  } catch (err) {
    console.error("Validation error:", err);
    return res.status(500).json({ error: "Validation failed", reason: "Server error. Please try again." });
  }
}
