// src/components/jobs/JobInbox.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/** =====================================================================
 * JobInbox.jsx — Phoenix (Paste JD → Parse → Score → Add to Tracker)
 * Props:
 *   - onAdd?(job)
 *   - defaultText?: string
 * API:
 *   - GET    /api/profile
 *   - POST   /api/profile             { profile }
 *   - POST   /api/jobs/parse          { jd_text }
 *   - POST   /api/jobs/score          { jd_struct }
 *   - POST   /api/tracker             { title, jd_struct, score, stage }
 * Persistence:
 *   - localStorage: xenya.jobs.inbox.v1 (JD + result)
 *   - localStorage: xenya.jobs.profile.v1 (Profile cache)
 * Emits: window.dispatchEvent('jobs:added', { detail: { job } })
 * ===================================================================== */

const API_ORIGIN =
  (import.meta?.env?.VITE_API_ORIGIN || "http://localhost:3000").replace(/\/$/, "");

const LS_INBOX_KEY = "xenya.jobs.inbox.v1";
const LS_PROFILE_KEY = "xenya.jobs.profile.v1";

/* ------------------------------ helpers ------------------------------ */
const nowISO = () => new Date().toISOString();
const fmtTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
};
const joinCSV = (arr) => (Array.isArray(arr) ? arr.join(", ") : "");
const splitCSV = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const Badge = ({ tone = "muted", children }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 12,
      border: "1px solid rgba(255,255,255,0.18)",
      background:
        tone === "live"
          ? "linear-gradient(180deg, rgba(52,211,153,.25), rgba(16,185,129,.18))"
          : tone === "mock"
          ? "linear-gradient(180deg, rgba(99,102,241,.24), rgba(79,70,229,.18))"
          : "rgba(255,255,255,0.06)",
      color: "#e8e6ff",
      userSelect: "none",
    }}
  >
    {children}
  </span>
);

/* ---------------------------- circular gauge ---------------------------- */
function Gauge({ value = 0 }) {
  const pct = Math.max(0, Math.min(1, value));
  const R = 42;
  const C = 2 * Math.PI * R;
  const dash = C * pct;
  return (
    <svg width="140" height="140" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r={R} stroke="rgba(255,255,255,.12)" strokeWidth="10" fill="none" />
      <circle
        cx="60"
        cy="60"
        r={R}
        stroke="#8b5cf6"
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${dash} ${C - dash}`}
        transform="rotate(-90 60 60)"
      />
      <text x="60" y="58" textAnchor="middle" fontSize="18" fill="#fff" fontWeight="700">
        {Math.round(pct * 100)}%
      </text>
      <text x="60" y="78" textAnchor="middle" fontSize="12" fill="#cfcaff">
        {pct >= 0.7 ? "High" : pct >= 0.5 ? "Medium" : "Low"}
      </text>
    </svg>
  );
}

/* ====================================================================== */

export default function JobInbox({ onAdd, defaultText = "" }) {
  /* ---------- analysis state ---------- */
  const [jdText, setJdText] = useState(defaultText);
  const [jdStruct, setJdStruct] = useState(null);
  const [result, setResult] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);

  /* ---------- profile state ---------- */
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  /* ---------- ui ---------- */
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const textRef = useRef(null);

  /* ---------- hydrate analysis from LS ---------- */
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_INBOX_KEY) || "{}");
      if (raw.jd_text) setJdText(raw.jd_text);
      if (raw.jd_struct) setJdStruct(raw.jd_struct);
      if (raw.result) setResult(raw.result);
      if (raw.lastSaved) setLastSaved(raw.lastSaved);
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem(
      LS_INBOX_KEY,
      JSON.stringify({ jd_text: jdText, jd_struct: jdStruct, result, lastSaved })
    );
  }, [jdText, jdStruct, result, lastSaved]);

  /* ---------- hydrate profile: server → cache; else cache ---------- */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_ORIGIN}/api/profile`, { cache: "no-store" });
        const ok = r.ok;
        const data = ok ? await r.json() : null;
        if (ok && data?.profile) {
          setProfile(data.profile);
          localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(data.profile));
          setLive(true);
          setLoadingProfile(false);
          return;
        }
      } catch {}
      try {
        const cached = JSON.parse(localStorage.getItem(LS_PROFILE_KEY) || "null");
        if (cached) setProfile(cached);
      } catch {}
      setLoadingProfile(false);
    })();
  }, []);

  /* ---------- health ping ---------- */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_ORIGIN}/api/health`);
        const j = await r.json();
        setLive(!!j?.ok);
      } catch {
        setLive(false);
      }
    })();
  }, []);

  /* ---------- display profile (render fallback from cache) ---------- */
  const displayProfile = useMemo(() => {
    if (profile) return profile;
    try {
      const cached = JSON.parse(localStorage.getItem(LS_PROFILE_KEY) || "null");
      return cached || null;
    } catch {
      return null;
    }
  }, [profile]);

  /* ---------- actions ---------- */
  const clearAnalysis = () => {
    setJdStruct(null);
    setResult(null);
    setJdText("");
    setLastSaved(nowISO());
    setTimeout(() => textRef.current?.focus(), 30);
  };

  const syncProfileToServer = async (p) => {
    try {
      const r = await fetch(`${API_ORIGIN}/api/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p }),
      });
      setLive(r.ok);
    } catch {
      setLive(false);
    }
  };

  const analyze = async () => {
    const text = (jdText || "").trim();
    if (!text) {
      textRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (displayProfile) await syncProfileToServer(displayProfile);

      const parsed = await fetch(`${API_ORIGIN}/api/jobs/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd_text: text }),
      }).then((r) => r.json());

      if (!parsed?.ok) throw new Error(parsed?.error || "Parse failed");
      setJdStruct(parsed.jd_struct);

      const scored = await fetch(`${API_ORIGIN}/api/jobs/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd_struct: parsed.jd_struct }),
      }).then((r) => r.json());

      if (!scored?.ok) throw new Error(scored?.error || "Score failed");
      setResult({ score: scored.score, breakdown: scored.breakdown });
      setLastSaved(nowISO());
    } catch (e) {
      alert(`Analyze error: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const addToTracker = async () => {
    if (!jdStruct) return;
    try {
      const r = await fetch(`${API_ORIGIN}/api/tracker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: jdStruct.title || "(Untitled)",
          jd_struct: jdStruct,
          score: result?.score || 0,
          stage: "inbox",
        }),
      }).then((x) => x.json());
      if (r?.ok) {
        if (onAdd) onAdd(r.job);
        window.dispatchEvent(new CustomEvent("jobs:added", { detail: { job: r.job } }));
      }
    } catch (e) {
      alert("Failed to add to tracker: " + (e.message || e));
    }
  };

  /* ---------- Edit Profile modal ---------- */
  const [pf_seniority, setPfSeniority] = useState("junior");
  const [pf_roles, setPfRoles] = useState("");
  const [pf_locs, setPfLocs] = useState("");
  const [pf_skills, setPfSkills] = useState("");
  const [pf_auth, setPfAuth] = useState({
    status: "",
    sponsorship_now: "no",
    sponsorship_future: "yes",
  });

  useEffect(() => {
    if (!displayProfile) return;
    setPfSeniority(displayProfile.seniority || "junior");
    setPfRoles(joinCSV(displayProfile?.preferences?.roles || []));
    setPfLocs(joinCSV(displayProfile?.preferences?.locations || []));
    setPfSkills(joinCSV(displayProfile?.skills || []));
    setPfAuth({
      status: displayProfile?.work_auth?.status || "",
      sponsorship_now: displayProfile?.work_auth?.sponsorship_now || "no",
      sponsorship_future: displayProfile?.work_auth?.sponsorship_future || "yes",
    });
  }, [displayProfile, showEdit]);

  const saveProfile = async () => {
    const next = {
      ...(displayProfile || {}),
      seniority: pf_seniority,
      preferences: {
        ...(displayProfile?.preferences || {}),
        roles: splitCSV(pf_roles),
        locations: splitCSV(pf_locs),
      },
      skills: splitCSV(pf_skills),
      work_auth: {
        ...(displayProfile?.work_auth || {}),
        status: pf_auth.status || "",
        sponsorship_now: pf_auth.sponsorship_now || "no",
        sponsorship_future: pf_auth.sponsorship_future || "yes",
      },
      meta: { ...(displayProfile?.meta || {}), last_updated: nowISO() },
    };
    setProfile(next);
    localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(next));
    try {
      await fetch(`${API_ORIGIN}/api/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: next }),
      });
    } catch {}
    setShowEdit(false);
  };

  /* ---------- derived ---------- */
  const fitText = useMemo(() => {
    const s = result?.score ?? 0;
    return s >= 0.7 ? "High" : s >= 0.5 ? "Medium" : "Low";
  }, [result]);

  /* ------------------------------- styles ------------------------------ */
  const styles = `
    .phx-card{ background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:12px; }
    .phx-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:8px; }
    .phx-actions{ display:flex; align-items:center; gap:8px; }
    .btn{ padding:8px 12px; border-radius:10px; color:#fff; background:linear-gradient(180deg,#8b5cf6,#7c3aed); border:1px solid rgba(255,255,255,0.16); cursor:pointer; font-weight:600 }
    .btn.ghost{ background:transparent; border-color:rgba(255,255,255,0.16) }
    .btn:disabled{ opacity:.6; cursor:not-allowed }
    .grid{ display:grid; gap:12px; grid-template-columns: 1fr 1fr; }
    .row{ display:grid; gap:6px; }
    .label{ font-size:12px; color:#cfcaff; }
    .input{ width:100%; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.18); border-radius:10px; padding:10px; color:#fff }
    textarea.input{ min-height:120px; }
    .box{ background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:10px; color:#fff; min-height:44px }
    .pill{ display:inline-flex; align-items:center; padding:4px 10px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); border-radius:999px; margin:2px; font-size:12px; color:#e8e6ff }
    .muted{ color:#bdb8ff }
    .side{ background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:12px; }
    .list{ font-size:12px; color:#eae8ff }
    .list div{ display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px dashed rgba(255,255,255,0.12) }
    .list div:last-child{ border-bottom:none }
    .modal-bg{ position:fixed; inset:0; backdrop-filter:blur(8px); background:rgba(0,0,0,.35); display:grid; place-items:center; z-index:10080 }
    .modal{ width:min(720px, 96vw); background:rgba(18,18,24,.9); border:1px solid rgba(255,255,255,.12); border-radius:16px; padding:16px }
    .row2{ display:grid; grid-template-columns: 1fr 1fr; gap:10px }
    .kbd{ padding:1px 6px; border:1px solid rgba(255,255,255,.18); border-radius:6px; background:rgba(255,255,255,.06) }
  `;

  /* ------------------------------- render ------------------------------ */
  return (
    <>
      <style>{styles}</style>

      <div className="phx-card">
        <div className="phx-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong>Job Inbox</strong>
            <Badge tone={live ? "live" : "mock"}>{live ? "Live" : "Mock"}</Badge>
          </div>
          <div className="phx-actions">
            <span className="muted" style={{ fontSize: 12 }}>
              Autosaved {fmtTime(lastSaved)}
            </span>
            <button className="btn ghost" onClick={() => setShowEdit(true)}>
              Edit profile
            </button>
            <button className="btn ghost" onClick={clearAnalysis} title="Clear the current analysis">
              New
            </button>
            <button className="btn" onClick={analyze} disabled={busy}>
              {busy ? "Analyzing…" : "Analyze"}
            </button>
          </div>
        </div>

        <div className="grid">
          {/* Left column */}
          <div className="row">
            <div className="label">Paste job description</div>
            <textarea
              ref={textRef}
              className="input"
              placeholder="Paste the job description here…"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              onBlur={() => setLastSaved(nowISO())}
            />

            <div className="label">Parsed</div>
            <div className="box">
              {jdStruct ? (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <span className="muted">Title</span>
                    <div style={{ fontWeight: 600 }}>{jdStruct.title || "—"}</div>
                  </div>
                  <div className="row" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div>
                      <div className="muted">Location</div>
                      <div>{jdStruct.location || "—"}</div>
                    </div>
                    <div>
                      <div className="muted">Visa</div>
                      <div>{jdStruct.visa || jdStruct.visa_status || "—"}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div className="muted">Must-have skills</div>
                    <div>
                      {(jdStruct.skills_must || []).length
                        ? jdStruct.skills_must.map((s, i) => (
                            <span className="pill" key={i}>
                              {s}
                            </span>
                          ))
                        : "—"}
                    </div>
                  </div>
                </>
              ) : (
                <div className="muted">
                  No parse yet. Click <span className="kbd">Analyze</span>.
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn ghost" onClick={() => textRef.current?.focus()}>
                Edit JD
              </button>
              <button className="btn" onClick={addToTracker} disabled={!jdStruct}>
                Add to Tracker
              </button>
            </div>
          </div>

          {/* Right column */}
          <div className="side">
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12 }}>
              <div style={{ display: "grid", placeItems: "center" }}>
                <Gauge value={result?.score || 0} />
              </div>
              <div>
                <div style={{ fontWeight: 700, color: "#dcd8ff", marginBottom: 6 }}>
                  Fit: {fitText}
                </div>
                <div className="list">
                  <div>
                    <span>skill match</span>
                    <span>{Math.round((result?.breakdown?.skill_match || 0) * 100)}%</span>
                  </div>
                  <div>
                    <span>role alignment</span>
                    <span>{Math.round((result?.breakdown?.role_alignment || 0) * 100)}%</span>
                  </div>
                  <div>
                    <span>seniority match</span>
                    <span>{Math.round((result?.breakdown?.seniority_match || 0) * 100)}%</span>
                  </div>
                  <div>
                    <span>location ok</span>
                    <span>{Math.round((result?.breakdown?.location_ok || 0) * 100)}%</span>
                  </div>
                  <div>
                    <span>visa flag</span>
                    <span>{Math.round((result?.breakdown?.visa_flag || 0) * 100)}%</span>
                  </div>
                  <div>
                    <span>project alignment</span>
                    <span>{Math.round((result?.breakdown?.project_alignment || 0) * 100)}%</span>
                  </div>
                  <div>
                    <span>company interest</span>
                    <span>{Math.round((result?.breakdown?.company_interest || 0) * 100)}%</span>
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 14,
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <div style={{ fontWeight: 700, color: "#dcd8ff" }}>Your profile</div>
              <button className="btn ghost" onClick={() => setShowEdit(true)} style={{ padding: "6px 10px" }}>
                Edit profile
              </button>
            </div>

            <div className="list" style={{ marginTop: 4 }}>
              <div>
                <span>Seniority</span>
                <span>{displayProfile?.seniority || "—"}</span>
              </div>
              <div>
                <span>Roles</span>
                <span>{joinCSV(displayProfile?.preferences?.roles || []) || "—"}</span>
              </div>
              <div>
                <span>Locations</span>
                <span>{joinCSV(displayProfile?.preferences?.locations || []) || "—"}</span>
              </div>
              <div>
                <span>Skills</span>
                <span>{(displayProfile?.skills || []).slice(0, 4).join(", ") || "—"}</span>
              </div>
              <div>
                <span>Work auth</span>
                <span>
                  {(displayProfile?.work_auth?.status || "—")} — now:
                  {String(displayProfile?.work_auth?.sponsorship_now ?? "—")} · future:
                  {String(displayProfile?.work_auth?.sponsorship_future ?? "—")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* -------------------------- Edit Profile Modal -------------------------- */}
      {showEdit && (
        <div className="modal-bg" onClick={() => setShowEdit(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Profile (used for scoring)</div>

            <div className="row2" style={{ marginBottom: 10 }}>
              <div>
                <div className="label">Seniority</div>
                <select className="input" value={pf_seniority} onChange={(e) => setPfSeniority(e.target.value)}>
                  <option value="intern">intern</option>
                  <option value="junior">junior</option>
                  <option value="mid">mid</option>
                  <option value="senior">senior</option>
                </select>
              </div>
              <div>
                <div className="label">Work authorization</div>
                <input
                  className="input"
                  placeholder="status (e.g., F-1, USC)"
                  value={pf_auth.status}
                  onChange={(e) => setPfAuth((x) => ({ ...x, status: e.target.value }))}
                />
              </div>
            </div>

            <div className="row2" style={{ marginBottom: 10 }}>
              <div>
                <div className="label">Roles (comma separated)</div>
                <input
                  className="input"
                  placeholder="AI/ML Engineer, Data Engineer"
                  value={pf_roles}
                  onChange={(e) => setPfRoles(e.target.value)}
                />
              </div>
              <div>
                <div className="label">Locations (comma separated)</div>
                <input
                  className="input"
                  placeholder="Remote, Seattle WA, Bay Area CA"
                  value={pf_locs}
                  onChange={(e) => setPfLocs(e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div className="label">Skills (comma separated)</div>
              <textarea
                className="input"
                rows={3}
                placeholder="python, pytorch, tensorflow, computer vision, sql, docker, kubernetes…"
                value={pf_skills}
                onChange={(e) => setPfSkills(e.target.value)}
              />
            </div>

            <div className="row2" style={{ marginBottom: 12 }}>
              <div>
                <div className="label">Sponsorship now?</div>
                <select
                  className="input"
                  value={pf_auth.sponsorship_now}
                  onChange={(e) => setPfAuth((x) => ({ ...x, sponsorship_now: e.target.value }))}
                >
                  <option value="no">no</option>
                  <option value="yes">yes</option>
                </select>
              </div>
              <div>
                <div className="label">Sponsorship future?</div>
                <select
                  className="input"
                  value={pf_auth.sponsorship_future}
                  onChange={(e) => setPfAuth((x) => ({ ...x, sponsorship_future: e.target.value }))}
                >
                  <option value="no">no</option>
                  <option value="yes">yes</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn ghost" onClick={() => setShowEdit(false)}>
                Cancel
              </button>
              <button className="btn" onClick={saveProfile} disabled={loadingProfile}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
