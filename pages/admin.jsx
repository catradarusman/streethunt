// pages/admin.jsx
// Admin UI for managing stickers and reference images
// Protected by ADMIN_SECRET env var

import { useState, useEffect, useRef } from "react";
import Head from "next/head";

const RARITIES = ["Common", "Rare", "Epic", "Legendary"];

const RARITY_COLOR = {
  Common: "#aaa",
  Rare: "#8B5CF6",
  Epic: "#EC4899",
  Legendary: "#FFD700",
};

const EMPTY_STICKER = {
  id: "",
  name: "",
  rarity: "Common",
  pts: 10,
  hint: "",
  color: "#ffffff",
  art_url: "",
  reference_url: "",
  active: true,
};

export default function AdminPage() {
  const [secret, setSecret]       = useState("");
  const [authed, setAuthed]       = useState(false);
  const [stickers, setStickers]   = useState([]);
  const [editing, setEditing]     = useState({});
  const [newRow, setNewRow]       = useState(EMPTY_STICKER);
  const [msg, setMsg]             = useState("");
  const [uploading, setUploading] = useState({});

  useEffect(() => {
    const saved = sessionStorage.getItem("admin_secret");
    if (saved) { setSecret(saved); setAuthed(true); }
  }, []);

  useEffect(() => {
    if (authed) loadStickers();
  }, [authed]);

  function headers() {
    return { "Content-Type": "application/json", "x-admin-secret": secret };
  }

  async function login(e) {
    e.preventDefault();
    const res = await fetch("/api/admin/stickers", { headers: { "x-admin-secret": secret } });
    if (res.status === 401) { setMsg("Wrong password."); return; }
    sessionStorage.setItem("admin_secret", secret);
    setAuthed(true);
  }

  async function loadStickers() {
    const res = await fetch("/api/admin/stickers", { headers: headers() });
    const data = await res.json();
    if (Array.isArray(data)) {
      setStickers(data);
      const map = {};
      data.forEach((s) => { map[s.id] = { ...s }; });
      setEditing(map);
    }
  }

  async function saveSticker(id) {
    const payload = { ...editing[id] };
    const res = await fetch("/api/admin/stickers", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    setMsg(res.ok ? `✓ Saved ${id}` : `✗ Error saving ${id}`);
    setTimeout(() => setMsg(""), 3000);
  }

  async function createSticker(e) {
    e.preventDefault();
    if (!newRow.id || !newRow.name) { setMsg("ID and name are required"); return; }
    const res = await fetch("/api/admin/stickers", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(newRow),
    });
    if (res.ok) {
      setMsg(`✓ Created ${newRow.id}`);
      setNewRow(EMPTY_STICKER);
      loadStickers();
      setTimeout(() => setMsg(""), 3000);
    } else {
      setMsg("✗ Error creating sticker");
    }
  }

  async function uploadImage(stickerId, field, file) {
    const key = `${stickerId}-${field}`;
    setUploading((u) => ({ ...u, [key]: true }));

    const ext = file.name.split(".").pop();
    const path = `${stickerId}-${field}.${ext}`;

    const form = new FormData();
    form.append("file", file);
    form.append("path", path);

    const res = await fetch("/api/admin/upload", {
      method: "POST",
      headers: { "x-admin-secret": secret },
      body: form,
    });

    setUploading((u) => ({ ...u, [key]: false }));

    if (res.ok) {
      const { url } = await res.json();
      setEditing((e) => ({ ...e, [stickerId]: { ...e[stickerId], [field]: url } }));
      setMsg(`✓ Uploaded ${field} for ${stickerId}`);
      setTimeout(() => setMsg(""), 3000);
    } else {
      setMsg("✗ Upload failed");
    }
  }

  function fieldChange(id, field, value) {
    setEditing((e) => ({ ...e, [id]: { ...e[id], [field]: value } }));
  }

  if (!authed) {
    return (
      <>
        <Head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
        </Head>
        <div className="center-screen">
          <form onSubmit={login} className="login-box">
            <h1 className="login-title">STREET HUNT</h1>
            <p className="login-sub">ADMIN PANEL</p>
            <input
              type="password"
              placeholder="Enter admin password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="field-input"
              autoFocus
            />
            <button type="submit" className="btn-primary">ENTER</button>
            {msg && <p className="error-msg">{msg}</p>}
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      </Head>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">STREET HUNT <span className="accent">ADMIN</span></h1>
          <button
            className="btn-ghost"
            onClick={() => { sessionStorage.removeItem("admin_secret"); setAuthed(false); }}
          >
            LOG OUT
          </button>
        </div>

        {msg && <div className="toast" onClick={() => setMsg("")}>{msg}</div>}

        <h2 className="section-title">STICKERS</h2>

        <div className="cards">
          {stickers.map((s) => {
            const row = editing[s.id] || s;
            const rc = RARITY_COLOR[row.rarity] || "#aaa";
            return (
              <div key={s.id} className="card" style={{ borderColor: `${rc}33` }}>
                <div className="card-header">
                  <span className="sticker-id">{s.id}</span>
                  <span className="rarity-badge" style={{ color: rc, borderColor: `${rc}55`, background: `${rc}11` }}>
                    {row.rarity}
                  </span>
                  <label className="active-toggle">
                    <input
                      type="checkbox"
                      checked={!!row.active}
                      onChange={(e) => fieldChange(s.id, "active", e.target.checked)}
                    />
                    <span>{row.active ? "ACTIVE" : "INACTIVE"}</span>
                  </label>
                </div>

                <div className="field-grid">
                  <label className="field-label">
                    NAME
                    <input
                      className="field-input"
                      value={row.name}
                      onChange={(e) => fieldChange(s.id, "name", e.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    RARITY
                    <select
                      className="field-input"
                      value={row.rarity}
                      onChange={(e) => fieldChange(s.id, "rarity", e.target.value)}
                    >
                      {RARITIES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </label>
                  <label className="field-label">
                    POINTS
                    <input
                      className="field-input"
                      type="number"
                      value={row.pts}
                      onChange={(e) => fieldChange(s.id, "pts", Number(e.target.value))}
                    />
                  </label>
                  <label className="field-label">
                    COLOR
                    <div className="color-row">
                      <input
                        type="color"
                        value={row.color || "#ffffff"}
                        onChange={(e) => fieldChange(s.id, "color", e.target.value)}
                        className="color-swatch"
                      />
                      <span className="color-hex">{row.color || "#ffffff"}</span>
                    </div>
                  </label>
                  <label className="field-label field-full">
                    HINT
                    <input
                      className="field-input"
                      value={row.hint || ""}
                      onChange={(e) => fieldChange(s.id, "hint", e.target.value)}
                      placeholder="Location hint for players"
                    />
                  </label>
                </div>

                <div className="image-row">
                  <div className="image-slot">
                    <span className="field-label-text">ART IMAGE</span>
                    <ImageCell
                      url={row.art_url}
                      loading={uploading[`${s.id}-art_url`]}
                      onUpload={(file) => uploadImage(s.id, "art_url", file)}
                      onClear={() => fieldChange(s.id, "art_url", "")}
                    />
                  </div>
                  <div className="image-slot">
                    <span className="field-label-text">REFERENCE IMAGE <span className="accent">(Claude uses this)</span></span>
                    <ImageCell
                      url={row.reference_url}
                      loading={uploading[`${s.id}-reference_url`]}
                      onUpload={(file) => uploadImage(s.id, "reference_url", file)}
                      onClear={() => fieldChange(s.id, "reference_url", "")}
                    />
                  </div>
                </div>

                <div className="card-footer">
                  <button className="btn-primary" onClick={() => saveSticker(s.id)}>SAVE</button>
                </div>
              </div>
            );
          })}
        </div>

        <h2 className="section-title" style={{ marginTop: 48 }}>ADD NEW STICKER</h2>
        <form onSubmit={createSticker} className="card">
          <div className="field-grid">
            <label className="field-label">
              ID <span className="accent">*</span>
              <input
                className="field-input"
                value={newRow.id}
                onChange={(e) => setNewRow((r) => ({ ...r, id: e.target.value }))}
                placeholder="e.g. s9"
                required
              />
            </label>
            <label className="field-label">
              NAME <span className="accent">*</span>
              <input
                className="field-input"
                value={newRow.name}
                onChange={(e) => setNewRow((r) => ({ ...r, name: e.target.value }))}
                placeholder="Sticker name"
                required
              />
            </label>
            <label className="field-label">
              RARITY
              <select
                className="field-input"
                value={newRow.rarity}
                onChange={(e) => setNewRow((r) => ({ ...r, rarity: e.target.value }))}
              >
                {RARITIES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="field-label">
              POINTS
              <input
                className="field-input"
                type="number"
                value={newRow.pts}
                onChange={(e) => setNewRow((r) => ({ ...r, pts: Number(e.target.value) }))}
              />
            </label>
            <label className="field-label">
              COLOR
              <div className="color-row">
                <input
                  type="color"
                  value={newRow.color}
                  onChange={(e) => setNewRow((r) => ({ ...r, color: e.target.value }))}
                  className="color-swatch"
                />
                <span className="color-hex">{newRow.color}</span>
              </div>
            </label>
            <label className="field-label field-full">
              HINT
              <input
                className="field-input"
                value={newRow.hint}
                onChange={(e) => setNewRow((r) => ({ ...r, hint: e.target.value }))}
                placeholder="Location hint for players"
              />
            </label>
          </div>
          <div className="card-footer">
            <button type="submit" className="btn-primary">CREATE STICKER</button>
          </div>
        </form>

        <div style={{ height: 48 }} />
      </div>
    </>
  );
}

function ImageCell({ url, loading, onUpload, onClear }) {
  const ref = useRef();
  return (
    <div className="image-cell">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="" className="image-thumb" />
        </a>
      ) : (
        <div className="image-empty">NO IMAGE</div>
      )}
      <div className="image-actions">
        <button
          className="btn-ghost"
          onClick={() => ref.current.click()}
          disabled={loading}
        >
          {loading ? "UPLOADING…" : "UPLOAD"}
        </button>
        {url && (
          <button className="btn-ghost btn-danger" onClick={onClear}>CLEAR</button>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => e.target.files[0] && onUpload(e.target.files[0])}
      />
    </div>
  );
}

