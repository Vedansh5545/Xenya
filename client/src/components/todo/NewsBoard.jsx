// client/src/components/todo/NewsBoard.jsx
import React, { useEffect, useState } from "react";

/* --------------------- tiny UI atoms --------------------- */
const Tag = ({ children }) => <span className="nb2-tag">{children}</span>;

const Button = ({ children, ...p }) => (
  <button {...p} className="nb2-btn">
    {children}
  </button>
);

/** Collapsible section (accordion-style, subtle motion) */
function Section({ title, subtitle, right, defaultOpen = true, children, count }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`nb2-sec ${open ? "is-open" : "is-closed"}`}>
      <header className="nb2-sec-head" onClick={() => setOpen((o) => !o)}>
        <div className="nb2-sec-titles">
          <div className="nb2-title">
            <span className={`nb2-caret ${open ? "rot" : ""}`} aria-hidden>▸</span>
            {title}
            {!!count && <span className="nb2-count">{count}</span>}
          </div>
          {subtitle && <div className="nb2-sub">{subtitle}</div>}
        </div>
        <div className="nb2-head-right">{right}</div>
      </header>

      {/* Collapsible content with max-height transition (no layout jank) */}
      <div className="nb2-collapse" aria-hidden={!open}>
        <div className="nb2-collapse-inner">{children}</div>
      </div>
    </div>
  );
}

/* --------------------- helpers --------------------- */
const HOST =
  (typeof window !== "undefined" && (window.__API_BASE__ || "")) ||
  (import.meta?.env?.VITE_API_BASE || "") ||
  (typeof location !== "undefined" && location.port === "5173"
    ? "http://localhost:3000"
    : "");

async function fetchJSON(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs || 15000);
  try {
    const r = await fetch(url, { cache: "no-store", ...opts, signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} at ${url}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function hostOf(u = "") {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function shortTitle(s = "") {
  return String(s).replace(/\s+\|\s+.*$/, "").replace(/\s+[-–—]\s+.*$/, "").trim();
}
function fmtCT(d) {
  try {
    return new Date(d).toLocaleString("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

/* cache summaries so we don't refetch */
const sumCache = new Map();
async function fetchSummary(url) {
  if (sumCache.has(url)) return sumCache.get(url);
  try {
    const j = await fetchJSON(`${HOST}/api/summary?url=${encodeURIComponent(url)}`);
    const out = j?.summary || j?.title || null;
    if (out) sumCache.set(url, out);
    return out;
  } catch { return null; }
}

/* --------------------- main --------------------- */
export default function NewsBoard() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState({ today: "", tz: "America/Chicago" });
  const [sections, setSections] = useState({ tech: [], finance: [], ir: [], trends: [], research: [] });

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const j = await fetchJSON(`${HOST}/api/news/today`);
      setMeta({ today: j.today, tz: j.tz || "America/Chicago" });
      setSections({
        tech: j.sections?.tech || [],
        finance: j.sections?.finance || [],
        ir: j.sections?.ir || [],
        trends: j.sections?.trends || [],
        research: j.sections?.research || [],
      });
    } catch (e) {
      setErr(
        String(e?.message || "Failed to load news").includes("/api/news/today")
          ? "news endpoint missing (404) — ensure server has /api/news/today and you restarted it."
          : String(e?.message || "Failed to load news")
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="nb2-root">
      <StyleSheet />
      <div className="nb2-actions">
        <Button onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh news"}</Button>
        <span className="nb2-muted">Today only • {meta.today || "(—)"} ({meta.tz})</span>
        {err && <span className="nb2-err"> • {err}</span>}
      </div>

      {/* Layout inspired by a clean bullet-journal spread */}
      <Section
        title="Tech"
        subtitle="The Verge • Ars Technica • TechCrunch"
        right={<Tag>engineering</Tag>}
        defaultOpen
        count={sections.tech?.length}
      >
        <Cards items={sections.tech} />
      </Section>

      <div className="nb2-grid">
        <Section
          title="Finance & Global Markets"
          subtitle="Reuters • CNBC • MarketWatch"
          right={<Tag>markets</Tag>}
          defaultOpen={false}
          count={sections.finance?.length}
        >
          <Cards items={sections.finance} />
        </Section>

        <Section
          title="International Relations"
          subtitle="Reuters World • BBC World • Al Jazeera • NPR"
          right={<Tag>world</Tag>}
          defaultOpen={false}
          count={sections.ir?.length}
        >
          <Cards items={sections.ir} />
        </Section>
      </div>

      <div className="nb2-grid">
        <Section
          title="Trends & Memes"
          subtitle="Google Trends (US) • Know Your Meme"
          right={<Tag>culture</Tag>}
          defaultOpen={false}
          count={sections.trends?.length}
        >
          <Cards items={sections.trends} />
        </Section>

        <Section
          title="New Research"
          subtitle="arXiv cs.LG • cs.CV (today)"
          right={<Tag>papers</Tag>}
          defaultOpen={false}
          count={sections.research?.length}
        >
          <Cards items={sections.research} />
        </Section>
      </div>
    </div>
  );
}

/* --------------------- list renderer w/ on-demand summary --------------------- */
function Cards({ items }) {
  if (!items?.length) return <div className="nb2-empty">No items yet for today.</div>;
  return (
    <ul className="nb2-list">
      {items.map((it, i) => <CardRow key={i} item={it} />)}
    </ul>
  );
}

function CardRow({ item }) {
  const [open, setOpen] = useState(false);
  const [sum, setSum] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (!sum) {
      setBusy(true);
      const s = await fetchSummary(item.url);
      setSum(String(s || "Quick take: could not summarize. Open the link for details."));
      setBusy(false);
    }
  }

  return (
    <li className="nb2-card">
      <a className="nb2-link" href={item.url} target="_blank" rel="noreferrer">
        {shortTitle(item.title || item.url)}
      </a>
      <div className="nb2-host"><span className="nb2-dot" /> {hostOf(item.url)} • {fmtCT(item.pubDate)}</div>

      <div className="nb2-row-actions">
        <button className="nb2-sm-btn" onClick={toggle}>
          {busy ? "Summarizing…" : open ? "Hide summary" : "Show summary"}
        </button>
      </div>

      {/* Summary area collapses inside card (subtle) */}
      <div className={`nb2-mini-collapse ${open ? "open" : ""}`}>
        {busy ? <div className="nb2-skel" /> : (sum && <div className="nb2-sum">{sum}</div>)}
      </div>
    </li>
  );
}

/* --------------------- styles --------------------- */
function StyleSheet() {
  return (
    <style>{`
      :root{
        --nb2-ink:#fff;
        --nb2-muted:rgba(255,255,255,.78);
        --nb2-surface: rgba(16,18,24,.72);
        --nb2-line: rgba(255,255,255,.14);
        --nb2-card: rgba(255,255,255,.06);
        --nb2-card2: rgba(255,255,255,.03);
        --nb2-accent:#FFE08A;        /* soft highlight like highlighter */
        --nb2-ink-accent:#0c0e14;
      }
      .nb2-root{ color:var(--nb2-ink) }

      /* top actions */
      .nb2-actions{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px }
      .nb2-muted{ opacity:.8 }
      .nb2-err{ color:#ffb3b3; font-size:12px }

      .nb2-btn{
        padding:8px 12px; border-radius:12px; border:1px solid var(--nb2-line);
        background:var(--nb2-card); color:#fff; cursor:pointer;
        transition:transform .15s ease, background .2s ease, border-color .2s ease;
      }
      .nb2-btn:disabled{ opacity:.6; cursor:default; transform:none }
      .nb2-btn:not(:disabled):hover{ background:rgba(255,255,255,.1); transform:translateY(-1px) }

      .nb2-tag{
        padding:3px 8px; border-radius:999px; font-size:11px;
        background:var(--nb2-card); border:1px solid var(--nb2-line);
      }

      /* Sections (accordion container) */
      .nb2-sec{
        background:var(--nb2-surface);
        border:1px solid var(--nb2-line);
        border-radius:16px; padding:10px 12px;
        margin-bottom:12px;
      }

      .nb2-sec-head{
        display:flex; align-items:flex-start; justify-content:space-between; gap:10px; cursor:pointer;
      }
      .nb2-sec-titles{ display:flex; flex-direction:column; gap:4px }
      .nb2-title{ font-weight:800; letter-spacing:.2px; display:flex; align-items:center; gap:8px }
      .nb2-count{ font-size:11px; opacity:.85; background:var(--nb2-card); border:1px solid var(--nb2-line); padding:2px 6px; border-radius:999px }
      .nb2-sub{ opacity:.75; font-size:12px }
      .nb2-head-right{ display:flex; align-items:center; gap:8px }

      .nb2-caret{ display:inline-block; transform:rotate(0deg); transition: transform .18s ease }
      .nb2-caret.rot{ transform:rotate(90deg) }

      .nb2-collapse{
        overflow:hidden;
        transition:max-height .28s ease;
        max-height:0;
      }
      .nb2-sec.is-open .nb2-collapse{ max-height:1200px } /* plenty for content size */
      .nb2-collapse-inner{ padding-top:10px }

      .nb2-grid{ display:grid; gap:12px }
      @media (min-width: 920px){ .nb2-grid{ grid-template-columns: 1fr 1fr } }

      /* Cards */
      .nb2-list{ list-style:none; padding:0; margin:0; display:grid; gap:10px }
      .nb2-card{
        background:linear-gradient(180deg, var(--nb2-card), var(--nb2-card2));
        border:1px solid rgba(255,255,255,.1);
        border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px;
        transition: box-shadow .22s ease, transform .16s ease, border-color .2s ease, background .2s ease;
      }
      .nb2-card:hover{ transform: translateY(-2px); border-color: rgba(255,255,255,.18); box-shadow: 0 8px 22px rgba(0,0,0,.25) }

      .nb2-link{ color:#cdeaff; text-decoration:none; font-weight:700; line-height:1.25 }
      .nb2-link:hover{ text-decoration:underline }
      .nb2-host{ font-size:11px; opacity:.72; display:flex; align-items:center; gap:6px }
      .nb2-dot{ width:6px; height:6px; border-radius:50%; background:#6fe3ff; opacity:.9 }

      .nb2-row-actions{ display:flex; gap:8px; align-items:center; flex-wrap:wrap }
      .nb2-sm-btn{
        font-size:12px; padding:4px 8px; border-radius:7px;
        border:1px solid var(--nb2-line);
        background:var(--nb2-card); color:#fff; cursor:pointer;
        transition: transform .12s ease, background .18s ease, border-color .18s ease;
      }
      .nb2-sm-btn:hover{ transform:translateY(-1px); background:rgba(255,255,255,.09) }

      /* Inline collapse inside card for summary */
      .nb2-mini-collapse{ overflow:hidden; max-height:0; transition:max-height .24s ease }
      .nb2-mini-collapse.open{ max-height:600px }
      .nb2-sum{ white-space:pre-line; opacity:.96; font-size:13.2px; line-height:1.38 }

      /* Skeleton shimmer for summary */
      .nb2-skel{
        height:68px; border-radius:8px; position:relative; overflow:hidden;
        background:
          linear-gradient(90deg, rgba(255,255,255,.06), rgba(255,255,255,.11), rgba(255,255,255,.06));
        background-size: 220px 100%;
        animation: nb2Shimmer 1.1s linear infinite;
      }
      @keyframes nb2Shimmer { 0% { background-position:-220px 0 } 100% { background-position:220px 0 } }

      .nb2-empty{
        font-size:13px; opacity:.82; border:1px dashed var(--nb2-line);
        padding:12px; border-radius:10px; text-align:center;
        background: rgba(255,255,255,.03);
      }

      /* Gentle highlighter underline for titles (bullet-journal vibe) */
      .nb2-title{
        position:relative;
      }
      .nb2-title::after{
        content:"";
        position:absolute; left:18px; right:auto; height:8px; bottom:-3px;
        background: var(--nb2-accent);
        opacity:.18; border-radius:6px;
        transform: translateY(0);
      }
    `}</style>
  );
}
