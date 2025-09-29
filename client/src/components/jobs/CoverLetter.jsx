// src/components/jobs/CoverLetter.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import MarkdownMessage from "../MarkdownMessage.jsx";

/**
 * CoverLetter.jsx — Draft ≤300-word cover letters from JD + Profile.
 *
 * Props:
 *   - jobId?: string          (optional; if not provided we use Job Inbox cache)
 *   - companyContext?: string (optional prefill; editable)
 *   - onReady?: (doc) => void (optional callback when user "Save version")
 *
 * APIs used:
 *   - GET  /api/profile
 *   - POST /api/tailor/draft/cover-letter  { jd_struct, profile, companyContext, tone, focus, wordCap }
 *
 * Persistence:
 *   - localStorage per job key: xenya.cover.v1::<jobKey>
 *   - jobKey = jobId || "inbox"
 *
 * Emits:
 *   window.dispatchEvent(new CustomEvent('docs:coverReady', { detail: { doc } }))
 */

const API_ORIGIN = (import.meta?.env?.VITE_API_ORIGIN || "").replace(/\/$/, ""); // '' -> use Vite proxy
const LS_PROFILE_KEY = "xenya.jobs.profile.v1";
const LS_INBOX_KEY = "xenya.jobs.inbox.v1"; // written by JobInbox.jsx

/* ----------------------------- helpers ----------------------------- */
const wc = (t = "") =>
  String(t).replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;

const nowISO = () => new Date().toISOString();
const prettyTime = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
  catch { return "—"; }
};

const downloadText = (filename, text) => {
  try {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a);
    a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch {}
};

const toast = (txt) => {
  const t = document.createElement("div");
  t.textContent = txt;
  t.style.cssText =
    "position:fixed;bottom:18px;right:18px;background:rgba(30,27,75,.95);border:1px solid rgba(255,255,255,.16);color:#fff;padding:10px 12px;border-radius:10px;z-index:10090;opacity:0;transform:translateY(8px);transition:all .22s";
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = "1"; t.style.transform = "translateY(0)"; });
  setTimeout(() => {
    t.style.opacity = "0"; t.style.transform = "translateY(8px)";
    setTimeout(() => t.remove(), 220);
  }, 1200);
};

const copyToClipboard = async (text) => {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch {}
};

/* ----------------------------- component ----------------------------- */
export default function CoverLetter({ jobId, companyContext = "", onReady }) {
  const jobKey = jobId || "inbox";
  const LS_COVER_KEY = `xenya.cover.v1::${jobKey}`;

  // controls
  const [tone, setTone] = useState("professional"); // professional | warm | crisp
  const [focus, setFocus] = useState("auto");       // auto | project | impact
  const [wordCap, setWordCap] = useState(300);
  const [signOff, setSignOff] = useState("Vedansh");
  const [addr, setAddr] = useState(false);
  const [ctx, setCtx] = useState(companyContext || "");

  // data
  const [profile, setProfile] = useState(null);
  const [jd, setJd] = useState(null);

  // output
  const [draft, setDraft] = useState("");
  const [risks, setRisks] = useState([]);
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const previewRef = useRef(null);

  /* --------------------------- styles (glass) --------------------------- */
  const styles = `
    .phx-card{ background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); border-radius:16px; padding:12px; }
    .phx-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;}
    .muted{ color:#cfcaff; font-size:12px }
    .btn{ padding:8px 12px; border-radius:10px; color:#fff; background:linear-gradient(180deg,#8b5cf6,#7c3aed); border:1px solid rgba(255,255,255,.16); cursor:pointer; font-weight:600 }
    .btn.ghost{ background:transparent; border-color:rgba(255,255,255,.16) }
    .btn:disabled{ opacity:.6; cursor:not-allowed }
    .grid{ display:grid; gap:12px; grid-template-columns: minmax(320px,1fr) 360px; }
    .panel{ background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:10px; }
    .label{ font-size:12px; color:#cfcaff; margin-bottom:4px }
    .input{ width:100%; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.18); border-radius:10px; color:#fff; padding:8px 10px }
    textarea.input{ min-height:80px }
    .row{ display:grid; grid-template-columns: 1fr 1fr; gap:8px }
    .side-row{ display:flex; align-items:center; justify-content:space-between; margin:6px 0; font-size:13px; color:#efeaff }
    .chip{ display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06); font-size:12px; color:#e8e6ff; margin:2px }
    .list{ font-size:12px; color:#efeaff }
    .list li{ margin:6px 0 }
    .divider{ height:1px; background:rgba(255,255,255,.12); margin:8px 0 }
  `;

  /* ------------------------------ hydrate ------------------------------ */
  // Load persisted cover state (per job)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_COVER_KEY) || "null");
      if (saved) {
        setTone(saved.controls?.tone || "professional");
        setFocus(saved.controls?.focus || "auto");
        setWordCap(saved.controls?.wordCap || 300);
        setSignOff(saved.controls?.signOff || "Vedansh");
        setAddr(!!saved.controls?.addr);
        setCtx(saved.companyContext || companyContext || "");
        setDraft(saved.draft_md || "");
        setRisks(saved.risks || []);
        setVersions(saved.versions || []);
        setSavedAt(saved.savedAt || null);
      }
    } catch {}
  }, [LS_COVER_KEY, companyContext]);

  // Persist cover state
  useEffect(() => {
    const payload = {
      job_id: jobId || null,
      companyContext: ctx,
      controls: { tone, focus, wordCap, signOff, addr },
      draft_md: draft,
      risks,
      versions,
      savedAt,
    };
    try { localStorage.setItem(LS_COVER_KEY, JSON.stringify(payload)); } catch {}
  }, [jobId, ctx, tone, focus, wordCap, signOff, addr, draft, risks, versions, savedAt, LS_COVER_KEY]);

  // Load profile: server then cache
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_ORIGIN}/api/profile`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          setProfile(j?.profile || null);
          if (j?.profile) localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(j.profile));
          setLive(true);
          return;
        }
      } catch {}
      // fallback to cache
      try {
        const cached = JSON.parse(localStorage.getItem(LS_PROFILE_KEY) || "null");
        if (cached) setProfile(cached);
      } catch {}
    })();
  }, []);

  // Load JD: by jobId (if you later wire /api/tracker/:id) else from JobInbox cache
  useEffect(() => {
    (async () => {
      if (!jobId) {
        try {
          const raw = JSON.parse(localStorage.getItem(LS_INBOX_KEY) || "{}");
          if (raw?.jd_struct) { setJd(raw.jd_struct); return; }
        } catch {}
      } else {
        try {
          const r = await fetch(`${API_ORIGIN}/api/tracker/${jobId}`);
          if (r.ok) {
            const j = await r.json();
            if (j?.job?.jd_struct) { setJd(j.job.jd_struct); return; }
          }
        } catch {}
      }
      setJd(null);
    })();
  }, [jobId]);

  /* ------------------------------ actions ------------------------------ */
  const regenerate = async () => {
    if (!profile) { alert("Complete your profile first."); return; }
    if (!jd) { alert("No job selected. Link a job from the Inbox or pass a jobId."); return; }

    setBusy(true);
    try {
      const payload = {
        jd_struct: jd,
        jobId: jobId || null,
        profile,
        companyContext: ctx || "",
        tone,
        focus,
        wordCap: Number(wordCap) || 300,
      };

      const res = await fetch(`${API_ORIGIN}/api/tailor/draft/cover-letter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get("content-type") || "";
      const bodyText = await res.text();
      if (!res.ok || !ct.includes("application/json")) {
        throw new Error(
          `HTTP ${res.status} ${res.statusText}. Response was not JSON. ` +
          `Check API_ORIGIN or that /api/tailor/draft/cover-letter exists.`
        );
      }
      const data = JSON.parse(bodyText);
      if (!data?.ok) throw new Error(data?.error || "Draft failed");

      let md = data.md || "";
      if (addr) {
        const name = profile?.identity?.full_name || "";
        const loc  = profile?.location?.current || "";
        md = `${name ? name + "\n" : ""}${loc || ""}\n\n${md}`;
      }
     
    if (signOff) {
      // only append if the model didn’t already include a sign-off
      const hasSig = /(?:\n|\r)(best|thanks|sincerely|regards)[^,\n]*,?\s*\n[ \t]*[A-Za-z .'-]+[ \t]*$/i.test(md);
      if (!hasSig) md = md.trim() + `\n\nBest,\n${signOff}\n`;
    }

      setDraft(md);
      setRisks(data.risks || []);
      setSavedAt(nowISO());
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    } catch (e) {
      alert("Generate error: " + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const saveVersion = () => {
    if (!draft.trim()) return;
    const doc = {
      id: `cov_${Date.now().toString(36)}`,
      job_id: jobId || null,
      md: draft,
      word_count: wc(draft),
      created_at: nowISO(),
      tags: ["cover_letter"],
    };
    setVersions((v) => [doc, ...v].slice(0, 20));
    setSavedAt(doc.created_at);
    window.dispatchEvent(new CustomEvent("docs:coverReady", { detail: { doc } }));
    if (onReady) onReady(doc);
    toast("Saved");
  };

  const restore = (doc) => {
    setDraft(doc.md || "");
    setSavedAt(nowISO());
  };

  const exportMd = () => {
    const title = jd?.title ? jd.title.replace(/[^\w\s-]/g, "").slice(0, 60) : "cover_letter";
    const company = (jd?.company || "").replace(/[^\w\s-]/g, "").slice(0, 40);
    const filename = `${company ? company + "_" : ""}${title || "cover_letter"}.md`;
    downloadText(filename, draft || "");
  };

  const wordCount = useMemo(() => wc(draft), [draft]);
  const overCap = wordCount > (Number(wordCap) || 300);

  /* --------------------------------- UI -------------------------------- */
  return (
    <>
      <style>{styles}</style>

      <div className="phx-card">
        {/* Header */}
        <div className="phx-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong>Cover Letter</strong>
            <span className="chip" title={live ? "Server reachable" : "Working offline"}>
              {live ? "Live" : "Offline"}
            </span>
            <span className="muted">Saved: {prettyTime(savedAt)}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={() => copyToClipboard(draft || "")} disabled={!draft}>Copy</button>
            <button className="btn ghost" onClick={exportMd} disabled={!draft}>Export</button>
            <button className="btn ghost" onClick={saveVersion} disabled={!draft}>Save version</button>
            <button className="btn" onClick={regenerate} disabled={busy || !profile}>
              {busy ? "Generating…" : draft ? "Regenerate" : "Generate"}
            </button>
          </div>
        </div>

        <div className="grid">
          {/* LEFT: Preview */}
          <div className="panel" ref={previewRef}>
            <div className="row">
              <div>
                <div className="label">Job</div>
                <div className="input" style={{ padding: "8px 10px" }}>
                  {jd?.title ? (
                    <>
                      <strong>{jd.title}</strong>
                      {jd.company ? <span className="muted"> — {jd.company}</span> : null}
                    </>
                  ) : (
                    <span className="muted">No job selected (using Inbox or pass jobId)</span>
                  )}
                </div>
              </div>
              <div>
                <div className="label">Company context (optional)</div>
                <input
                  className="input"
                  placeholder="mission, product, team notes…"
                  value={ctx}
                  onChange={(e) => setCtx(e.target.value)}
                />
              </div>
            </div>

            <div className="divider" />

            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <div className="label">Preview</div>
              <div
                className="chip"
                style={{
                  borderColor: overCap ? "rgba(244,63,94,.5)" : "rgba(255,255,255,.16)",
                  background: overCap ? "rgba(244,63,94,.12)" : "rgba(255,255,255,.06)",
                }}
                title={`Words: ${wordCount}/${wordCap}`}
              >
                {wordCount}/{wordCap}
              </div>
            </div>

            <div className="panel" style={{ minHeight: 180, background: "rgba(255,255,255,.03)" }} aria-live="polite">
              {draft ? (
                <MarkdownMessage text={draft} />
              ) : (
                <div className="muted">
                  No draft yet. Click <strong>Generate</strong> to create a ≤{wordCap}-word letter
                  from your profile and this job.
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Controls */}
          <div className="panel">
            <div className="label">Tone</div>
            <div className="row" style={{ marginBottom: 8 }}>
              <select className="input" value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="professional">professional</option>
                <option value="warm">warm</option>
                <option value="crisp">crisp</option>
              </select>

              <div>
                <div className="label">Focus</div>
                <select className="input" value={focus} onChange={(e) => setFocus(e.target.value)}>
                  <option value="auto">auto</option>
                  <option value="project">project-heavy</option>
                  <option value="impact">impact-heavy</option>
                </select>
              </div>
            </div>

            <div className="row" style={{ marginBottom: 8 }}>
              <div>
                <div className="label">Word cap</div>
                <input
                  className="input"
                  type="number"
                  min={120}
                  max={400}
                  value={wordCap}
                  onChange={(e) => setWordCap(parseInt(e.target.value || "300", 10))}
                />
              </div>
              <div>
                <div className="label">Sign-off name</div>
                <input className="input" value={signOff} onChange={(e) => setSignOff(e.target.value)} />
              </div>
            </div>

            <div className="side-row">
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={addr} onChange={(e) => setAddr(e.target.checked)} />
                Include address block
              </label>
            </div>

            <div className="divider" />

            <div className="label">Risks & tips</div>
            <ul className="list">
              {risks?.length ? (
                risks.map((r, i) => (
                  <li key={i}>
                    <span className="chip" style={{ background: "rgba(244,63,94,.12)", borderColor: "rgba(244,63,94,.35)" }}>
                      {r.type || "risk"}
                    </span>{" "}
                    {r.text || r.suggest || JSON.stringify(r)}
                  </li>
                ))
              ) : (
                <li className="muted">None detected.</li>
              )}
            </ul>

            <div className="divider" />

            <div className="label">Versions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {versions.length ? (
                versions.map((v) => (
                  <button
                    key={v.id}
                    className="input"
                    style={{ textAlign: "left", cursor: "pointer" }}
                    onClick={() => restore(v)}
                    title={`Restore version from ${prettyTime(v.created_at)} (${v.word_count} words)`}
                  >
                    v{v.id.slice(-4)} • {v.word_count} words • {prettyTime(v.created_at)}
                  </button>
                ))
              ) : (
                <div className="muted">No versions yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
