import React, { useEffect, useMemo, useState } from "react";
import { loadState } from "../../lib/stateStore";
import WeatherCard from "./WeatherCard.jsx";
/* --------------------------- helpers --------------------------- */

const qod = [
  ["Small steps today become momentum tomorrow.", "positivity"],
  ["Discipline beats motivation—show up anyway.", "focus"],
  ["You don’t need more time; you need clearer priorities.", "clarity"],
  ["Practice makes permanent. Practice the right things.", "craft"],
  ["The best way to start is to start.", "action"],
  ["Consistency is a superpower.", "consistency"],
  ["Your future self is watching. Don’t let them down.", "accountability"],
];

const wotd = [
  { word: "succinct", pos:"adj.", def:"brief and clearly expressed",
    ex: ["Keep cover letters succinct—signal, not fluff.", "Give a succinct status in stand-ups." ]},
  { word: "tenet", pos:"n.", def:"a principle or belief",
    ex: ["A tenet of good ML practice is reproducibility.", "User empathy is a core tenet of product design."]},
  { word: "cogent", pos:"adj.", def:"clear, logical, and convincing",
    ex: ["Prepare cogent arguments for design reviews.", "Write a cogent summary after research."]},
  { word: "heuristic", pos:"n.", def:"a practical rule of thumb",
    ex: ["Use a simple heuristic before over-engineering.", "This ranking heuristic works well with sparse data."]},
  { word: "diligent", pos:"adj.", def:"careful and persistent",
    ex: ["Be diligent with experiment logging.", "Diligent practice compounds quickly."]},
];

const byDatePick = (arr) => arr[(new Date().getUTCDate() + new Date().getUTCMonth()) % arr.length];

const truncate = (s, n=120) => (s && s.length>n ? s.slice(0,n-1)+"…" : s);

/* Weather advise */
function gearAdvice({ tMax, tMin, rainMm, uvMax, windKph }) {
  const items = [];
  if (rainMm >= 2) items.push("umbrella");
  if (uvMax >= 6) items.push("sunscreen");
  if (tMax <= 10 || tMin < 7) items.push("jacket");
  if (windKph >= 35) items.push("windbreaker");
  return items;
}

/* --------------------- Open-Meteo (no key) --------------------- */
// If user shares geolocation we call forecast directly.
// Otherwise they can type a city; we geocode via open-meteo’s geocoding API.
async function geocodeCity(city) {
  const u = `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`;
  const r = await fetch(u);
  const j = await r.json().catch(()=> ({}));
  const p = j?.results?.[0];
  if (!p) return null;
  return { lat: p.latitude, lon: p.longitude, name: `${p.name}${p.country?`, ${p.country}`:''}` };
}

async function getForecast({ lat, lon }) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,wind_speed_10m_max` +
    `&timezone=auto`;
  const r = await fetch(url);
  const j = await r.json();
  const d = j?.daily;
  if (!d) return null;
  return {
    location: { lat, lon },
    today: {
      tMax: d.temperature_2m_max?.[0],
      tMin: d.temperature_2m_min?.[0],
      rainMm: d.precipitation_sum?.[0],
      uvMax: d.uv_index_max?.[0],
      windKph: Math.round((d.wind_speed_10m_max?.[0] || 0)),
    }
  };
}

/* ------------------ Goal-aware news via your API ------------------ */
async function fetchGoalNews(goals, nPerGoal=3) {
  const all = [];
  for (const g of goals) {
    const q = (g.title || "").trim();
    if (!q) continue;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&n=${nPerGoal}`);
      const { hits=[] } = await res.json();
      // Pull a short summary for each hit
      const items = await Promise.all(hits.map(async (h) => {
        try {
          const sum = await fetch(`/api/summary?url=${encodeURIComponent(h.url)}`);
          const sj = await sum.json().catch(()=> ({}));
          return { title: h.title, url: h.url, takeaway: truncate(sj.summary || "", 220) };
        } catch {
          return { title: h.title, url: h.url, takeaway: "" };
        }
      }));
      all.push({ goal: q, items });
    } catch {}
  }
  return all;
}

/* ------------------------------ UI ------------------------------ */
const Chip = ({ children }) => (
  <span style={{
    padding:"6px 10px", borderRadius:999, fontSize:12,
    background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.12)"
  }}>{children}</span>
);

export default function BriefTab(){
  const [state, setState] = useState(null);
  const [city, setCity] = useState("");
  const [geoName, setGeoName] = useState("");
  const [wx, setWx] = useState(null);
  const [loadingWx, setLoadingWx] = useState(false);
  const [news, setNews] = useState([]);
  const [loadingNews, setLoadingNews] = useState(true);

  // load saved goals/capacity
  useEffect(() => { (async () => {
    const s = await loadState();
    setState(s);
  })(); }, []);

  // build a goal list (long + short)
  const goalList = useMemo(() => {
    const g = [];
    if (state?.goals?.long)  g.push(...state.goals.long);
    if (state?.goals?.short) g.push(...state.goals.short);
    return g.filter(Boolean);
  }, [state]);

  // goal news
  useEffect(() => {
    (async () => {
      setLoadingNews(true);
      const groups = await fetchGoalNews(goalList, 3);
      setNews(groups);
      setLoadingNews(false);
    })();
  }, [goalList]);

  // quote & word of day
  const [quote, tone] = byDatePick(qod);
  const word = byDatePick(wotd);

  // geolocate helper
  const useMyLocation = async () => {
    if (!navigator.geolocation) return alert("Geolocation not available");
    setLoadingWx(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        const f = await getForecast({ lat, lon });
        setWx(f);
        setGeoName("Your location");
      } finally { setLoadingWx(false); }
    }, () => setLoadingWx(false));
  };

  const searchCity = async () => {
    if (!city.trim()) return;
    setLoadingWx(true);
    try {
      const geo = await geocodeCity(city.trim());
      if (!geo) { setLoadingWx(false); return; }
      const f = await getForecast({ lat: geo.lat, lon: geo.lon });
      setWx(f); setGeoName(geo.name);
    } finally { setLoadingWx(false); }
  };

  const advice = wx ? gearAdvice(wx.today) : [];
  const dateStr = new Date().toLocaleDateString(undefined, { weekday:"long", month:"short", day:"numeric" });

  return (
    <div style={{display:"grid", gap:16, width:"100%", maxWidth:"100%", overflowX:"hidden"}}>
      <style>{`
        .card{ background:rgba(12,14,20,.72); border:1px solid rgba(255,255,255,.14);
               border-radius:16px; padding:14px; width:100%; max-width:100% }
        .h{ font-weight:800; letter-spacing:.25px; margin-bottom:6px }
        .muted{ opacity:.8 }
        .grid-2{ display:grid; gap:14px; grid-template-columns: minmax(0,1fr) minmax(0,1fr) }
        @media (max-width: 1024px){ .grid-2{ grid-template-columns: 1fr } }
        .btn{ padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
              background:rgba(255,255,255,.06); color:#fff }
        .btn:hover{ background:rgba(255,255,255,.10) }
        input[type="text"]{ width:100%; background:rgba(0,0,0,.4); border:1px solid rgba(255,255,255,.12);
                            color:#fff; border-radius:10px; padding:8px 10px }
        .news-item{ display:grid; gap:6px; padding:10px; border-radius:12px; background:rgba(255,255,255,.05);
                    border:1px solid rgba(255,255,255,.10) }
        a.link{ color:#93c5fd; text-decoration:none }
        a.link:hover{ text-decoration:underline }
      `}</style>

      {/* Header / Today */}
      <div className="card">
        <div className="h">Today • {dateStr}</div>
        <div className="muted">Your tailored brief—motivator, weather, and goal-focused reads.</div>
      </div>

      {/* Motivation & Word */}
      <div className="grid-2">
        <div className="card">
          <div className="h">Quote of the Day</div>
          <div style={{fontSize:18, lineHeight:1.4}}>{quote}</div>
          <div style={{marginTop:8}}><Chip>tone: {tone}</Chip></div>
        </div>
        <div className="card">
          <div className="h">Word of the Day</div>
          <div style={{fontSize:18, fontWeight:700}}>{word.word}</div>
          <div className="muted" style={{marginBottom:6}}>{word.pos} — {word.def}</div>
          <ul style={{margin:0, paddingLeft:18}}>
            {word.ex.map((s,i)=>(<li key={i}>{s}</li>))}
          </ul>
        </div>
      </div>
{/*   --------------------- Weather --------------------- */}



    <div style={{display:"grid", gap:16}}>
    {/* other cards… */}
    <WeatherCard />
    {/* other cards… */}
    </div>

{/*   --------------------- News --------------------- */}

      <div className="card">
        <div className="h">For Your Goals</div>
        {!goalList.length && <div className="muted">Add at least one goal in the Goals tab to see curated reads.</div>}
        {loadingNews && <div className="muted">Finding fresh items…</div>}
        {!loadingNews && news.map((group, idx)=>(
          <div key={idx} style={{marginTop:10}}>
            <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:8}}>
              <Chip>Goal</Chip>
              <div style={{fontWeight:700}}>{group.goal}</div>
            </div>
            <div style={{display:"grid", gap:8}}>
              {group.items.map((it,i)=>(
                <div key={i} className="news-item">
                  <a className="link" href={it.url} target="_blank" rel="noreferrer">{it.title}</a>
                  {it.takeaway && <div className="muted">{it.takeaway}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
