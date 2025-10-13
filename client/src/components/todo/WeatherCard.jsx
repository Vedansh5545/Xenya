// client/src/components/todo/WeatherCard.jsx
import React, { useEffect, useMemo, useState } from "react";

/* ---- tiny UI bits ---- */
const Chip = ({ children }) => (
  <span style={{
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.12)"
  }}>{children}</span>
);

/* ---- WMO code → label/icon ---- */
const WMO = {
  0:{name:"Clear",icon:"☀️"},1:{name:"Mainly clear",icon:"🌤️"},2:{name:"Partly cloudy",icon:"⛅"},
  3:{name:"Overcast",icon:"☁️"},45:{name:"Fog",icon:"🌫️"},48:{name:"Rime fog",icon:"🌫️"},
  51:{name:"Light drizzle",icon:"🌦️"},53:{name:"Drizzle",icon:"🌦️"},55:{name:"Heavy drizzle",icon:"🌧️"},
  61:{name:"Light rain",icon:"🌧️"},63:{name:"Rain",icon:"🌧️"},65:{name:"Heavy rain",icon:"🌧️"},
  71:{name:"Snow",icon:"❄️"},80:{name:"Rain showers",icon:"🌧️"},95:{name:"Thunderstorm",icon:"⛈️"}
};

/* ---- data fetchers (no API key needed) ---- */
async function reverseGeocode(lat, lon){
  const u = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1`;
  const r = await fetch(u);
  const j = await r.json().catch(()=>({}));
  const p = j?.results?.[0];
  if (!p) return null;
  const parts = [p.name, p.admin1, p.country].filter(Boolean);
  return parts.slice(0,2).join(", ");
}
async function getForecast({lat,lon}){
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code`
    + `&hourly=temperature_2m,precipitation_probability,weather_code`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,wind_speed_10m_max`
    + `&timezone=auto`;
  const r = await fetch(url);
  const j = await r.json().catch(()=>null);
  if (!j) return null;
  return {
    current: { t:j.current?.temperature_2m, wc:j.current?.weather_code, wind:Math.round(j.current?.wind_speed_10m||0) },
    hourly:  { times:j.hourly?.time||[], temps:j.hourly?.temperature_2m||[] },
    today:   { tMax:j.daily?.temperature_2m_max?.[0], tMin:j.daily?.temperature_2m_min?.[0],
               rainMm:j.daily?.precipitation_sum?.[0], uvMax:j.daily?.uv_index_max?.[0],
               windKph:Math.round(j.daily?.wind_speed_10m_max?.[0]||0) }
  };
}

/* ---- location resolver: geolocation → IP fallback ---- */
function geolocateWithTimeout(ms=8000){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error("no-geo"));
    let done=false;
    const timer=setTimeout(()=>{ if(!done){ done=true; reject(new Error("geo-timeout")); } }, ms);
    navigator.geolocation.getCurrentPosition(
      pos=>{ if(done) return; done=true; clearTimeout(timer); resolve({lat:pos.coords.latitude, lon:pos.coords.longitude}); },
      err=>{ if(done) return; done=true; clearTimeout(timer); reject(err); },
      { enableHighAccuracy:true, timeout:ms }
    );
  });
}
async function ipFallback(){
  try{
    const r = await fetch("https://ipapi.co/json/");
    const j = await r.json();
    if (j?.latitude && j?.longitude)
      return { lat:j.latitude, lon:j.longitude, name:`${j.city}, ${j.country_name}` };
  }catch{}
  return null;
}

/* ---- simple gear advice ---- */
function gearAdvice({ tMax, tMin, rainMm, uvMax, windKph }){
  const a=[]; if(rainMm>=2)a.push("umbrella"); if(uvMax>=6)a.push("sunscreen");
  if(tMax<=10||tMin<7)a.push("jacket"); if(windKph>=35)a.push("windbreaker"); return a;
}

/* ---- sparkline helpers (Catmull–Rom → Bézier) ---- */
function catmullRom2bezier(points) {
  if (points.length < 2) return "";
  const d = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    if (i === 0) d.push(`M ${p1.x},${p1.y}`);
    d.push(`C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`);
  }
  return d.join(" ");
}
function buildSpark(temps, times, opts={}) {
  if (!temps?.length || !times?.length) return null;

  // chart box (extra height for axis labels)
  const W = 560, H = 140, P = 12;
  const min = Math.min(...temps);
  const max = Math.max(...temps) + 0.0001;
  const n = temps.length;

  const sx = (i) => P + (i / (n - 1)) * (W - 2 * P);
  const sy = (v) => P + (1 - (v - min) / (max - min)) * (H - 42 - P); // keep 42px for axis space

  const pts = temps.map((v, i) => ({ x: sx(i), y: sy(v), v }));
  const path = catmullRom2bezier(pts);

  const baseY = H - 30; // axis baseline
  const area = `${path} L ${pts.at(-1).x},${baseY} L ${pts[0].x},${baseY} Z`;

  // Build hour tick marks (every 3 hours)
  const labels = [];
  const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
  const step = 3; // hours
  for (let i = 0; i < times.length && labels.length < n; i++) {
    const dt = new Date(times[i]);
    const hoursFromStart = (dt.getTime() - new Date(times[0]).getTime()) / 3_600_000;
    if (Math.round(hoursFromStart) % step === 0) {
      labels.push({ x: sx(i), text: formatter.format(dt) });
    }
  }

  return {
    W, H, baseY,
    path,
    area,
    points: [pts[0], pts[Math.round((n - 1) / 2)], pts.at(-1)],
    labels,                      // tick label positions
    range: { min, max }
  };
}

/* ======================= COMPONENT ======================= */
export default function WeatherCard(){
  const [locName,setLocName]=useState("");     // "San Jose, US"
  const [wx,setWx]=useState(null);             // forecast bundle
  const [err,setErr]=useState("");             // human message
  const [loading,setLoading]=useState(true);

  async function resolveWeather(){
    setLoading(true); setErr(""); setWx(null);
    try{
      // 1) Try browser geolocation
      let coords=null, name=null;
      try{
        coords = await geolocateWithTimeout(8000);
        name   = await reverseGeocode(coords.lat, coords.lon);
      }catch{
        // 2) Fallback to IP
        const ip = await ipFallback();
        if(!ip) throw new Error("Couldn’t determine your location.");
        coords = { lat:ip.lat, lon:ip.lon };
        name   = ip.name || "Your location";
      }
      const f = await getForecast(coords);
      if(!f) throw new Error("Forecast fetch failed.");
      setLocName(name || "Your location");
      setWx(f);
    }catch(e){ setErr(e?.message || "Weather unavailable."); }
    finally{ setLoading(false); }
  }

  useEffect(()=>{ resolveWeather(); }, []);

  // Next ~12 hours temps → pretty spark with axis
  const spark = useMemo(() => {
    if(!wx?.hourly?.temps?.length || !wx?.hourly?.times?.length) return null;
    const now = Date.now();
    const i0  = wx.hourly.times.findIndex(t => new Date(t).getTime() >= now);
    const temps = wx.hourly.temps.slice(Math.max(0,i0), Math.max(0,i0)+12);
    const times = wx.hourly.times.slice(Math.max(0,i0), Math.max(0,i0)+12);
    return buildSpark(temps, times);
  }, [wx]);

  const icon   = WMO[wx?.current?.wc]?.icon || "⛅";
  const label  = WMO[wx?.current?.wc]?.name || "Partly cloudy";
  const advice = wx ? gearAdvice(wx.today) : [];
  const dateStr = new Date().toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"});

  return (
    <div className="card">
      <style>{`
        .card{ background:rgba(12,14,20,.72); border:1px solid rgba(255,255,255,.14);
               border-radius:16px; padding:14px; width:100% }
        .h{ font-weight:800; letter-spacing:.25px; margin-bottom:6px }
        .muted{ opacity:.8 }
        .wx-wrap{ display:grid; gap:12px }
        .wx-top{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap }
        .wx-left{ display:flex; align-items:center; gap:12px }
        .wx-emoji{ font-size:40px; filter: drop-shadow(0 0 8px rgba(255,255,255,.25)); animation: breathe 3s ease-in-out infinite }
        @keyframes breathe { 0%{ transform:scale(1) } 50%{ transform:scale(1.04) } 100%{ transform:scale(1) } }
        .wx-temp{ font-size:36px; font-weight:800; letter-spacing:.3px }

        /* pretty spark */
        .wx-chart{ width:100%; margin-top:6px }
        .wx-draw{ stroke-dasharray:1100; stroke-dashoffset:1100; animation: wx-draw 1.6s ease-out forwards }
        .wx-fade{ opacity:0; animation: wx-fade .9s .2s ease-out forwards }
        .wx-dot{ transform-origin:center; animation: wx-pop .35s ease-out both }
        .wx-dot:nth-child(1){ animation-delay:.15s }
        .wx-dot:nth-child(2){ animation-delay:.30s }
        .wx-dot:nth-child(3){ animation-delay:.45s }

        .wx-axis text{ font-size:11px; fill: rgba(255,255,255,.7); }
        .wx-axis line{ stroke: rgba(255,255,255,.12); }

        @keyframes wx-draw { to{ stroke-dashoffset:0 } }
        @keyframes wx-fade { to{ opacity:1 } }
        @keyframes wx-pop { from{ transform: scale(.6); opacity:0 } to{ transform: scale(1); opacity:1 } }

        .legend{ font-size:11px; color:rgba(255,255,255,.75); margin-left:2px }
        .btn{ padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
              background:rgba(255,255,255,.06); color:#fff }
        .btn:hover{ background:rgba(255,255,255,.10) }
      `}</style>

      <div className="h">Weather</div>

      {loading && <div className="muted">Getting your location and weather…</div>}

      {!loading && err && (
        <div style={{display:"flex", gap:10, alignItems:"center", justifyContent:"space-between", flexWrap:"wrap"}}>
          <div className="muted">{err}</div>
          <button className="btn" onClick={resolveWeather}>Retry</button>
        </div>
      )}

      {!loading && wx && (
        <div className="wx-wrap">
          <div className="wx-top">
            <div className="wx-left">
              <div className="wx-emoji" aria-hidden>{icon}</div>
              <div>
                <div className="wx-temp">{Math.round(wx.current.t)}°C</div>
                <div className="muted">{label} • {locName || "Your location"} • {dateStr}</div>
              </div>
            </div>
            <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
              <Chip>T° max {Math.round(wx.today.tMax)}°C</Chip>
              <Chip>T° min {Math.round(wx.today.tMin)}°C</Chip>
              <Chip>Rain {Math.round(wx.today.rainMm)}mm</Chip>
              <Chip>UV max {Math.round(wx.today.uvMax)}</Chip>
              <Chip>Wind {Math.round(wx.today.windKph)} km/h</Chip>
            </div>
          </div>

          {spark && (
            <>
              <div className="legend">Next 12 hours</div>
              <div className="wx-chart">
                <svg viewBox={`0 0 ${spark.W} ${spark.H}`} width="100%" height={spark.H}>
                  <defs>
                    <linearGradient id="wx-line" x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%"  stopColor="#fde68a"/>
                      <stop offset="50%" stopColor="#a7f3d0"/>
                      <stop offset="100%" stopColor="#60a5fa"/>
                    </linearGradient>
                    <linearGradient id="wx-area" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="rgba(96,165,250,.28)"/>
                      <stop offset="100%" stopColor="rgba(96,165,250,0)"/>
                    </linearGradient>
                    <filter id="wx-glow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#60a5fa" floodOpacity="0.5"/>
                    </filter>
                  </defs>

                  {/* axis baseline */}
                  <g className="wx-axis">
                    <line x1="0" y1={spark.baseY} x2={spark.W} y2={spark.baseY} />
                    {spark.labels.map((l,i)=>(
                      <g key={i} transform={`translate(${l.x},0)`}>
                        <line x1="0" y1={spark.baseY} x2="0" y2={spark.baseY+6}/>
                        <text x="0" y={spark.baseY+18} textAnchor="middle">{l.text}</text>
                      </g>
                    ))}
                  </g>

                  {/* area fill */}
                  <path d={spark.area} fill="url(#wx-area)" className="wx-fade"/>

                  {/* smooth line */}
                  <path d={spark.path} fill="none" stroke="url(#wx-line)" strokeWidth="3.5"
                        filter="url(#wx-glow)" className="wx-draw"/>

                  {/* dots: first / mid / last */}
                  {spark.points.map((p, i) => (
                    <g key={i} className="wx-dot">
                      <circle cx={p.x} cy={p.y} r="3.6" fill="#fff"/>
                      <circle cx={p.x} cy={p.y} r="8" fill="rgba(255,255,255,.08)"/>
                    </g>
                  ))}
                </svg>
              </div>
            </>
          )}

          <div>
            {advice.length
              ? <>Gear today: {advice.map((a,i)=><Chip key={i}>{a}</Chip>)}</>
              : <span className="muted">No special gear needed today.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
