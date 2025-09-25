// components/FocusTimer.jsx
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";

/**
 * FocusTimer.jsx — compact/tile-first
 *
 * What’s new:
 *  - Size-aware: normal / compact / tiny (via ResizeObserver)
 *  - Conic progress RING (space efficient)
 *  - Bottom toolbar (icon buttons) instead of many chips
 *  - Settings Popover (durations, presets, ambience, end sounds)
 *  - Scrollable body when needed, sticky header/ring
 *
 * Keeps:
 *  - Two modes: Timer + Pomodoro (auto-cycle)
 *  - Kanban link picker (Inbox / Doing)
 *  - 5 ambience types + themed animations
 *  - End-of-phase sounds (attention vs gentle)
 *  - Session log
 */

const LS_STATE = "xenya.timer.v1";
const LS_CFG   = "xenya.timer.v1.cfg";
const LS_SESS  = "xenya.sessions.v1";
const KB_LS    = "xenya.kanban.v1";

const DEFAULTS = {
  mode: "pomodoro",     // 'timer' | 'pomodoro'
  /* Timer */
  simpleM: 20,
  /* Pomodoro */
  focusM: 25, shortBreakM: 5, longBreakM: 15, longEvery: 4, autoCycle: true,
  /* Sounds */
  notify: true, sound: true,
  timerEndSound: "alarm",        // 'alarm' | 'bell' | 'buzzer' | 'none'
  pomodoroEndSound: "chime",     // 'chime' | 'woodblock' | 'bell' | 'none'
  /* Ambience (Pomodoro) */
  ambientEnabled: true,
  ambientType: "cafe",           // 'cafe' | 'pianoguitar' | 'beach' | 'rain' | 'fireplace'
  ambientVolume: 0.16,
  ambientOnFocus: true,
  ambientOnBreak: false,
};

const POMODORO_PRESETS = [
  { id: "classic",  label: "25/5 ×4",  focusM: 25, shortBreakM: 5,  longBreakM: 15, longEvery: 4 },
  { id: "study",    label: "50/10 ×3", focusM: 50, shortBreakM: 10, longBreakM: 20, longEvery: 3 },
  { id: "balanced", label: "45/15 ×4", focusM: 45, shortBreakM: 15, longBreakM: 20, longEvery: 4 },
  { id: "ultra",    label: "90/20 ×2", focusM: 90, shortBreakM: 20, longBreakM: 30, longEvery: 2 },
];

const TIMER_STEPS = [5,10,15,20,25,30,45,60]; // for slider ticks label

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

/* ---------------------- WebAudio (ambience + end sounds) ---------------------- */
function createAudioKit(){
  const kit = { ctx:null, master:null, ambientGain:null, ambient:{nodes:[], timers:[], lfos:[]} };

  kit.ensure = async () => {
    if(!kit.ctx){
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      const amb = ctx.createGain(); amb.gain.value = 0.0; amb.connect(master);
      kit.ctx = ctx; kit.master = master; kit.ambientGain = amb;
    }
    if(kit.ctx.state === "suspended"){ try{ await kit.ctx.resume(); }catch{} }
    return kit.ctx;
  };

  kit._stop = n => { try{ n.stop?.(); }catch{} try{ n.disconnect?.(); }catch{} };
  kit.stopAmbient = () => {
    kit.ambient.nodes.forEach(kit._stop); kit.ambient.nodes=[];
    kit.ambient.timers.forEach(clearInterval); kit.ambient.timers=[];
    kit.ambient.lfos.forEach(kit._stop); kit.ambient.lfos=[];
    if(kit.ambientGain && kit.ctx) kit.ambientGain.gain.setTargetAtTime(0.0, kit.ctx.currentTime, 0.06);
  };

  const mkNoise = (ctx, kind="brown")=>{
    const len = 2*ctx.sampleRate, buf = ctx.createBuffer(1,len,ctx.sampleRate), d = buf.getChannelData(0);
    if(kind==="white"){ for(let i=0;i<len;i++) d[i]=Math.random()*2-1; }
    else if(kind==="pink"){
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for(let i=0;i<len;i++){
        const w=Math.random()*2-1;
        b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759; b2=0.96900*b2+w*0.1538520;
        b3=0.86650*b3+w*0.3104856; b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
        d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11; b6=w*0.115926;
      }
    }else{
      let last=0; for(let i=0;i<len;i++){ const w=Math.random()*2-1; const v=(last+0.02*w)/1.02; d[i]=v*3.5; last=v; }
    }
    return buf;
  };

  const ping = (ctx, out, type="sine", f=880, dur=0.25, vol=0.25)=>{
    const o=ctx.createOscillator(), g=ctx.createGain(); o.type=type; o.frequency.value=f;
    o.connect(g); g.connect(out); g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+dur);
    o.start(); o.stop(ctx.currentTime+dur+0.02); return [o,g];
  };

  kit.startAmbient = (type="cafe", volume=0.15)=>{
    if(!kit.ctx) return;
    kit.stopAmbient();
    const ctx = kit.ctx, g = kit.ambientGain;
    g.gain.setValueAtTime(clamp(volume,0,1), ctx.currentTime);

    if(type==="cafe"){
      const src=ctx.createBufferSource(); src.buffer=mkNoise(ctx,"brown"); src.loop=true;
      const bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=700; bp.Q.value=0.5;
      src.connect(bp).connect(g); src.start(); kit.ambient.nodes.push(src,bp);
      const t=setInterval(()=>{ const f=1800+Math.random()*800; const [o,gg]=ping(ctx,g,"triangle",f,0.03,0.05); kit.ambient.nodes.push(o,gg); }, 3200+Math.random()*3600);
      kit.ambient.timers.push(t);
    }else if(type==="pianoguitar"){
      const play=()=>{ const root=220*Math.pow(2, Math.floor(Math.random()*6)/12); [root, root*1.25, root*1.5, root*2]
        .forEach((f,i)=>{ const [o,gg]=ping(ctx,g,"sine",f,1.1+i*0.25,0.035-i*0.006); kit.ambient.nodes.push(o,gg); }); };
      const t=setInterval(play, 6000+Math.random()*5000); kit.ambient.timers.push(t);
    }else if(type==="beach"){
      const src=ctx.createBufferSource(); src.buffer=mkNoise(ctx,"brown"); src.loop=true;
      const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=900; lp.Q.value=0.3;
      const gg=ctx.createGain(); gg.gain.value=0.6; src.connect(lp).connect(gg).connect(g); src.start();
      kit.ambient.nodes.push(src,lp,gg);
      const lfo=ctx.createOscillator(), lfoG=ctx.createGain(); lfo.type="sine"; lfo.frequency.value=0.08; lfoG.gain.value=0.35;
      lfo.connect(lfoG).connect(gg.gain); lfo.start(); kit.ambient.lfos.push(lfo,lfoG);
    }else if(type==="rain"){
      const src=ctx.createBufferSource(); src.buffer=mkNoise(ctx,"pink"); src.loop=true;
      const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=1600; lp.Q.value=0.7;
      src.connect(lp).connect(g); src.start(); kit.ambient.nodes.push(src,lp);
      const t=setInterval(()=>{ const roof=Math.random()>0.5; const f=roof? (1400+Math.random()*500) : (700+Math.random()*300);
        const [o,gg]=ping(ctx,g,"sine",f,roof?0.05:0.04, roof?0.03:0.05); kit.ambient.nodes.push(o,gg); }, 900+Math.random()*900);
      kit.ambient.timers.push(t);
    }else if(type==="fireplace"){
      const src=ctx.createBufferSource(); src.buffer=mkNoise(ctx,"brown"); src.loop=true;
      const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=1000; lp.Q.value=0.9;
      const gg=ctx.createGain(); gg.gain.value=0.4; src.connect(lp).connect(gg).connect(g); src.start();
      kit.ambient.nodes.push(src,lp,gg);
      const t=setInterval(()=>{ const o=ctx.createOscillator(), c=ctx.createGain();
        o.type="square"; o.frequency.value=1800+Math.random()*1200; o.connect(c); c.connect(g);
        const t0=ctx.currentTime; c.gain.setValueAtTime(0.0001,t0); c.gain.exponentialRampToValueAtTime(0.28,t0+0.01);
        c.gain.exponentialRampToValueAtTime(0.0001,t0+0.12); o.start(); o.stop(t0+0.14); kit.ambient.nodes.push(o,c);
      }, 800+Math.random()*1200); kit.ambient.timers.push(t);
    }
  };

  kit.playEnd = (kind="timer", choice="alarm")=>{
    if(!kit.ctx) return; const ctx=kit.ctx;
    const tone=(type="sine", f=880, dur=0.25, vol=0.25)=>{
      const o=ctx.createOscillator(), g=ctx.createGain(); o.type=type; o.frequency.value=f;
      o.connect(g); g.connect(kit.master); g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+dur);
      o.start(); o.stop(ctx.currentTime+dur+0.02);
    };
    if(choice==="none") return;
    if(choice==="alarm"){ tone("square",1000,0.18,0.35); setTimeout(()=>tone("square",1100,0.18,0.35),220); setTimeout(()=>tone("square",1200,0.22,0.35),440); return; }
    if(choice==="buzzer"){ const o=ctx.createOscillator(), g=ctx.createGain(), m=ctx.createOscillator(), mg=ctx.createGain();
      o.type="sawtooth"; o.frequency.value=140; m.type="sine"; m.frequency.value=20; mg.gain.value=30; m.connect(mg).connect(o.frequency);
      o.connect(g); g.connect(kit.master); g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.linearRampToValueAtTime(0.4, ctx.currentTime+0.02);
      g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime+0.6); o.start(); m.start(); o.stop(ctx.currentTime+0.62); m.stop(ctx.currentTime+0.62); return; }
    if(choice==="bell"){ tone("sine",660,0.5,0.2); setTimeout(()=>tone("sine",1320,0.7,0.16),40); return; }
    if(choice==="chime"){ return tone("sine",880,0.45,0.18); }
    if(choice==="woodblock"){ const o=ctx.createOscillator(), g=ctx.createGain(), f=ctx.createBiquadFilter();
      o.type="triangle"; o.frequency.value=2200; o.connect(f); f.type="bandpass"; f.frequency.value=1800; f.Q.value=4.0;
      f.connect(g); g.connect(kit.master); g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime+0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.12); o.start(); o.stop(ctx.currentTime+0.14); return; }
    tone("sine",800,0.3,0.2);
  };

  return kit;
}

/* --------------------------------------------------------------------------- */

export default function FocusTimer({ embedded = true, onLogSession }) {
  const [config, setConfig]     = useLocalJSON(LS_CFG, DEFAULTS);
  const [sessions, setSessions] = useLocalJSON(LS_SESS, []);

  const [state, setState] = useLocalJSON(LS_STATE, () => ({
    running:false, mode:"idle", breakType:"short",
    totalMs:0, remainingMs:0, startAt:null, endAt:null,
    linked:null, focusCount:0,
  }));

  // size awareness -------------------------------------------------------------
  const rootRef = useRef(null);
  const [size, setSize] = useState({ w: 600, h: 400, mode: "normal" }); // 'normal' | 'compact' | 'tiny'
  useLayoutEffect(()=>{
    const el = rootRef.current; if(!el) return;
    const ro = new ResizeObserver(([entry])=>{
      const w = Math.round(entry.contentRect.width), h = Math.round(entry.contentRect.height);
      let mode = "normal";
      if (w < 520 || h < 360) mode = "compact";
      if (w < 380 || h < 260) mode = "tiny";
      setSize({ w, h, mode });
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // Kanban picker --------------------------------------------------------------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [kbTasks, setKbTasks] = useState(()=>readKanbanTasks());
  const [kbCol, setKbCol] = useState("inbox"); // 'inbox' | 'doing'
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

  // timer engine ---------------------------------------------------------------
  const tickRef = useRef(null);
  const timeRef = useRef(null);
  const isRunning = !!state.running;
  const isIdle = state.mode === "idle";
  const percent = useMemo(()=> state.totalMs ? clamp(100 - (state.remainingMs/state.totalMs)*100, 0, 100) : 0, [state.remainingMs, state.totalMs]);

  // audio kit
  const audioRef = useRef(null); if(!audioRef.current) audioRef.current = createAudioKit();
  const ensureAudio = async()=>{ try{ await audioRef.current.ensure(); }catch{} };

  const ambientShouldPlay = useMemo(()=>{
    if (config.mode!=="pomodoro" || !config.ambientEnabled) return false;
    if (state.mode==="focus" && config.ambientOnFocus) return true;
    if (state.mode==="break" && config.ambientOnBreak) return true;
    return false;
  }, [config.mode, config.ambientEnabled, config.ambientOnFocus, config.ambientOnBreak, state.mode]);

  useEffect(()=>{
    (async ()=>{
      if (!("AudioContext" in window)) return;
      if (ambientShouldPlay){ await ensureAudio(); audioRef.current.startAmbient(config.ambientType, clamp(config.ambientVolume,0,1)); }
      else { audioRef.current.stopAmbient(); }
    })();
    return ()=>{ try{ audioRef.current.stopAmbient(); }catch{} };
  }, [ambientShouldPlay, config.ambientType, config.ambientVolume]);

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

  useEffect(()=>{
    if(state.running && state.endAt && now()>=state.endAt){ handleComplete(true); }
    else if(state.running && state.endAt){ setState(s=>({ ...s, remainingMs:s.endAt - now() })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    if(config.sound && "AudioContext" in window){
      ensureAudio().then(()=>{
        if(state.mode==="simple") audioRef.current.playEnd("timer", config.timerEndSound||"alarm");
        else audioRef.current.playEnd("pomodoro", config.pomodoroEndSound||"chime");
      });
    }
    notify(state.mode==="simple" ? "Timer finished" : `Timer finished: ${state.mode}`, state.linked?.title || "Good job!");

    if(state.mode==="simple"){ return hardReset(); }

    // Pomodoro flow
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

  // ambience theme class
  const themeClass = useMemo(()=>{
    if(config.mode!=="pomodoro" || !config.ambientEnabled) return "";
    return ({ cafe:"ft-theme-cafe", pianoguitar:"ft-theme-pianoguitar", beach:"ft-theme-beach", rain:"ft-theme-rain", fireplace:"ft-theme-fireplace" }[config.ambientType]||"");
  }, [config.mode, config.ambientEnabled, config.ambientType]);

  // settings popover
  const [showSettings, setShowSettings] = useState(false);

  // UI -------------------------------------------------------------------------
  return (
    <div ref={rootRef} className={`ft-root ${themeClass} ${size.mode}`}>
      <style>{`
        .ft-root{position:relative;height:100%;display:flex;flex-direction:column;overflow:hidden}
        .ft-root.compact .ft-time{font-size:clamp(28px, 8vw, 40px)}
        .ft-root.tiny .ft-time{font-size:clamp(22px, 7.5vw, 32px)}
        .ft-head{display:flex;align-items:center;gap:8px;padding:6px 8px;position:sticky;top:0;z-index:3;
          background:linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0))}
        .ft-mode{display:inline-flex;border:1px solid rgba(255,255,255,0.12);border-radius:999px;overflow:hidden}
        .ft-seg{padding:6px 10px;font-size:12px;color:#eee;background:transparent;cursor:pointer}
        .ft-seg.active{background:rgba(0,229,255,0.18);border-left:1px solid rgba(0,229,255,0.45)}
        .ft-head .sp{flex:1}
        .ft-link{font-size:12px;opacity:.9}
        .ft-chip{padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#eee;cursor:pointer}
        .ft-scroll{flex:1;overflow:auto;padding:6px 8px;position:relative;z-index:1}

        /* RING */
        .ft-ring{display:flex;align-items:center;justify-content:center;margin:6px auto 8px;position:relative}
        .ft-ring .ring{--pct:0; width:clamp(160px, 60vw, 220px); height:clamp(160px, 60vw, 220px); border-radius:50%;
          background:
            radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 61%, rgba(255,255,255,0.08) 62% 64%, rgba(0,0,0,0) 66%),
            conic-gradient(from -90deg, rgba(0,229,255,0.65) calc(var(--pct)*1%), rgba(255,255,255,0.08) 0%);
          box-shadow:0 0 0 1px rgba(255,255,255,0.06) inset; position:relative}
        .ft-ring .center{position:absolute; inset:10% 10%; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center}
        .ft-time{font-weight:800; letter-spacing:1px; color:#EDEDED}
        .ft-sub{font-size:12px; opacity:.85; margin-top:4px}
        .ft-mini{font-size:11px; opacity:.8}

        /* Toolbar */
        .ft-toolbar{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;z-index:3;
          background:linear-gradient(0deg, rgba(0,0,0,0.12), rgba(0,0,0,0))}
        .ft-ibtn{width:38px;height:38px;border-radius:999px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:#eee;cursor:pointer}
        .ft-ibtn.primary{background:rgba(0,229,255,0.20);border-color:rgba(0,229,255,0.55)}
        .ft-ibtn.warn{background:rgba(255,127,191,0.14);border-color:rgba(255,127,191,0.45)}
        .ft-lbl{font-size:12px;opacity:.85}
        .ft-inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;margin:6px 0}

        /* Settings Popover */
        .ft-pop{position:fixed; z-index:10060; left:50%; top:10%; transform:translateX(-50%); width:min(680px, 94vw); max-height:80vh;
          background:rgba(18,18,32,0.98); border:1px solid rgba(255,255,255,0.1); border-radius:14px; box-shadow:0 18px 52px rgba(0,0,0,.5); display:flex; flex-direction:column; overflow:hidden}
        .ft-pop h3{margin:0; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.08); font-size:14px; letter-spacing:.06em}
        .ft-pop .body{padding:10px 12px; overflow:auto}
        .ft-pop .row{display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:8px 0}
        .ft-select{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);color:#eee;border-radius:10px;padding:6px 8px}
        .ft-num{width:68px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.06);color:#EEE}
        .ft-range{width:160px}
        .ft-close{margin:8px; align-self:flex-end}

        /* THEME BACKDROPS */
        .ft-theme-cafe{background:radial-gradient(120% 120% at 10% 10%, #5a3b2e 0%, #2a1c16 60%, #1a120e 100%)}
        .ft-theme-pianoguitar{background:radial-gradient(120% 120% at 10% 10%, #2d1f47 0%, #141629 60%, #0b0d1a 100%)}
        .ft-theme-beach{background:radial-gradient(120% 120% at 10% 10%, #0d3b66 0%, #0a4f6d 55%, #063a4a 100%)}
        .ft-theme-rain{background:radial-gradient(120% 120% at 10% 10%, #0f2738 0%, #081a27 60%, #06141d 100%)}
        .ft-theme-fireplace{background:radial-gradient(120% 120% at 10% 10%, #5c1d0c 0%, #2e0d07 60%, #160705 100%)}

        /* DECOR layers (kept subtle) */
        .ft-decor{position:absolute; inset:0; z-index:0; pointer-events:none}
        .steam{position:absolute; bottom:-10px; left:10%; width:80px; height:160px; background:
          radial-gradient(40px 60px at 50% 100%, rgba(255,255,255,0.08), transparent 70%);
          filter:blur(2px); animation:steam-rise 7s linear infinite}
        .steam:nth-child(2){left:40%; animation-duration:8.5s; opacity:.7}
        .steam:nth-child(3){left:70%; animation-duration:6.5s; opacity:.5}
        @keyframes steam-rise{0%{transform:translateY(40px) scale(0.9); opacity:0} 20%{opacity:.5} 100%{transform:translateY(-140px) scale(1.1); opacity:0}}
        .note{position:absolute; bottom:-10px; font-size:18px; color:rgba(255,255,255,0.18); animation:note-float 8s linear infinite}
        .note:nth-child(1){left:15%} .note:nth-child(2){left:35%; animation-duration:9.5s}
        .note:nth-child(3){left:55%; animation-duration:7.5s} .note:nth-child(4){left:75%; animation-duration:10.5s}
        @keyframes note-float{0%{transform:translateY(30px) translateX(0) rotate(0deg); opacity:.0}
          15%{opacity:.6} 50%{transform:translateY(-90px) translateX(-8px) rotate(-10deg)}
          100%{transform:translateY(-160px) translateX(8px) rotate(10deg); opacity:0}}
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

      {/* decor (pomodoro ambience only) */}
      {(config.mode==="pomodoro" && config.ambientEnabled) && (
        <div className="ft-decor" aria-hidden="true">
          {config.ambientType==="cafe" && (<><div className="steam"/><div className="steam"/><div className="steam"/></>)}
          {config.ambientType==="pianoguitar" && (<><div className="note">♪</div><div className="note">♬</div><div className="note">♪</div><div className="note">♩</div></>)}
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
        <div className="sp" />
        <div className="ft-link">{state.linked ? `Linked: ${state.linked.title}` : "No link"}</div>
      </div>

      {/* scrollable body */}
      <div className="ft-scroll">
        {/* ring */}
        <div className="ft-ring">
          <div className="ring" style={{ ["--pct"]: percent }}/>
          <div className="center" tabIndex={-1} ref={timeRef}>
            <div className="ft-time">{isIdle ? "00:00" : fmt(state.remainingMs)}</div>
            <div className="ft-sub">{modeBadge}{state.linked?.title ? ` • ${state.linked.title}` : ""}</div>
          </div>
        </div>

        {/* context line (changes based on mode & size) */}
        {config.mode==="pomodoro" ? (
          <>
            {size.mode!=="tiny" ? (
              <div className="ft-inline">
                <span className="ft-lbl">Focus {config.focusM}m</span>
                <span className="ft-mini">•</span>
                <span className="ft-lbl">Break {config.shortBreakM}m</span>
                <span className="ft-mini">•</span>
                <span className="ft-lbl">Long {config.longBreakM}m / {config.longEvery}x</span>
                {config.autoCycle && <span className="ft-mini">• Auto-cycle</span>}
              </div>
            ) : (
              <div className="ft-inline"><span className="ft-mini">{config.focusM}/{config.shortBreakM} (L{config.longBreakM}/{config.longEvery})</span></div>
            )}
          </>
        ) : (
          <>
            {size.mode!=="tiny" ? (
              <div className="ft-inline">
                <span className="ft-lbl">Minutes</span>
                <input type="range" min="5" max="90" step="5"
                  value={config.simpleM}
                  onChange={(e)=>setCfg("simpleM", parseInt(e.target.value,10))}
                  className="ft-range"/>
                <span className="ft-lbl">{config.simpleM}m</span>
              </div>
            ) : (
              <div className="ft-inline"><span className="ft-mini">Len: {config.simpleM}m</span></div>
            )}
          </>
        )}

        {/* mini log */}
        <div className="ft-inline" style={{justifyContent:'space-between'}}>
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
            <h3>Timer Settings</h3>
            <div className="body">
              {config.mode==="pomodoro" ? (
                <>
                  <div className="row">
                    <label>Preset&nbsp;
                      <select className="ft-select" onChange={(e)=>{ const p = POMODORO_PRESETS.find(x=>x.id===e.target.value); if(p){ setCfg("focusM",p.focusM); setCfg("shortBreakM",p.shortBreakM); setCfg("longBreakM",p.longBreakM); setCfg("longEvery",p.longEvery); } }}
                              value={POMODORO_PRESETS.find(p=>p.focusM===config.focusM && p.shortBreakM===config.shortBreakM && p.longBreakM===config.longBreakM && p.longEvery===config.longEvery)?.id || ""}>
                        <option value="">Custom…</option>
                        {POMODORO_PRESETS.map(p=> <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </label>
                    <label>Focus <input className="ft-num" type="number" min={1} max={180} value={config.focusM} onChange={e=>setCfg("focusM", clamp(parseInt(e.target.value||"0",10)||25,1,180))}/></label>
                    <label>Break <input className="ft-num" type="number" min={1} max={60} value={config.shortBreakM} onChange={e=>setCfg("shortBreakM", clamp(parseInt(e.target.value||"0",10)||5,1,60))}/></label>
                    <label>Long <input className="ft-num" type="number" min={1} max={90} value={config.longBreakM} onChange={e=>setCfg("longBreakM", clamp(parseInt(e.target.value||"0",10)||15,1,90))}/></label>
                    <label>Every <input className="ft-num" type="number" min={2} max={8} value={config.longEvery} onChange={e=>setCfg("longEvery", clamp(parseInt(e.target.value||"0",10)||4,2,8))}/></label>
                    <label><input type="checkbox" checked={!!config.autoCycle} onChange={e=>setCfg("autoCycle", !!e.target.checked)}/> Auto-cycle</label>
                  </div>

                  <div className="row">
                    <label>End sound&nbsp;
                      <select className="ft-select" value={config.pomodoroEndSound} onChange={e=>setCfg("pomodoroEndSound", e.target.value)}>
                        <option value="chime">Chime (gentle)</option>
                        <option value="woodblock">Woodblock</option>
                        <option value="bell">Bell</option>
                        <option value="none">None</option>
                      </select>
                    </label>
                    <label><input type="checkbox" checked={!!config.sound} onChange={e=>setCfg("sound", !!e.target.checked)}/> End sound</label>
                    <label><input type="checkbox" checked={!!config.notify} onChange={e=>setCfg("notify", !!e.target.checked)}/> Notify</label>
                  </div>

                  <div className="row">
                    <label>Ambience&nbsp;
                      <select className="ft-select" value={config.ambientType} onChange={e=>setCfg("ambientType", e.target.value)}>
                        <option value="cafe">Café (people)</option>
                        <option value="pianoguitar">Gentle Piano/Guitar</option>
                        <option value="beach">Beach Waves</option>
                        <option value="rain">Rainfall</option>
                        <option value="fireplace">Crackling Fireplace</option>
                      </select>
                    </label>
                    <label>Vol&nbsp;
                      <input className="ft-range" type="range" min="0" max="1" step="0.01" value={config.ambientVolume}
                        onChange={e=>setCfg("ambientVolume", parseFloat(e.target.value)||0)} />
                      <span className="ft-mini">&nbsp;{Math.round(config.ambientVolume*100)}%</span>
                    </label>
                    <label><input type="checkbox" checked={!!config.ambientEnabled} onChange={e=>setCfg("ambientEnabled", !!e.target.checked)}/> Enabled</label>
                    <label><input type="checkbox" checked={!!config.ambientOnFocus} onChange={e=>setCfg("ambientOnFocus", !!e.target.checked)}/> Focus</label>
                    <label><input type="checkbox" checked={!!config.ambientOnBreak} onChange={e=>setCfg("ambientOnBreak", !!e.target.checked)}/> Break</label>
                  </div>
                </>
              ) : (
                <>
                  <div className="row">
                    <label>Default minutes <input className="ft-num" type="number" min={1} max={360} value={config.simpleM} onChange={e=>setCfg("simpleM", clamp(parseInt(e.target.value||"0",10)||20,1,360))}/></label>
                    <label>End sound&nbsp;
                      <select className="ft-select" value={config.timerEndSound} onChange={e=>setCfg("timerEndSound", e.target.value)}>
                        <option value="alarm">Alarm (attention)</option>
                        <option value="buzzer">Buzzer</option>
                        <option value="bell">Bell</option>
                        <option value="none">None</option>
                      </select>
                    </label>
                    <label><input type="checkbox" checked={!!config.sound} onChange={e=>setCfg("sound", !!e.target.checked)}/> End sound</label>
                    <label><input type="checkbox" checked={!!config.notify} onChange={e=>setCfg("notify", !!e.target.checked)}/> Notify</label>
                  </div>
                </>
              )}
              <button className="ft-chip ft-close" onClick={()=>setShowSettings(false)}>Close</button>
            </div>
          </div>
          <div className="ft-pback" onClick={()=>setShowSettings(false)} style={{position:'fixed', inset:0, background:'rgba(5,6,20,0.55)', backdropFilter:'blur(3px)', zIndex:10050}}/>
        </>
      )}

      {/* Kanban picker */}
      {pickerOpen && (
        <>
          <div className="ft-pop" role="dialog" aria-modal="true">
            <h3>Link a task from Kanban</h3>
            <div className="body">
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
              <button className="ft-chip ft-close" onClick={()=>setPickerOpen(false)}>Close</button>
            </div>
          </div>
          <div className="ft-pback" onClick={()=>setPickerOpen(false)} style={{position:'fixed', inset:0, background:'rgba(5,6,20,0.55)', backdropFilter:'blur(3px)', zIndex:10050}}/>
        </>
      )}
    </div>
  );
}
