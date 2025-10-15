// client/src/components/todo/BriefTab.jsx
import React, { useMemo } from "react";
import WeatherCard from "./WeatherCard.jsx";
import NewsBoard from "./NewsBoard.jsx";

/* ---------- tiny atoms ---------- */
const Card = ({ title, children }) => (
  <div className="bf-card">
    <div className="bf-head">{title}</div>
    <div>{children}</div>
  </div>
);

/* ---------- daily quote / word (deterministic by date) ---------- */
const QUOTES = [
  { a:"James Clear", q:"You do not rise to the level of your goals. You fall to the level of your systems." },
  { a:"Angela Duckworth", q:"Enthusiasm is common. Endurance is rare." },
  { a:"Cal Newport", q:"Clarity about what matters provides clarity about what does not." },
  { a:"Maya Angelou", q:"Nothing will work unless you do." },
  { a:"Naval Ravikant", q:"Earn with your mind, not your time." },
  { a:"Marcus Aurelius", q:"The impediment to action advances action. What stands in the way becomes the way." },
  { a:"William Gibson", q:"The future is already here — it’s just not evenly distributed." },
];
const WORDS = [
  { w:"laconic", d:"using few words, concise", ex:"Give a laconic update in stand-ups." },
  { w:"tenet", d:"a principle or belief", ex:"One tenet of deep work is to remove distraction." },
  { w:"alacrity", d:"brisk and cheerful readiness", ex:"Approach code reviews with alacrity." },
  { w:"pragmatic", d:"dealing with things sensibly", ex:"Pick pragmatic baselines before fancy models." },
  { w:"succinct", d:"briefly and clearly expressed", ex:"Write succinct commit messages." },
  { w:"fortify", d:"to strengthen", ex:"Fortify your prep with daily DSA reps." },
  { w:"aplomb", d:"self-confidence or assurance", ex:"Answer mock questions with aplomb." },
];

function todayIndex(len){
  const d = new Date();
  // YYYYMMDD as a simple seed
  const seed = d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
  return seed % len;
}

/* ======================= Brief Tab ======================= */
export default function BriefTab(){
  const q = useMemo(() => QUOTES[todayIndex(QUOTES.length)], []);
  const w = useMemo(() => WORDS[todayIndex(WORDS.length)], []);

  return (
    <div className="bf-root">
      <style>{`
        .bf-root{ color:#fff; padding:2px }
        .bf-grid{ display:grid; gap:12px }
        /* keep it comfy inside the dock width (<= ~960px) */
        @media (min-width: 920px){
          .bf-grid{ grid-template-columns: 1fr; } /* single column works best inside the dock */
        }

        .bf-card{
          background:rgba(12,14,20,.72);
          border:1px solid rgba(255,255,255,.14);
          border-radius:16px;
          padding:14px;
        }
        .bf-head{ font-weight:800; letter-spacing:.2px; margin-bottom:8px }
        .bf-quote{ font-size:16px; line-height:1.5 }
        .bf-author{ opacity:.8; margin-top:6px }
        .bf-word{ display:flex; gap:10px; align-items:center; flex-wrap:wrap }
        .bf-chip{ padding:4px 8px; border-radius:999px; font-size:12px;
                  background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12) }
        .bf-muted{ opacity:.8 }
        .bf-stack{ display:grid; gap:12px }
      `}</style>

      <div className="bf-grid">
        {/* Quick positivity + word of the day */}
        <div className="bf-stack">
          <Card title="Motivation">
            <div className="bf-quote">“{q.q}”</div>
            <div className="bf-author">— {q.a}</div>
          </Card>

          <Card title="Word of the Day">
            <div className="bf-word">
              <span className="bf-chip">{w.w}</span>
              <span className="bf-muted">• {w.d}</span>
            </div>
            <div style={{ marginTop:8 }} className="bf-muted">Example: {w.ex}</div>
          </Card>
        </div>

        {/* Weather at the top */}
        <WeatherCard />


        {/* Goal-aware + curated news board */}
        <NewsBoard />
      </div>
    </div>
  );
}
