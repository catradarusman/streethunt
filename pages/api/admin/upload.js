// pages/api/admin/upload.js
// Uploads an image to Supabase Storage and returns the public URL
// Expects multipart form data: file (binary) + path (e.g. "s1-reference.jpg")
// Protected: requires x-admin-secret header

import path from "path";

export const config = {
  api: { bodyParser: false },
};

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET     = process.env.ADMIN_SECRET;
const BUCKET           = "stickers";

function auth(req, res) {
  if (!ADMIN_SECRET || req.headers["x-admin-secret"] !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseBoundary(contentType) {
  const match = contentType?.match(/boundary=([^\s;]+)/);
  return match ? match[1] : null;
}

function parseMultipart(buffer, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;

  while (start < buffer.length) {
    const idx = buffer.indexOf(sep, start);
    if (idx === -1) break;
    const end = buffer.indexOf(sep, idx + sep.length);
    const chunk = buffer.slice(idx + sep.length, end === -1 ? buffer.length : end);

    // Separate headers from body (double CRLF)
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd === -1) { start = idx + sep.length; continue; }

    const headerStr = chunk.slice(0, headerEnd).toString();
    const body = chunk.slice(headerEnd + 4, chunk.length - 2); // trim trailing CRLF

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

    parts.push({
      name: nameMatch?.[1],
      filename: filenameMatch?.[1],
      contentType: ctMatch?.[1]?.trim(),
      data: body,
    });
    start = idx + sep.length;
  }
  return parts;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!auth(req, res)) return;

  const boundary = parseBoundary(req.headers["content-type"]);
  if (!boundary) return res.status(400).json({ error: "No multipart boundary" });

  const rawBody = await readBody(req);
  const parts = parseMultipart(rawBody, boundary);

  const filePart = parts.find((p) => p.name === "file");
  const pathPart = parts.find((p) => p.name === "path");

  if (!filePart || !pathPart) return res.status(400).json({ error: "Missing file or path" });

  const mimeType = filePart.contentType || "image/jpeg";
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return res.status(400).json({ error: "Only image files (jpeg, png, webp, gif) are allowed" });
  }

  // Strip to basename and allow only safe characters to prevent path traversal
  const rawPath = pathPart.data.toString().trim();
  const storagePath = path.basename(rawPath).replace(/[^a-zA-Z0-9\-_.]/g, "");
  if (!storagePath) return res.status(400).json({ error: "Invalid file path" });

  // Upload to Supabase Storage (upsert)
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE}`,
        "Content-Type": mimeType,
        "x-upsert": "true",
      },
      body: filePart.data,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    return res.status(500).json({ error: `Storage upload failed: ${err}` });
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
  return res.status(200).json({ url: publicUrl });
}
