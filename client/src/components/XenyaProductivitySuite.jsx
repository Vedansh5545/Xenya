// src/components/XenyaProductivitySuite.jsx
// Drop-in MVP for the spec "Xenya Productivity Suite — Feature Notes (v0.1)".
// - Keyboard-first Quick Capture (⌘/Ctrl+J)
// - Tasks store with explainable priority scoring
// - Micro-Kanban (Inbox/Doing/Done)
// - Focus Timer (Pomodoro/custom) + session logs
// - Notes with #task:<id> backlinks
// - Command Palette (⌘/Ctrl+K) with slash commands
// - Optional TTS read-outs via prop ttsSpeak(text)
// - Optional Outlook upsert stub via fetch('/calendar/upsert') if present
//
// Styling uses lightweight utility classes; see ./xps.css for neon/glass theme.
// The component is framework-agnostic (no external deps). For robust date parsing,
// you can add chrono-node later and swap parseWhen().

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";


/* ===================== Types (JSDoc) ===================== */
/** @typedef {"low"|"med"|"high"|"urgent"} Prio */
/** @typedef {"inbox"|"doing"|"done"} KanbanCol */

/** @typedef {{
 *  id: string, title: string, notes?: string, due?: number, start?: number, end?: number,
 *  prio: Prio, tags: string[], col: KanbanCol, estimatePomodoros?: number,
 *  completed?: number, source?: 'chat'|'capture'|'manual'|'calendar',
 *  ext?: { outlookEventId?: string }, created: number, updated: number,
 *  score?: number, explain?: string
 * }} Task */

/** @typedef {{ id:string, taskId?:string, kind:'focus'|'break', start:number, end?:number, duration?:number }} Session */
/** @typedef {{ id:string, title:string, body:string, tags:string[], backlinks?:string[], created:number, updated:number }} Note */
/** @typedef {{ id:string, text:string, target:'tasks'|'notes'|'readlater', url?:string|null, tags:string[], created:number, meta?:object }} Capture */

/* ===================== Helpers ===================== */
const LS_KEY = "xps.v1";
const now = () => Date.now();
const newId = (p="id") => `${p}_${Math.random().toString(36).slice(2,8)}_${Date.now().toString(36)}`;
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
const isToday = (t)=>{
  if(!t) return false; const d = new Date(t), n = new Date();
  return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate();
}
const inNextDays = (t,days)=>{
  if(!t) return false; const n = Date.now(); return t>=n && t<= n + days*86400000;
}

/* Priority Scoring (Explainable) */
function scoreTask(task){
  const prioW = {low:1, med:2, high:3, urgent:4}[task.prio || 'med'];
  const hoursToDue = task.due ? Math.max(0, (task.due - now())/3600000) : 99999;
  const soonW = 10 / Math.max(1, hoursToDue);
  const estW = 0.1 * (task.estimatePomodoros || 1);
  const doingBonus = task.col === 'doing' ? 1.5 : 1;
  const score = (prioW*2 + soonW + estW) * doingBonus;
  const parts = [];
  if(task.due){
    const h = Math.round(hoursToDue);
    parts.push(h<=24?`due in ${h}h`:`due in ${Math.ceil(h/24)}d`);
  }
  parts.push(task.prio);
  if(task.estimatePomodoros) parts.push(`${task.estimatePomodoros} pomodoro${task.estimatePomodoros>1?'s':''}`);
  return { score, explain: parts.join("; ") };
}

/* ===================== State ===================== */
const initialState = /** @type {{
  tasks: Task[], sessions: Session[], notes: Note[], captures: Capture[],
  ui: { captureOpen:boolean, paletteOpen:boolean, selectedTaskId:string|null },
  timer: { running:boolean, kind:'focus'|'break', remainingMs:number, attachedTaskId:string|null }
}} */({
  tasks: [], sessions: [], notes: [], captures: [],
  ui: { captureOpen:false, paletteOpen:false, selectedTaskId:null },
  timer: { running:false, kind:'focus', remainingMs:25*60*1000, attachedTaskId:null }
});

function reviveState(raw){
  if(!raw) return initialState;
  try{ const s = JSON.parse(raw); return { ...initialState, ...s }; } catch { return initialState; }
}

/* Actions */
function reducer(state, action){
  switch(action.type){
    case 'LOAD': return action.state;
    case 'TOGGLE_CAPTURE': return { ...state, ui:{...state.ui, captureOpen:!state.ui.captureOpen} };
    case 'CLOSE_CAPTURE': return { ...state, ui:{...state.ui, captureOpen:false} };
    case 'TOGGLE_PALETTE': return { ...state, ui:{...state.ui, paletteOpen:!state.ui.paletteOpen} };
    case 'SELECT_TASK': return { ...state, ui:{...state.ui, selectedTaskId:action.id} };
    case 'ADD_TASK': {
      const t = action.task; const {score, explain} = scoreTask(t); t.score=score; t.explain=explain;
      const tasks = [t, ...state.tasks];
      return { ...state, tasks };
    }
    case 'UPDATE_TASK': {
      const tasks = state.tasks.map(t=> t.id===action.id? (()=>{ const nt = {...t, ...action.patch, updated: now()}; const {score,explain}=scoreTask(nt); nt.score=score; nt.explain=explain; return nt; })() : t);
      return { ...state, tasks };
    }
    case 'MOVE_TASK': {
      const tasks = state.tasks.map(t=> t.id===action.id? (()=>{ const nt = {...t, col:action.col, updated: now()}; const {score,explain}=scoreTask(nt); nt.score=score; nt.explain=explain; return nt; })() : t);
      return { ...state, tasks };
    }
    case 'ADD_NOTE': return { ...state, notes:[action.note, ...state.notes] };
    case 'UPDATE_NOTE': {
      const notes = state.notes.map(n=> n.id===action.id? {...n, ...action.patch, updated: now()} : n);
      return { ...state, notes: linkBacklinks(notes, state.tasks) };
    }
    case 'ATTACH_EVENT_ID': {
      const tasks = state.tasks.map(t=> t.id===action.id? {...t, ext:{...(t.ext||{}), outlookEventId: action.eventId}, updated: now()} : t);
      return { ...state, tasks };
    }
    case 'ADD_SESSION': return { ...state, sessions:[...state.sessions, action.session] };
    case 'UPDATE_TIMER': return { ...state, timer:{...state.timer, ...action.patch} };
    default: return state;
  }
}

function linkBacklinks(notes, tasks){
  // Build backlinks for #task:<id>
  const map = new Map(); tasks.forEach(t=>map.set(t.id, []));
  notes.forEach(n=>{
    const ids = [...(n.body.match(/#task:([a-zA-Z0-9_\-]+)/g)||[])].map(s=>s.split(":")[1]);
    ids.forEach(id=>{ if(map.has(id)) map.get(id).push(n.id); });
  });
  return notes.map(n=> ({...n, backlinks: n.backlinks||[]})); // keep note backlinks for future extension
}

/* ===================== Persistence ===================== */
function usePersistentReducer(){
  const [state, dispatch] = useReducer(reducer, undefined, ()=> reviveState(localStorage.getItem(LS_KEY)));
  useEffect(()=>{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }, [state]);
  return [state, dispatch];
}

/* ===================== Date Parsing (naive MVP) ===================== */
function parseWhen(text){
  // Very small parser: supports "today", "tomorrow", "in 30m", "in 2h", "YYYY-MM-DD HH:mm"
  const lower = text.toLowerCase();
  const nowD = new Date();
  let m;
  if(lower.includes("tomorrow")){
    const d = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()+1, 17, 0, 0);
    return d.getTime();
  }
  if(lower.includes("today")){
    const d = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate(), 17, 0, 0);
    return d.getTime();
  }
  if((m = lower.match(/in\s+(\d+)\s*(m|min|minute|minutes)\b/))) return now() + parseInt(m[1])*60000;
  if((m = lower.match(/in\s+(\d+)\s*(h|hour|hours)\b/))) return now() + parseInt(m[1])*3600000;
  if((m = text.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/))){
    const [,Y,M,D,H,Min] = m; const d = new Date(Number(Y), Number(M)-1, Number(D), Number(H||17), Number(Min||0), 0);
    return d.getTime();
  }
  return undefined;
}

/* ===================== Command Parsing ===================== */
function parseSlash(input){
  const s = input.trim(); if(!s.startsWith('/')) return null;
  const [cmd, ...rest] = s.split(/\s+/);
  const arg = rest.join(' ');
  switch(cmd){
    case '/task': {
      // /task <title> [date/time] [!prio] [#tag…]
      const tags = [...arg.matchAll(/#([\w-]+)/g)].map(m=>m[1]);
      const prioMatch = arg.match(/!(low|med|high|urgent)\b/);
      const prio = prioMatch? prioMatch[1] : 'med';
      const when = parseWhen(arg);
      const title = arg
        .replace(/#([\w-]+)/g,'')
        .replace(/!(low|med|high|urgent)/,'')
        .trim();
      return { type:'createTask', title, due: when, prio, tags };
    }
    case '/move': {
      // /move "<title>" <inbox|doing|done>
      const mm = arg.match(/"([^"]+)"\s+(inbox|doing|done)/);
      if(!mm) return { type:'error', message:'Usage: /move "<title>" <inbox|doing|done>' };
      return { type:'moveTask', title:mm[1], col:mm[2] };
    }
    case '/timer': {
      const m = arg.match(/(\d+)/); const minutes = m? parseInt(m[1]) : 25; return { type:'startTimer', minutes };
    }
    case '/break': {
      const m = arg.match(/(\d+)/); const minutes = m? parseInt(m[1]) : 5; return { type:'startBreak', minutes };
    }
    case '/stop': return { type:'stopTimer' };
    case '/prioritize': return { type:'prioritize' };
    case '/read': {
      // /read tasks today|week   OR   /read agenda today
      const m = arg.match(/(tasks|agenda)\s+(today|week)/);
      if(!m) return { type:'error', message:'Usage: /read tasks today|week | /read agenda today' };
      return { type:'read', what:m[1], when:m[2] };
    }
    case '/calendar': {
      // /calendar "<title>" <when> [@location]
      const mm = arg.match(/"([^"]+)"\s+(.+?)(?:\s+@(.+))?$/);
      if(!mm) return { type:'error', message:'Usage: /calendar "<title>" <when> [@location]' };
      const title = mm[1]; const whenStr = mm[2]; const start = parseWhen(whenStr); let end = start? start + 60*60*1000 : undefined; // default 1h
      if(whenStr.includes(' ')){
        // crude range support: "YYYY-MM-DD HH:mm-HH:mm"
        const r = whenStr.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
        if(r){ const [,YMD,h1,m1,h2,m2] = r; const ds = new Date(`${YMD}T${h1}:${m1}:00`); const de = new Date(`${YMD}T${h2}:${m2}:00`); 
          if(!isNaN(ds.getTime()) && !isNaN(de.getTime())){ start = ds.getTime(); end = de.getTime(); }
        }
      }
      const location = mm[3];
      return { type:'calendarUpsert', title, start, end, location };
    }
    default:
      return { type:'error', message:`Unknown command: ${cmd}` };
  }
}

/* ===================== UI Fragments ===================== */
function Toolbar({onCapture,onPalette}){
  return (
    <div className="xps-toolbar">
      <button className="btn" onClick={onCapture} title="Quick Capture (⌘/Ctrl+J)">Capture</button>
      <button className="btn" onClick={onPalette} title="Command Palette (⌘/Ctrl+K)">Commands</button>
      <span className="brand">Xenya Productivity</span>
    </div>
  );
}

function QuickCapture({open,onClose,onSave}){
  const [text,setText] = useState("");
  const [target,setTarget] = useState('tasks');
  const ref = useRef(null);
  useEffect(()=>{ if(open){ setTimeout(()=>{ ref.current?.focus(); }, 10); } }, [open]);
  useEffect(()=>{
    function onKey(e){ if(!open) return; if(e.key==='Escape'){ onClose(); }
      if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='enter'){ if(text.trim()){ onSave(text.trim(), target); setText(""); onClose(); } }
    }
    window.addEventListener('keydown', onKey); return ()=>window.removeEventListener('keydown', onKey);
  }, [open,text,target,onClose,onSave]);
  if(!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={e=>e.stopPropagation()}>
        <div className="row">
          <input ref={ref} value={text} onChange={e=>setText(e.target.value)} placeholder="t: Finish lab tomorrow 6pm #csce !high" />
        </div>
        <div className="row gap">
          {['tasks','notes','readlater'].map(x=>(
            <button key={x} className={`chip ${target===x?'chip-active':''}`} onClick={()=>setTarget(x)}>{x}</button>
          ))}
          <div className="hint">Cmd/Ctrl+Enter to save • Esc to close</div>
        </div>
      </div>
    </div>
  );
}

function TasksPanel({tasks,onSelect,onUpdate}){
  const [filter,setFilter] = useState('all');
  const [query,setQuery] = useState('');
  const filtered = useMemo(()=>{
    let list = [...tasks];
    if(filter==='today') list = list.filter(t=>isToday(t.due));
    if(filter==='upcoming') list = list.filter(t=>inNextDays(t.due,7));
    if(query) list = list.filter(t=> (t.title+" "+(t.tags||[]).join(' ')).toLowerCase().includes(query.toLowerCase()));
    list.sort((a,b)=> (b.score||0)-(a.score||0));
    return list;
  },[tasks,filter,query]);
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Tasks</h3>
        <div className="row gap">
          <select value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="today">Today</option>
            <option value="upcoming">Upcoming</option>
          </select>
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search #tags" />
        </div>
      </div>
      <div className="list">
        {filtered.map(t=> (
          <div key={t.id} className={`task ${t.col}`} onClick={()=>onSelect(t.id)}>
            <div className="task-title">{t.title}</div>
            <div className="task-meta">{t.explain}</div>
            <div className="task-tags">{t.tags?.map(tag=> <span key={tag} className="tag">#{tag}</span>)}</div>
          </div>
        ))}
        {!filtered.length && <div className="empty">No tasks yet. Try <code>/task</code> in Commands.</div>}
      </div>
    </div>
  );
}

function Kanban({tasks,onMove,onSelect}){
  const cols = ['inbox','doing','done'];
  return (
    <div className="kanban">
      {cols.map(col=> (
        <KanbanCol key={col} title={col.toUpperCase()} col={col} tasks={tasks.filter(t=>t.col===col)} onMove={onMove} onSelect={onSelect} />
      ))}
    </div>
  );
}

function KanbanCol({title,col,tasks,onMove,onSelect}){
  function onDrop(e){ e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); onMove(id, col); }
  return (
    <div className="kcol" onDragOver={e=>e.preventDefault()} onDrop={onDrop}>
      <div className="khead">{title} <span className="count">{tasks.length}</span></div>
      <div className="klist">
        {tasks.map(t=>(
          <div key={t.id} className="kcard" draggable onDragStart={e=>e.dataTransfer.setData('text/plain', t.id)} onClick={()=>onSelect(t.id)}>
            <div className="ktitle">{t.title}</div>
            <div className="kmeta">{t.explain}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FocusTimer({timer,onStart,onStop,attachTitle}){
  const mm = Math.floor(timer.remainingMs/60000).toString().padStart(2,'0');
  const ss = Math.floor((timer.remainingMs%60000)/1000).toString().padStart(2,'0');
  const [mins,setMins] = useState(25);
  const [bmins,setBmins] = useState(5);
  return (
    <div className="panel">
      <div className="panel-head"><h3>Focus Timer</h3></div>
      <div className="timer-box">
        <div className={`big ${timer.running? 'run':''}`}>{mm}:{ss}</div>
        <div className="attach">{attachTitle? `Attached to: ${attachTitle}` : 'No task attached'}</div>
        <div className="row gap">
          {!timer.running ? (
            <>
              <button className="btn" onClick={()=>onStart('focus', mins)}>Start {mins}m</button>
              <button className="btn" onClick={()=>onStart('break', bmins)}>Break {bmins}m</button>
            </>
          ) : <button className="btn danger" onClick={onStop}>Stop</button>}
        </div>
        <div className="row gap">
          <label>Focus <input type="number" value={mins} onChange={e=>setMins(clamp(parseInt(e.target.value||'0'),1,180))} /> min</label>
          <label>Break <input type="number" value={bmins} onChange={e=>setBmins(clamp(parseInt(e.target.value||'0'),1,60))} /> min</label>
        </div>
      </div>
    </div>
  );
}

function NotesPanel({notes,onAdd,onUpdate,linkTaskId}){
  const [title,setTitle] = useState(""); const [body,setBody] = useState("");
  return (
    <div className="panel">
      <div className="panel-head"><h3>Notes</h3></div>
      <div className="row gap">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title" />
        <button className="btn" onClick={()=>{ if(!title.trim()) return; onAdd({ id:newId('n'), title:title.trim(), body, tags:[], created:now(), updated:now()}); setTitle(""); setBody(""); }}>Add</button>
      </div>
      <textarea className="note-editor" value={body} onChange={e=>setBody(e.target.value)} placeholder="Body… Use #task:<id> to link."/>
      <div className="list">
        {notes.map(n=>(
          <div key={n.id} className="note">
            <div className="note-title">{n.title}</div>
            <textarea value={n.body} onChange={e=>onUpdate(n.id,{body:e.target.value})} />
          </div>
        ))}
        {!notes.length && <div className="empty">No notes yet.</div>}
      </div>
      {linkTaskId && <div className="hint">Tip: add <code>#task:{linkTaskId}</code> in your note to link the selected task.</div>}
    </div>
  );
}

function CommandPalette({open,onClose,onRun,output}){
  const [input,setInput] = useState("");
  const ref = useRef(null);
  useEffect(()=>{ if(open){ setTimeout(()=>ref.current?.focus(),5); } }, [open]);
  useEffect(()=>{
    function onKey(e){ if(!open) return; if(e.key==='Escape') onClose(); if(e.key==='Enter'){ const v=input.trim(); if(v){ onRun(v); setInput(""); } } }
    window.addEventListener('keydown', onKey); return ()=>window.removeEventListener('keydown', onKey);
  },[open,input,onClose,onRun]);
  if(!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={e=>e.stopPropagation()}>
        <input ref={ref} value={input} onChange={e=>setInput(e.target.value)} placeholder="/task Finish lab tomorrow 6pm !high #csce" />
        {output && <div className="output">{output}</div>}
      </div>
    </div>
  );
}

/* ===================== Main Component ===================== */
export default function XenyaProductivitySuite({ ttsSpeak }){
  const [state, dispatch] = usePersistentReducer();
  const [out, setOut] = useState("");
  const intervalRef = useRef(null);

  // Global hotkeys
  useEffect(()=>{
    function onKey(e){
      if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='j') { e.preventDefault(); dispatch({type:'TOGGLE_CAPTURE'}); }
      if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k') { e.preventDefault(); dispatch({type:'TOGGLE_PALETTE'}); }
    }
    window.addEventListener('keydown', onKey); return ()=>window.removeEventListener('keydown', onKey);
  },[]);

  // Timer tick
  useEffect(()=>{
    if(state.timer.running){
      intervalRef.current = setInterval(()=>{
        dispatch({type:'UPDATE_TIMER', patch:{ remainingMs: Math.max(0, state.timer.remainingMs - 1000) }});
      }, 1000);
      return ()=> clearInterval(intervalRef.current);
    }
  }, [state.timer.running]);

  // Auto-finish timer
  useEffect(()=>{
    if(state.timer.running && state.timer.remainingMs<=0){
      // log session
      const sess = { id:newId('s'), taskId: state.timer.attachedTaskId||undefined, kind: state.timer.kind, start: now()-(state.timer.kind==='focus'?25:5)*60*1000, end: now(), duration: (state.timer.kind==='focus'?25:5)*60*1000 };
      dispatch({type:'ADD_SESSION', session: sess});
      dispatch({type:'UPDATE_TIMER', patch:{ running:false, remainingMs: 25*60*1000 }});
      setOut(`Timer finished (${state.timer.kind}). Continue?`);
      speakText(ttsSpeak, `Time. ${state.timer.kind==='focus'?'Take a short break.':'Back to focus.'}`);
    }
  }, [state.timer.running, state.timer.remainingMs]);

  const selectedTask = useMemo(()=> state.tasks.find(t=>t.id===state.ui.selectedTaskId)||null, [state.tasks, state.ui.selectedTaskId]);

  const addTask = useCallback((title, opts={})=>{
    const t = /** @type {Task} */({ id:newId('t'), title, notes:opts.notes||'', due:opts.due, start:opts.start, end:opts.end, prio:opts.prio||'med', tags:opts.tags||[], col:opts.col||'inbox', estimatePomodoros:opts.estimatePomodoros, created:now(), updated:now(), source:opts.source||'manual' });
    dispatch({type:'ADD_TASK', task:t});
    return t;
  },[]);

  const onSaveCapture = useCallback((text,target)=>{
    // Prefix t:/n:/r: overrides target
    const tx = text.trim();
    let tgt = target; if(tx.startsWith('t:')) tgt='tasks'; else if(tx.startsWith('n:')) tgt='notes'; else if(tx.startsWith('r:')) tgt='readlater';
    const body = tx.replace(/^[tnr]:/,'').trim();
    if(tgt==='tasks'){
      const tags = [...body.matchAll(/#([\w-]+)/g)].map(m=>m[1]);
      const prioMatch = body.match(/!(low|med|high|urgent)\b/);
      const prio = prioMatch? prioMatch[1] : 'med';
      const due = parseWhen(body);
      addTask(body.replace(/#([\w-]+)/g,'').replace(/!(low|med|high|urgent)/,'').trim(), {prio, tags, due, source:'capture'});
    } else if(tgt==='notes'){
      dispatch({type:'ADD_NOTE', note:{ id:newId('n'), title: body.slice(0,60)||'Untitled', body, tags:[], created:now(), updated:now() }});
    } else {
      // read-later capture stored as note with tag readlater
      dispatch({type:'ADD_NOTE', note:{ id:newId('n'), title: body.slice(0,60)||'Read later', body, tags:['readlater'], created:now(), updated:now() }});
    }
  },[addTask]);

  const onMove = useCallback((id,col)=> dispatch({type:'MOVE_TASK', id, col}), []);

  const runCommand = useCallback(async (raw)=>{
    const p = parseSlash(raw);
    if(!p){ setOut('Not a slash command. Supported: /task, /move, /timer, /break, /stop, /prioritize, /read, /calendar'); return; }
    if(p.type==='error'){ setOut(p.message); return; }

    switch(p.type){
      case 'createTask': {
        const t = addTask(p.title, { due:p.due, prio:p.prio, tags:p.tags, source:'chat' });
        setOut(`Task created: ${t.title}`);
        break;
      }
      case 'moveTask':{
        const cand = state.tasks.find(t=> t.title.toLowerCase().includes(p.title.toLowerCase()));
        if(!cand) { setOut('Task not found'); break; }
        onMove(cand.id, p.col);
        setOut(`Moved "${cand.title}" to ${p.col}`);
        break;
      }
      case 'startTimer':{
        startTimer('focus', p.minutes);
        setOut(`Timer started ${p.minutes}m`);
        break;
      }
      case 'startBreak':{
        startTimer('break', p.minutes);
        setOut(`Break started ${p.minutes}m`);
        break;
      }
      case 'stopTimer':{
        stopTimer(); setOut('Timer stopped'); break;
      }
      case 'prioritize':{
        const top = [...state.tasks].sort((a,b)=> (b.score||0)-(a.score||0)).slice(0,5);
        const msg = top.map((t,i)=> `${i+1}. ${t.title} — ${t.explain}`).join('\n');
        setOut(msg||'No tasks'); speakText(ttsSpeak, msg.replaceAll('\n','. '));
        break;
      }
      case 'read':{
        if(p.what==='tasks'){
          let list = state.tasks;
          if(p.when==='today') list = list.filter(t=>isToday(t.due));
          if(p.when==='week') list = list.filter(t=>inNextDays(t.due,7));
          list.sort((a,b)=> (b.score||0)-(a.score||0));
          const msg = list.slice(0,10).map(t=> `${t.title}, ${t.explain}`).join('\n');
          setOut(msg||'No matching tasks'); speakText(ttsSpeak, msg.replaceAll('\n','. '));
        } else if(p.what==='agenda'){
          setOut('Agenda read-out requires Outlook endpoint; falling back to tasks with start times.');
          const list = state.tasks.filter(t=> t.start).slice(0,10).map(t=> `${t.title} from ${new Date(t.start).toLocaleTimeString()} to ${t.end? new Date(t.end).toLocaleTimeString():''}`);
          const msg = list.join('\n'); speakText(ttsSpeak, msg||'No agenda.');
        }
        break;
      }
      case 'calendarUpsert':{
        const start = p.start || now()+3600000; const end = p.end || start+3600000;
        setOut('Attempting Outlook upsert…');
        try{
          const res = await fetch('/calendar/upsert',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ task:{ title:p.title, start, end } }) });
          if(res.ok){ const {eventId} = await res.json(); setOut(`Calendar event created: ${eventId}`);} else { setOut('Calendar upsert failed'); }
        } catch{ setOut('Calendar upsert endpoint not available'); }
        break;
      }
      default: setOut('Unhandled');
    }
  },[state.tasks, addTask, onMove, ttsSpeak]);

  function startTimer(kind, minutes){
    dispatch({type:'UPDATE_TIMER', patch:{ kind, running:true, remainingMs: minutes*60*1000, attachedTaskId: state.ui.selectedTaskId }});
  }
  function stopTimer(){ dispatch({type:'UPDATE_TIMER', patch:{ running:false }}); }

  function saveTaskPatch(id, patch){ dispatch({type:'UPDATE_TASK', id, patch}); }

  return (
    <div className="xps-root">
      <Toolbar onCapture={()=>dispatch({type:'TOGGLE_CAPTURE'})} onPalette={()=>dispatch({type:'TOGGLE_PALETTE'})} />

      <div className="grid">
        <TasksPanel tasks={state.tasks} onSelect={(id)=>dispatch({type:'SELECT_TASK', id})} onUpdate={saveTaskPatch} />
        <Kanban tasks={state.tasks} onMove={onMove} onSelect={(id)=>dispatch({type:'SELECT_TASK', id})} />
        <FocusTimer timer={state.timer} onStart={startTimer} onStop={stopTimer} attachTitle={selectedTask?.title||null} />
        <NotesPanel notes={state.notes} onAdd={(note)=>dispatch({type:'ADD_NOTE', note})} onUpdate={(id,patch)=>dispatch({type:'UPDATE_NOTE', id, patch})} linkTaskId={selectedTask?.id||null} />
      </div>

      <QuickCapture open={state.ui.captureOpen} onClose={()=>dispatch({type:'CLOSE_CAPTURE'})} onSave={onSaveCapture} />
      <CommandPalette open={state.ui.paletteOpen} onClose={()=>dispatch({type:'TOGGLE_PALETTE'})} onRun={runCommand} output={out} />
    </div>
  );
}

function speakText(ttsSpeak, text){
  if(!text) return;
  if(typeof ttsSpeak === 'function'){ ttsSpeak(text); return; }
  if('speechSynthesis' in window){ const u = new SpeechSynthesisUtterance(text); window.speechSynthesis.speak(u); }
}

/* ===================== Minimal Neon/Glass CSS ===================== */
// src/components/xps.css
const css = String.raw`
.xps-root{ --bg:#0D0D1A; --glass:rgba(255,255,255,0.06); --stroke:rgba(122,62,255,0.6); --cyan:#00E5FF; --rose:#FF7FBF; --text:#EDEDED; color:var(--text); background:var(--bg); padding:12px; border-radius:16px; box-shadow:0 0 0 1px rgba(255,255,255,0.04) inset; }
.xps-toolbar{ display:flex; gap:8px; align-items:center; margin-bottom:12px; }
.btn{ background:var(--glass); border:1px solid var(--stroke); padding:8px 12px; border-radius:10px; color:var(--text); cursor:pointer; }
.btn:hover{ box-shadow:0 0 12px var(--stroke); }
.btn.danger{ border-color:var(--rose); }
.brand{ margin-left:auto; opacity:0.8; }
.grid{ display:grid; grid-template-columns: 1fr 1fr; grid-auto-rows:minmax(220px, auto); gap:12px; }
.panel{ background:linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:12px; }
.panel-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.row{ display:flex; align-items:center; }
.gap>*{ margin-right:8px; }
input, textarea, select{ background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:var(--text); border-radius:10px; padding:8px; outline:none; }
textarea{ width:100%; min-height:80px; }
.note-editor{ width:100%; min-height:60px; margin:8px 0; }
.list{ display:flex; flex-direction:column; gap:8px; max-height:260px; overflow:auto; }
.task{ padding:8px; border:1px solid rgba(255,255,255,0.08); border-radius:10px; background:rgba(255,255,255,0.04); }
.task.doing{ outline:1px solid var(--cyan); }
.task.done{ opacity:0.8; }
.task-title{ font-weight:600; }
.task-meta{ font-size:12px; opacity:0.8; }
.task-tags .tag{ font-size:12px; margin-right:6px; opacity:0.85; }
.empty{ opacity:0.7; font-style:italic; }
.kanban{ display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; }
.kcol{ background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:8px; min-height:180px; }
.khead{ display:flex; justify-content:space-between; opacity:0.85; margin-bottom:6px; }
.klist{ display:flex; flex-direction:column; gap:6px; min-height:120px; }
.kcard{ background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:8px; cursor:grab; }
.kcard:active{ cursor:grabbing; }
.ktitle{ font-weight:600; }
.kmeta{ font-size:12px; opacity:0.8; }
.timer-box{ display:flex; flex-direction:column; align-items:center; gap:8px; }
.big{ font-size:48px; letter-spacing:1px; }
.big.run{ text-shadow:0 0 12px var(--cyan); }
.attach{ font-size:12px; opacity:0.8; }
.overlay{ position:fixed; inset:0; background:rgba(0,0,0,0.4); backdrop-filter: blur(6px); display:flex; align-items:center; justify-content:center; z-index:9999; }
.card{ background:rgba(13,13,26,0.9); border:1px solid var(--stroke); border-radius:16px; padding:14px; min-width:520px; box-shadow:0 10px 30px rgba(0,0,0,0.5); }
.card .row{ margin-top:6px; }
.card input{ width:100%; }
.chip{ background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); border-radius:999px; padding:6px 10px; cursor:pointer; }
.chip-active{ border-color: var(--cyan); box-shadow:0 0 10px rgba(0,229,255,0.4); }
.hint{ margin-left:auto; opacity:0.7; font-size:12px; }
.output{ white-space:pre-wrap; margin-top:8px; padding:8px; border:1px dashed rgba(255,255,255,0.2); border-radius:10px; }
`;

// Inject CSS at runtime (for drop-in convenience)
if (typeof document !== 'undefined' && !document.getElementById('xps-css')){
  const style = document.createElement('style'); style.id='xps-css'; style.textContent = css; document.head.appendChild(style);
}
