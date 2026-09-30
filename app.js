(() => {
  const app = document.getElementById("app");
  const RECORDS_KEY = "luna-readings-v1";
  const DAILY_KEY = "luna-daily-v1";
  const state = {
    view:"home", mode:null, question:"", deck:[], chosen:[], orientations:[], fanScroll:0,
    shuffling:false, revealIndex:0, flipped:false, record:null, resultBack:"home", toast:""
  };
  let shuffleTimer;
  let toastTimer;
  const artPreloads = new Map();
  const loadedArt = new Set();
  const cardExports = new Map();
  const readingExports = new Map();
  const fullArtPromises = new Map();

  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
  const cardById = id => CARDS.find(card => card.id === id);
  const artUrl = id => `./assets/cards/${id}.webp?v=hd2`;
  const thumbUrl = id => `./assets/cards/thumbs/${id}.webp?v=2`;
  const avifUrl = id => `./assets/cards/thumbs/${id}.avif`;
  const arrow = (direction="up") => `<svg class="arrow-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">${{
    up:'<path d="M5 19 19 5M7 5h12v12"/>',
    left:'<path d="M19 12H5m7-7-7 7 7 7"/>',
    right:'<path d="M5 12h14m-7-7 7 7-7 7"/>'
  }[direction]}</svg>`;
  const loadFullArt = id => {
    if(fullArtPromises.has(id)) return fullArtPromises.get(id);
    const image=new Image();
    const promise=new Promise((resolve,reject)=>{
      image.onload=async()=>{
        try {if(image.decode) await image.decode();} catch {}
        if(image.naturalWidth<1024 || image.naturalHeight<1536) {
          reject(new Error("清晰原图未加载完成"));return;
        }
        resolve(image);
      };
      image.onerror=()=>reject(new Error("清晰原图加载失败"));
    });
    image.src=artUrl(id);
    const cached=promise.catch(error=>{fullArtPromises.delete(id);throw error;});
    fullArtPromises.set(id,cached);
    return cached;
  };
  const preloadArt = id => {
    if(typeof Image==="undefined" || artPreloads.has(id)) return;
    const img=new Image();
    img.decoding="async";
    img.fetchPriority="high";
    img.onload=()=>{img.decode?.().catch(()=>{});};
    img.onerror=()=>{img.onerror=null;img.src=thumbUrl(id);};
    img.src=avifUrl(id);
    artPreloads.set(id,img);
  };
  const orientationAt = (reading, index) => reading?.orientations?.[index] === "reversed" ? "reversed" : "upright";
  const orientationName = orientation => orientation === "reversed" ? "逆位" : "正位";
  const keywordsFor = (card, orientation) => orientation === "reversed" ? REVERSED[card.id].keys : card.keys;
  const meaningFor = (card, orientation) => orientation === "reversed" ? REVERSED[card.id].meaning : card.meaning;
  const wrapCanvasText = (context, text, width) => {
    const lines=[];
    let line="";
    for(const char of String(text)) {
      if(char==="\n") {if(line) lines.push(line);line="";continue;}
      if(line && context.measureText(line+char).width>width) {lines.push(line);line=char;}
      else line+=char;
    }
    if(line) lines.push(line);
    return lines;
  };
  const drawCanvasLines = (context, lines, x, y, height) =>
    lines.forEach((line,i)=>context.fillText(line,x,y+i*height));
  const downloadImage = (blob, name) => {
    const link=document.createElement("a");
    link.href=URL.createObjectURL(blob);link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  };
  const shareOrDownload = async (blob, name, title, description) => {
    if(typeof File!=="undefined" && navigator.share && navigator.canShare) {
      const file=new File([blob],name,{type:"image/png"});
      let supported=false;
      try {supported=navigator.canShare({files:[file]});} catch {}
      if(supported) {
        try {await navigator.share({files:[file],title,text:description});return "shared";}
        catch(error) {if(error?.name==="AbortError") return "cancelled";}
      }
    }
    downloadImage(blob,name);
    return "downloaded";
  };
  const saveFeedback = outcome => ({
    shared:"✓ 系统分享已完成，请在所选位置查看高清图文。",
    downloaded:"✓ 高清图文已生成，下载已开始，请在下载内容查看。",
    cancelled:"已取消保存。"
  })[outcome];
  const copyText = async value => {
    try {await navigator.clipboard.writeText(value);return true;} catch {}
    const field=document.createElement("textarea");
    field.value=value;field.style.position="fixed";field.style.opacity="0";
    document.body.appendChild(field);field.select();
    let copied=false;
    try {copied=document.execCommand("copy");} catch {}
    field.remove();return copied;
  };
  const dateKey = (date = new Date()) => {
    const n = x => String(x).padStart(2,"0");
    return `${date.getFullYear()}-${n(date.getMonth()+1)}-${n(date.getDate())}`;
  };
  const todayLabel = () => new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"long",day:"numeric"}).format(new Date());
  const dateLabel = timestamp => new Intl.DateTimeFormat("zh-CN", {year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(new Date(timestamp));
  const readStore = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const writeStore = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };
  const records = () => {
    const value = readStore(RECORDS_KEY, []);
    return Array.isArray(value) ? value : [];
  };
  const randomInt = max => {
    if (crypto?.getRandomValues) {
      const one = new Uint32Array(1);
      const limit = Math.floor(4294967296 / max) * max;
      do { crypto.getRandomValues(one); } while (one[0] >= limit);
      return one[0] % max;
    }
    return Math.floor(Math.random() * max);
  };
  const shuffledCards = () => {
    const ids = CARDS.map(c => c.id);
    for (let i=ids.length-1;i>0;i--) {
      const j = randomInt(i+1);
      [ids[i],ids[j]] = [ids[j],ids[i]];
    }
    return ids;
  };
  const accent = id => {
    const palette = ["#ba9b65","#a28ab2","#819db8","#b99491","#a9ab8a"];
    return palette[Math.max(0,CARDS.findIndex(c => c.id === id)) % palette.length];
  };
  const face = (card, compact=false, orientation="upright") => `<div class="tarot-face ${compact?"compact":""} ${orientation==="reversed"?"is-reversed":""} ${loadedArt.has(card.id)?"was-loaded":""}" data-card-id="${card.id}" style="--accent:${accent(card.id)}" role="img" aria-label="${esc(card.en)}，${esc(card.cn)}，${orientationName(orientation)}">
    <img class="face-preview" src="${PREVIEW_ART[card.id]}" alt="" aria-hidden="true" draggable="false">
    <picture><source srcset="${avifUrl(card.id)}" type="image/avif"><img class="face-art" src="${thumbUrl(card.id)}" alt="" loading="eager" fetchpriority="high" decoding="async" draggable="false"></picture>
    <span class="face-number">${card.n}</span>
    <span class="face-caption"><span class="face-name">${esc(card.en)}</span><span class="face-cn">${esc(card.cn)}</span></span>
  </div>`;
  const header = immersive => `<header class="site-header">
    <button class="brand" data-action="home" aria-label="返回 LUNA 首页"><span class="brand-mark" aria-hidden="true">☾</span><span class="brand-name">LUNA</span></button>
    <nav class="header-actions" aria-label="主导航">${immersive
      ? `<span class="header-step">${esc(state.mode ? SPREADS[state.mode].eyebrow : "A QUIET SPACE")}</span><button class="nav-link" data-action="home">退出牌桌</button>`
      : `<button class="nav-link" data-action="home" ${state.view==="home"?'aria-current="page"':""}>首页</button><button class="nav-link" data-action="journal" ${state.view==="journal"?'aria-current="page"':""}>我的记录</button>`
    }</nav>
  </header>`;
  const footer = () => `<footer class="site-footer"><span>© LUNA · 给思绪一点空间</span><span>塔罗用于自我探索，不替代专业建议。</span></footer>`;
  const shell = (content, immersive=false) => `<div class="app-shell">${header(immersive)}${content}${immersive?"":footer()}${state.toast?`<div class="toast" role="status">${esc(state.toast)}</div>`:""}</div>`;
  const home = () => shell(`<main class="page home">
    <section class="hero" aria-labelledby="home-title">
      <div class="hero-copy">
        <p class="eyebrow">A SPACE TO REFLECT</p>
        <h1 id="home-title">有些问题，<br>不需要马上<br><em>找到答案。</em></h1>
        <p class="hero-text">选一种方式抽牌。看看此刻的感受，在阅读中为自己的想法留一点空间。</p>
      </div>
      <div class="hero-art" aria-hidden="true"><span class="hero-orbit one">✧</span><div class="hero-back"></div><span class="hero-orbit two">✦</span></div>
    </section>
    <section aria-labelledby="choose-title">
      <div class="section-heading"><span>01 / THE TABLE</span><h2 id="choose-title">今天，你想从哪里开始？</h2></div>
      <div class="mode-grid">
        ${modeCard("daily","☼","今日一牌","给今天一个观察自己的角度。")}
        ${modeCard("decision","⚖","理清一个决定","看看需要、遗漏与提醒。")}
        ${modeCard("three","☾","三张牌","过去、现在，以及下一步。")}
      </div>
      <div class="home-extra"><span>也可以不带着具体问题。</span><button class="text-link" data-action="mode" data-mode="single">自由抽一张 ${arrow("right")}</button></div>
    </section>
  </main>`);
  const modeCard = (mode, icon, title, description) => `<button class="mode-card" data-action="mode" data-mode="${mode}">
    <span class="mode-icon" aria-hidden="true">${icon}</span><span class="mode-arrow">${arrow()}</span>
    <span class="mode-copy"><strong>${title}</strong><small>${description}</small></span>
  </button>`;
  const intent = () => {
    const spread = SPREADS[state.mode];
    const decision = state.mode==="decision";
    return shell(`<main class="journey">
      <button class="back-link" data-action="home">${arrow("left")} 返回首页</button>
      <section class="stage-center">
        <p class="eyebrow">${spread.eyebrow}</p>
        <div class="intent-icon" aria-hidden="true">${decision?"⚖":"☾"}</div>
        <h1>${decision?"想一想这个决定。":"先想一想你的问题。"}</h1>
        <p class="lead">${decision?"可以写下正在考虑的一件事，也可以留空直接抽牌。结果会给出一个明确的行动倾向。":`${spread.intro}<br>不用寻找正确的那一张，凭第一感觉就好。`}</p>
        <div class="question-field"><label for="question">${decision?"正在考虑的决定":"写下此刻正在想的事"} <span style="color:var(--blue)">（可选）</span></label>
          <textarea id="question" maxlength="180" placeholder="${decision?"例如：我要不要接受这份新工作？":"例如：最近这件事为什么让我犹豫？"}">${esc(state.question)}</textarea>
        </div>
        <button class="primary" data-action="prepare">准备好了 ${arrow()}</button>
        <p class="small-note">${decision?"填写的内容仅显示在本次阅读和当前浏览器的记录里，不会改变抽牌结果。":"你写下的问题仅显示在本次阅读和当前浏览器的记录里，不会改变抽牌结果。"}</p>
      </section>
    </main>`,true);
  };
  const shuffle = () => {
    const spread = SPREADS[state.mode];
    return shell(`<main class="journey">
      <button class="back-link" data-action="home">${arrow("left")} 返回首页</button>
      <section class="stage-center">
        <p class="eyebrow">${spread.eyebrow}</p>
        <h1>${state.shuffling?"让思绪慢下来。":"让牌先安静下来。"}</h1>
        <p class="lead">${state.shuffling?"洗牌中……":"停留片刻，想一想此刻最在意的事。"}</p>
        <div class="deck-stage ${state.shuffling?"is-shuffling":""}" aria-hidden="true"><div class="deck-card"></div><div class="deck-card"></div><div class="deck-card"></div></div>
        <button class="primary" data-action="shuffle-run" ${state.shuffling?"disabled":""}>${state.shuffling?"正在洗牌":"开始洗牌"} ${arrow()}</button>
      </section>
    </main>`,true);
  };
  const slots = () => `<div class="chosen-slots" aria-label="已选卡牌">${Array.from({length:SPREADS[state.mode].count},(_,i)=>`<div class="slot ${state.chosen[i]?"filled":""}"><span class="slot-thumb" aria-hidden="true"></span><span>${["Ⅰ","Ⅱ","Ⅲ"][i]}</span></div>`).join("")}</div>`;
  const select = () => {
    const count = SPREADS[state.mode].count;
    return shell(`<main class="journey">
      <button class="back-link" data-action="home">${arrow("left")} 返回首页</button>
      <div class="selection-head"><p class="progress-count">选择 ${state.chosen.length+1} / ${count}</p><h1>凭直觉选择。</h1><p>左右滑动牌组，轻触一张。每张牌可能是正位或逆位。</p></div>
      <div class="fan-wrap"><div class="fan" role="group" aria-label="可选择的牌背">${state.deck.slice(0,18).map((id,i)=>`<button class="fan-card" style="--tilt:${(i-8.5)*.75}deg;--z:${i+1}" data-action="choose" data-index="${i}" aria-label="选择第 ${i+1} 张牌" ${state.chosen.includes(id)?"disabled":""}></button>`).join("")}</div></div>
      ${slots()}<p class="selection-tip">所有牌选好后才会翻开。</p>
    </main>`,true);
  };
  const ready = () => shell(`<main class="journey"><button class="back-link" data-action="home">${arrow("left")} 返回首页</button>
    <section class="stage-center"><p class="eyebrow">THE CARDS ARE READY</p><h1>你的牌已经准备好了。</h1><p class="lead">先不要急着赋予它们答案。慢慢翻开，留意第一感觉。</p>
      <div class="deck-stage" aria-hidden="true"><div class="deck-card"></div><div class="deck-card"></div><div class="deck-card"></div></div>
      ${slots()}<button class="primary" data-action="reveal-start">翻开第一张 ${arrow()}</button>
    </section></main>`,true);
  const revealedDetails = (card,orientation) => `<h1 class="reveal-name">${esc(card.en)} · ${esc(card.cn)}</h1><p class="reveal-keywords">${orientationName(orientation)} · ${keywordsFor(card,orientation).map(esc).join(" · ")}</p><button class="primary" data-action="reveal-next">${state.revealIndex+1===state.chosen.length?"阅读你的牌":"下一张"} ${arrow()}</button>`;
  const reveal = () => {
    const card = cardById(state.chosen[state.revealIndex]);
    const orientation = state.orientations[state.revealIndex];
    const position = SPREADS[state.mode].positions[state.revealIndex];
    return shell(`<main class="journey"><button class="back-link" data-action="home">${arrow("left")} 返回首页</button>
      <section class="stage-center"><p class="eyebrow">${state.revealIndex+1} / ${state.chosen.length} · ${esc(position)}</p>
        <div class="single-card ${state.flipped?"flipped":""}"><div class="card-rotor"><div class="card-side back"></div><div class="card-side front">${face(card,false,orientation)}</div></div></div>
        <div id="reveal-details" aria-live="polite">${state.flipped?revealedDetails(card,orientation)
          : `<h1 class="reveal-name">第 ${state.revealIndex+1} 张 · ${esc(position)}</h1><p class="lead">准备好以后，轻轻翻开。</p><button class="primary" data-action="flip">翻开这张牌 ${arrow()}</button>`}</div>
      </section></main>`,true);
  };
  // A repeatable action lean for a saved decision reading. Upright/reversed values
  // reflect the card themes; the final "reminder" card has a little more weight.
  const decisionValues = {
    fool:[1,-1],magician:[2,-1],priestess:[-1,-2],empress:[1,-1],emperor:[1,-1],
    hierophant:[0,-1],lovers:[1,-1],chariot:[2,-2],strength:[1,-1],hermit:[-1,-1],
    wheel:[1,-1],justice:[0,-1],hanged:[-2,-1],death:[1,-1],temperance:[-1,-1],
    devil:[-2,1],tower:[-2,-2],star:[1,-1],moon:[-2,-2],sun:[2,-1],
    judgement:[1,-1],world:[1,-1]
  };
  const decisionVerdict = (cards, reading) => {
    const values=cards.map((card,i)=>(decisionValues[card.id]?.[orientationAt(reading,i)==="reversed"?1:0]||0)*(i===2?2:1));
    const advance=values.reduce((sum,value)=>sum+value,0)>0;
    const lead=values.reduce((best,value,i)=>
      (advance?value>0:value<0) && Math.abs(value)>Math.abs(values[best]||0) ? i : best,
      values.findIndex(value=>advance?value>0:value<0));
    const index=lead<0?2:lead;
    const card=cards[index];
    const orientation=orientationAt(reading,index);
    const keyword=keywordsFor(card,orientation)[0];
    return {
      title:advance?"现在推进":"先暂缓",
      reason:`「${card.cn}」（${orientationName(orientation)}）落在“${SPREADS.decision.positions[index]}”的位置，提示「${keyword}」。${advance?"先迈出一小步，边行动边检验方向。":"先核对条件与事实，再决定是否行动。"}`
    };
  };
  const summary = (spread, cards, reading) => {
    const firstTheme = keywordsFor(cards[0],orientationAt(reading,0))[0];
    if (spread==="daily") return `今天可以从「${firstTheme}」这个主题开始，观察它与你的生活有什么联系。`;
    if (spread==="single") return `这张牌把注意力带到「${firstTheme}」：它让你对眼前的事多看见了什么？`;
    if (spread==="decision") return "看看这三张牌如何分别映照需要、遗漏与行动前的提醒。";
    return "把过去、现在与下一步放在一起看。留意这些主题之间，是延续、转变，还是一场新的对话。";
  };
  const result = () => {
    const r = state.record;
    if (!r || !SPREADS[r.spread]) return home();
    const cards = r.cards.map(cardById).filter(Boolean);
    const spread = SPREADS[r.spread];
    if (!cards.length) return home();
    const prompts = cards.map(card=>card.question);
    const verdict = r.spread==="decision" && cards.length===3 ? decisionVerdict(cards,r) : null;
    return shell(`<main class="page result">
      <button class="back-link result-back" data-action="result-back">${arrow("left")} 返回${state.resultBack==="journal"?"我的记录":"首页"}</button>
      <div class="result-head"><p class="eyebrow">${spread.eyebrow} · YOUR READING</p><h1>${spread.title}</h1>
        ${r.question?`<p class="result-question">“${esc(r.question)}”</p>`:""}
        <p class="result-date">${dateLabel(r.createdAt)}</p>
        ${verdict?`<div class="decision-verdict" role="status"><span>这次牌面的结论</span><strong>${esc(verdict.title)}</strong><p>${esc(verdict.reason)}</p></div>`:""}
      </div>
      <section class="result-cards" aria-label="这次抽到的牌">${cards.map((card,i)=>`<button class="result-card" data-action="inspect-card" data-index="${i}" aria-label="放大查看${esc(card.cn)}，${orientationName(orientationAt(r,i))}">${face(card, cards.length>1, orientationAt(r,i))}<span class="position-label">${i+1}. ${esc(spread.positions[i])} · ${orientationName(orientationAt(r,i))}</span></button>`).join("")}</section>
      ${cards.length>1?`<p class="cards-scroll-hint" aria-hidden="true">左右滑动，查看全部牌面 ${arrow("right")}</p>`:""}
      <div class="reading-panel">
        <p class="eyebrow">01 / ${verdict?"阅读方式":"一句话解读"}</p><p class="summary">${esc(verdict?"三张牌分别照见你真正看重的、容易遗漏的，以及行动前需要确认的事。":summary(r.spread,cards,r))}</p>
        <p class="reading-note">这是一个思考的角度，而不是对未来的保证。看看哪些文字与你当下的经验相呼应，也允许自己有不同的理解。</p>
        ${r.orientations?.includes("reversed")?`<p class="orientation-note">逆位不等于“不好”。它常提示受阻、内在化，或某个主题值得重新审视。</p>`:""}
        <p class="eyebrow">02 / 逐张阅读</p>
        ${cards.map((card,i)=>{const orientation=orientationAt(r,i);return `<section class="card-reading"><div><span class="meta">${String(i+1).padStart(2,"0")} / ${esc(spread.positions[i])} · ${orientationName(orientation)}</span><h3>${esc(card.en)}<br>${esc(card.cn)}</h3><span class="meta">${keywordsFor(card,orientation).map(esc).join(" · ")}</span></div><div><p>${esc(meaningFor(card,orientation))}</p><p><strong>在这个位置：</strong>${esc(POSITION_NOTES[spread.positions[i]])}</p></div></section>`}).join("")}
        ${cards.length>1?`<p class="reading-note" style="margin:28px 0 0">把这些牌放在一起时，可以留意重复的主题、不同的感受，以及你自己的经历如何把它们连接起来。</p>`:""}
        <section class="reflection"><p class="eyebrow">03 / 带走一个问题</p><blockquote>“${esc(prompts.at(-1))}”</blockquote></section>
        <section class="journal-editor" aria-labelledby="note-title"><p class="eyebrow">TAROT JOURNAL</p><h2 id="note-title">写下你的想法</h2>
          <p class="reading-note" style="margin:0">记录此刻最触动你的那一句，过段时间再回来看看。</p>
          <label for="journal-note" class="visually-hidden">我的阅读笔记</label>
          <textarea id="journal-note" maxlength="5000" placeholder="我注意到……">${esc(r.note||"")}</textarea>
          <div class="result-actions"><button class="primary" data-action="save-note">保存记录</button><button class="secondary" data-action="share">保存图文卡片</button><button class="secondary" data-action="copy-reading">复制解读文字</button><button class="secondary" data-action="journal">查看我的记录</button></div>
          <p class="save-feedback" id="reading-save-status" role="status" aria-live="polite"></p>
          <p class="small-note" style="margin:0">记录保存在当前浏览器。手机保存图文卡片时，请在系统分享菜单里选择“存储图像”或“保存到照片”；不支持分享的浏览器会下载图片。</p>
        </section>
      </div>
      <dialog class="card-dialog" id="card-dialog" aria-label="卡牌大图"><button class="dialog-close" data-action="close-card" aria-label="关闭大图">×</button><div id="dialog-content"></div></dialog>
    </main>`);
  };
  const journal = () => {
    const list = records().filter(r=>r && SPREADS[r.spread] && Array.isArray(r.cards)).sort((a,b)=>b.createdAt-a.createdAt);
    return shell(`<main class="page journal-page">
      <div class="journal-head"><p class="eyebrow">YOUR JOURNAL</p><h1>我的塔罗日志</h1><p>回看抽过的牌，也回看当时的自己。</p></div>
      <div class="storage-note">阅读和笔记保存在当前浏览器中。清除浏览器数据或更换设备后，它们可能消失。</div>
      ${list.length?`<div class="journal-list">${list.map(r=>{const d=new Date(r.createdAt);return `<button class="journal-item" data-action="open-record" data-id="${esc(r.id)}"><span class="journal-date">${d.getDate()}<small>${d.getMonth()+1} 月</small></span><span class="journal-item-main"><strong>${esc(r.question||SPREADS[r.spread].title)}</strong><span>${esc(SPREADS[r.spread].title)} · ${r.cards.map((id,i)=>esc((cardById(id)?.cn||"")+"（"+orientationName(orientationAt(r,i))+"）")).join(" · ")}${r.note?" · 已记录想法":""}</span></span><span class="journal-item-arrow">${arrow()}</span></button>`}).join("")}</div>`
      :`<div class="empty-journal"><div class="glyph" aria-hidden="true">☾</div><h2>这里还没有记录。</h2><p>从一张牌开始，给今天的想法留个位置。</p><button class="primary" data-action="home">去抽一张牌 ${arrow()}</button></div>`}
    </main>`);
  };
  const screens = {home,intent,shuffle,select,ready,reveal,result,journal};
  function render() {
    app.innerHTML = (screens[state.view]||home)();
    app.querySelectorAll(".face-art").forEach(image => watchArt(image));
    if(state.view==="result" && state.record) {
      const id=state.record.id;
      const share=app.querySelector('[data-action="share"]');
      if(share) {
        share.disabled=true;share.textContent="正在准备图文卡片…";
        prepareReadingImage(state.record).then(()=>{
          if(state.view==="result" && state.record?.id===id) {
            const current=app.querySelector('[data-action="share"]');
            if(current) {current.disabled=false;current.textContent="保存图文卡片";}
          }
        }).catch(()=>{
          if(state.record?.id===id) {
            const current=app.querySelector('[data-action="share"]');
            if(current) {current.disabled=false;current.textContent="重试保存图文卡片";}
            const status=app.querySelector("#reading-save-status");
            if(status) status.textContent="清晰原图加载失败，请重试保存。";
          }
        });
      }
    }
    if (state.view==="select") app.querySelector(".fan").scrollLeft=state.fanScroll;
    if (state.view==="home") document.title="LUNA · 给思绪一点空间";
    else document.title=`${state.view==="journal"?"我的塔罗日志":state.view==="result"?"我的阅读":SPREADS[state.mode]?.title||"抽牌"} · LUNA`;
  }
  function watchArt(image) {
    if(!image) return;
    const face = image.closest(".tarot-face");
    if (!face) return;
    const id=face.dataset.cardId;
    face.classList.remove("is-loaded", "has-error");
    const loaded = () => {loadedArt.add(id);face.classList.add("is-loaded");};
    const failed = () => {loadedArt.delete(id);face.classList.remove("is-loaded");face.classList.add("has-error");};
    image.addEventListener("load", loaded, {once:true});
    image.addEventListener("error", failed, {once:true});
    if (image.complete) image.naturalWidth ? loaded() : failed();
  }
  function flash(message) {
    state.toast=message;
    const shell=app.querySelector(".app-shell");
    let toast=shell?.querySelector(".toast");
    if(shell && !toast) {
      toast=document.createElement("div");
      toast.className="toast";
      toast.setAttribute("role","status");
      shell.appendChild(toast);
    }
    if(toast) toast.textContent=message;
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{state.toast="";app.querySelector(".toast")?.remove();},2600);
  }
  function navigate(view) {
    clearTimeout(shuffleTimer);
    state.toast=""; state.view=view;
    if (view==="home"||view==="journal") history.pushState({view},"",view==="home"?"#home":"#journal");
    window.scrollTo(0,0); render();
  }
  function persist(record) {
    const list=records();
    const i=list.findIndex(item=>item.id===record.id);
    if(i>=0) list[i]=record; else list.unshift(record);
    return writeStore(RECORDS_KEY,list.slice(0,100));
  }
  function buildRecord() {
    if(state.record) return state.record;
    state.record={id:crypto?.randomUUID?.() || String(Date.now())+"-"+Math.random().toString(36).slice(2),
      spread:state.mode,question:state.question.trim(),cards:[...state.chosen],orientations:[...state.orientations],createdAt:Date.now(),note:""};
    return state.record;
  }
  function startMode(mode) {
    if (!SPREADS[mode]) return;
    if (mode==="daily") {
      const saved=readStore(DAILY_KEY,null);
      if (saved?.date===dateKey()) {
        const found=records().find(r=>r.id===saved.id);
        if (found) {state.mode="daily";state.record=found;state.resultBack="home";state.view="result";window.scrollTo(0,0);render();return;}
      }
    }
    artPreloads.clear();
    cardExports.clear();
    readingExports.clear();
    fullArtPromises.clear();
    state.mode=mode;state.question="";state.deck=shuffledCards();state.chosen=[];state.orientations=[];state.record=null;state.fanScroll=0;state.shuffling=false;
    state.view=mode==="daily"?"shuffle":"intent";
    window.scrollTo(0,0);render();
  }
  function choose(index) {
    if(state.view!=="select"||!Number.isInteger(index)||index<0||index>=18) return false;
    const id=state.deck[index];
    if(!id||state.chosen.includes(id)) return false;
    state.fanScroll=app.querySelector(".fan")?.scrollLeft||0;
    state.chosen.push(id);
    state.orientations.push(randomInt(2)===0?"upright":"reversed");
    preloadArt(id);
    if(navigator.vibrate) navigator.vibrate(8);
    if(state.chosen.length===SPREADS[state.mode].count) {
      state.view="ready";
      if(state.mode==="daily") {
        const r=buildRecord();
        if(persist(r)) writeStore(DAILY_KEY,{date:dateKey(),id:r.id});
      }
    }
    render();
    return true;
  }
  function showResult() {
    const r=buildRecord();
    const saved=persist(r);
    state.resultBack="home";state.view="result";
    history.pushState({view:"result",id:r.id},"",`#reading/${encodeURIComponent(r.id)}`);
    window.scrollTo(0,0);render();
    if(!saved) flash("浏览器无法保存记录，请检查存储设置。");
  }
  function openRecord(id) {
    const found=records().find(r=>r.id===id);
    if (!found) return flash("找不到这次阅读。");
    state.record=found;state.mode=found.spread;state.resultBack="journal";state.view="result";
    history.pushState({view:"result",id},"",`#reading/${encodeURIComponent(id)}`);
    window.scrollTo(0,0);render();
  }
  const cardReadingText = (r,index,card) =>
    `${card.cn} · ${orientationName(orientationAt(r,index))}\n${SPREADS[r.spread].positions[index]}\n${meaningFor(card,orientationAt(r,index))}`;
  function prepareCardImage(r,index) {
    const card=cardById(r?.cards?.[index]);
    if(!card) return Promise.reject(new Error("找不到卡牌"));
    const key=`${r.id}:${index}:${dateKey()}`;
    if(!cardExports.has(key)) {
      const task=(async()=>{
        const image=await loadFullArt(card.id);
        const canvas=document.createElement("canvas");
        canvas.width=900;canvas.height=1790;
        const c=canvas.getContext("2d");
        if(!c) throw new Error("无法生成图片");
        c.fillStyle="#090B13";c.fillRect(0,0,900,1790);
        if(orientationAt(r,index)==="reversed") {
          c.save();c.translate(450,675);c.rotate(Math.PI);c.drawImage(image,-450,-675,900,1350);c.restore();
        } else c.drawImage(image,0,0,900,1350);
        c.fillStyle="rgba(9,11,19,.72)";c.fillRect(0,0,900,145);
        c.fillStyle="rgba(9,11,19,.86)";c.fillRect(0,1080,900,270);
        c.strokeStyle="#BA9B65";c.lineWidth=3;c.strokeRect(27,27,846,1736);
        c.strokeStyle="rgba(241,235,221,.7)";c.lineWidth=1;c.strokeRect(41,41,818,1708);
        c.textAlign="center";
        c.fillStyle="#E3C58C";c.font="42px Georgia,serif";c.fillText(card.n,450,101);
        c.fillStyle="#F1EBDD";c.font="54px Georgia,serif";c.fillText(card.en.toUpperCase(),450,1190,780);
        c.fillStyle="#E3C58C";c.font="28px sans-serif";c.fillText(card.cn+" · "+orientationName(orientationAt(r,index)),450,1250);
        c.font="22px sans-serif";c.fillText("这张牌的解读",450,1426);
        c.fillStyle="#F1EBDD";c.font="29px sans-serif";
        const lines=wrapCanvasText(c,meaningFor(card,orientationAt(r,index)),750);
        drawCanvasLines(c,lines,450,1495,50);
        c.fillStyle="#BA9B65";c.font="21px sans-serif";
        c.fillText(SPREADS[r.spread].positions[index],450,1668,760);
        c.fillStyle="#75839E";c.fillText(`保存于 ${todayLabel()}`,450,1730);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
        if(!blob) throw new Error("无法生成图片");
        return blob;
      })().catch(error=>{cardExports.delete(key);throw error;});
      cardExports.set(key,task);
    }
    return cardExports.get(key);
  }
  async function saveCardImage(index) {
    const r=state.record, card=cardById(r?.cards?.[index]);
    if(!card) return;
    const status=app.querySelector("#card-save-status");
    const button=app.querySelector('[data-action="save-card"]');
    if(button) button.disabled=true;
    if(status) {status.classList.remove("is-success");status.textContent="正在打开系统保存菜单…";}
    try {
      const blob=await prepareCardImage(r,index);
      const outcome=await shareOrDownload(blob,`LUNA-${card.id}-${orientationAt(r,index)}-${dateKey()}.png`,
        `${card.cn} · LUNA`,cardReadingText(r,index,card));
      if(status) {status.classList.toggle("is-success",outcome!=="cancelled");status.textContent=saveFeedback(outcome);}
    } catch {
      if(status) status.textContent="清晰原图加载失败，保存未完成，请重试。";
    } finally {
      if(button) button.disabled=false;
    }
  }
  async function copyCardReading(index) {
    const r=state.record, card=cardById(r?.cards?.[index]);
    if(!card) return;
    const copied=await copyText(cardReadingText(r,index,card));
    const status=app.querySelector("#card-save-status");
    if(status) status.textContent=copied?"解读文字已复制。":"复制失败，请长按上方文字复制。";
  }
  const readingCaption = (r,cards) => {
    if(r.spread==="decision" && cards.length===3) {
      const verdict=decisionVerdict(cards,r);
      return `结论：${verdict.title}。${verdict.reason}`;
    }
    return summary(r.spread,cards,r);
  };
  const readingText = (r,cards) => [
    SPREADS[r.spread].title,
    r.question?`“${r.question}”`:"",
    readingCaption(r,cards),
    `带走一个问题：${cards.at(-1).question}`
  ].filter(Boolean).join("\n");
  function prepareReadingImage(r) {
    const key=`${r.id}:${dateKey()}`;
    if(readingExports.has(key)) return readingExports.get(key);
    const task=(async()=>{
      const cards=r.cards.map(cardById).filter(Boolean);
      if(!cards.length) throw new Error("没有卡牌");
      const artwork=await Promise.all(cards.map(card=>loadFullArt(card.id)));
      const canvas=document.createElement("canvas");
      canvas.width=1800;canvas.height=3000;
      const c=canvas.getContext("2d");
      if(!c) throw new Error("无法生成图片");
      c.scale(2,2);
      c.fillStyle="#090B13";c.fillRect(0,0,900,1500);
      c.strokeStyle="#BA9B65";c.lineWidth=2;c.strokeRect(42,42,816,1416);
      c.strokeStyle="rgba(186,155,101,.4)";c.strokeRect(55,55,790,1390);
      c.textAlign="center";c.fillStyle="#BA9B65";c.font="42px Georgia,serif";c.fillText("☾",450,144);
      c.fillStyle="#F1EBDD";c.font="38px Georgia,serif";c.fillText("L U N A",450,202);
      c.fillStyle="#BA9B65";c.font="21px sans-serif";c.fillText(SPREADS[r.spread].title,450,273);
      const drawArtwork=(img,x,y,w,h,reversed)=>{
        c.save();c.beginPath();c.rect(x,y,w,h);c.clip();
        c.fillStyle="#15172A";c.fillRect(x,y,w,h);
        if(img){
          if(reversed){c.translate(x+w/2,y+h/2);c.rotate(Math.PI);c.drawImage(img,-w/2,-h/2,w,h);}
          else c.drawImage(img,x,y,w,h);
        }
        c.restore();c.strokeStyle="#BA9B65";c.lineWidth=2;c.strokeRect(x,y,w,h);
      };
      cards.forEach((card,i)=>{
        const single=cards.length===1;
        const w=single?270:190, h=single?405:285;
        const x=single?315:105+i*250, y=single?335:360;
        drawArtwork(artwork[i],x,y,w,h,orientationAt(r,i)==="reversed");
        c.fillStyle="#F1EBDD";c.font=`${single?51:25}px Georgia,serif`;
        c.fillText(card.en.toUpperCase(),x+w/2,single?807:690,single?700:215);
        c.fillStyle="#BA9B65";c.font=`${single?26:20}px sans-serif`;
        c.fillText(card.cn+" · "+orientationName(orientationAt(r,i)),x+w/2,single?856:735,single?500:220);
        if(!single){c.fillStyle="#75839E";c.font="18px sans-serif";c.fillText(SPREADS[r.spread].positions[i],x+w/2,774,225);}
      });
      c.strokeStyle="rgba(186,155,101,.45)";c.beginPath();c.moveTo(200,895);c.lineTo(700,895);c.stroke();
      c.fillStyle="#BA9B65";c.font="20px sans-serif";c.fillText(r.spread==="decision"?"本次结论":"一句话解读",450,950);
      c.fillStyle="#F1EBDD";c.font="27px sans-serif";
      drawCanvasLines(c,wrapCanvasText(c,readingCaption(r,cards),760),450,1008,43);
      c.strokeStyle="rgba(186,155,101,.45)";c.beginPath();c.moveTo(200,1193);c.lineTo(700,1193);c.stroke();
      c.fillStyle="#BA9B65";c.font="20px sans-serif";c.fillText("带走一个问题",450,1247);
      c.fillStyle="#F1EBDD";c.font="25px sans-serif";
      drawCanvasLines(c,wrapCanvasText(c,cards.at(-1).question,760),450,1302,40);
      c.fillStyle="#75839E";c.font="21px sans-serif";c.fillText(`保存于 ${todayLabel()}`,450,1430);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
      if(!blob) throw new Error("无法生成图片");
      return blob;
    })().catch(error=>{readingExports.delete(key);throw error;});
    readingExports.set(key,task);
    return task;
  }
  async function shareReading() {
    const r=state.record;
    if(!r) return;
    const cards=r.cards.map(cardById).filter(Boolean);
    if(!cards.length) return;
    const status=app.querySelector("#reading-save-status");
    const button=app.querySelector('[data-action="share"]');
    if(button) button.disabled=true;
    if(status) {status.classList.remove("is-success");status.textContent="正在准备清晰原图…";}
    try {
      const blob=await prepareReadingImage(r);
      const outcome=await shareOrDownload(blob,`LUNA-reading-${dateKey()}.png`,"我的 LUNA 塔罗阅读",readingText(r,cards));
      if(status) {status.classList.toggle("is-success",outcome!=="cancelled");status.textContent=saveFeedback(outcome);}
      if(outcome!=="cancelled") flash("图文图片已准备完成。");
    } catch {
      if(status) status.textContent="清晰原图加载失败，保存未完成，请重试。";
    } finally {if(button) button.disabled=false;}
  }
  async function copyReading() {
    const r=state.record;
    if(!r) return;
    const cards=r.cards.map(cardById).filter(Boolean);
    if(!cards.length) return;
    flash(await copyText(readingText(r,cards))?"解读文字已复制。":"复制失败，请长按文字复制。");
  }
  app.addEventListener("input",event=>{
    if(event.target.id==="question") state.question=event.target.value;
  });
  app.addEventListener("click",event=>{
    const button=event.target.closest("[data-action]");
    if(!button) return;
    const action=button.dataset.action;
    if(action==="home") navigate("home");
    else if(action==="journal") navigate("journal");
    else if(action==="result-back") navigate(state.resultBack==="journal"?"journal":"home");
    else if(action==="mode") startMode(button.dataset.mode);
    else if(action==="prepare") {
      state.question=(app.querySelector("#question")?.value||"").trim();
      state.view="shuffle";
      render();
    }
    else if(action==="shuffle-run"&&!state.shuffling) {
      state.shuffling=true;render();
      shuffleTimer=setTimeout(()=>{state.shuffling=false;state.view="select";render()},window.matchMedia("(prefers-reduced-motion: reduce)").matches?80:2400);
    }
    else if(action==="choose") choose(Number(button.dataset.index));
    else if(action==="reveal-start") {state.view="reveal";state.revealIndex=0;state.flipped=false;render();}
    else if(action==="flip") {
      state.flipped=true;
      app.querySelector(".single-card")?.classList.add("flipped");
      button.disabled=true;
      const index=state.revealIndex;
      setTimeout(()=>{
        if(state.view==="reveal"&&state.revealIndex===index) {
          const details=app.querySelector("#reveal-details");
          const card=cardById(state.chosen[index]);
          if(details&&card) details.innerHTML=revealedDetails(card,state.orientations[index]);
        }
      },760);
    }
    else if(action==="reveal-next") {
      if(state.revealIndex+1<state.chosen.length){state.revealIndex++;state.flipped=false;render();}
      else showResult();
    }
    else if(action==="open-record") openRecord(button.dataset.id);
    else if(action==="inspect-card") {
      const i=Number(button.dataset.index), r=state.record, card=cardById(r?.cards?.[i]);
      if(!card||!Number.isInteger(i)) return;
      const orientation=orientationAt(r,i);
      const content=app.querySelector("#dialog-content");
      content.innerHTML=`<div class="dialog-card">${face(card,false,orientation)}</div><p class="dialog-position">${esc(SPREADS[r.spread].positions[i])} · ${orientationName(orientation)}</p><h2>${esc(card.en)} · ${esc(card.cn)}</h2><p class="dialog-meaning">${esc(meaningFor(card,orientation))}</p><div class="dialog-actions"><button class="primary dialog-save" data-action="save-card" data-index="${i}" disabled>正在准备图文卡片…</button><button class="secondary" data-action="copy-card" data-index="${i}">复制解读文字</button></div><p class="dialog-save-note">图片会包含上面的解读。手机可在系统分享菜单里选择“存储图像”或“保存到照片”。</p><p class="dialog-status" id="card-save-status" role="status" aria-live="polite"></p>`;
      const dialog=app.querySelector("#card-dialog");
      if(dialog.showModal) dialog.showModal(); else dialog.setAttribute("open","");
      watchArt(content.querySelector(".face-art"));
      prepareCardImage(r,i).then(()=>{
        if(state.record?.id!==r.id || !dialog.open || content.querySelector('[data-action="save-card"]')?.dataset.index!==String(i)) return;
        const save=content.querySelector('[data-action="save-card"]');
        save.disabled=false;save.textContent="保存图文卡片";
      }).catch(()=>{
        if(content.querySelector('[data-action="save-card"]')?.dataset.index===String(i)) {
          content.querySelector("#card-save-status").textContent="清晰原图加载失败，请重新打开这张牌再试。";
        }
      });
    }
    else if(action==="save-card") saveCardImage(Number(button.dataset.index));
    else if(action==="copy-card") copyCardReading(Number(button.dataset.index));
    else if(action==="close-card") {
      const dialog=app.querySelector("#card-dialog");
      if(dialog.close) dialog.close(); else dialog.removeAttribute("open");
    }
    else if(action==="save-note") {
      if(!state.record) return;
      state.record.note=app.querySelector("#journal-note")?.value||"";
      flash(persist(state.record)?"已保存在当前浏览器。":"保存失败，请检查浏览器存储设置。");
    }
    else if(action==="share") shareReading();
    else if(action==="copy-reading") copyReading();
  });
  window.addEventListener("popstate",()=>{
    const hash=decodeURIComponent(location.hash);
    if(hash==="#journal") {state.view="journal";render();}
    else if(hash.startsWith("#reading/")) {
      const found=records().find(r=>r.id===hash.slice(9));
      if(found){state.record=found;state.mode=found.spread;state.resultBack="home";state.view="result";render();}
      else {state.view="home";render();}
    } else {state.view="home";render();}
  });
  const initial=decodeURIComponent(location.hash);
  if(initial==="#journal") state.view="journal";
  else if(initial.startsWith("#reading/")) {
    const found=records().find(r=>r.id===initial.slice(9));
    if(found){state.record=found;state.mode=found.spread;state.resultBack="home";state.view="result";}
  }
  render();

  if("serviceWorker" in navigator && location.protocol==="https:") {
    navigator.serviceWorker.register("./sw.js?v=20260930-1",{scope:"./"}).catch(()=>{});
  }

  // Optional browser agent interface; the visible controls use the same actions.
  if(document.modelContext?.registerTool) {
    const context=document.modelContext;
    Promise.resolve(context.registerTool({
      name:"start_tarot_reading",title:"Start a LUNA tarot reading",
      description:"Open a daily, single-card, three-card, or decision reading. This prepares the visible reading flow but does not draw cards.",
      inputSchema:{type:"object",properties:{spread:{type:"string",enum:["daily","single","three","decision"]}},required:["spread"],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input) {
        if(!input || !SPREADS[input.spread]) throw new Error("Choose a valid spread.");
        startMode(input.spread);
        return {stage:state.view,spread:input.spread,requiredCards:SPREADS[input.spread].count};
      }
    })).catch(()=>{});
    Promise.resolve(context.registerTool({
      name:"choose_tarot_cards",title:"Choose LUNA tarot cards",
      description:"Choose the specified card-back positions for the active reading and show the ready-to-reveal stage. The positions are zero-based from the visible 18-card row.",
      inputSchema:{type:"object",properties:{positions:{type:"array",items:{type:"integer",minimum:0,maximum:17},minItems:1,maxItems:3}},required:["positions"],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input) {
        if(!state.mode||!["intent","shuffle","select"].includes(state.view)) throw new Error("Start a reading first.");
        const positions=input?.positions;
        if(!Array.isArray(positions)||positions.length!==SPREADS[state.mode].count||new Set(positions).size!==positions.length||positions.some(i=>!Number.isInteger(i)||i<0||i>17)) throw new Error("Provide distinct visible positions for this spread.");
        clearTimeout(shuffleTimer);state.shuffling=false;state.view="select";render();
        for(const i of positions) if(!choose(i)) throw new Error("Could not choose a card.");
        return {stage:state.view,selectedCount:state.chosen.length,orientations:[...state.orientations]};
      }
    })).catch(()=>{});
  }
})();
