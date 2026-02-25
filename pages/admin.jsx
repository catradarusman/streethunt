// pages/admin.jsx
// Admin UI for managing stickers and reference images
// Protected by ADMIN_SECRET env var

import { useState, useEffect, useRef } from "react";

const RARITIES = ["Common", "Rare", "Epic", "Legendary"];

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
  const [editing, setEditing]     = useState({}); // { [id]: stickerObj }
  const [newRow, setNewRow]       = useState(EMPTY_STICKER);
  const [msg, setMsg]             = useState("");
  const [uploading, setUploading] = useState({}); // { [key]: bool }

  // Persist session
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
    setMsg(res.ok ? `Saved ${id}` : `Error saving ${id}`);
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
      setMsg(`Created ${newRow.id}`);
      setNewRow(EMPTY_STICKER);
      loadStickers();
    } else {
      setMsg("Error creating sticker");
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
      setMsg(`Uploaded ${field} for ${stickerId}`);
    } else {
      setMsg("Upload failed");
    }
  }

  function fieldChange(id, field, value) {
    setEditing((e) => ({ ...e, [id]: { ...e[id], [field]: value } }));
  }

  if (!authed) {
    return (
      <div style={styles.center}>
        <form onSubmit={login} style={styles.loginBox}>
          <h2 style={{ marginBottom: 16 }}>Street Hunt Admin</h2>
          <input
            type="password"
            placeholder="Admin password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            style={styles.input}
            autoFocus
          />
          <button type="submit" style={styles.btn}>Enter</button>
          {msg && <p style={{ color: "red", marginTop: 8 }}>{msg}</p>}
        </form>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={{ margin: 0 }}>Street Hunt Admin</h1>
        <button onClick={() => { sessionStorage.removeItem("admin_secret"); setAuthed(false); }} style={styles.btnSm}>
          Log out
        </button>
      </div>

      {msg && (
        <div style={styles.toast} onClick={() => setMsg("")}>{msg}</div>
      )}

      <h2 style={{ marginTop: 32 }}>Stickers</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={styles.table}>
          <thead>
            <tr>
              {["ID","Name","Rarity","Pts","Hint","Color","Active","Art Image","Ref Image",""].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stickers.map((s) => {
              const row = editing[s.id] || s;
              return (
                <tr key={s.id}>
                  <td style={styles.td}><code>{s.id}</code></td>
                  <td style={styles.td}>
                    <input value={row.name} onChange={(e) => fieldChange(s.id, "name", e.target.value)} style={styles.cellInput} />
                  </td>
                  <td style={styles.td}>
                    <select value={row.rarity} onChange={(e) => fieldChange(s.id, "rarity", e.target.value)} style={styles.cellInput}>
                      {RARITIES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={styles.td}>
                    <input type="number" value={row.pts} onChange={(e) => fieldChange(s.id, "pts", Number(e.target.value))} style={{ ...styles.cellInput, width: 60 }} />
                  </td>
                  <td style={styles.td}>
                    <input value={row.hint || ""} onChange={(e) => fieldChange(s.id, "hint", e.target.value)} style={{ ...styles.cellInput, width: 180 }} />
                  </td>
                  <td style={styles.td}>
                    <input type="color" value={row.color || "#ffffff"} onChange={(e) => fieldChange(s.id, "color", e.target.value)} style={{ width: 44, height: 28, cursor: "pointer" }} />
                  </td>
                  <td style={styles.td}>
                    <input type="checkbox" checked={!!row.active} onChange={(e) => fieldChange(s.id, "active", e.target.checked)} />
                  </td>
                  <td style={styles.td}>
                    <ImageCell
                      url={row.art_url}
                      loading={uploading[`${s.id}-art_url`]}
                      onUpload={(file) => uploadImage(s.id, "art_url", file)}
                      onClear={() => fieldChange(s.id, "art_url", "")}
                    />
                  </td>
                  <td style={styles.td}>
                    <ImageCell
                      url={row.reference_url}
                      loading={uploading[`${s.id}-reference_url`]}
                      onUpload={(file) => uploadImage(s.id, "reference_url", file)}
                      onClear={() => fieldChange(s.id, "reference_url", "")}
                    />
                  </td>
                  <td style={styles.td}>
                    <button onClick={() => saveSticker(s.id)} style={styles.btnSm}>Save</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 40 }}>Add New Sticker</h2>
      <form onSubmit={createSticker} style={styles.newForm}>
        {[
          { label: "ID*", field: "id", type: "text", width: 80 },
          { label: "Name*", field: "name", type: "text", width: 140 },
          { label: "Pts", field: "pts", type: "number", width: 60 },
          { label: "Hint", field: "hint", type: "text", width: 200 },
          { label: "Color", field: "color", type: "color", width: 44 },
        ].map(({ label, field, type, width }) => (
          <label key={field} style={styles.formLabel}>
            {label}
            <input
              type={type}
              value={newRow[field]}
              onChange={(e) => setNewRow((r) => ({ ...r, [field]: type === "number" ? Number(e.target.value) : e.target.value }))}
              style={{ ...styles.input, width, marginTop: 4 }}
              required={label.endsWith("*")}
            />
          </label>
        ))}
        <label style={styles.formLabel}>
          Rarity
          <select value={newRow.rarity} onChange={(e) => setNewRow((r) => ({ ...r, rarity: e.target.value }))} style={{ ...styles.input, marginTop: 4 }}>
            {RARITIES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <button type="submit" style={{ ...styles.btn, alignSelf: "flex-end" }}>Create</button>
      </form>
    </div>
  );
}

function ImageCell({ url, loading, onUpload, onClear }) {
  const ref = useRef();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 140 }}>
      {url ? (
        <>
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, border: "1px solid #444" }} />
          </a>
          <button onClick={onClear} style={styles.btnXs} title="Clear URL">✕</button>
        </>
      ) : (
        <span style={{ color: "#666", fontSize: 12 }}>none</span>
      )}
      <button onClick={() => ref.current.click()} style={styles.btnXs} disabled={loading}>
        {loading ? "…" : "Upload"}
      </button>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onUpload(e.target.files[0])} />
    </div>
  );
}

const styles = {
  page: { padding: "24px 32px", fontFamily: "system-ui, sans-serif", maxWidth: 1200, margin: "0 auto" },
  center: { display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  loginBox: { display: "flex", flexDirection: "column", gap: 12, padding: 32, border: "1px solid #ccc", borderRadius: 8, minWidth: 280 },
  input: { padding: "6px 10px", border: "1px solid #ccc", borderRadius: 4, fontSize: 14 },
  cellInput: { padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13, width: 120 },
  btn: { padding: "8px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 14 },
  btnSm: { padding: "4px 10px", background: "#111", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 },
  btnXs: { padding: "2px 7px", background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #ddd", whiteSpace: "nowrap" },
  td: { padding: "6px 10px", borderBottom: "1px solid #eee", verticalAlign: "middle" },
  toast: { background: "#222", color: "#fff", padding: "8px 16px", borderRadius: 6, display: "inline-block", cursor: "pointer", marginTop: 8, fontSize: 13 },
  newForm: { display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", padding: 20, background: "#f8f8f8", borderRadius: 8 },
  formLabel: { display: "flex", flexDirection: "column", fontSize: 12, fontWeight: 600, gap: 2 },
};
