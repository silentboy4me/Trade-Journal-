/* ============================================================
   Ledger — local-only trading journal
   All data stored in the browser's IndexedDB. Nothing leaves
   the device. No backend, no account, no cost.
   ============================================================ */

const DB_NAME = "ledgerDB";
const DB_VERSION = 1;
const STORE = "trades";
let db;

const EMOTIONS = ["Calm","Confident","Disciplined","Anxious","FOMO","Greedy","Revenge","Impatient","Bored","Fearful"];
const MISTAKES = ["No stop loss","Moved stop loss","Oversized position","Chased entry","Ignored plan","Revenge trade","FOMO entry","Exited too early","Exited too late","Overtraded today","No clear setup"];

/* ---------------- IndexedDB layer ---------------- */
function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains(STORE)){
        const s = d.createObjectStore(STORE, {keyPath:"id", autoIncrement:true});
        s.createIndex("date","date");
      }
    };
    req.onsuccess = ()=>{db=req.result; resolve(db);};
    req.onerror = ()=>reject(req.error);
  });
}

function txStore(mode="readonly"){
  return db.transaction(STORE, mode).objectStore(STORE);
}
function addTrade(trade){
  return new Promise((res,rej)=>{
    const r = txStore("readwrite").add(trade);
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
  });
}
function putTrade(trade){
  return new Promise((res,rej)=>{
    const r = txStore("readwrite").put(trade);
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
  });
}
function deleteTrade(id){
  return new Promise((res,rej)=>{
    const r = txStore("readwrite").delete(id);
    r.onsuccess = ()=>res();
    r.onerror = ()=>rej(r.error);
  });
}
function getAllTrades(){
  return new Promise((res,rej)=>{
    const r = txStore().getAll();
    r.onsuccess = ()=>res(r.result.sort((a,b)=> new Date(b.date+"T"+(b.time||"00:00")) - new Date(a.date+"T"+(a.time||"00:00"))));
    r.onerror = ()=>rej(r.error);
  });
}
function getTrade(id){
  return new Promise((res,rej)=>{
    const r = txStore().get(id);
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
  });
}

/* ---------------- App state ---------------- */
let TRADES = [];
let currentEditId = null;
let formState = {};
let currentFilter = "all";

/* ---------------- Boot ---------------- */
window.addEventListener("DOMContentLoaded", async ()=>{
  await openDB();
  TRADES = await getAllTrades();
  bindNav();
  renderDashboard();
  renderSettings();
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("service-worker.js").catch(()=>{});
  }
});

/* ---------------- Navigation ---------------- */
function bindNav(){
  document.querySelectorAll(".navbtn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const view = btn.dataset.view;
      if(view === "entry"){ openNewTradeForm(); }
      showView(view);
    });
  });
  document.getElementById("settingsBtn").addEventListener("click", ()=>showView("settings"));
}

function showView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById("view-"+name).classList.add("active");
  document.querySelectorAll(".navbtn").forEach(b=>b.classList.toggle("active", b.dataset.view===name));
  if(name==="dashboard") renderDashboard();
  if(name==="trades") renderTradesList();
  if(name==="insights") renderInsights();
  if(name==="settings") renderSettings();
  document.getElementById("views").scrollTop = 0;
}

function toast(msg){
  const t = document.getElementById("toast") || (()=>{
    const el = document.createElement("div"); el.id="toast"; document.body.appendChild(el); return el;
  })();
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove("show"), 2200);
}

/* ================================================================
   STATS
   ================================================================ */
function computeStats(trades){
  const closed = trades.filter(t=>typeof t.pnl === "number" && !isNaN(t.pnl));
  const wins = closed.filter(t=>t.pnl>0);
  const losses = closed.filter(t=>t.pnl<0);
  const totalPnl = closed.reduce((s,t)=>s+t.pnl,0);
  const winRate = closed.length ? (wins.length/closed.length*100) : 0;
  const avgWin = wins.length ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s,t)=>s+t.pnl,0)/losses.length : 0;
  const grossWin = wins.reduce((s,t)=>s+t.pnl,0);
  const grossLoss = Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
  const profitFactor = grossLoss>0 ? (grossWin/grossLoss) : (grossWin>0 ? Infinity : 0);
  const best = closed.reduce((m,t)=> t.pnl>(m?m.pnl:-Infinity)?t:m, null);
  const worst = closed.reduce((m,t)=> t.pnl<(m?m.pnl:Infinity)?t:m, null);
  // current streak
  const sorted = [...closed].sort((a,b)=> new Date(a.date)-new Date(b.date));
  let streak=0, streakType=null;
  for(let i=sorted.length-1;i>=0;i--){
    const isWin = sorted[i].pnl>0;
    if(streakType===null){streakType=isWin; streak=1;}
    else if(isWin===streakType){streak++;}
    else break;
  }
  return {closed, wins, losses, totalPnl, winRate, avgWin, avgLoss, profitFactor, best, worst, streak, streakType, sorted};
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function renderDashboard(){
  const el = document.getElementById("dashContent");
  if(TRADES.length===0){
    el.innerHTML = `
      <div class="empty-state">
        <div class="big">📓</div>
        <div style="font-size:16px;color:#D6DCE4;font-weight:600;">No trades logged yet</div>
        <div style="margin-top:6px;">Start your journal — log your first trade with the price, the setup, and how you felt going in.</div>
        <button class="cta" onclick="openNewTradeForm(); showView('entry')">Log your first trade</button>
      </div>`;
    return;
  }
  const s = computeStats(TRADES);
  const pnlClass = s.totalPnl>0?"pos":s.totalPnl<0?"neg":"";
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Total P&amp;L</div>
        <div class="value ${pnlClass}">${fmtMoney(s.totalPnl)}</div>
        <div class="sub">${s.closed.length} closed trades</div>
      </div>
      <div class="stat-card">
        <div class="label">Win rate</div>
        <div class="value">${s.winRate.toFixed(0)}%</div>
        <div class="sub">${s.wins.length}W / ${s.losses.length}L</div>
      </div>
      <div class="stat-card">
        <div class="label">Profit factor</div>
        <div class="value">${isFinite(s.profitFactor)? s.profitFactor.toFixed(2): "∞"}</div>
        <div class="sub">gross win ÷ gross loss</div>
      </div>
      <div class="stat-card">
        <div class="label">Current streak</div>
        <div class="value ${s.streak? (s.streakType?"pos":"neg"):""}">${s.streak||0} ${s.streak? (s.streakType?"W":"L"):""}</div>
        <div class="sub">most recent trades</div>
      </div>
    </div>

    <div class="section-title">Equity curve</div>
    <div class="equity-wrap"><canvas id="equityChart"></canvas></div>

    <div class="section-title">Recent trades</div>
    <div class="trades-list" id="dashRecent"></div>
  `;
  drawEquityChart(s.sorted);
  const recentWrap = document.getElementById("dashRecent");
  TRADES.slice(0,5).forEach(t=> recentWrap.appendChild(tradeRowEl(t)));
}

function drawEquityChart(sortedClosed){
  const ctx = document.getElementById("equityChart");
  if(!ctx) return;
  let running=0;
  const points = sortedClosed.map(t=>{ running+=t.pnl; return running; });
  const labels = sortedClosed.map(t=>t.date);
  if(window._equityChart) window._equityChart.destroy();
  window._equityChart = new Chart(ctx, {
    type:"line",
    data:{ labels, datasets:[{
      data:points, borderColor:"#E0A03C", borderWidth:2, pointRadius:0, tension:0.25,
      fill:true, backgroundColor:"rgba(224,160,60,0.08)"
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:{intersect:false, mode:"index"}},
      scales:{
        x:{display:false},
        y:{grid:{color:"#1B232C"}, ticks:{color:"#8593A3", font:{size:10}}}
      }
    }
  });
}

function fmtMoney(n){
  const sign = n<0 ? "-" : "+";
  return `${n===0?"":sign}$${Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:2, minimumFractionDigits:2})}`;
}

/* ================================================================
   TRADES LIST
   ================================================================ */
function renderTradesList(){
  const filterRow = document.getElementById("filterRow");
  const filters = [["all","All"],["long","Longs"],["short","Shorts"],["win","Wins"],["loss","Losses"]];
  filterRow.innerHTML = filters.map(([k,label])=>
    `<button class="chip ${currentFilter===k?'active':''}" data-f="${k}">${label}</button>`).join("");
  filterRow.querySelectorAll(".chip").forEach(c=> c.addEventListener("click", ()=>{
    currentFilter = c.dataset.f; renderTradesList();
  }));

  const list = document.getElementById("tradesList");
  list.innerHTML = "";
  let filtered = TRADES;
  if(currentFilter==="long") filtered = TRADES.filter(t=>t.direction==="long");
  if(currentFilter==="short") filtered = TRADES.filter(t=>t.direction==="short");
  if(currentFilter==="win") filtered = TRADES.filter(t=>t.pnl>0);
  if(currentFilter==="loss") filtered = TRADES.filter(t=>t.pnl<0);

  if(filtered.length===0){
    list.innerHTML = `<div class="empty-state"><div class="big">🔍</div>No trades match this filter.</div>`;
    return;
  }
  filtered.forEach(t=> list.appendChild(tradeRowEl(t)));
}

function tradeRowEl(t){
  const row = document.createElement("div");
  row.className = "trade-row";
  const pnlClass = t.pnl>0?"pos":t.pnl<0?"neg":"";
  row.innerHTML = `
    <div class="trade-dir ${t.direction}"></div>
    ${t.screenshots && t.screenshots[0] ? `<img class="trade-thumb" src="${t.screenshots[0]}">` : ""}
    <div class="trade-main">
      <div class="sym">${escapeHtml(t.symbol)} <span style="color:var(--muted);font-weight:400;">${t.direction==='long'?'Long':'Short'}</span></div>
      <div class="meta">${t.date}${t.setup? " · "+escapeHtml(t.setup):""}</div>
    </div>
    <div class="trade-pnl ${pnlClass}">${fmtMoney(t.pnl)}</div>
  `;
  row.addEventListener("click", ()=> openDetail(t.id));
  return row;
}

/* ================================================================
   ENTRY FORM (new / edit)
   ================================================================ */
function openNewTradeForm(){
  currentEditId = null;
  formState = {direction:"long", confidence:3, preEmotions:[], postEmotions:[], mistakes:[], screenshots:[]};
  document.getElementById("entryTitle").textContent = "New Trade";
  renderEntryForm();
  showView("entry");
}
async function openEditTradeForm(id){
  const t = await getTrade(id);
  currentEditId = id;
  formState = {
    ...t,
    preEmotions: t.preEmotions||[], postEmotions: t.postEmotions||[], mistakes: t.mistakes||[],
    screenshots: t.screenshots||[]
  };
  document.getElementById("entryTitle").textContent = "Edit Trade";
  renderEntryForm();
  showView("entry");
}

function renderEntryForm(){
  const f = document.getElementById("tradeForm");
  const fs = formState;
  f.innerHTML = `
    <div class="field">
      <label>Direction</label>
      <div class="seg">
        <button type="button" class="dir-btn ${fs.direction==='long'?'active long':''}" data-dir="long">Long</button>
        <button type="button" class="dir-btn ${fs.direction==='short'?'active short':''}" data-dir="short">Short</button>
      </div>
    </div>

    <div class="field">
      <label>Symbol</label>
      <input type="text" id="f_symbol" placeholder="e.g. NIFTY, AAPL, BTCUSD" value="${fs.symbol?escapeAttr(fs.symbol):""}" autocapitalize="characters">
    </div>

    <div class="row2">
      <div class="field"><label>Date</label><input type="date" id="f_date" value="${fs.date||todayStr()}"></div>
      <div class="field"><label>Time</label><input type="time" id="f_time" value="${fs.time||""}"></div>
    </div>

    <div class="row3">
      <div class="field"><label>Entry price</label><input type="number" step="any" id="f_entry" value="${fs.entryPrice??""}"></div>
      <div class="field"><label>Exit price</label><input type="number" step="any" id="f_exit" value="${fs.exitPrice??""}"></div>
      <div class="field"><label>Qty / size</label><input type="number" step="any" id="f_qty" value="${fs.quantity??""}"></div>
    </div>

    <div class="field">
      <label>P&amp;L ($) — auto-filled, edit if needed</label>
      <input type="number" step="any" id="f_pnl" value="${fs.pnl??""}">
    </div>

    <div class="field">
      <label>Setup / strategy</label>
      <input type="text" id="f_setup" placeholder="e.g. Breakout, Pullback, Reversal" list="setupList" value="${fs.setup?escapeAttr(fs.setup):""}">
      <datalist id="setupList">
        <option value="Breakout"><option value="Pullback"><option value="Reversal"><option value="Trend follow"><option value="Range/scalp"><option value="News play">
      </datalist>
    </div>

    <div class="field">
      <label>Confidence going in</label>
      <div class="scale-row" id="confRow">
        ${[1,2,3,4,5].map(n=>`<button type="button" class="scale-btn ${fs.confidence==n?'active':''}" data-conf="${n}">${n}</button>`).join("")}
      </div>
    </div>

    <div class="field">
      <label>How you felt before the trade</label>
      <div class="tag-grid" id="preEmoGrid">
        ${EMOTIONS.map(e=>`<div class="tag-opt ${fs.preEmotions.includes(e)?'active':''}" data-emo="${e}">${e}</div>`).join("")}
      </div>
    </div>

    <div class="field">
      <label>How you felt after (result reaction)</label>
      <div class="tag-grid" id="postEmoGrid">
        ${EMOTIONS.map(e=>`<div class="tag-opt ${fs.postEmotions.includes(e)?'active':''}" data-emo="${e}">${e}</div>`).join("")}
      </div>
    </div>

    <div class="field">
      <label>Mistakes made (if any)</label>
      <div class="tag-grid" id="mistakeGrid">
        ${MISTAKES.map(m=>`<div class="tag-opt ${fs.mistakes.includes(m)?'active':''}" data-mistake="${m}">${m}</div>`).join("")}
      </div>
    </div>

    <div class="field">
      <label>Notes / reflection</label>
      <textarea id="f_notes" placeholder="What was your plan? What actually happened? What would you do differently?">${fs.notes?escapeHtml(fs.notes):""}</textarea>
    </div>

    <div class="field">
      <label>Screenshots</label>
      <label class="shot-input" for="f_shots">Tap to add chart / broker screenshots</label>
      <input type="file" id="f_shots" accept="image/*" multiple style="display:none;">
      <div class="shot-preview" id="shotPreview"></div>
    </div>

    <div class="btn-row">
      ${currentEditId? '<button type="button" class="btn-danger" id="deleteBtn">Delete</button>' : ''}
      <button type="submit" class="btn-primary">${currentEditId? 'Save changes':'Save trade'}</button>
    </div>
  `;

  // direction toggle
  f.querySelectorAll(".dir-btn").forEach(b=> b.addEventListener("click", ()=>{
    fs.direction = b.dataset.dir; recalcPnl(); renderEntryForm();
  }));
  // confidence
  f.querySelectorAll(".scale-btn").forEach(b=> b.addEventListener("click", ()=>{
    fs.confidence = parseInt(b.dataset.conf); renderEntryForm();
  }));
  // emotion tags
  f.querySelectorAll("#preEmoGrid .tag-opt").forEach(el=> el.addEventListener("click", ()=>{
    toggleArr(fs.preEmotions, el.dataset.emo); renderEntryForm();
  }));
  f.querySelectorAll("#postEmoGrid .tag-opt").forEach(el=> el.addEventListener("click", ()=>{
    toggleArr(fs.postEmotions, el.dataset.emo); renderEntryForm();
  }));
  f.querySelectorAll("#mistakeGrid .tag-opt").forEach(el=> el.addEventListener("click", ()=>{
    toggleArr(fs.mistakes, el.dataset.mistake); renderEntryForm();
  }));
  // price fields -> auto pnl
  ["f_entry","f_exit","f_qty"].forEach(id=>{
    document.getElementById(id).addEventListener("input", recalcPnl);
  });
  // screenshots
  document.getElementById("f_shots").addEventListener("change", handleShotUpload);
  renderShotPreview();

  f.addEventListener("submit", onSubmitTrade);
  if(currentEditId){
    const delBtn = document.getElementById("deleteBtn");
    if(delBtn) delBtn.addEventListener("click", onDeleteFromForm);
  }
}

function recalcPnl(){
  const entry = parseFloat(document.getElementById("f_entry").value);
  const exit = parseFloat(document.getElementById("f_exit").value);
  const qty = parseFloat(document.getElementById("f_qty").value);
  if(!isNaN(entry) && !isNaN(exit) && !isNaN(qty)){
    const dir = document.querySelector(".dir-btn.active")?.dataset.dir || formState.direction;
    const pnl = dir==="long" ? (exit-entry)*qty : (entry-exit)*qty;
    document.getElementById("f_pnl").value = pnl.toFixed(2);
  }
}

function toggleArr(arr, val){
  const i = arr.indexOf(val);
  if(i>-1) arr.splice(i,1); else arr.push(val);
}

async function handleShotUpload(e){
  const files = Array.from(e.target.files || []);
  for(const file of files){
    const dataUrl = await resizeImage(file, 1000, 0.72);
    formState.screenshots.push(dataUrl);
  }
  renderShotPreview();
}
function renderShotPreview(){
  const wrap = document.getElementById("shotPreview");
  if(!wrap) return;
  wrap.innerHTML = "";
  formState.screenshots.forEach((src, idx)=>{
    const d = document.createElement("div");
    d.className = "shot-thumb-wrap";
    d.innerHTML = `<img src="${src}"><button type="button" class="shot-remove" data-idx="${idx}">×</button>`;
    wrap.appendChild(d);
  });
  wrap.querySelectorAll(".shot-remove").forEach(btn=> btn.addEventListener("click", ()=>{
    formState.screenshots.splice(parseInt(btn.dataset.idx),1);
    renderShotPreview();
  }));
}

function resizeImage(file, maxDim, quality){
  return new Promise((resolve)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e)=>{
      img.onload = ()=>{
        let {width,height} = img;
        if(width>maxDim || height>maxDim){
          if(width>height){ height = Math.round(height*maxDim/width); width=maxDim; }
          else { width = Math.round(width*maxDim/height); height=maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width=width; canvas.height=height;
        canvas.getContext("2d").drawImage(img,0,0,width,height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onSubmitTrade(e){
  e.preventDefault();
  const symbol = document.getElementById("f_symbol").value.trim();
  if(!symbol){ toast("Add a symbol to save this trade"); return; }
  const dir = document.querySelector(".dir-btn.active")?.dataset.dir || "long";
  const trade = {
    symbol: symbol.toUpperCase(),
    direction: dir,
    date: document.getElementById("f_date").value || todayStr(),
    time: document.getElementById("f_time").value || "",
    entryPrice: parseFloat(document.getElementById("f_entry").value) || null,
    exitPrice: parseFloat(document.getElementById("f_exit").value) || null,
    quantity: parseFloat(document.getElementById("f_qty").value) || null,
    pnl: parseFloat(document.getElementById("f_pnl").value) || 0,
    setup: document.getElementById("f_setup").value.trim(),
    confidence: formState.confidence || 3,
    preEmotions: formState.preEmotions,
    postEmotions: formState.postEmotions,
    mistakes: formState.mistakes,
    notes: document.getElementById("f_notes").value.trim(),
    screenshots: formState.screenshots,
    createdAt: formState.createdAt || Date.now()
  };
  if(currentEditId){
    trade.id = currentEditId;
    await putTrade(trade);
    toast("Trade updated");
  } else {
    await addTrade(trade);
    toast("Trade saved");
  }
  TRADES = await getAllTrades();
  showView("trades");
}

async function onDeleteFromForm(){
  if(!confirm("Delete this trade? This can't be undone.")) return;
  await deleteTrade(currentEditId);
  TRADES = await getAllTrades();
  toast("Trade deleted");
  showView("trades");
}

/* ================================================================
   DETAIL VIEW
   ================================================================ */
async function openDetail(id){
  const t = await getTrade(id);
  const el = document.getElementById("detailContent");
  const pnlClass = t.pnl>0?"pos":t.pnl<0?"neg":"";
  el.innerHTML = `
    <button class="back-btn" id="backFromDetail">← Back</button>
    <div class="detail-head">
      <div>
        <span class="pill ${t.direction}">${t.direction==='long'?'Long':'Short'}</span>
        <h1>${escapeHtml(t.symbol)}</h1>
        <div class="muted">${t.date}${t.time? " · "+t.time:""}${t.setup? " · "+escapeHtml(t.setup):""}</div>
      </div>
      <div class="value ${pnlClass}" style="font-family:var(--font-num);font-size:20px;font-weight:700;">${fmtMoney(t.pnl)}</div>
    </div>

    <div class="kv-grid">
      <div class="kv"><div class="k">Entry</div><div class="v">${t.entryPrice ?? "—"}</div></div>
      <div class="kv"><div class="k">Exit</div><div class="v">${t.exitPrice ?? "—"}</div></div>
      <div class="kv"><div class="k">Size</div><div class="v">${t.quantity ?? "—"}</div></div>
      <div class="kv"><div class="k">Confidence</div><div class="v">${t.confidence||"—"}/5</div></div>
    </div>

    ${t.preEmotions?.length ? `<div class="section-title">Before the trade</div><div class="tag-grid">${t.preEmotions.map(e=>`<span class="tag-opt active">${e}</span>`).join("")}</div>`:""}
    ${t.postEmotions?.length ? `<div class="section-title">After the trade</div><div class="tag-grid">${t.postEmotions.map(e=>`<span class="tag-opt active">${e}</span>`).join("")}</div>`:""}
    ${t.mistakes?.length ? `<div class="section-title">Mistakes flagged</div><div class="tag-grid">${t.mistakes.map(m=>`<span class="tag-opt" style="background:var(--red-bg);color:var(--red);border-color:#4a2323;">${m}</span>`).join("")}</div>`:""}

    ${t.notes ? `<div class="section-title">Notes</div><div class="note-block">${escapeHtml(t.notes)}</div>` : ""}

    ${t.screenshots?.length ? `<div class="section-title">Screenshots</div><div class="detail-shots">${t.screenshots.map(s=>`<img src="${s}">`).join("")}</div>` : ""}

    <div class="btn-row" style="margin-top:20px;">
      <button class="btn-secondary" id="editTradeBtn">Edit</button>
      <button class="btn-danger" id="deleteTradeBtn">Delete</button>
    </div>
  `;
  document.getElementById("backFromDetail").addEventListener("click", ()=>showView("trades"));
  document.getElementById("editTradeBtn").addEventListener("click", ()=> openEditTradeForm(id));
  document.getElementById("deleteTradeBtn").addEventListener("click", async ()=>{
    if(!confirm("Delete this trade?")) return;
    await deleteTrade(id);
    TRADES = await getAllTrades();
    toast("Trade deleted");
    showView("trades");
  });
  showView("detail");
}

/* ================================================================
   INSIGHTS ENGINE — rule-based, fully local, no API calls
   ================================================================ */
function computeInsights(trades){
  const closed = trades.filter(t=>typeof t.pnl==="number");
  const insights = [];
  if(closed.length < 5){
    insights.push({icon:"info", title:"Log a few more trades", body:"Insights get sharper once you have at least 5–10 trades logged. Keep going — patterns in your emotions and setups will start to show up here."});
    return insights;
  }

  // Win rate by emotion tag (pre-trade)
  const emoStats = {};
  closed.forEach(t=>{
    (t.preEmotions||[]).forEach(e=>{
      emoStats[e] = emoStats[e] || {wins:0,total:0,pnl:0};
      emoStats[e].total++; emoStats[e].pnl += t.pnl;
      if(t.pnl>0) emoStats[e].wins++;
    });
  });
  const overallWinRate = closed.filter(t=>t.pnl>0).length/closed.length;
  Object.entries(emoStats).forEach(([emo,stat])=>{
    if(stat.total<3) return;
    const wr = stat.wins/stat.total;
    const diff = wr - overallWinRate;
    if(diff <= -0.2){
      insights.push({icon:"warn", title:`"${emo}" trades underperform`, body:`When you tagged "${emo}" going in, you won ${Math.round(wr*100)}% of ${stat.total} trades vs your overall ${Math.round(overallWinRate*100)}% — and it cost you ${fmtMoney(stat.pnl)} combined. Worth pausing when you notice this state.`});
    } else if(diff >= 0.2 && stat.pnl>0){
      insights.push({icon:"good", title:`"${emo}" is a strong state for you`, body:`Trades logged as "${emo}" won ${Math.round(wr*100)}% of the time (${stat.total} trades), well above your ${Math.round(overallWinRate*100)}% average, netting ${fmtMoney(stat.pnl)}.`});
    }
  });

  // Mistake tag impact
  const mistakeStats = {};
  closed.forEach(t=>{
    (t.mistakes||[]).forEach(m=>{
      mistakeStats[m] = mistakeStats[m]||{total:0,pnl:0,wins:0};
      mistakeStats[m].total++; mistakeStats[m].pnl+=t.pnl;
      if(t.pnl>0) mistakeStats[m].wins++;
    });
  });
  const sortedMistakes = Object.entries(mistakeStats).sort((a,b)=>a[1].pnl-b[1].pnl);
  sortedMistakes.slice(0,2).forEach(([m,stat])=>{
    if(stat.total>=2 && stat.pnl<0){
      insights.push({icon:"warn", title:`"${m}" is costing you`, body:`This happened on ${stat.total} trade${stat.total>1?'s':''} and those trades netted ${fmtMoney(stat.pnl)} combined. This is the most fixable kind of loss — it's behavioral, not market-driven.`});
    }
  });

  // Confidence vs outcome
  const confBuckets = {};
  closed.forEach(t=>{
    if(!t.confidence) return;
    confBuckets[t.confidence] = confBuckets[t.confidence]||{total:0,wins:0,pnl:0};
    confBuckets[t.confidence].total++; confBuckets[t.confidence].pnl+=t.pnl;
    if(t.pnl>0) confBuckets[t.confidence].wins++;
  });
  const lowConf = [1,2].reduce((s,k)=> s+(confBuckets[k]?.total||0),0);
  const lowConfPnl = [1,2].reduce((s,k)=> s+(confBuckets[k]?.pnl||0),0);
  if(lowConf>=3 && lowConfPnl<0){
    insights.push({icon:"warn", title:"Low-confidence trades are draining P&L", body:`Trades where you rated your confidence 1–2 out of 5 (${lowConf} trades) netted ${fmtMoney(lowConfPnl)}. Consider skipping setups you're not genuinely confident in.`});
  }

  // Setup performance
  const setupStats = {};
  closed.forEach(t=>{
    if(!t.setup) return;
    const key = t.setup.trim();
    if(!key) return;
    setupStats[key] = setupStats[key]||{total:0,wins:0,pnl:0};
    setupStats[key].total++; setupStats[key].pnl+=t.pnl;
    if(t.pnl>0) setupStats[key].wins++;
  });
  const setupEntries = Object.entries(setupStats).filter(([,s])=>s.total>=3);
  if(setupEntries.length){
    const best = setupEntries.reduce((a,b)=> a[1].pnl>b[1].pnl?a:b);
    const worst = setupEntries.reduce((a,b)=> a[1].pnl<b[1].pnl?a:b);
    if(best[1].pnl>0){
      insights.push({icon:"good", title:`Your best setup: "${best[0]}"`, body:`${best[1].total} trades, ${Math.round(best[1].wins/best[1].total*100)}% win rate, ${fmtMoney(best[1].pnl)} total. This is where your edge shows up most clearly.`});
    }
    if(worst[1].pnl<0 && worst[0]!==best[0]){
      insights.push({icon:"warn", title:`Weakest setup: "${worst[0]}"`, body:`${worst[1].total} trades, ${Math.round(worst[1].wins/worst[1].total*100)}% win rate, ${fmtMoney(worst[1].pnl)} total. Consider trading this pattern smaller, or not at all, until you review it.`});
    }
  }

  // Day-of-week performance
  const dowStats = {};
  closed.forEach(t=>{
    const d = new Date(t.date+"T00:00:00");
    if(isNaN(d)) return;
    const dow = d.toLocaleDateString(undefined,{weekday:"long"});
    dowStats[dow]=dowStats[dow]||{total:0,pnl:0,wins:0};
    dowStats[dow].total++; dowStats[dow].pnl+=t.pnl;
    if(t.pnl>0) dowStats[dow].wins++;
  });
  const dowEntries = Object.entries(dowStats).filter(([,s])=>s.total>=3);
  if(dowEntries.length){
    const worstDow = dowEntries.reduce((a,b)=> a[1].pnl<b[1].pnl?a:b);
    if(worstDow[1].pnl<0){
      insights.push({icon:"info", title:`${worstDow[0]}s tend to be rough`, body:`${worstDow[1].total} trades on ${worstDow[0]}s netted ${fmtMoney(worstDow[1].pnl)}. Could be schedule, fatigue, or market conditions specific to that day — worth a look.`});
    }
  }

  // Overtrading: days with 4+ trades
  const byDate = {};
  trades.forEach(t=>{ byDate[t.date]=(byDate[t.date]||0)+1; });
  const heavyDays = Object.entries(byDate).filter(([,c])=>c>=4);
  if(heavyDays.length){
    const heavyDayPnls = heavyDays.map(([date])=> closed.filter(t=>t.date===date).reduce((s,t)=>s+t.pnl,0));
    const avgHeavy = heavyDayPnls.reduce((a,b)=>a+b,0)/heavyDayPnls.length;
    if(avgHeavy < 0){
      insights.push({icon:"warn", title:"High-frequency days underperform", body:`On days with 4+ trades, your average day P&L was ${fmtMoney(avgHeavy)}. Overtrading is one of the most common ways discipline breaks down after an early win or loss.`});
    }
  }

  // Revenge trading pattern: a loss followed same-day by a larger-size trade
  let revengeCount = 0;
  const byDateSorted = {};
  trades.forEach(t=>{ (byDateSorted[t.date]=byDateSorted[t.date]||[]).push(t); });
  Object.values(byDateSorted).forEach(dayTrades=>{
    for(let i=1;i<dayTrades.length;i++){
      const prev = dayTrades[i-1], cur = dayTrades[i];
      if(prev.pnl<0 && cur.quantity && prev.quantity && cur.quantity > prev.quantity*1.4){
        revengeCount++;
      }
    }
  });
  if(revengeCount>=2){
    insights.push({icon:"warn", title:"Possible revenge-trading pattern", body:`${revengeCount} times, a losing trade was followed same-day by a noticeably larger position. This is a classic revenge-trading signature — worth a hard rule like "no size increase after a loss."`});
  }

  if(insights.length===0){
    insights.push({icon:"good", title:"No major red flags yet", body:"Your trade log doesn't show a strong negative pattern right now. Keep logging consistently — this gets more accurate the more trades you add."});
  }

  return insights;
}

function renderInsights(){
  const el = document.getElementById("insightsContent");
  if(TRADES.length===0){
    el.innerHTML = `<div class="empty-state"><div class="big">🧠</div>Log a few trades first — insights are built entirely from your own history.</div>`;
    return;
  }
  const insights = computeInsights(TRADES);
  el.innerHTML = insights.map(i=>`
    <div class="insight-card">
      <div class="insight-icon ${i.icon}">${i.icon==='warn'?'⚠':i.icon==='good'?'✓':'ℹ'}</div>
      <div class="insight-text"><div class="t">${i.title}</div><div class="d">${i.body}</div></div>
    </div>
  `).join("");
}

/* ================================================================
   SETTINGS — export / import / clear
   ================================================================ */
function renderSettings(){
  const el = document.getElementById("settingsContent");
  el.innerHTML = `
    <div class="settings-group">
      <h3>Your data</h3>
      <div class="settings-row"><div><div class="t">Trades logged</div><div class="s">Stored only on this device</div></div><div class="value" style="font-family:var(--font-num);font-size:16px;">${TRADES.length}</div></div>
    </div>
    <div class="settings-group">
      <h3>Backup</h3>
      <button class="btn-secondary" id="exportBtn" style="margin-bottom:8px;">Export backup (.json)</button>
      <label class="btn-secondary" for="importFile" style="display:block; text-align:center;">Import backup (.json)</label>
      <input type="file" id="importFile" accept="application/json" style="display:none;">
      <div class="muted" style="margin-top:8px;">Back this up regularly — clearing your browser data or switching phones will erase your journal since everything lives locally.</div>
    </div>
    <div class="settings-group">
      <h3>About the insights</h3>
      <div class="settings-row" style="align-items:flex-start;">
        <div><div class="t">How this works</div><div class="s">Insights are computed on-device from your own trades — no AI API, no data upload, no cost. It looks for patterns between your emotions, mistakes, setups, and outcomes.</div></div>
      </div>
    </div>
    <div class="settings-group">
      <h3>Danger zone</h3>
      <button class="btn-danger" id="clearBtn">Delete all data</button>
    </div>
  `;
  document.getElementById("exportBtn").addEventListener("click", exportBackup);
  document.getElementById("importFile").addEventListener("change", importBackup);
  document.getElementById("clearBtn").addEventListener("click", clearAllData);
}

function exportBackup(){
  const blob = new Blob([JSON.stringify({trades:TRADES, exportedAt:new Date().toISOString()}, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `ledger-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast("Backup downloaded");
}

function importBackup(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (ev)=>{
    try{
      const data = JSON.parse(ev.target.result);
      const trades = data.trades || data;
      if(!Array.isArray(trades)) throw new Error("bad format");
      if(!confirm(`Import ${trades.length} trades? This adds to your existing data.`)) return;
      for(const t of trades){
        const {id, ...rest} = t;
        await addTrade(rest);
      }
      TRADES = await getAllTrades();
      toast("Backup imported");
      renderSettings();
    }catch(err){
      toast("Couldn't read that file — is it a Ledger backup?");
    }
  };
  reader.readAsText(file);
}

async function clearAllData(){
  if(!confirm("Delete ALL trades? This cannot be undone.")) return;
  if(!confirm("Really sure? Your entire journal will be permanently erased.")) return;
  const all = await getAllTrades();
  for(const t of all) await deleteTrade(t.id);
  TRADES = [];
  toast("All data deleted");
  renderSettings();
  showView("dashboard");
}

/* ---------------- helpers ---------------- */
function todayStr(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s){ return escapeHtml(s); }
