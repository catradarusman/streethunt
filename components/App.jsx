import { useState, useRef, useEffect, useCallback } from "react";

// ─── SUPABASE CONFIG ────────────────────────────────────────────────────────
// Values come from .env.local — never hardcoded
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON || "";

// Thin Supabase client — no SDK needed, just fetch
const sb = {
  auth: {
    async signInWithOtp(email) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
        method: "POST",
        headers: { "Content-Type":"application/json", "apikey":SUPABASE_ANON },
        body: JSON.stringify({
          email,
          options: {
            // PWA deeplink — must match your Supabase redirect URL whitelist
            emailRedirectTo: window.location.origin + window.location.pathname
          }
        })
      });
      return res.ok ? { error:null } : { error: await res.json() };
    },

    async exchangeCodeForSession(token) {
      // Called when user clicks magic link and is redirected back
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=magiclink`, {
        method: "POST",
        headers: { "Content-Type":"application/json", "apikey":SUPABASE_ANON },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      if (data.access_token) {
        localStorage.setItem("sb_session", JSON.stringify(data));
        return { session: data, error: null };
      }
      return { session: null, error: data };
    },

    getSession() {
      try {
        const raw = localStorage.getItem("sb_session");
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },

    signOut() {
      localStorage.removeItem("sb_session");
      localStorage.removeItem(CACHE_KEY);
    }
  },

  async from(table) {
    const session = sb.auth.getSession();
    const headers = {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON,
      ...(session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {})
    };
    return {
      headers,
      async select(query = "*", filters = "") {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${query}${filters ? "&" + filters : ""}`, { headers });
        return res.ok ? { data: await res.json(), error: null } : { data: null, error: await res.json() };
      },
      async upsert(body) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
          method: "POST",
          headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(body)
        });
        return res.ok ? { data: await res.json(), error: null } : { data: null, error: await res.json() };
      },
      async update(body, filters = "") {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filters}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=representation" },
          body: JSON.stringify(body)
        });
        return res.ok ? { data: await res.json(), error: null } : { data: null, error: await res.json() };
      },
      async insert(body) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=representation" },
          body: JSON.stringify(Array.isArray(body) ? body : [body])
        });
        return res.ok ? { data: await res.json(), error: null } : { data: null, error: await res.json() };
      }
    };
  },

  // Upload a File object to Supabase Storage, return public URL
  // Bucket: "avatars" — create it in Supabase Dashboard → Storage
  // Set bucket policy to public so URLs are readable without auth
  async uploadAvatar(userId, file) {
    const session = sb.auth.getSession();
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${userId}/avatar.${ext}`;
    // Delete old avatar first (upsert via overwrite)
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/avatars/${path}`,
      {
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON,
          "Authorization": `Bearer ${session?.access_token || SUPABASE_ANON}`,
          "Content-Type": file.type,
          "x-upsert": "true",   // overwrite if exists
        },
        body: file,
      }
    );
    if (!res.ok) return { url: null, error: await res.json() };
    // Construct public URL — works when bucket is set to public
    const url = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
    return { url, error: null };
  }
};

// ─── CACHE (localStorage as offline buffer) ────────────────────────────────
// In PWA: always read from cache first, sync to Supabase when online
const CACHE_KEY = "streethunt_cache_v1";

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; }
  catch { return {}; }
}
function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), ...data })); }
  catch {}
}

// ─── DEMO MODE ─────────────────────────────────────────────────────────────
// When SUPABASE_URL is not configured, everything runs locally
const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON;

// ─── DATA ──────────────────────────────────────────────────────────────────
// Sticker icon — shows art_url image from DB, falls back to colored placeholder
function StickerIcon({ sticker, size=64 }) {
  const [err, setErr] = useState(false);
  const color = sticker?.color || "#C6FF00";
  const letter = (sticker?.name || "?")[0].toUpperCase();

  if (sticker?.art_url && !err) {
    return (
      <img
        src={sticker.art_url}
        alt={sticker.name}
        onError={() => setErr(true)}
        style={{ width:size, height:size, objectFit:"contain", borderRadius:size*0.18, display:"block" }}
      />
    );
  }
  // Fallback — colored letter tile
  return (
    <div style={{ width:size, height:size, borderRadius:size*0.18, background:`${color}18`, border:`1.5px solid ${color}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.45, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, color, flexShrink:0 }}>
      {letter}
    </div>
  );
}

// Default stickers — shown instantly before DB loads, no art_url
const DEFAULT_STICKERS = [
  { id:"s1", name:"Dead Eye",    rarity:"Common",    pts:10, hint:"Near a red wall",         color:"#FF4444", art_url:null },
  { id:"s2", name:"Neon Reaper", rarity:"Rare",      pts:20, hint:"Dark alley wall",          color:"#C6FF00", art_url:null },
  { id:"s3", name:"Grin",        rarity:"Common",    pts:10, hint:"Bus stop or bench",        color:"#ffffff", art_url:null },
  { id:"s4", name:"Void King",   rarity:"Epic",      pts:35, hint:"Underground spot",         color:"#8B5CF6", art_url:null },
  { id:"s5", name:"Rust Face",   rarity:"Rare",      pts:20, hint:"Industrial area",          color:"#FF8C00", art_url:null },
  { id:"s6", name:"Ghost Tag",   rarity:"Common",    pts:10, hint:"Stairwell or corner",      color:"#88ccff", art_url:null },
  { id:"s7", name:"Gold Tooth",  rarity:"Legendary", pts:50, hint:"Only 3 exist in Jakarta",  color:"#FFD700", art_url:null },
  { id:"s8", name:"Static",      rarity:"Epic",      pts:35, hint:"Near electronics shops",   color:"#00FFCC", art_url:null },
];

// Fetch active stickers from Supabase including art_url
async function fetchStickersFromDB() {
  if (IS_DEMO) return DEFAULT_STICKERS;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/stickers?active=eq.true&order=id&select=id,name,rarity,pts,hint,color,art_url,reference_url`,
      { headers: { "apikey": SUPABASE_ANON, "Content-Type": "application/json" } }
    );
    if (!res.ok) return DEFAULT_STICKERS;
    const rows = await res.json();
    if (!rows?.length) return DEFAULT_STICKERS;
    return rows;
  } catch {
    return DEFAULT_STICKERS;
  }
}

// Module-level stickers ref — updated after DB fetch
let STICKERS = DEFAULT_STICKERS;

const RARITY_CONFIG = {
  Common:    { color:"#aaa",    bg:"rgba(170,170,170,0.08)", border:"rgba(170,170,170,0.2)"  },
  Rare:      { color:"#8B5CF6", bg:"rgba(139,92,246,0.1)",  border:"rgba(139,92,246,0.3)"   },
  Epic:      { color:"#EC4899", bg:"rgba(236,72,153,0.1)",  border:"rgba(236,72,153,0.3)"   },
  Legendary: { color:"#FFD700", bg:"rgba(255,215,0,0.1)",   border:"rgba(255,215,0,0.35)"   },
};

// No seed drops — map starts empty, real drops load from DB
const SEED_DROPS = [];

// ─── SCORING ───────────────────────────────────────────────────────────────
function calcScore(sticker, isFirst, isPioneer) {
  const RB = { Common:0, Rare:5, Epic:15, Legendary:30 };
  let total = sticker.pts;
  const breakdown = [{ label:"Base find", pts:sticker.pts }];
  if (isFirst)   { total += 50; breakdown.push({ label:"🎉 First find ever", pts:50 }); }
  if (isPioneer) { total += 15; breakdown.push({ label:"🏴 Pioneer drop",    pts:15 }); }
  const rb = RB[sticker.rarity]||0;
  if (rb)        { total += rb;  breakdown.push({ label:`⭐ ${sticker.rarity}`,   pts:rb  }); }
  return { total, breakdown };
}

// ─── VALIDATION ────────────────────────────────────────────────────────────
async function validateSticker(userPhotoBase64, sticker) {
  if (IS_DEMO) {
    // Demo simulation — no API call
    await new Promise(r => setTimeout(r, 2200));
    const valid = Math.random() > 0.3;
    return {
      valid,
      confidence: valid ? Math.floor(75+Math.random()*25) : Math.floor(20+Math.random()*40),
      reason: valid ? `${sticker.name} confirmed.` : "Photo doesn't match the sticker.",
    };
  }

  // Production — hits /api/validate, Anthropic key stays server-side
  const res = await fetch("/api/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userPhotoBase64,
      referenceId: sticker.id,
      stickerName: sticker.name,
    }),
  });

  if (!res.ok) {
    return { valid: false, confidence: 0, reason: "Server error. Please try again." };
  }

  return res.json();
}

// ─── SUPABASE SYNC ─────────────────────────────────────────────────────────
async function syncUserFromDB(userId) {
  if (IS_DEMO) return null;
  try {
    const t = await sb.from("users");
    const { data } = await t.select("*", `user_id=eq.${userId}`);
    return data?.[0] || null;
  } catch { return null; }
}

async function saveUserToDB(userId, profile) {
  if (IS_DEMO) return;
  try {
    const t = await sb.from("users");
    await t.upsert({ user_id: userId, ...profile, updated_at: new Date().toISOString() });
  } catch {}
}

async function saveDropToDB(userId, drop) {
  if (IS_DEMO) return;
  try {
    const t = await sb.from("drops");
    await t.insert({ user_id: userId, sticker_id: drop.stickerId, lat: drop.lat, lng: drop.lng, city: drop.city, pts: drop.pts, pioneer: drop.pioneer });
  } catch {}
}

async function loadDropsFromDB(userId) {
  if (IS_DEMO) return [];
  try {
    const t = await sb.from("drops");
    const { data } = await t.select("*", `user_id=eq.${userId}&order=created_at.desc`);
    return (data||[]).map(d => ({
      id: d.id, lat: d.lat, lng: d.lng, stickerId: d.sticker_id,
      owner: d.username || "you", city: d.city, time: "synced",
      pts: d.pts, pioneer: d.pioneer, isOwn: true,
    }));
  } catch { return []; }
}

// ─── CSS ───────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500&family=Space+Mono:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0A0A0A;font-family:'Barlow',sans-serif;color:#fff;overflow:hidden;height:100vh}
button{cursor:pointer;font-family:'Barlow',sans-serif}
button:active{transform:scale(0.96)}
input{font-family:'Barlow',sans-serif}
.app{max-width:390px;margin:0 auto;height:100vh;overflow:hidden;background:#0A0A0A;position:relative}
.screen{height:100vh;overflow-y:auto;animation:fadeIn 0.22s ease;scrollbar-width:none;-ms-overflow-style:none}
.screen::-webkit-scrollbar{display:none}

.leaflet-tile{filter:invert(1) hue-rotate(180deg) brightness(0.72) saturate(0.35) contrast(1.1)!important}
.leaflet-container{background:#080c10!important}
.leaflet-control-zoom,.leaflet-control-attribution{display:none!important}
.leaflet-popup-content-wrapper{background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important}
.leaflet-popup-content{margin:0!important}
.leaflet-popup-tip-container,.leaflet-popup-close-button{display:none!important}

@keyframes fadeIn    {from{opacity:0}to{opacity:1}}
@keyframes slideUp   {from{transform:translateY(18px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes slideDown {from{transform:translateY(-14px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes scaleIn   {from{transform:scale(0.86);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes float     {0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes floatSlow {0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes scanLine  {0%{top:-2px;opacity:0}5%{opacity:1}95%{opacity:1}100%{top:100%;opacity:0}}
@keyframes spin      {to{transform:rotate(360deg)}}
@keyframes livePulse {0%,100%{opacity:1}50%{opacity:0.2}}
@keyframes pinDrop   {0%{transform:translateY(-18px) scale(0.75);opacity:0}65%{transform:translateY(3px) scale(1.05)}100%{transform:translateY(0) scale(1);opacity:1}}
@keyframes loadBar   {0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
@keyframes glowPulse {0%,100%{box-shadow:0 0 16px rgba(198,255,0,0.3)}50%{box-shadow:0 0 36px rgba(198,255,0,0.7)}}
@keyframes countUp   {from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulseRing {0%{transform:scale(1);opacity:0.5}100%{transform:scale(1.8);opacity:0}}
@keyframes shimmer   {0%{opacity:0.4}50%{opacity:0.8}100%{opacity:0.4}}
`;

// ─── SHARED ────────────────────────────────────────────────────────────────
function Eye({ size=80, pulse=true }) {
  return (
    <div style={{ position:"relative", width:size, height:size*0.75, flexShrink:0 }}>
      <svg width={size} height={size*0.75} viewBox="0 0 80 60" fill="none">
        <ellipse cx="40" cy="30" rx="38" ry="26" stroke="#C6FF00" strokeWidth="2" style={{ filter:"drop-shadow(0 0 6px #C6FF0080)" }}/>
        <circle cx="40" cy="30" r="13" fill="#C6FF00" style={{ filter:"drop-shadow(0 0 8px #C6FF00)" }}/>
        <circle cx="40" cy="30" r="7" fill="#0A0A0A"/>
        <circle cx="44" cy="26" r="3" fill="#C6FF00"/>
      </svg>
      {pulse && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}><div style={{ width:size+8, height:(size*0.75)+6, borderRadius:"50%", border:"1px solid #C6FF0050", animation:"pulseRing 2.5s ease-out infinite" }}/></div>}
    </div>
  );
}

function RarityBadge({ rarity, small }) {
  const c = RARITY_CONFIG[rarity]||RARITY_CONFIG.Common;
  return <span style={{ padding:small?"2px 7px":"3px 10px", borderRadius:20, fontSize:small?9:10, fontFamily:"'Space Mono',monospace", background:c.bg, border:`1px solid ${c.border}`, color:c.color, whiteSpace:"nowrap" }}>{rarity}</span>;
}

function Spinner({ color="#C6FF00" }) {
  return <div style={{ width:24, height:24, border:`2px solid ${color}`, borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>;
}

// Renders any avatar type: emoji, uploaded image (URL or preview), or legacy SVG sticker
// avatarId is a JSON string: {"type":"emoji","value":"🪦"} | {"type":"upload","value":"https://..."} | {"type":"upload","preview":"blob:..."}
// or a legacy sticker id like "s1"
function AvatarDisplay({ avatarId, size=32, style={} }) {
  let parsed = null;
  try { parsed = JSON.parse(avatarId); } catch {}

  if (parsed?.type === "emoji") {
    return (
      <div style={{ width:size, height:size, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.6, lineHeight:1, ...style }}>
        {parsed.value}
      </div>
    );
  }
  if (parsed?.type === "upload") {
    const src = parsed.value || parsed.preview;
    return (
      <img src={src} alt="avatar"
        style={{ width:size, height:size, objectFit:"cover", borderRadius:size*0.25, display:"block", ...style }}/>
    );
  }
  // Legacy sticker id — find in current STICKERS list and render as StickerIcon
  const sticker = STICKERS.find(s => s.id === avatarId) || { name:"?", color:"#C6FF00", art_url:null };
  return <div style={{ ...style }}><StickerIcon sticker={sticker} size={size}/></div>;
}

function OnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (online) return null;
  return (
    <div style={{ position:"fixed", top:0, left:"50%", transform:"translateX(-50%)", zIndex:9998, background:"#FF4444", borderRadius:"0 0 12px 12px", padding:"6px 16px", fontFamily:"'Space Mono',monospace", fontSize:10, color:"#fff", display:"flex", alignItems:"center", gap:6 }}>
      <div style={{ width:6, height:6, borderRadius:"50%", background:"#fff", animation:"shimmer 1s ease-in-out infinite" }}/>
      OFFLINE — data will sync when connected
    </div>
  );
}

// ─── AUTH SCREEN ────────────────────────────────────────────────────────────
// Handles: new user signup, returning user login, magic link redirect
function AuthScreen({ onAuth, pendingSession }) {
  const [stage, setStage]   = useState(pendingSession ? "username" : "email");
  const [email, setEmail]   = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const sendMagicLink = async () => {
    setLoading(true); setError("");
    if (IS_DEMO) {
      // Demo: skip real email, go straight to username setup
      await new Promise(r => setTimeout(r, 1200));
      setStage("username"); setLoading(false); return;
    }
    const { error: err } = await sb.auth.signInWithOtp(email);
    setLoading(false);
    if (err) { setError("Couldn't send link. Check your email."); return; }
    setStage("sent");
  };

  // avatarData shape:
  //   emoji:  { type:"emoji",  value:"🪦" }
  //   upload: { type:"upload", file: File, preview: objectURL }  ← before save
  //           { type:"upload", value: "https://…supabase…/avatars/…" }  ← after save
  const [avatarData, setAvatarData] = useState(null);
  const fileRef = useRef(null);

  // Keep a local object URL for instant preview — no base64 bloat
  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Revoke previous preview to avoid memory leaks
    if (avatarData?.preview) URL.revokeObjectURL(avatarData.preview);
    const preview = URL.createObjectURL(file);
    setAvatarData({ type:"upload", file, preview });
  };

  const completeProfile = async () => {
    if (!username || username.length < 3 || !avatarData) return;
    setLoading(true);

    let finalAvatarData = avatarData;

    // If user uploaded a photo, push it to Supabase Storage
    if (avatarData.type === "upload" && avatarData.file && !IS_DEMO) {
      const userId = sb.auth.getSession()?.user?.id || `demo_${Date.now()}`;
      const { url, error } = await sb.uploadAvatar(userId, avatarData.file);
      if (url) {
        // Clean up object URL, swap for permanent storage URL
        URL.revokeObjectURL(avatarData.preview);
        finalAvatarData = { type:"upload", value: url };
      } else {
        // Upload failed — fall back to storing a tiny preview as base64
        // (better than nothing; user can retry later)
        console.warn("Avatar upload failed, falling back to base64", error);
        const b64 = await new Promise(res => {
          const r = new FileReader();
          r.onload = e => res(e.target.result);
          r.readAsDataURL(avatarData.file);
        });
        finalAvatarData = { type:"upload", value: b64 };
      }
    } else if (avatarData.type === "upload" && avatarData.file && IS_DEMO) {
      // Demo mode: convert to base64 so preview persists in localStorage
      const b64 = await new Promise(res => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.readAsDataURL(avatarData.file);
      });
      URL.revokeObjectURL(avatarData.preview);
      finalAvatarData = { type:"upload", value: b64 };
    }

    const avatarJson = JSON.stringify(finalAvatarData);
    // Use userId from pendingSession (magic link flow) or generate demo id
    const userId = pendingSession?.user?.id || (IS_DEMO ? `demo_${Date.now()}` : sb.auth.getSession()?.user?.id);
    const profile = { username, avatar_id: avatarJson, total_score: 0, finds: 0, discovered: [] };
    await saveUserToDB(userId, profile);
    writeCache({ userId, ...profile, ownDrops: [] });
    onAuth({ userId, ...profile });
    setLoading(false);
  };

  // Override legacy avatar for this stage
  const avatar = avatarData ? "set" : null;

  // EMAIL STAGE
  if (stage === "email") return (
    <div style={{ minHeight:"100vh", background:"#0A0A0A", display:"flex", flexDirection:"column", padding:"60px 28px 48px", gap:32, position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)", width:"130%", height:"50%", background:"radial-gradient(ellipse at 50% 100%,#C6FF0010 0%,transparent 70%)", pointerEvents:"none" }}/>
      <div style={{ display:"flex", justifyContent:"center", animation:"float 3s ease-in-out infinite" }}><Eye size={80}/></div>
      <div>
        <p style={{ fontFamily:"'Space Mono',monospace", color:"#C6FF00", fontSize:10, letterSpacing:"0.2em", marginBottom:8 }}>STREET HUNT</p>
        <h1 style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:48, fontWeight:800, lineHeight:0.95, marginBottom:10 }}>FIND THE<br/>STICKER</h1>
        <p style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff40", fontSize:11, lineHeight:1.7 }}>
          Enter your email to get started.<br/>
          We'll send a magic link — no password needed.
        </p>
      </div>

      {IS_DEMO && (
        <div style={{ background:"rgba(198,255,0,0.06)", border:"1px solid rgba(198,255,0,0.2)", borderRadius:12, padding:"10px 14px" }}>
          <p style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#C6FF00", lineHeight:1.6 }}>
            🧪 Demo mode — Supabase not configured.<br/>
            Email won't be sent. Tap continue to test the full flow.
          </p>
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <label style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#ffffff35", letterSpacing:"0.1em" }}>EMAIL ADDRESS</label>
        <input
          type="email" value={email}
          onChange={e => { setEmail(e.target.value); setError(""); }}
          onKeyDown={e => e.key==="Enter" && validEmail && sendMagicLink()}
          placeholder="you@email.com"
          style={{ padding:"15px 18px", background:"#141414", border:`1px solid ${validEmail?"#C6FF0050":"#2A2A2A"}`, borderRadius:12, color:"#fff", fontSize:14, fontFamily:"'Space Mono',monospace", outline:"none", transition:"border 0.2s" }}
        />
        {error && <p style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#FF4444" }}>{error}</p>}
      </div>

      <div style={{ marginTop:"auto" }}>
        <button onClick={sendMagicLink} disabled={!validEmail||loading}
          style={{ width:"100%", padding:"16px", background:validEmail&&!loading?"#C6FF00":"#1A1A1A", border:`1px solid ${validEmail&&!loading?"#C6FF00":"#2A2A2A"}`, borderRadius:14, color:validEmail&&!loading?"#0A0A0A":"#333", fontSize:15, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, letterSpacing:"0.08em", transition:"all 0.2s", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
          {loading ? <><Spinner color="#0A0A0A"/> SENDING...</> : IS_DEMO ? "CONTINUE →" : "SEND MAGIC LINK →"}
        </button>
      </div>
    </div>
  );

  // SENT STAGE (waiting for email click)
  if (stage === "sent") return (
    <div style={{ minHeight:"100vh", background:"#0A0A0A", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 28px", gap:28, textAlign:"center" }}>
      <div style={{ animation:"float 3s ease-in-out infinite" }}><Eye size={80}/></div>
      <div>
        <h2 style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:36, fontWeight:800, marginBottom:8 }}>Check your email</h2>
        <p style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff50", fontSize:11, lineHeight:1.8 }}>
          We sent a magic link to<br/>
          <span style={{ color:"#C6FF00" }}>{email}</span><br/><br/>
          Click the link in the email — it'll bring you back here and log you in automatically.
        </p>
      </div>
      <div style={{ background:"#141414", border:"1px solid #2A2A2A", borderRadius:14, padding:"14px 18px", width:"100%", maxWidth:300 }}>
        <p style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#ffffff35", lineHeight:1.8 }}>
          💡 PWA tip: If the link opens in Safari, tap the share icon → "Open in..." → your browser where the app is installed.
        </p>
      </div>
      <button onClick={() => setStage("email")} style={{ background:"none", border:"none", fontFamily:"'Space Mono',monospace", fontSize:11, color:"#ffffff30", textDecoration:"underline" }}>
        Use a different email
      </button>
    </div>
  );

  // USERNAME SETUP (first time only)
  if (stage === "username") return (
    <div style={{ minHeight:"100vh", background:"#0A0A0A", display:"flex", flexDirection:"column", padding:"52px 28px 40px", gap:24 }}>
      <div style={{ display:"flex", justifyContent:"center", animation:"float 3s ease-in-out infinite" }}><Eye size={64}/></div>
      <div>
        <p style={{ fontFamily:"'Space Mono',monospace", color:"#C6FF00", fontSize:10, letterSpacing:"0.15em", marginBottom:8 }}>ONE TIME SETUP</p>
        <h2 style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:40, fontWeight:800, lineHeight:1 }}>SET YOUR TAG</h2>
        <p style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff40", fontSize:11, marginTop:8, lineHeight:1.6 }}>Your identity on the leaderboard and map. Can't be changed later.</p>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <label style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#ffffff35", letterSpacing:"0.1em" }}>USERNAME</label>
        <input value={username} onChange={e => setUsername(e.target.value.replace(/\s/g,"").toLowerCase().slice(0,20))}
          placeholder="e.g. streetcrawler"
          style={{ padding:"15px 18px", background:"#141414", border:`1px solid ${username.length>2?"#C6FF0050":"#2A2A2A"}`, borderRadius:12, color:"#fff", fontSize:14, fontFamily:"'Space Mono',monospace", outline:"none", transition:"border 0.2s" }}/>
        {username.length>0&&username.length<3 && <p style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#FF4444" }}>min 3 characters</p>}
        {username.length>=3 && <p style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#C6FF00" }}>✓ looks good</p>}
      </div>

      <div>
        <p style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#ffffff35", letterSpacing:"0.1em", marginBottom:12 }}>PICK YOUR AVATAR</p>

        {/* Preview */}
        {avatarData && (
          <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
            <AvatarDisplay avatarId={JSON.stringify(
              avatarData.type === "upload" && avatarData.preview
                ? { type:"upload", preview: avatarData.preview }
                : avatarData
            )} size={72} style={{ borderRadius:20, border:"2px solid #C6FF00", boxShadow:"0 0 20px rgba(198,255,0,0.25)", animation:"float 2.5s ease-in-out infinite" }}/>
          </div>
        )}

        {/* Emoji options */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:10 }}>
          {[
            { type:"emoji", value:"🪦", label:"Headstone" },
            { type:"emoji", value:"💀", label:"Skull" },
          ].map(opt => {
            const sel = avatarData?.type==="emoji" && avatarData?.value===opt.value;
            return (
              <button key={opt.value} onClick={() => setAvatarData(opt)}
                style={{ background:sel?"#141414":"#0d0d0d", border:`1.5px solid ${sel?"#C6FF00":"#1e1e1e"}`, borderRadius:16, padding:"16px 10px", display:"flex", flexDirection:"column", alignItems:"center", gap:8, boxShadow:sel?"0 0 18px rgba(198,255,0,0.2)":"none", transition:"all 0.2s" }}>
                <span style={{ fontSize:40, lineHeight:1, animation:sel?"float 2.5s ease-in-out infinite":"none", display:"block" }}>{opt.value}</span>
                <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:sel?"#C6FF00":"#ffffff35", fontWeight:700 }}>{opt.label}</span>
              </button>
            );
          })}

          {/* Upload button */}
          <button onClick={() => fileRef.current?.click()}
            style={{ background:avatarData?.type==="upload"?"#141414":"#0d0d0d", border:`1.5px solid ${avatarData?.type==="upload"?"#C6FF00":"#1e1e1e"}`, borderRadius:16, padding:"16px 10px", display:"flex", flexDirection:"column", alignItems:"center", gap:8, boxShadow:avatarData?.type==="upload"?"0 0 18px rgba(198,255,0,0.2)":"none", transition:"all 0.2s" }}>
            {avatarData?.type==="upload"
              ? <img src={avatarData.preview || avatarData.value} style={{ width:40, height:40, borderRadius:10, objectFit:"cover" }} alt="avatar"/>
              : <span style={{ fontSize:36, lineHeight:1, display:"block" }}>🖼️</span>
            }
            <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:avatarData?.type==="upload"?"#C6FF00":"#ffffff35", fontWeight:700 }}>{avatarData?.type==="upload"?"Change":"Upload"}</span>
          </button>
        </div>

        {/* Hidden file input — accepts images from gallery */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display:"none" }}
          onChange={handleUpload}
        />
        <p style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#ffffff20", textAlign:"center" }}>Upload opens your photo gallery on mobile</p>
      </div>

      <div style={{ marginTop:"auto" }}>
        <button onClick={completeProfile} disabled={username.length<3||!avatar||loading}
          style={{ width:"100%", padding:"16px", background:username.length>=3&&avatar&&!loading?"#C6FF00":"#1A1A1A", border:`1px solid ${username.length>=3&&avatar?"#C6FF00":"#2A2A2A"}`, borderRadius:14, color:username.length>=3&&avatar&&!loading?"#0A0A0A":"#333", fontSize:15, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, letterSpacing:"0.08em", transition:"all 0.2s", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
          {loading ? <><Spinner color="#0A0A0A"/> SAVING...</> : "LET'S HUNT →"}
        </button>
      </div>
    </div>
  );
}

// ─── DASHBOARD ─────────────────────────────────────────────────────────────
function Dashboard({ user, totalScore, drops, discovered, stickers, onHunt, onMap, onProfile }) {
  const [lb, setLb] = useState([{ tag:user.username, pts:totalScore, avatarId:user.avatar_id, own:true }]);

  // Load real leaderboard from DB
  useEffect(()=>{
    if (IS_DEMO) return;
    fetch(`${SUPABASE_URL}/rest/v1/users?select=username,total_score,avatar_id&order=total_score.desc&limit=10`,
      { headers:{ "apikey":SUPABASE_ANON } })
      .then(r=>r.json())
      .then(rows=>{
        if (!rows?.length) return;
        setLb(rows.map(r=>({ tag:r.username, pts:r.total_score, avatarId:r.avatar_id, own:r.username===user.username })));
      })
      .catch(()=>{});
  },[totalScore]);
  const rank = lb.findIndex(e=>e.own)+1;

  return (
    <div style={{ minHeight:"100vh", background:"#0A0A0A" }}>
      <div style={{ padding:"12px 20px 6px", display:"flex", justifyContent:"space-between" }}>
        <span style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff30", fontSize:11 }}>9:41</span>
        <span style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff30", fontSize:10 }}>●●●● WiFi</span>
      </div>
      <div style={{ padding:"4px 20px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <p style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff40", fontSize:11 }}>Welcome back.</p>
          <p style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:22, fontWeight:800 }}>@{user.username}</p>
        </div>
        <button onClick={onProfile} style={{ background:"none", border:"none", padding:0 }}>
          <div style={{ width:40, height:40, borderRadius:12, background:"#141414", border:"1px solid #2A2A2A", display:"flex", alignItems:"center", justifyContent:"center", animation:"floatSlow 3s ease-in-out infinite", overflow:"hidden" }}>
            <AvatarDisplay avatarId={user.avatar_id} size={28}/>
          </div>
        </button>
      </div>

      {/* Score card */}
      <div style={{ padding:"0 20px 16px" }}>
        <div style={{ background:"linear-gradient(135deg,#1A1A1A,#141414)", border:"1px solid #2A2A2A", borderRadius:20, padding:"18px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <p style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff40", fontSize:10, marginBottom:4 }}>Your Score</p>
            <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
              <span key={totalScore} style={{ color:"#C6FF00", fontSize:54, fontWeight:800, fontFamily:"'Barlow Condensed',sans-serif", lineHeight:1, textShadow:"0 0 20px #C6FF0060", animation:"countUp 0.4s ease" }}>{totalScore}</span>
              <span style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff30", fontSize:12 }}>pts</span>
            </div>
            <div style={{ marginTop:10, height:4, width:140, background:"#2A2A2A", borderRadius:2 }}>
              <div style={{ height:"100%", width:`${Math.min((totalScore/1000)*100,100)}%`, background:"linear-gradient(90deg,#C6FF00,#E8FF00)", borderRadius:2, transition:"width 0.8s ease" }}/>
            </div>
            <div style={{ display:"flex", gap:14, marginTop:8 }}>
              <span style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#8B5CF6" }}>💀 {discovered.length} found</span>
              <span style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#FFD700" }}>🏆 #{rank}</span>
            </div>
          </div>
          <div style={{ animation:"float 3s ease-in-out infinite" }}>
            <AvatarDisplay avatarId={user.avatar_id} size={64}/>
          </div>
        </div>
      </div>

      {/* Mini map */}
      <div style={{ padding:"0 20px 16px" }}>
        <div onClick={onMap} style={{ height:130, borderRadius:16, overflow:"hidden", border:"1px solid #2A2A2A", cursor:"pointer", position:"relative", background:"#0d1520" }}>
          <svg width="100%" height="100%" style={{ position:"absolute", inset:0 }}><rect width="100%" height="100%" fill="#0d1520"/><path d="M0 65 Q130 45 280 70 Q360 82 500 65" stroke="#ffffff08" strokeWidth="6" fill="none"/><ellipse cx="300" cy="90" rx="55" ry="30" fill="#1a2a40" opacity="0.5"/></svg>
          {SEED_DROPS.slice(0,5).map((d,i) => {
            const st=STICKERS.find(s=>s.id===d.stickerId);
            return <div key={d.id} style={{ position:"absolute", left:`${14+i*16}%`, top:`${28+[0,20,-8,14,-4][i]}%`, transform:"translate(-50%,-100%)", animation:`float ${1.9+i*0.22}s ease-in-out infinite`, animationDelay:`${i*0.12}s` }}>
              <svg width="13" height="17" viewBox="0 0 13 17"><path d="M6.5 0C2.9 0 0 2.9 0 6.5C0 11.4 6.5 17 6.5 17S13 11.4 13 6.5C13 2.9 10.1 0 6.5 0Z" fill={st?.color||"#8B5CF6"}/><circle cx="6.5" cy="6.5" r="2.8" fill="#0A0A0A"/></svg>
            </div>;
          })}
          <div style={{ position:"absolute", top:8, right:10, background:"rgba(10,10,10,0.85)", borderRadius:8, padding:"3px 9px", fontFamily:"'Space Mono',monospace", fontSize:9, color:"#fff" }}>↗ Expand</div>
          <div style={{ position:"absolute", bottom:8, left:10, fontFamily:"'Space Mono',monospace", fontSize:9, color:"rgba(255,255,255,0.3)" }}>{drops.length} pins worldwide</div>
        </div>
      </div>

      {/* Hunt CTA */}
      <div style={{ padding:"0 20px 16px" }}>
        <button onClick={onHunt}
          style={{ width:"100%", padding:"16px", background:"#141414", border:"1px solid #2A2A2A", borderRadius:14, color:"#fff", fontSize:15, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, letterSpacing:"0.06em", transition:"all 0.2s", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="#C6FF00";e.currentTarget.style.color="#C6FF00"}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="#2A2A2A";e.currentTarget.style.color="#fff"}}>
          🔍 I FOUND A STICKER
        </button>
      </div>

      {/* Leaderboard */}
      <div style={{ padding:"0 20px 40px" }}>
        <div style={{ background:"#0A0A0A", border:"1px solid #1A1A1A", borderRadius:20, overflow:"hidden" }}>
          <div style={{ padding:"16px 20px 12px", borderBottom:"1px solid #1A1A1A", display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
            <h2 style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26, fontWeight:800 }}>Leaderboard</h2>
            <span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#ffffff30" }}>ALL TIME</span>
          </div>
          {lb.map((e,i) => {
            return <div key={i} style={{ padding:"10px 20px", borderBottom:"1px solid #ffffff04", display:"flex", alignItems:"center", gap:12, background:e.own?"rgba(198,255,0,0.04)":"transparent" }}>
              <span style={{ fontFamily:"'Space Mono',monospace", color:i<3?"#C6FF00":"#ffffff18", fontSize:11, width:16 }}>{i+1}</span>
              <div style={{ width:28, height:28, borderRadius:8, background:"#141414", display:"flex", alignItems:"center", justifyContent:"center", border:e.own?"1px solid rgba(198,255,0,0.3)":"1px solid #1e1e1e", flexShrink:0, overflow:"hidden" }}>
                <AvatarDisplay avatarId={e.avatarId} size={22}/>
              </div>
              <span style={{ flex:1, fontFamily:"'Space Mono',monospace", color:e.own?"#C6FF00":"#fff", fontSize:11, fontWeight:e.own?700:400 }}>@{e.tag}{e.own?" ✓":""}</span>
              <span style={{ fontFamily:"'Space Mono',monospace", color:e.own?"#C6FF00":"#ffffff30", fontSize:11 }}>{e.pts}</span>
            </div>;
          })}
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"center", paddingBottom:32 }}><Eye size={32} pulse={false}/></div>
    </div>
  );
}

// ─── FIND STICKER ───────────────────────────────────────────────────────────
function FindSticker({ stickers, discovered, onSelect, onBack }) {
  const [selected, setSelected] = useState(null);
  const sel = STICKERS.find(s=>s.id===selected);
  return (
    <div style={{ minHeight:"100vh", background:"#0A0A0A", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14, borderBottom:"1px solid #1A1A1A" }}>
        <button onClick={onBack} style={{ background:"#141414", border:"1px solid #2A2A2A", borderRadius:10, width:38, height:38, color:"#fff", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>←</button>
        <div>
          <h1 style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26, fontWeight:800 }}>Found a Sticker?</h1>
          <p style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#ffffff35", marginTop:1 }}>Select the one you spotted IRL</p>
        </div>
      </div>
      {sel && (
        <div style={{ margin:"14px 20px 0", background:"#141414", border:`1px solid ${sel.color}40`, borderRadius:16, padding:"13px 16px", display:"flex", alignItems:"center", gap:14, animation:"slideDown 0.2s ease" }}>
          <div style={{ width:50, height:50, background:"#0A0A0A", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", border:`1px solid ${sel.color}30`, animation:"float 2.5s ease-in-out infinite", overflow:"hidden" }}>
            <StickerIcon sticker={sel} size={40}/>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:20, fontWeight:800, color:sel.color }}>{sel.name}</div>
            <div style={{ display:"flex", gap:6, marginTop:4 }}><RarityBadge rarity={sel.rarity} small/><span style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#ffffff35" }}>+{sel.pts} pts base</span></div>
            <p style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#ffffff25", marginTop:4 }}>💡 {sel.hint}</p>
          </div>
        </div>
      )}
      <div style={{ padding:"16px 20px", flex:1 }}>
        <p style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#ffffff25", letterSpacing:"0.1em", marginBottom:12 }}>ALL STICKERS — {stickers.length} IN CIRCULATION</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
          {stickers.map(s => {
            const isSel=selected===s.id; const isDone=discovered.includes(s.id);
            return <button key={s.id} onClick={()=>setSelected(s.id)}
              style={{ background:isSel?"#141414":"#0d0d0d", border:`1.5px solid ${isSel?s.color:"#1e1e1e"}`, borderRadius:16, padding:"14px 10px 12px", display:"flex", flexDirection:"column", alignItems:"center", gap:7, transition:"all 0.2s", boxShadow:isSel?`0 0 18px ${s.color}25`:"none", position:"relative" }}>
              <div style={{ animation:isSel?"float 2.5s ease-in-out infinite":"none" }}>
                <StickerIcon sticker={s} size={50}/>
              </div>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:800, color:isSel?s.color:"#fff", lineHeight:1 }}>{s.name}</div>
                <div style={{ display:"flex", justifyContent:"center", marginTop:4 }}><RarityBadge rarity={s.rarity} small/></div>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#ffffff25", marginTop:3 }}>+{s.pts} pts</div>
              </div>
              {isDone && <div style={{ position:"absolute", top:7, right:7, width:16, height:16, borderRadius:"50%", background:"#C6FF00", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"#000", fontWeight:700 }}>✓</div>}
            </button>;
          })}
        </div>
      </div>
      <div style={{ padding:"14px 20px 32px", borderTop:"1px solid #1A1A1A" }}>
        <button onClick={()=>selected&&onSelect(selected)}
          style={{ width:"100%", padding:"16px", background:selected?"#C6FF00":"#141414", border:`1px solid ${selected?"#C6FF00":"#2A2A2A"}`, borderRadius:14, color:selected?"#0A0A0A":"#333", fontSize:15, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, letterSpacing:"0.06em", transition:"all 0.2s" }}>
          {selected?"PHOTOGRAPH IT →":"SELECT A STICKER FIRST"}
        </button>
      </div>
    </div>
  );
}

// ─── CAMERA ────────────────────────────────────────────────────────────────
function Camera({ sticker, onCapture, onBack }) {
  const videoRef=useRef(null); const canvasRef=useRef(null); const streamRef=useRef(null);
  const [streaming,setStreaming]=useState(false); const [capturing,setCapturing]=useState(false); const [camErr,setCamErr]=useState(false);
  useEffect(()=>{
    (async()=>{
      try{const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});streamRef.current=s;if(videoRef.current){videoRef.current.srcObject=s;videoRef.current.play();setStreaming(true);}}catch{setCamErr(true);}
    })();
    return()=>streamRef.current?.getTracks().forEach(t=>t.stop());
  },[]);
  const capture=()=>{
    setCapturing(true);let b64=null;
    if(canvasRef.current&&videoRef.current&&streaming){const c=canvasRef.current,v=videoRef.current;c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);b64=c.toDataURL("image/jpeg",0.85).split(",")[1];}
    streamRef.current?.getTracks().forEach(t=>t.stop());
    setTimeout(()=>{setCapturing(false);onCapture(b64);},500);
  };
  return (
    <div style={{ minHeight:"100vh", background:"#000", display:"flex", flexDirection:"column", position:"relative" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, zIndex:10, padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", background:"linear-gradient(180deg,rgba(0,0,0,0.92) 0%,transparent 100%)" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.1)", border:"none", borderRadius:10, width:36, height:36, color:"#fff", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>←</button>
        <div style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(0,0,0,0.75)", border:`1px solid ${sticker.color}50`, borderRadius:12, padding:"6px 12px 6px 8px", backdropFilter:"blur(10px)" }}>
          <div style={{ width:28, height:28, background:"#111", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}><StickerIcon sticker={sticker} size={24}/></div>
          <div><div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:800, color:sticker.color }}>{sticker.name}</div><div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#ffffff40" }}>Match this sticker</div></div>
        </div>
        <div style={{ width:36 }}/>
      </div>
      <div style={{ flex:1, position:"relative", overflow:"hidden", background:"#0d1520" }}>
        <video ref={videoRef} style={{ width:"100%", height:"100%", objectFit:"cover", display:streaming?"block":"none" }} playsInline muted/>
        <canvas ref={canvasRef} style={{ display:"none" }}/>
        {!streaming && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
          {camErr?<><div style={{ background:"#141414", borderRadius:20, padding:20, animation:"float 3s ease-in-out infinite" }}><StickerIcon sticker={sticker} size={68}/></div><p style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff40", fontSize:11, textAlign:"center", maxWidth:200 }}>Camera unavailable — tap capture for demo</p></>:<Spinner/>}
        </div>}
        <div style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
          <div style={{ position:"absolute", left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${sticker.color},transparent)`, animation:"scanLine 2s linear infinite" }}/>
          {[{top:"20%",left:"10%"},{top:"20%",right:"10%",transform:"scaleX(-1)"},{bottom:"20%",left:"10%",transform:"scaleY(-1)"},{bottom:"20%",right:"10%",transform:"scale(-1)"}].map((s,i)=><div key={i} style={{ position:"absolute",...s, width:26, height:26, borderTop:`2px solid ${sticker.color}`, borderLeft:`2px solid ${sticker.color}`, filter:`drop-shadow(0 0 4px ${sticker.color}80)` }}/>)}
        </div>
        <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"50px 24px 20px", background:"linear-gradient(0deg,rgba(0,0,0,0.85) 0%,transparent 100%)" }}>
          <p style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"rgba(255,255,255,0.45)", textAlign:"center" }}>💡 {sticker.hint}</p>
        </div>
      </div>
      <div style={{ padding:"20px 24px 40px", background:"#000", display:"flex", justifyContent:"center", alignItems:"center", gap:32 }}>
        <div style={{ width:44 }}/>
        <button onClick={capture} disabled={capturing} style={{ width:72, height:72, borderRadius:"50%", background:capturing?sticker.color:"#fff", border:"5px solid #333", boxShadow:capturing?`0 0 32px ${sticker.color}80`:"none", transition:"all 0.3s", fontSize:28, display:"flex", alignItems:"center", justifyContent:"center" }}>
          {capturing?"":"📸"}
        </button>
        <div style={{ width:44, height:44, borderRadius:12, background:"#141414", border:"1px solid #2A2A2A", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}><StickerIcon sticker={sticker} size={32}/></div>
      </div>
    </div>
  );
}

// ─── VALIDATING ─────────────────────────────────────────────────────────────
function Validating({ sticker }) {
  return (
    <div style={{ minHeight:"100vh", background:"#000", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
      <div style={{ position:"absolute", inset:0, background:`radial-gradient(ellipse 80% 60% at 50% 50%,${sticker.color}0d 0%,transparent 70%)` }}/>
      <div style={{ position:"relative", zIndex:1, background:"rgba(255,255,255,0.95)", borderRadius:24, padding:"36px 28px", maxWidth:290, width:"calc(100% - 48px)", textAlign:"center", boxShadow:"0 24px 60px rgba(0,0,0,0.9)", animation:"scaleIn 0.3s ease" }}>
        <div style={{ animation:"float 2s ease-in-out infinite", marginBottom:20, display:"flex", justifyContent:"center" }}><StickerIcon sticker={sticker} size={72}/></div>
        <h3 style={{ fontFamily:"'Barlow Condensed',sans-serif", color:"#0A0A0A", fontSize:24, fontWeight:800, marginBottom:6 }}>Analyzing Photo...</h3>
        <p style={{ fontFamily:"'Space Mono',monospace", color:"#666", fontSize:11, lineHeight:1.7, marginBottom:22 }}>Claude AI is comparing your photo against the <strong>{sticker.name}</strong> reference.</p>
        <div style={{ height:3, background:"#eee", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:"38%", background:`linear-gradient(90deg,${sticker.color},${sticker.color}80)`, borderRadius:2, animation:"loadBar 1.1s ease-in-out infinite" }}/>
        </div>
      </div>
    </div>
  );
}

// ─── SUCCESS MODAL ──────────────────────────────────────────────────────────
function SuccessModal({ sticker, breakdown, total, isPioneer, confidence, onClose }) {
  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:24, background:"rgba(0,0,0,0.88)", backdropFilter:"blur(10px)" }}>
      <div style={{ background:"#141414", border:"1px solid #2A2A2A", borderRadius:24, padding:"28px 24px", width:"100%", maxWidth:330, animation:"scaleIn 0.35s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:20 }}>
          <div style={{ position:"relative" }}>
            <div style={{ width:80, height:80, borderRadius:20, background:"#0A0A0A", border:`2px solid ${sticker.color}`, display:"flex", alignItems:"center", justifyContent:"center", animation:"glowPulse 2s ease-in-out infinite", overflow:"hidden" }}><StickerIcon sticker={sticker} size={54}/></div>
            <div style={{ position:"absolute", top:-6, right:-6, width:24, height:24, borderRadius:"50%", background:"#C6FF00", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"#000", fontWeight:700 }}>✓</div>
          </div>
        </div>
        <h2 style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:30, fontWeight:800, textAlign:"center", marginBottom:4 }}>STICKER FOUND!</h2>
        <p style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#ffffff40", textAlign:"center", marginBottom:12 }}>{sticker.name}</p>
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:20, flexWrap:"wrap" }}>
          <RarityBadge rarity={sticker.rarity}/>
          <span style={{ padding:"3px 10px", borderRadius:20, fontSize:10, fontFamily:"'Space Mono',monospace", background:"rgba(198,255,0,0.1)", border:"1px solid rgba(198,255,0,0.3)", color:"#C6FF00" }}>{confidence}% match</span>
          {isPioneer&&<span style={{ padding:"3px 10px", borderRadius:20, fontSize:10, fontFamily:"'Space Mono',monospace", background:"rgba(255,215,0,0.1)", border:"1px solid rgba(255,215,0,0.3)", color:"#FFD700" }}>🏴 Pioneer</span>}
        </div>
        <div style={{ background:"#0A0A0A", borderRadius:14, padding:"14px 16px", marginBottom:20 }}>
          {breakdown.map((b,i)=>(
            <div key={i} style={{ display:"flex", justifyContent:"space-between", paddingBottom:i<breakdown.length-1?8:0, marginBottom:i<breakdown.length-1?8:0, borderBottom:i<breakdown.length-1?"1px solid #1e1e1e":"none" }}>
              <span style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#ffffff45" }}>{b.label}</span>
              <span style={{ fontFamily:"'Space Mono',monospace", fontSize:11, color:"#C6FF00", fontWeight:700 }}>+{b.pts}</span>
            </div>
          ))}
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:10, paddingTop:10, borderTop:"1px solid #2A2A2A" }}>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:18, fontWeight:800, color:"#fff" }}>TOTAL</span>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:22, fontWeight:800, color:"#C6FF00" }}>+{total}</span>
          </div>
        </div>
        <button onClick={onClose} style={{ width:"100%", padding:"15px", background:"#C6FF00", border:"none", borderRadius:12, color:"#0A0A0A", fontSize:16, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, letterSpacing:"0.06em" }}>BACK TO HUNT</button>
      </div>
    </div>
  );
}

// ─── FAILED ─────────────────────────────────────────────────────────────────
function Failed({ sticker, reason, onRetry, onBack }) {
  return (
    <div style={{ minHeight:"100vh", background:"#0A0A0A", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 28px", gap:24 }}>
      <div style={{ width:80, height:80, borderRadius:20, background:"#1a0000", border:"2px solid #FF4444", display:"flex", alignItems:"center", justifyContent:"center", animation:"float 3s ease-in-out infinite", overflow:"hidden" }}><StickerIcon sticker={sticker} size={52}/></div>
      <div style={{ textAlign:"center" }}>
        <h2 style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:32, fontWeight:800, color:"#FF4444", marginBottom:8 }}>NO MATCH</h2>
        <p style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff40", fontSize:11, lineHeight:1.7, maxWidth:260 }}>{reason}</p>
      </div>
      <div style={{ background:"#141414", border:"1px solid #2A2A2A", borderRadius:14, padding:"14px 18px", width:"100%", maxWidth:300 }}>
        <p style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#ffffff35", lineHeight:1.8 }}>💡 Tips:<br/>· Get closer to the sticker<br/>· Good lighting, no shadows<br/>· Hold the camera steady</p>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10, width:"100%" }}>
        <button onClick={onRetry} style={{ padding:"16px", background:"#C6FF00", border:"none", borderRadius:14, color:"#0A0A0A", fontSize:15, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, letterSpacing:"0.06em" }}>TRY AGAIN</button>
        <button onClick={onBack} style={{ padding:"14px", background:"none", border:"1px solid #2A2A2A", borderRadius:14, color:"#ffffff35", fontSize:12, fontFamily:"'Space Mono',monospace" }}>Back to sticker list</button>
      </div>
    </div>
  );
}

// ─── MAP ────────────────────────────────────────────────────────────────────
// Builds a map marker icon — uses art_url if available, else colored initial
function makeMarkerHtml(st, color, delay) {
  const inner = st.art_url
    ? `<img src="${st.art_url}" style="width:26px;height:26px;object-fit:contain;border-radius:4px;" onerror="this.style.display='none';this.nextSibling.style.display='flex'"/><span style="display:none;width:26px;height:26px;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14px;color:${color}">${(st.name||"?")[0]}</span>`
    : `<span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14px;color:${color}">${(st.name||"?")[0]}</span>`;
  return `<div style="display:flex;flex-direction:column;align-items:center;animation:pinDrop 0.45s cubic-bezier(0.34,1.56,0.64,1) ${delay}ms both"><div style="width:42px;height:42px;border-radius:50%;border:2.5px solid ${color};background:#0A0A0A;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px ${color}25,0 4px 14px rgba(0,0,0,0.7)">${inner}</div><div style="width:2px;height:9px;background:${color}"></div><div style="width:5px;height:5px;border-radius:50%;background:${color}"></div></div>`;
}

function makePopupHtml(st, d, rarCfg, color) {
  const artHtml = st.art_url
    ? `<img src="${st.art_url}" style="width:54px;height:54px;object-fit:contain;border-radius:8px;" />`
    : `<span style="font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:36px;color:${color}">${(st.name||"?")[0]}</span>`;
  return `<div style="background:#141414;border:1px solid #2A2A2A;border-radius:18px;width:220px;overflow:hidden;box-shadow:0 20px 40px rgba(0,0,0,0.8)"><div style="height:90px;background:#0A0A0A;display:flex;align-items:center;justify-content:center;position:relative">${artHtml}<div style="position:absolute;bottom:0;left:0;right:0;height:32px;background:linear-gradient(0deg,#141414,transparent)"></div></div><div style="padding:11px 13px 13px"><div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:800;color:#fff;margin-bottom:7px">${st.name}</div><div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px"><span style="padding:2px 8px;border-radius:20px;font-size:9px;font-family:'Space Mono',monospace;background:${rarCfg.bg};border:1px solid ${rarCfg.border};color:${rarCfg.color}">${st.rarity}</span><span style="padding:2px 8px;border-radius:20px;font-size:9px;font-family:'Space Mono',monospace;background:rgba(198,255,0,0.1);border:1px solid rgba(198,255,0,0.3);color:#C6FF00">+${d.pts} pts</span>${d.pioneer?`<span style="padding:2px 8px;border-radius:20px;font-size:9px;font-family:'Space Mono',monospace;background:rgba(255,215,0,0.1);border:1px solid rgba(255,215,0,0.3);color:#FFD700">🏴 Pioneer</span>`:""}</div><div style="font-family:'Space Mono',monospace;font-size:9px;color:#ffffff30;padding-top:8px;border-top:1px solid #2A2A2A">@${d.owner} · ${d.city} · ${d.time}</div></div></div>`;
}

function MapScreen({ drops, stickers, onBack }) {
  const mapRef=useRef(null); const inst=useRef(null); const [ready,setReady]=useState(false);
  useEffect(()=>{
    if(inst.current||!window.L)return;
    const m=window.L.map(mapRef.current,{center:[15,15],zoom:2.5,zoomControl:false,attributionControl:false,minZoom:2,maxZoom:17});
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{subdomains:["a","b","c"],maxZoom:17}).addTo(m);
    inst.current=m;setReady(true);
  },[]);
  useEffect(()=>{
    if(!ready||!inst.current)return;
    const L=window.L,m=inst.current;
    m.eachLayer(l=>{if(l._icon)m.removeLayer(l);});
    drops.forEach((d,i)=>{
      const st=stickers.find(s=>s.id===d.stickerId)||stickers[0]||{name:"?",color:"#C6FF00",rarity:"Common",art_url:null};
      const color=d.isOwn?"#C6FF00":st.color;
      const rarCfg=RARITY_CONFIG[st.rarity]||RARITY_CONFIG.Common;
      const icon=L.divIcon({html:makeMarkerHtml(st,color,i*45),className:"",iconSize:[42,62],iconAnchor:[21,62],popupAnchor:[0,-66]});
      const popup=makePopupHtml(st,d,rarCfg,color);
      L.marker([d.lat,d.lng],{icon}).addTo(m).bindPopup(popup,{maxWidth:230,className:"",closeOnClick:false,autoPan:true,autoPanPadding:[20,80]});
    });
    const own=drops.find(d=>d.isOwn);
    if(own)m.flyTo([own.lat,own.lng],10,{duration:1.2});
  },[ready,drops]);

  return (
    <div style={{ height:"100vh", position:"relative", background:"#080c10" }}>
      <div ref={mapRef} style={{ position:"absolute", inset:0 }}/>
      <div style={{ position:"absolute", inset:0, background:"rgba(8,10,12,0.18)", pointerEvents:"none", zIndex:400 }}/>
      <div style={{ position:"absolute", top:0, left:0, right:0, zIndex:1000, padding:"16px 20px 20px", background:"linear-gradient(180deg,rgba(8,12,16,0.97) 0%,transparent 100%)", display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={onBack} style={{ background:"rgba(20,20,20,0.9)", border:"1px solid #2A2A2A", borderRadius:12, width:40, height:40, color:"#fff", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(10px)" }}>←</button>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:22, fontWeight:800 }}>Hunt Map</div>
          <div style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#ffffff35", marginTop:1 }}>Where stickers were found</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(198,255,0,0.1)", border:"1px solid rgba(198,255,0,0.3)", borderRadius:20, padding:"5px 12px", fontFamily:"'Space Mono',monospace", fontSize:10, color:"#C6FF00" }}>
          <div style={{ width:5,height:5,background:"#C6FF00",borderRadius:"50%",animation:"livePulse 1.5s ease-in-out infinite" }}/>
          {drops.length} DROPS
        </div>
      </div>
      <div style={{ position:"absolute", bottom:0, left:0, right:0, zIndex:1000, background:"linear-gradient(0deg,rgba(8,10,12,0.98) 55%,transparent 100%)", paddingTop:36, paddingBottom:24 }}>
        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#ffffff25", letterSpacing:"0.1em", padding:"0 20px 10px" }}>RECENT FINDS</div>
        <div style={{ display:"flex", gap:8, overflowX:"auto", padding:"0 20px", scrollbarWidth:"none" }}>
          {drops.map(d=>{const st=stickers.find(s=>s.id===d.stickerId)||stickers[0]||{name:"?",color:"#C6FF00",art_url:null};return(
            <div key={d.id} onClick={()=>inst.current?.flyTo([d.lat,d.lng],13,{duration:1.1})} style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(20,20,20,0.95)", border:`1px solid ${d.isOwn?"rgba(198,255,0,0.35)":"#2A2A2A"}`, borderRadius:12, padding:"8px 12px", cursor:"pointer", flexShrink:0, backdropFilter:"blur(10px)" }}>
              <div style={{ width:28,height:28,background:"#141414",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden" }}><StickerIcon sticker={st} size={22}/></div>
              <div><div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:800, color:d.isOwn?"#C6FF00":"#fff" }}>{st.name}</div><div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"rgba(255,255,255,0.25)" }}>@{d.owner} · {d.city}</div></div>
            </div>
          );})}
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE ────────────────────────────────────────────────────────────────
function ProfileScreen({ user, totalScore, discovered, drops, stickers, onBack, onSignOut }) {
  return (
    <div style={{ minHeight:"100vh", background:"#0A0A0A" }}>
      <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:"1px solid #1A1A1A" }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <button onClick={onBack} style={{ background:"#141414", border:"1px solid #2A2A2A", borderRadius:10, width:38, height:38, color:"#fff", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>←</button>
          <h1 style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26, fontWeight:800 }}>Profile</h1>
        </div>
        <button onClick={onSignOut} style={{ background:"none", border:"1px solid #2A2A2A", borderRadius:10, padding:"6px 14px", fontFamily:"'Space Mono',monospace", fontSize:10, color:"#ffffff40" }}>Sign out</button>
      </div>
      <div style={{ padding:"28px 20px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:14 }}>
        <div style={{ width:88, height:88, background:"#141414", borderRadius:24, display:"flex", alignItems:"center", justifyContent:"center", border:"2px solid #C6FF00", boxShadow:"0 0 24px rgba(198,255,0,0.18)", animation:"float 3s ease-in-out infinite", overflow:"hidden" }}>
            <AvatarDisplay avatarId={user.avatar_id} size={60}/>
          </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:32, fontWeight:800 }}>@{user.username}</div>
          <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#ffffff35" }}>Street Hunter {IS_DEMO?"· Demo mode":""}</div>
        </div>
      </div>
      <div style={{ padding:"0 20px 24px", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
        {[{label:"TOTAL PTS",val:totalScore,color:"#C6FF00"},{label:"FOUND",val:`${discovered.length}/${STICKERS.length}`,color:"#8B5CF6"},{label:"DROPS",val:drops.filter(d=>d.isOwn).length,color:"#FFD700"}].map((s,i)=>(
          <div key={i} style={{ background:"#141414", border:"1px solid #2A2A2A", borderRadius:14, padding:"14px 10px", textAlign:"center" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26, fontWeight:800, color:s.color, lineHeight:1 }} key={s.val}>{s.val}</div>
            <div style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:"#ffffff25", marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ padding:"0 20px 40px" }}>
        <div style={{ fontFamily:"'Space Mono',monospace", fontSize:9, color:"#ffffff25", letterSpacing:"0.1em", marginBottom:12 }}>COLLECTION — {discovered.length}/{STICKERS.length} FOUND</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
          {stickers.map(s=>{const found=discovered.includes(s.id);return(
            <div key={s.id} style={{ background:found?"#141414":"#080808", border:`1px solid ${found?s.color+"40":"#141414"}`, borderRadius:12, padding:"10px 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:5, opacity:found?1:0.3, transition:"all 0.2s" }}>
              <StickerIcon sticker={s} size={34}/>
              <span style={{ fontFamily:"'Space Mono',monospace", fontSize:8, color:found?s.color:"#ffffff20", textAlign:"center" }}>{s.name}</span>
            </div>
          );})}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────
const SC = { AUTH:"auth", DASH:"dash", FIND:"find", CAM:"cam", VALIDATING:"validating", FAILED:"failed", MAP:"map", PROFILE:"profile" };

export default function App() {
  const [screen, setScreen]           = useState(SC.AUTH);
  const [user, setUser]               = useState(null);
  const [totalScore, setTotalScore]   = useState(0);
  const [discovered, setDiscovered]   = useState([]);
  const [drops, setDrops]             = useState(SEED_DROPS);
  const [finds, setFinds]             = useState(0);
  const [selected, setSelected]       = useState(null);
  const [result, setResult]           = useState(null);
  const [failReason, setFailReason]   = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [leafletOk, setLeafletOk]     = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [pendingSession, setPendingSession] = useState(null);
  const [stickers, setStickers]       = useState(DEFAULT_STICKERS);

  // ── Load stickers from DB on mount ───────────────────────────────────────
  useEffect(()=>{
    fetchStickersFromDB().then(rows => {
      STICKERS = rows; // update module-level ref used by map/validation
      setStickers(rows);
    });
  },[]);

  // ── Load Leaflet ──────────────────────────────────────────────────────────
  useEffect(()=>{
    if(window.L){setLeafletOk(true);return;}
    const l=document.createElement("link");l.rel="stylesheet";l.href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";document.head.appendChild(l);
    const sc=document.createElement("script");sc.src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";sc.onload=()=>setLeafletOk(true);document.head.appendChild(sc);
  },[]);

  // ── Handle magic link redirect ────────────────────────────────────────────
  useEffect(()=>{
    const hash = window.location.hash;
    if (!hash.includes("access_token")) {
      tryRestoreSession();
      return;
    }

    const params = new URLSearchParams(hash.replace("#",""));
    const accessToken  = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type         = params.get("type");

    if (accessToken && (type === "magiclink" || type === "signup")) {
      // Decode JWT payload to get user id and email (no library needed)
      let userId = null;
      let userEmail = null;
      try {
        const payload = JSON.parse(atob(accessToken.split(".")[1]));
        userId    = payload.sub;   // Supabase user UUID
        userEmail = payload.email;
      } catch {}

      const session = { access_token: accessToken, refresh_token: refreshToken, user: { id: userId, email: userEmail } };
      localStorage.setItem("sb_session", JSON.stringify(session));
      // Clean URL so token isn't re-processed on refresh
      window.history.replaceState(null, "", window.location.pathname);
      loadUserAfterAuth(session);
    } else {
      // Hash present but not a magic link (e.g. error) — just restore session
      window.history.replaceState(null, "", window.location.pathname);
      tryRestoreSession();
    }
  }, []);

  const tryRestoreSession = async () => {
    const cache = readCache();
    // Check localStorage cache first (instant load)
    if (cache.userId && cache.username) {
      setUser(cache);
      setTotalScore(cache.total_score||0);
      setDiscovered(cache.discovered||[]);
      const ownDrops = (cache.ownDrops||[]).map(d=>({...d,isOwn:true}));
      setDrops([...SEED_DROPS,...ownDrops]);
      setFinds(cache.finds||0);
      setScreen(SC.DASH);
      // Then sync from Supabase in background if online
      if (!IS_DEMO && navigator.onLine) syncFromDB(cache.userId);
    }
    // else: stay on auth screen
  };

  const loadUserAfterAuth = async (session) => {
    setSyncing(true);
    const userId = session.user?.id;
    if (!userId) {
      // Couldn't decode user ID — fall back to auth screen
      setSyncing(false);
      return;
    }

    const dbUser = await syncUserFromDB(userId);
    if (dbUser) {
      // Returning user — restore full profile
      const ownDrops = await loadDropsFromDB(userId);
      const profile = { ...dbUser, userId };
      writeCache({ ...profile, ownDrops });
      setUser(profile);
      setTotalScore(dbUser.total_score||0);
      setDiscovered(dbUser.discovered||[]);
      setDrops([...SEED_DROPS,...ownDrops]);
      setFinds(dbUser.finds||0);
      setSyncing(false);
      setScreen(SC.DASH);
    } else {
      // New user — session is valid, skip to username setup
      // Pass userId + email via a pending session so AuthScreen can complete signup
      setSyncing(false);
      setPendingSession(session);
      setScreen(SC.AUTH);
    }
  };

  const syncFromDB = async (userId) => {
    const dbUser = await syncUserFromDB(userId);
    if (!dbUser) return;
    const ownDrops = await loadDropsFromDB(userId);
    writeCache({ userId, ...dbUser, ownDrops });
    setUser(u => ({ ...u, ...dbUser }));
    setTotalScore(dbUser.total_score||0);
    setDiscovered(dbUser.discovered||[]);
    setDrops([...SEED_DROPS,...ownDrops.map(d=>({...d,isOwn:true}))]);
    setFinds(dbUser.finds||0);
  };

  // ── Persist to cache + Supabase on every change ───────────────────────────
  useEffect(()=>{
    if (!user) return;
    const ownDrops = drops.filter(d=>d.isOwn);
    const payload = { ...user, total_score:totalScore, discovered, finds, ownDrops };
    writeCache(payload);
    if (!IS_DEMO) saveUserToDB(user.userId, { total_score:totalScore, discovered, finds });
  }, [totalScore, discovered, finds]);

  const selectedSticker = stickers.find(s=>s.id===selected);

  const handleAuth = (profile) => {
    setUser(profile);
    setScreen(SC.DASH);
  };

  const handleCapture = async (b64) => {
    setScreen(SC.VALIDATING);
    try {
      const res = await validateSticker(b64, selectedSticker);
      if (res.valid) {
        const isFirst   = finds === 0;
        const isPioneer = !drops.some(d=>d.stickerId===selected&&!d.isOwn);
        const { total, breakdown } = calcScore(selectedSticker, isFirst, isPioneer);
        const newDrop = {
          id:`own-${Date.now()}`,
          lat:-6.2088+(Math.random()-0.5)*0.06,
          lng:106.8456+(Math.random()-0.5)*0.06,
          stickerId:selected, owner:user.username,
          city:"Jakarta, ID", time:"just now",
          pts:total, pioneer:isPioneer, isOwn:true,
        };
        setTotalScore(t=>t+total);
        setFinds(f=>f+1);
        setDiscovered(d=>d.includes(selected)?d:[...d,selected]);
        setDrops(d=>[newDrop,...d]);
        if (!IS_DEMO) saveDropToDB(user.userId, newDrop);
        setResult({ breakdown, total, isPioneer, confidence:res.confidence });
        setShowSuccess(true);
        setScreen(SC.DASH);
      } else {
        setFailReason(res.reason);
        setScreen(SC.FAILED);
      }
    } catch {
      setFailReason("Server error. Please try again.");
      setScreen(SC.FAILED);
    }
  };

  const handleSignOut = () => {
    sb.auth.signOut();
    setUser(null); setTotalScore(0); setDiscovered([]); setDrops(SEED_DROPS); setFinds(0);
    setScreen(SC.AUTH);
  };

  if (syncing) return (
    <>
      <style>{CSS}</style>
      <div className="app" style={{ display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:20 }}>
        <div style={{ animation:"float 2s ease-in-out infinite" }}><Eye size={72}/></div>
        <Spinner/>
        <p style={{ fontFamily:"'Space Mono',monospace", color:"#ffffff40", fontSize:11 }}>Syncing your profile...</p>
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <OnlineStatus/>
      <div className="app">
        <div className="screen">
          {screen===SC.AUTH        && <AuthScreen onAuth={handleAuth} pendingSession={pendingSession}/>}
          {screen===SC.DASH        && user && <Dashboard user={user} totalScore={totalScore} drops={drops} discovered={discovered} stickers={stickers} onHunt={()=>{setSelected(null);setScreen(SC.FIND);}} onMap={()=>setScreen(SC.MAP)} onProfile={()=>setScreen(SC.PROFILE)}/>}
          {screen===SC.FIND        && <FindSticker stickers={stickers} discovered={discovered} onSelect={id=>{setSelected(id);setScreen(SC.CAM);}} onBack={()=>setScreen(SC.DASH)}/>}
          {screen===SC.CAM         && selectedSticker && <Camera sticker={selectedSticker} onCapture={handleCapture} onBack={()=>setScreen(SC.FIND)}/>}
          {screen===SC.VALIDATING  && selectedSticker && <Validating sticker={selectedSticker}/>}
          {screen===SC.FAILED      && selectedSticker && <Failed sticker={selectedSticker} reason={failReason} onRetry={()=>setScreen(SC.CAM)} onBack={()=>setScreen(SC.FIND)}/>}
          {screen===SC.MAP         && (leafletOk?<MapScreen drops={drops} stickers={stickers} onBack={()=>setScreen(SC.DASH)}/>:<div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><Spinner/></div>)}
          {screen===SC.PROFILE     && user && <ProfileScreen user={user} totalScore={totalScore} discovered={discovered} drops={drops} stickers={stickers} onBack={()=>setScreen(SC.DASH)} onSignOut={handleSignOut}/>}
        </div>
        {showSuccess&&result&&selectedSticker&&<SuccessModal sticker={selectedSticker} breakdown={result.breakdown} total={result.total} isPioneer={result.isPioneer} confidence={result.confidence} onClose={()=>{setShowSuccess(false);setResult(null);}}/>}
      </div>
    </>
  );
}
