// src/components/FocusTimer.jsx
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";

// ---- local audio (adjust if you moved files) ----
import cafeURL from "../../sounds/cafe.mp3";
import beachURL from "../../sounds/beach.mp3";
import rain1URL from "../../sounds/rain1.mp3";
import rain2URL from "../../sounds/rain2.mp3";
import fireplaceURL from "../../sounds/fireplace.mp3";
import pianoURL from "../../sounds/piano.mp3";

/**
 * FocusTimer — UX-polished settings + ambience previews
 *
 * - Uses your local mp3s (cafe/beach/rain1+rain2/fireplace/piano).
 * - Ambience keeps playing even if the timer panel is closed (global audio kit).
 * - New Settings: tabs, visual ambience picker, bigger sliders, Test button, Reset defaults.
 * - Animations/backgrounds per ambience kept and slightly polished.
 */

const LS_STATE = "xenya.timer.v1";
const LS_CFG   = "xenya.timer.v1.cfg";
const LS_SESS  = "xenya.sessions.v1";
const KB_LS    = "xenya.kanban.v1";

// -------- defaults (unchanged semantics) --------
const DEFAULTS = {
  mode: "pomodoro",     // 'timer' | 'pomodoro'
  simpleM: 20,
  focusM: 25, shortBreakM: 5, longBreakM: 15, longEvery: 4, autoCycle: true,
  notify: true, sound: true,
  timerEndSound: "alarm",
  pomodoroEndSound: "chime",
  ambientEnabled: true,
  ambientType: "cafe",           // 'cafe' | 'pianoguitar' | 'beach' | 'rain' | 'fireplace'
  ambientVolume: 0.18,
  ambientOnFocus: true,
  ambientOnBreak: false,
};

const POMODORO_PRESETS = [
  { id: "classic",  label: "25/5 ×4",  focusM: 25, shortBreakM: 5,  longBreakM: 15, longEvery: 4 },
  { id: "study",    label: "50/10 ×3", focusM: 50, shortBreakM: 10, longBreakM: 20, longEvery: 3 },
  { id: "balanced", label: "45/15 ×4", focusM: 45, shortBreakM: 15, longBreakM: 20, longEvery: 4 },
  { id: "ultra",    label: "90/20 ×2", focusM: 90, shortBreakM: 20, longBreakM: 30, longEvery: 2 },
];

// -------- utils --------
function now(){ return Date.now(); }
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function fmt(ms){
  ms = Math.max(0, ms|0);
  const s = Math.round(ms/1000); const m = Math.floor(s/60); const r = s % 60;
  return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}
function uid(){ return "s_" + Math.random().toString(36).slice(2,8) + Math.random().toString(36).slice(2,6); }

function useLocalJSON(key, init){
  const [value, setValue] = useState(()=>{
    try{ const raw = localStorage.getItem(key); if(raw) return JSON.parse(raw); }catch{}
    return typeof init === "function" ? init() : init;
  });
  useEffect(()=>{ try{ localStorage.setItem(key, JSON.stringify(value)); }catch{} }, [key, value]);
  return [value, setValue];
}

function readKanbanTasks(){
  try{ const db = JSON.parse(localStorage.getItem(KB_LS)) || { tasks:[] }; return Array.isArray(db.tasks)? db.tasks:[]; }catch{ return []; }
}

/* =======================================================================================
   LocalAudioKit — plays your mp3s via Web Audio, survives unmounts
======================================================================================= */
function getLocalAudioKit(){
  if (typeof window === "undefined") return null;
  if (window.__xenyaLocalAudioKit) return window.__xenyaLocalAudioKit;
  const kit = createLocalAudioKit();
  window.__xenyaLocalAudioKit = kit;
  return kit;
}

function createLocalAudioKit(){
  const k = {
    ctx: null,
    master: null,
    bus: null,
    current: null,
    fadingOut: [],
    claims: 0,
    fadeMs: 450
  };

  const ensure = async ()=>{
    if (!k.ctx) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const master = ctx.createGain(); master.gain.value = 0.95; master.connect(ctx.destination);
      const bus = ctx.createGain(); bus.gain.value = 0.0; bus.connect(master);
      k.ctx = ctx; k.master = master; k.bus = bus;

      // keepalive ultra-low osc (keeps audio graph alive in some cases)
      const keep = ctx.createOscillator(), g = ctx.createGain();
      keep.frequency.value = 12; g.gain.value = 0.00001; keep.connect(g).connect(master); keep.start();
    }
    if (k.ctx.state === "suspended") { try{ await k.ctx.resume(); }catch{} }
  };

  const setVolume = (v)=>{ if(k.bus) k.bus.gain.setTargetAtTime(clamp(v,0,1), k.ctx.currentTime, 0.12); };

  const stop = ()=>{
    if (k.current){ tryStopGroup(k.current); k.current = null; }
    k.fadingOut.forEach(tryStopGroup); k.fadingOut = [];
    if (k.bus) k.bus.gain.setTargetAtTime(0, k.ctx.currentTime, 0.08);
  };

  function tryStopGroup(group){
    if(!group) return;
    group.elements.forEach(a=>{ try{ a.pause(); }catch{} try{ a.srcObject = null; }catch{} });
    group.sources.forEach(s=>{ try{ s.disconnect(); }catch{} });
    try{ group.gain.disconnect(); }catch{}
  }

  function makeElement(src, loop=true){
    const a = new Audio(src);
    a.loop = loop; a.crossOrigin = "anonymous"; a.preload = "auto"; a.volume = 1;
    return a;
  }

  function buildGroup(type){
    const elements = [];
    const sources  = [];
    const groupGain = k.ctx.createGain(); groupGain.gain.value = 0;
    groupGain.connect(k.bus);

    const connect = (url, relGain=1)=>{
      const a = makeElement(url, true);
      const srcNode = k.ctx.createMediaElementSource(a);
      const g = k.ctx.createGain(); g.gain.value = relGain;
      srcNode.connect(g).connect(groupGain);
      elements.push(a); sources.push(srcNode, g);
    };

    if (type === "cafe") connect(cafeURL, 1.0);
    else if (type === "beach") connect(beachURL, 1.0);
    else if (type === "rain") { connect(rain1URL, 0.85); connect(rain2URL, 0.85); }
    else if (type === "fireplace") connect(fireplaceURL, 1.0);
    else if (type === "pianoguitar") connect(pianoURL, 1.0);

    return { gain: groupGain, elements, sources };
  }

  async function start(type, vol){
    await ensure();
    setVolume(vol);

    const next = buildGroup(type);
    next.elements.forEach(a=>{
      // uncomment to start at a random point for more natural loop feel:
      // a.addEventListener('loadedmetadata', ()=> { try{ a.currentTime = Math.random() * (a.duration||0); }catch{} });
      a.play().catch(()=>{});
    });

    const t = k.ctx.currentTime;
    next.gain.gain.cancelScheduledValues(t);
    next.gain.gain.setValueAtTime(0, t);
    next.gain.gain.linearRampToValueAtTime(1, t + k.fadeMs/1000);

    if (k.current){
      const old = k.current;
      k.fadingOut.push(old);
      const t2 = k.ctx.currentTime;
      old.gain.gain.cancelScheduledValues(t2);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t2);
      old.gain.gain.linearRampToValueAtTime(0, t2 + k.fadeMs/1000);
      setTimeout(()=>{
        tryStopGroup(old);
        k.fadingOut = k.fadingOut.filter(g=>g!==old);
      }, k.fadeMs + 60);
    }

    k.current = next;
  }

  function claim(){ k.claims++; }
  function release(){ k.claims = Math.max(0, k.claims-1); if (k.claims===0) stop(); }

  // Simple end bleeps (WebAudio)
  function playEnd(choice){
    if(!k.ctx) return; if(choice==="none") return;
    const tone=(f=880, dur=0.25, vol=0.22)=>{
      const o=k.ctx.createOscillator(), g=k.ctx.createGain(); o.type="sine"; o.frequency.value=f;
      o.connect(g).connect(k.master||k.ctx.destination); g.gain.value=0.0001;
      const t=k.ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(vol, t+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t+dur); o.start(); o.stop(t+dur+0.02);
    };
    if (choice==="alarm"){ tone(1000,0.18,0.32); setTimeout(()=>tone(1100,0.18,0.32),200); setTimeout(()=>tone(1200,0.22,0.32),420); return; }
    if (choice==="buzzer"){ const o=k.ctx.createOscillator(), g=k.ctx.createGain(), m=k.ctx.createOscillator(), mg=k.ctx.createGain();
      o.type="sawtooth"; o.frequency.value=140; m.type="sine"; m.frequency.value=20; mg.gain.value=30; m.connect(mg).connect(o.frequency);
      o.connect(g).connect(k.ctx.destination); g.gain.value=0.0001; const t=k.ctx.currentTime; g.gain.linearRampToValueAtTime(0.4,t+0.02); g.gain.linearRampToValueAtTime(0.0001,t+0.6);
      o.start(); m.start(); o.stop(t+0.62); m.stop(t+0.62); return; }
    if (choice==="bell"){ tone(660,0.5,0.18); setTimeout(()=>tone(1320,0.7,0.16),60); return; }
    if (choice==="chime"){ tone(880,0.45,0.16); return; }
    tone(800,0.3,0.18);
  }

  return { ensure, setVolume, start, stop, claim, release, playEnd };
}

/* =======================================================================================
   React Component
======================================================================================= */
export default function FocusTimer({ embedded = true, onLogSession }) {
  const [config, setConfig]     = useLocalJSON(LS_CFG, DEFAULTS);
  const [sessions, setSessions] = useLocalJSON(LS_SESS, []);
  const [state, setState] = useLocalJSON(LS_STATE, () => ({
    running:false, mode:"idle", breakType:"short",
    totalMs:0, remainingMs:0, startAt:null, endAt:null,
    linked:null, focusCount:0,
  }));

  // size awareness
  const rootRef = useRef(null);
  const [size, setSize] = useState({ w: 600, h: 400, mode: "normal" });
  useLayoutEffect(()=>{
    const el = rootRef.current; if(!el) return;
    const ro = new ResizeObserver(([entry])=>{
      const w = Math.round(entry.contentRect.width), h = Math.round(entry.contentRect.height);
      let mode = "normal"; if (w < 520 || h < 360) mode = "compact"; if (w < 380 || h < 260) mode = "tiny";
      setSize({ w, h, mode });
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // Kanban link
  const [pickerOpen, setPickerOpen] = useState(false);
  const [kbTasks, setKbTasks] = useState(()=>readKanbanTasks());
  const [kbCol, setKbCol] = useState("inbox");
  const [kbSearch, setKbSearch] = useState("");
  useEffect(()=>{ const reload=()=>setKbTasks(readKanbanTasks());
    window.addEventListener("kanban:updated", reload); return ()=>window.removeEventListener("kanban:updated", reload);
  }, []);
  const filteredKb = useMemo(()=>{
    const q=(kbSearch||"").toLowerCase();
    return kbTasks.filter(t=>t && t.col===kbCol && (q? (t.title||"").toLowerCase().includes(q):true))
                  .sort((a,b)=> (b.created||0) - (a.created||0)).slice(0,150);
  }, [kbTasks, kbCol, kbSearch]);
  const pickTask = (t)=>{ if(!t) return; setState(s=>({ ...s, linked:{ id:t.id, title:t.title } })); setPickerOpen(false); };
  const unlinkTask = ()=> setState(s=>({ ...s, linked:null }));

  // timer engine
  const tickRef = useRef(null);
  const timeRef = useRef(null);
  const isRunning = !!state.running;
  const isIdle = state.mode === "idle";
  const percent = useMemo(()=> state.totalMs ? clamp(100 - (state.remainingMs/state.totalMs)*100, 0, 100) : 0, [state.remainingMs, state.totalMs]);

  // audio kit
  const audioRef = useRef(getLocalAudioKit());
  const ensureAudio = async()=>{ try{ await audioRef.current?.ensure(); }catch{} };

  // ambience eligibility
  const ambientShouldPlay = useMemo(()=>{
    if (config.mode!=="pomodoro" || !config.ambientEnabled) return false;
    if (state.mode==="focus" && config.ambientOnFocus) return true;
    if (state.mode==="break" && config.ambientOnBreak) return true;
    return false;
  }, [config.mode, config.ambientEnabled, config.ambientOnFocus, config.ambientOnBreak, state.mode]);

  // start/stop ambience
  useEffect(()=>{
    (async ()=>{
      if (!audioRef.current) return;
      if (ambientShouldPlay){
        await ensureAudio();
        audioRef.current.claim();
        audioRef.current.start(config.ambientType, clamp(config.ambientVolume,0,1));
      }else{
        audioRef.current.release();
      }
    })();
    return ()=>{ audioRef.current?.release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambientShouldPlay, config.ambientType, config.ambientVolume]);

  // ticks
  useEffect(()=>{
    if(!isRunning) return;
    const id=setInterval(()=>{
      const left=(state.endAt||0)-now();
      if(left<=0){ clearInterval(id); handleComplete(); }
      else setState(s=>({ ...s, remainingMs:left }));
    }, 250);
    tickRef.current=id; return ()=>clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, state.endAt]);

  // restore
  useEffect(()=>{
    if(state.running && state.endAt && now()>=state.endAt){ handleComplete(true); }
    else if(state.running && state.endAt){ setState(s=>({ ...s, remainingMs:s.endAt - now() })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // notifications
  useEffect(()=>{ if(config.notify && "Notification" in window && Notification.permission==="default"){ Notification.requestPermission().catch(()=>{}); } }, [config.notify]);
  function notify(title, body){
    if(!config.notify || !("Notification" in window) || Notification.permission!=="granted") return;
    try{ new Notification(title, { body }); }catch{}
  }

  function startTimer(kind, minutes, opts={}){
    const total=Math.max(1, Math.round(minutes))*60_000;
    const startAt=now(), endAt=startAt+total;
    setState(s=>({
      ...s, running:true, mode: kind==="focus" ? "focus" : (kind==="break" ? "break" : "simple"),
      breakType: kind==="break" ? (opts.breakType||"short") : s.breakType,
      totalMs: total, remainingMs: total, startAt, endAt,
      linked: opts.linked ?? s.linked ?? null
    }));
    ensureAudio(); timeRef.current?.focus?.();
  }
  function pauseTimer(){ if(!isRunning) return; clearInterval(tickRef.current); setState(s=>({ ...s, running:false, endAt:null })); }
  function resumeTimer(){ if(isRunning || isIdle) return; const endAt=now()+(state.remainingMs||0); setState(s=>({ ...s, running:true, endAt })); ensureAudio(); }
  function hardReset(){ clearInterval(tickRef.current);
    setState(s=>({ ...s, running:false, mode:"idle", totalMs:0, remainingMs:0, startAt:null, endAt:null })); }
  function stopTimer(){ hardReset(); }

  function handleComplete(fromRestore=false){
    clearInterval(tickRef.current);
    const end=now(), dur=Math.max(0, state.totalMs||0);
    const sess={ id:uid(), taskId:state.linked?.id||null, taskTitle:state.linked?.title||null,
      kind: state.mode==="focus" ? "focus" : state.mode==="break" ? "break" : "timer",
      start: state.startAt || end - dur, end, duration: dur };
    setSessions(a=>[sess, ...a].slice(0,500)); onLogSession?.(sess);
    window.dispatchEvent(new CustomEvent("xenya:timerSession",{ detail:sess }));

    if(config.sound){
      ensureAudio().then(()=>{
        audioRef.current?.playEnd(state.mode==="simple" ? (config.timerEndSound||"alarm") : (config.pomodoroEndSound||"chime"));
      });
    }
    notify(state.mode==="simple" ? "Timer finished" : `Timer finished: ${state.mode}`, state.linked?.title || "Good job!");

    if(state.mode==="simple"){ return hardReset(); }

    const completedFocus = state.mode==="focus";
    const nextFocusCount = completedFocus ? (state.focusCount+1) : state.focusCount;

    if(config.autoCycle && !fromRestore){
      if(completedFocus){
        const isLong = nextFocusCount % (config.longEvery||4) === 0;
        const mins = isLong ? config.longBreakM : config.shortBreakM;
        startTimer("break", mins, { breakType: isLong ? "long":"short", linked: state.linked });
      }else{
        startTimer("focus", config.focusM, { linked: state.linked });
      }
      setState(s=>({ ...s, focusCount: nextFocusCount }));
    }else{
      setState(s=>({ ...s, running:false, mode:"idle", totalMs:0, remainingMs:0, startAt:null, endAt:null, focusCount: nextFocusCount }));
    }
  }

  // mode switch
  const canSwitchMode = !isRunning;
  function switchMode(next){ if(!canSwitchMode) return; setConfig(c=>({ ...c, mode: next })); hardReset(); }

  // quick helpers
  const quick = {
    startFocus:()=>startTimer("focus", config.focusM),
    shortBreak:()=>startTimer("break", config.shortBreakM, { breakType:"short" }),
    longBreak:()=>startTimer("break", config.longBreakM, { breakType:"long" }),
    startSimple:(m)=>startTimer("simple", m ?? config.simpleM),
  };
  const setCfg = (k,v)=> setConfig(c=>({ ...c, [k]: v }));

  const modeBadge = isIdle
    ? (config.mode==="timer" ? "Timer" : "Pomodoro")
    : (state.mode==="simple" ? "Timer" : (state.mode==="focus" ? "Focus" : `Break • ${state.breakType}`));

  const themeClass = useMemo(()=>{
    if(config.mode!=="pomodoro" || !config.ambientEnabled) return "";
    return ({ cafe:"ft-theme-cafe", pianoguitar:"ft-theme-pianoguitar", beach:"ft-theme-beach", rain:"ft-theme-rain", fireplace:"ft-theme-fireplace" }[config.ambientType]||"");
  }, [config.mode, config.ambientEnabled, config.ambientType]);

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("ambience"); // ambience | pomodoro | timer | alerts

  // quick test: let user audition ambience without running a timer
  const [auditioning, setAuditioning] = useState(false);
  const toggleTest = async ()=>{
    await ensureAudio();
    if (!auditioning){
      audioRef.current?.claim();
      audioRef.current?.start(config.ambientType, clamp(config.ambientVolume,0,1));
      setAuditioning(true);
    }else{
      audioRef.current?.release();
      setAuditioning(false);
    }
  };

  const resetDefaults = ()=>{
    setConfig({ ...DEFAULTS });
  };

  return (
    <div ref={rootRef} className={`ft-root ${themeClass} ${size.mode}`}>
      <style>{`
        .ft-root{position:relative;height:100%;display:flex;flex-direction:column;overflow:hidden}
        .ft-root.compact .ft-time{font-size:clamp(28px, 8vw, 40px)}
        .ft-root.tiny .ft-time{font-size:clamp(22px, 7.5vw, 32px)}
        .ft-head{display:flex;align-items:center;gap:10px;padding:8px 10px;position:sticky;top:0;z-index:3;
          backdrop-filter:saturate(120%) blur(6px);
          background:linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0))}
        .ft-mode{display:inline-flex;border:1px solid rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.15) inset}
        .ft-seg{padding:6px 12px;font-size:12px;color:#eee;background:transparent;cursor:pointer;transition:background .2s ease, transform .08s ease}
        .ft-seg:hover{background:rgba(255,255,255,0.08)}
        .ft-seg.active{background:rgba(0,229,255,0.22);border-left:1px solid rgba(0,229,255,0.5)}
        .ft-head .sp{flex:1}
        .ft-link{font-size:12px;opacity:.9}

        .ft-scroll{flex:1;overflow:auto;padding:6px 8px;position:relative;z-index:1}

        .ft-ring{display:flex;align-items:center;justify-content:center;margin:10px auto 12px;position:relative}
        .ft-ring .ring{--pct:0; width:clamp(168px, 60vw, 232px); height:clamp(168px, 60vw, 232px); border-radius:50%;
          background:
            radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 61%, rgba(255,255,255,0.10) 62% 64%, rgba(0,0,0,0) 66%),
            conic-gradient(from -90deg, rgba(0,229,255,0.70) calc(var(--pct)*1%), rgba(255,255,255,0.10) 0%);
          box-shadow:0 0 0 1px rgba(255,255,255,0.08) inset, 0 10px 36px rgba(0,229,255,0.14);
          position:relative; transition: box-shadow .3s ease}
        .ft-ring .center{position:absolute; inset:10% 10%; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center}
        .ft-time{font-weight:800; letter-spacing:1px; color:#EDEDED}
        .ft-sub{font-size:12px; opacity:.85; margin-top:4px}
        .ft-mini{font-size:11px; opacity:.8}

        .ft-toolbar{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;z-index:3;
          backdrop-filter:saturate(120%) blur(6px);
          background:linear-gradient(0deg, rgba(0,0,0,0.16), rgba(0,0,0,0))}
        .ft-ibtn{width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.06);color:#eee;cursor:pointer;transition:transform .08s ease, background .2s ease}
        .ft-ibtn:active{transform:scale(0.98)}
        .ft-ibtn.primary{background:rgba(0,229,255,0.22);border-color:rgba(0,229,255,0.55)}
        .ft-ibtn.warn{background:rgba(255,127,191,0.16);border-color:rgba(255,127,191,0.45)}
        .ft-chip{padding:6px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.06);color:#eee;cursor:pointer}
        .ft-chip.on{background:rgba(0,229,255,0.18);border-color:rgba(0,229,255,0.45)}
        .ft-badge{font-size:11px;opacity:.85;border:1px solid rgba(255,255,255,0.18);padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.04)}

        /* settings */
        .ft-pop{position:fixed; z-index:10060; left:50%; top:8%; transform:translateX(-50%); width:min(760px, 96vw); max-height:84vh;
          background:rgba(18,18,32,0.97); border:1px solid rgba(255,255,255,0.1); border-radius:16px; box-shadow:0 18px 52px rgba(0,0,0,.5); display:flex; flex-direction:column; overflow:hidden}
        .ft-pop h3{margin:0; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,0.08); font-size:15px; letter-spacing:.06em}
        .ft-pop .body{display:grid; grid-template-columns: 200px 1fr; gap:0; min-height:340px}
        .ft-sidenav{border-right:1px solid rgba(255,255,255,0.08); padding:10px; display:flex; flex-direction:column; gap:8px; background:rgba(255,255,255,0.03)}
        .ft-sidenav button{padding:10px 12px; text-align:left; border-radius:10px; border:1px solid transparent; background:transparent; color:#eee; cursor:pointer}
        .ft-sidenav button.active{background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.16)}
        .ft-pane{padding:12px 14px; overflow:auto}
        .row{display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin:10px 0}
        .kv{display:flex; align-items:center; gap:8px}
        .ft-select, .ft-num{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.16);color:#eee;border-radius:10px;padding:8px 10px}
        .ft-num{width:74px}
        .ft-range{width:min(340px, 56vw)}
        .grid{display:grid; grid-template-columns: repeat(5, minmax(100px, 1fr)); gap:10px}
        .card{position:relative; border-radius:12px; overflow:hidden; border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.05); cursor:pointer}
        .card .thumb{height:66px; background:radial-gradient(100% 100% at 50% 50%, rgba(255,255,255,0.10), rgba(255,255,255,0.02))}
        .card .label{padding:8px; font-size:12px; display:flex; align-items:center; justify-content:space-between}
        .card .check{width:16px; height:16px; border-radius:4px; border:1px solid rgba(255,255,255,0.5)}
        .card.active{outline:2px solid rgba(0,229,255,0.7); background:rgba(0,229,255,0.12)}
        .ft-actions{display:flex; gap:10px; justify-content:flex-end; padding:10px; border-top:1px solid rgba(255,255,255,0.08)}
        .ft-reset{margin-right:auto}
        .ft-close{ }

        /* ambience themes (same IDs, polished gradients) */
        .ft-theme-cafe{background:radial-gradient(120% 120% at 10% 10%, #5a3b2e 0%, #2a1c16 60%, #1a120e 100%)}
        .ft-theme-pianoguitar{background:radial-gradient(120% 120% at 10% 10%, #2d1f47 0%, #141629 60%, #0b0d1a 100%)}
        .ft-theme-beach{background:radial-gradient(120% 120% at 10% 10%, #0d3b66 0%, #0a4f6d 55%, #063a4a 100%)}
        .ft-theme-rain{background:radial-gradient(120% 120% at 10% 10%, #0f2738 0%, #081a27 60%, #06141d 100%)}
        .ft-theme-fireplace{background:radial-gradient(120% 120% at 10% 10%, #5c1d0c 0%, #2e0d07 60%, #160705 100%)}

        /* ambience décor (kept) */
        .ft-decor{position:absolute; inset:0; z-index:0; pointer-events:none}
        .steam{position:absolute; bottom:-10px; left:10%; width:80px; height:160px; background:
          radial-gradient(40px 60px at 50% 100%, rgba(255,255,255,0.08), transparent 70%);
          filter:blur(2px); animation:steam-rise 7s linear infinite}
        .steam:nth-child(2){left:40%; animation-duration:8.5s; opacity:.7}
        .steam:nth-child(3){left:70%; animation-duration:6.5s; opacity:.5}
        @keyframes steam-rise{0%{transform:translateY(40px) scale(0.9); opacity:0} 20%{opacity:.5} 100%{transform:translateY(-140px) scale(1.1); opacity:0}}
        .wave{position:absolute; left:-20%; right:-20%; height:24%; background:
          radial-gradient(100% 120% at 50% 0%, rgba(255,255,255,0.08), rgba(255,255,255,0.02) 60%, transparent 70%);
          border-radius:40% 60% 0 0; animation:wave-roll 12s ease-in-out infinite}
        .wave.w1{bottom:-2%} .wave.w2{bottom:10%; animation-duration:14s; opacity:.6}
        .wave.w3{bottom:22%; animation-duration:16s; opacity:.4}
        @keyframes wave-roll{0%{transform:translateX(0)} 50%{transform:translateX(8%)} 100%{transform:translateX(0)}}
        .drop{position:absolute; top:-10%; width:1px; height:40px; background:linear-gradient(to bottom, rgba(255,255,255,0.0), rgba(255,255,255,0.25));
          animation:drop-fall 1.6s linear infinite}
        .drop:nth-child(odd){height:46px; animation-duration:1.9s; opacity:.7}
        @keyframes drop-fall{0%{transform:translateY(-10vh)} 100%{transform:translateY(110vh)}}
        .ember{position:absolute; bottom:-6px; width:4px; height:4px; background:rgba(255,160,64,0.75); border-radius:50%;
          filter:blur(0.5px); animation:ember-rise 3.2s ease-out infinite}
        .ember:nth-child(odd){background:rgba(255,190,120,0.8); animation-duration:2.6s}
        @keyframes ember-rise{0%{transform:translateY(0) translateX(0) scale(1); opacity:.9}
          70%{opacity:.6} 100%{transform:translateY(-140px) translateX(20px) scale(0.6); opacity:0}}
        .flicker{position:absolute; bottom:0; left:0; right:0; height:36%; background:
          radial-gradient(120% 80% at 50% 100%, rgba(255,120,40,0.20), rgba(255,80,20,0.06), transparent);
          animation:flicker 1.4s ease-in-out infinite alternate}
        @keyframes flicker{0%{opacity:.35} 100%{opacity:.6}}
      `}</style>

      {(config.mode==="pomodoro" && config.ambientEnabled) && (
        <div className="ft-decor" aria-hidden="true">
          {config.ambientType==="cafe" && (<><div className="steam"/><div className="steam"/><div className="steam"/></>)}
          {config.ambientType==="beach" && (<><div className="wave w1"/><div className="wave w2"/><div className="wave w3"/></>)}
          {config.ambientType==="rain" && (Array.from({length:16}).map((_,i)=><div key={i} className="drop" style={{left:`${(i*6.2)%100}%`,animationDelay:`${(i%7)*0.17}s`}}/>))}
          {config.ambientType==="fireplace" && (<><div className="flicker"/>{Array.from({length:12}).map((_,i)=><div key={i} className="ember" style={{left:`${12+(i*7)%76}%`,animationDelay:`${(i%5)*0.28}s`}}/> )}</>)}
        </div>
      )}

      {/* header */}
      <div className="ft-head">
        <div className="ft-mode" title={isRunning ? "Pause/Stop to switch" : ""}>
          <button className={`ft-seg ${config.mode==="timer"?"active":""}`} disabled={!canSwitchMode} onClick={()=>switchMode("timer")}>⏱︎ Timer</button>
          <button className={`ft-seg ${config.mode==="pomodoro"?"active":""}`} disabled={!canSwitchMode} onClick={()=>switchMode("pomodoro")}>🍅 Pomodoro</button>
        </div>
        <span className="ft-badge">{modeBadge}</span>
        <div className="sp" />
        <div className="ft-link">{state.linked ? `Linked: ${state.linked.title}` : "No link"}</div>
      </div>

      {/* body */}
      <div className="ft-scroll">
        <div className="ft-ring">
          <div className="ring" style={{ ["--pct"]: percent }}/>
          <div className="center" tabIndex={-1} ref={timeRef}>
            <div className="ft-time">{isIdle ? "00:00" : fmt(state.remainingMs)}</div>
            <div className="ft-sub">{modeBadge}{state.linked?.title ? ` • ${state.linked.title}` : ""}</div>
          </div>
        </div>

        {config.mode==="pomodoro" ? (
          <>
            {size.mode!=="tiny" ? (
              <div className="row" style={{justifyContent:'center'}}>
                <span className="ft-chip">{`Focus ${config.focusM}m`}</span>
                <span className="ft-chip">{`Break ${config.shortBreakM}m`}</span>
                <span className="ft-chip">{`Long ${config.longBreakM}m / ${config.longEvery}x`}</span>
                {config.autoCycle && <span className="ft-chip on">Auto-cycle</span>}
              </div>
            ) : (
              <div className="row" style={{justifyContent:'center'}}><span className="ft-mini">{config.focusM}/{config.shortBreakM} (L{config.longBreakM}/{config.longEvery})</span></div>
            )}
          </>
        ) : (
          <>
            {size.mode!=="tiny" ? (
              <div className="row" style={{justifyContent:'center'}}>
                <span>Minutes</span>
                <input type="range" min="5" max="90" step="5"
                  value={config.simpleM}
                  onChange={(e)=>setCfg("simpleM", parseInt(e.target.value,10))}
                  className="ft-range"/>
                <span className="ft-chip">{config.simpleM}m</span>
              </div>
            ) : (
              <div className="row" style={{justifyContent:'center'}}><span className="ft-mini">Len: {config.simpleM}m</span></div>
            )}
          </>
        )}

        <div className="row" style={{justifyContent:'space-between', padding:'0 6px'}}>
          <span className="ft-mini">Today focus: {(() => { const d0 = new Date(); d0.setHours(0,0,0,0);
            const startMs = d0.getTime(); return sessions.filter(s=>s.kind==="focus" && s.start>=startMs).length; })()}</span>
          <span className="ft-mini">{sessions[0] ? `${sessions[0].kind} • ${fmt(sessions[0].duration)}` : "—"}</span>
        </div>
      </div>

      {/* toolbar */}
      <div className="ft-toolbar">
        <button className="ft-ibtn" title={state.linked ? "Unlink task" : "Link task"} onClick={()=> state.linked ? unlinkTask() : setPickerOpen(true)}>
          {state.linked ? "🔗" : "➕"}
        </button>

        {isRunning
          ? <button className="ft-ibtn primary" title="Pause" onClick={pauseTimer}>⏸</button>
          : isIdle
            ? (config.mode==="pomodoro"
                ? <button className="ft-ibtn primary" title="Start Focus" onClick={quick.startFocus}>▶︎</button>
                : <button className="ft-ibtn primary" title={`Start ${config.simpleM}m`} onClick={()=>quick.startSimple()}>▶︎</button>)
            : <button className="ft-ibtn primary" title="Resume" onClick={resumeTimer}>▶︎</button>
        }

        <button className="ft-ibtn warn" title="Stop / reset" onClick={stopTimer}>■</button>
        <button className="ft-ibtn" title="Settings" onClick={()=>setShowSettings(true)}>⚙︎</button>
      </div>

      {/* settings popover */}
      {showSettings && (
        <>
          <div className="ft-pop" role="dialog" aria-modal="true">
            <h3>Settings</h3>
            <div className="body">
              {/* side nav */}
              <div className="ft-sidenav">
                <button className={settingsTab==="ambience"?"active":""} onClick={()=>setSettingsTab("ambience")}>🎧 Ambience</button>
                <button className={settingsTab==="pomodoro"?"active":""} onClick={()=>setSettingsTab("pomodoro")}>🍅 Pomodoro</button>
                <button className={settingsTab==="timer"?"active":""} onClick={()=>setSettingsTab("timer")}>⏱ Timer</button>
                <button className={settingsTab==="alerts"?"active":""} onClick={()=>setSettingsTab("alerts")}>🔔 Alerts</button>
              </div>

              {/* main pane */}
              <div className="ft-pane">
                {settingsTab==="ambience" && (
                  <>
                    <div className="row">
                      <label className="kv"><input type="checkbox" checked={!!config.ambientEnabled} onChange={e=>setCfg("ambientEnabled", !!e.target.checked)}/> Enabled</label>
                      <label className="kv"><input type="checkbox" checked={!!config.ambientOnFocus} onChange={e=>setCfg("ambientOnFocus", !!e.target.checked)}/> Focus</label>
                      <label className="kv"><input type="checkbox" checked={!!config.ambientOnBreak} onChange={e=>setCfg("ambientOnBreak", !!e.target.checked)}/> Break</label>
                      <button className={`ft-chip ${auditioning?"on":""}`} onClick={toggleTest}>{auditioning ? "⏹ Stop Test" : "▶︎ Test"}</button>
                    </div>

                    <div className="row">
                      <span>Volume</span>
                      <input className="ft-range" type="range" min="0" max="1" step="0.01"
                        value={config.ambientVolume}
                        onChange={e=>setCfg("ambientVolume", parseFloat(e.target.value)||0)} />
                      <span className="ft-chip">{Math.round(config.ambientVolume*100)}%</span>
                    </div>

                    <div className="row" style={{marginTop:14, marginBottom:6}}>
                      <span style={{opacity:.9}}>Ambience</span>
                    </div>
                    <div className="grid">
                      {[
                        { id:"cafe", label:"Café", thumbClass:"ft-theme-cafe" },
                        { id:"beach", label:"Beach", thumbClass:"ft-theme-beach" },
                        { id:"rain", label:"Rain", thumbClass:"ft-theme-rain" },
                        { id:"fireplace", label:"Fireplace", thumbClass:"ft-theme-fireplace" },
                        { id:"pianoguitar", label:"Piano/Guitar", thumbClass:"ft-theme-pianoguitar" },
                      ].map(opt=>(
                        <div key={opt.id} className={`card ${config.ambientType===opt.id?"active":""}`} onClick={()=>setCfg("ambientType", opt.id)}>
                          <div className="thumb" style={{background:(opt.thumbClass.includes("cafe")&&"radial-gradient(120% 120% at 10% 10%, #5a3b2e, #1a120e)")}
                            } />
                          <div className="label">
                            <span>{opt.label}</span>
                            <span className="check" style={{background: config.ambientType===opt.id ? "rgba(0,229,255,0.8)" : "transparent"}} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {settingsTab==="pomodoro" && (
                  <>
                    <div className="row">
                      <span>Preset</span>
                      <select className="ft-select" onChange={(e)=>{ const p = POMODORO_PRESETS.find(x=>x.id===e.target.value); if(p){ setCfg("focusM",p.focusM); setCfg("shortBreakM",p.shortBreakM); setCfg("longBreakM",p.longBreakM); setCfg("longEvery",p.longEvery); } }}
                        value={POMODORO_PRESETS.find(p=>p.focusM===config.focusM && p.shortBreakM===config.shortBreakM && p.longBreakM===config.longBreakM && p.longEvery===config.longEvery)?.id || ""}>
                        <option value="">Custom…</option>
                        {POMODORO_PRESETS.map(p=> <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                      <label className="kv"><input type="checkbox" checked={!!config.autoCycle} onChange={e=>setCfg("autoCycle", !!e.target.checked)}/> Auto-cycle</label>
                    </div>
                    <div className="row">
                      <label>Focus <input className="ft-num" type="number" min={1} max={180} value={config.focusM} onChange={e=>setCfg("focusM", clamp(parseInt(e.target.value||"0",10)||25,1,180))}/></label>
                      <label>Break <input className="ft-num" type="number" min={1} max={60} value={config.shortBreakM} onChange={e=>setCfg("shortBreakM", clamp(parseInt(e.target.value||"0",10)||5,1,60))}/></label>
                      <label>Long <input className="ft-num" type="number" min={1} max={90} value={config.longBreakM} onChange={e=>setCfg("longBreakM", clamp(parseInt(e.target.value||"0",10)||15,1,90))}/></label>
                      <label>Every <input className="ft-num" type="number" min={2} max={8} value={config.longEvery} onChange={e=>setCfg("longEvery", clamp(parseInt(e.target.value||"0",10)||4,2,8))}/></label>
                    </div>
                    <div className="row">
                      <span className="ft-mini">Tip: use Auto-cycle to hop between Focus/Break hands-free.</span>
                    </div>
                  </>
                )}

                {settingsTab==="timer" && (
                  <>
                    <div className="row">
                      <span>Default minutes</span>
                      <input className="ft-range" type="range" min="1" max="360" step="1"
                        value={config.simpleM}
                        onChange={e=>setCfg("simpleM", clamp(parseInt(e.target.value||"0",10)||20,1,360))}/>
                      <span className="ft-chip">{config.simpleM}m</span>
                    </div>
                  </>
                )}

                {settingsTab==="alerts" && (
                  <>
                    <div className="row">
                      <label className="kv"><input type="checkbox" checked={!!config.sound} onChange={e=>setCfg("sound", !!e.target.checked)}/> End sound</label>
                      <label className="kv"><input type="checkbox" checked={!!config.notify} onChange={e=>setCfg("notify", !!e.target.checked)}/> Notifications</label>
                    </div>
                    <div className="row">
                      <span>Pomodoro end</span>
                      <select className="ft-select" value={config.pomodoroEndSound} onChange={e=>setCfg("pomodoroEndSound", e.target.value)}>
                        <option value="chime">Chime (gentle)</option>
                        <option value="woodblock">Woodblock</option>
                        <option value="bell">Bell</option>
                        <option value="none">None</option>
                      </select>
                      <span>Simple timer end</span>
                      <select className="ft-select" value={config.timerEndSound} onChange={e=>setCfg("timerEndSound", e.target.value)}>
                        <option value="alarm">Alarm (attention)</option>
                        <option value="buzzer">Buzzer</option>
                        <option value="bell">Bell</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="ft-actions">
              <button className="ft-chip ft-reset" title="Reset all settings to defaults" onClick={resetDefaults}>↺ Reset</button>
              <button className="ft-chip ft-close" onClick={()=>{ setShowSettings(false); if (auditioning){ audioRef.current?.release(); setAuditioning(false);} }}>Close</button>
            </div>
          </div>
          <div className="ft-pback" onClick={()=>{ setShowSettings(false); if (auditioning){ audioRef.current?.release(); setAuditioning(false);} }} style={{position:'fixed', inset:0, background:'rgba(5,6,20,0.55)', backdropFilter:'blur(3px)', zIndex:10050}}/>
        </>
      )}

      {/* Kanban picker */}
      {pickerOpen && (
        <>
          <div className="ft-pop" role="dialog" aria-modal="true">
            <h3>Link a task from Kanban</h3>
            <div className="body" style={{display:'block'}}>
              <div className="row">
                <input className="ft-select" style={{flex:'1 1 240px'}} placeholder={`Search ${kbCol}…`} value={kbSearch} onChange={e=>setKbSearch(e.target.value)} />
                <div className="ft-mode">
                  <button className={`ft-seg ${kbCol==='inbox'?'active':''}`} onClick={()=>setKbCol('inbox')}>Inbox</button>
                  <button className={`ft-seg ${kbCol==='doing'?'active':''}`} onClick={()=>setKbCol('doing')}>Doing</button>
                </div>
              </div>
              {filteredKb.length===0 && <div className="ft-mini" style={{opacity:.8}}>No tasks match.</div>}
              {filteredKb.map(t=>(
                <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10, padding:'8px 10px', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, margin:'6px 0', background:'rgba(255,255,255,0.04)'}}>
                  <div style={{minWidth:0}}>
                    <div style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontWeight:600}} title={t.title}>{t.title}</div>
                    <div className="ft-mini" style={{opacity:.85}}>{kbCol.toUpperCase()} {(t.flags||[]).slice(0,3).map(f=>" • "+f).join("")}</div>
                  </div>
                  <button className="ft-chip" onClick={()=>pickTask(t)}>Select</button>
                </div>
              ))}
              <div className="ft-actions"><button className="ft-chip ft-close" onClick={()=>setPickerOpen(false)}>Close</button></div>
            </div>
          </div>
          <div className="ft-pback" onClick={()=>setPickerOpen(false)} style={{position:'fixed', inset:0, background:'rgba(5,6,20,0.55)', backdropFilter:'blur(3px)', zIndex:10050}}/>
        </>
      )}
    </div>
  );
}
