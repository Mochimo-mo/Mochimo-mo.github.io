(() => {
  const app = document.getElementById("app");
  const RECORDS_KEY = "luna-readings-v1";
  const DAILY_KEY = "luna-daily-v1";
  const AI_SETTINGS_KEY = "luna-ai-settings-v1";
  const API_KEY_STORE = "luna-user-api-key-v1";
  const SITE_AI_ENDPOINT = "https://luna-tarot-ai.qiutingqian.workers.dev/api/reading";
  const AI_PRESETS = {
    zhipu:{name:"智谱 GLM-4.7-Flash"}
  };
  const THEME_KEY = "luna-display-theme-v1";
  const state = {
    view:"home", mode:null, question:"", deck:[], chosen:[], orientations:[], fanScroll:0,
    shuffling:false, revealIndex:0, flipped:false, record:null, resultBack:"home", settingsBack:"home", toast:"", aiBusy:false
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
    const url=URL.createObjectURL(blob);
    link.href=url;link.download=name;
    link.style.display="none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
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
    shared:"✓ 已保存图文图片。请在系统分享时选择的位置查看；选择“保存到照片”后可在相册查看。",
    downloaded:"✓ 已保存图文图片到浏览器下载内容。若相册里没有，请从下载内容打开图片并存入相册。",
    cancelled:"已取消保存。"
  })[outcome];
  const showSaveFeedback = (status, button, outcome) => {
    const saved=outcome!=="cancelled";
    if(status) {
      status.classList.toggle("is-success",saved);
      status.textContent=saveFeedback(outcome);
    }
    if(button) button.textContent=saved?"✓ 已保存 · 再次保存":"保存图文卡片";
  };
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
  const readAiSettings = () => {
    const saved=readStore(AI_SETTINGS_KEY,{});
    const provider=["zhipu","custom"].includes(saved?.provider)?saved.provider:"zhipu";
    return {
      provider,
      endpoint:typeof saved?.endpoint==="string"?saved.endpoint:"",
      model:typeof saved?.model==="string"?saved.model:"",
      rememberKey:saved?.provider===provider&&typeof saved?.rememberKey==="boolean"?saved.rememberKey:false
    };
  };
  const apiKeyStoreName = provider => provider==="custom"?API_KEY_STORE:`${API_KEY_STORE}-${provider}`;
  const storedApiKey = (provider=readAiSettings().provider) => {
    const name=apiKeyStoreName(provider);
    try {return sessionStorage.getItem(name) || localStorage.getItem(name) || "";} catch {return "";}
  };
  const saveApiKey = (key, remember, provider=readAiSettings().provider) => {
    const name=apiKeyStoreName(provider);
    try {
      sessionStorage.removeItem(name);
      localStorage.removeItem(name);
      if(key) (remember?localStorage:sessionStorage).setItem(name,key);
      return true;
    } catch {return false;}
  };
  try {
    sessionStorage.removeItem(`${API_KEY_STORE}-modelscope`);
    localStorage.removeItem(`${API_KEY_STORE}-modelscope`);
  } catch {}
  const themeChoice = () => {
    try {const choice=localStorage.getItem(THEME_KEY);return choice==="light"||choice==="dark"?choice:"system";} catch {return "system";}
  };
  const applyTheme = choice => {
    if(choice==="light"||choice==="dark") document.documentElement.dataset.theme=choice;
    else delete document.documentElement.dataset.theme;
    try {localStorage.setItem(THEME_KEY,choice);} catch {}
  };
  applyTheme(themeChoice());
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
      ? `<span class="header-step">${esc(state.mode ? SPREADS[state.mode].eyebrow : "A QUIET SPACE")}</span><button class="nav-link" data-action="home">退出牌桌</button><button class="nav-link" data-action="settings">设置</button>`
      : `<button class="nav-link" data-action="home" ${state.view==="home"?'aria-current="page"':""}>首页</button><button class="nav-link" data-action="journal" ${state.view==="journal"?'aria-current="page"':""}>我的记录</button><button class="nav-link" data-action="settings" ${state.view==="settings"?'aria-current="page"':""}>设置</button>`
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
  const aiMessages = reading => (Array.isArray(reading.aiChat)?reading.aiChat:[])
    .filter(message=>["user","assistant"].includes(message?.role)&&typeof message.content==="string")
    .slice(-24);
  const formattedAiText = content => esc(content).replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>");
  const aiThread = reading => {
    const messages=aiMessages(reading);
    return messages.length?messages.map(message=>`<div class="ai-message ${message.role}"><span>${message.role==="user"?"你":"LUNA AI"}</span><p>${message.role==="assistant"?formattedAiText(message.content):esc(message.content)}</p></div>`).join("")
      :`<p class="ai-empty">点击下方按钮，让 AI 根据这次牌面和你写下的问题给出更具体的解读。</p>`;
  };
  const aiPanel = reading => {
    const settings=readAiSettings();
    const providerLabel=AI_PRESETS[settings.provider]?.name||"自定义 API";
    const privacyTip=settings.provider==="zhipu"?
      "本站服务通过 Cloudflare 代为调用智谱，无需填写 API Key；请求有频率与额度限制。":
      "自定义接口由浏览器直接请求，服务需要允许跨域访问。";
    return `<section class="ai-panel" id="ai-panel" aria-labelledby="ai-title">
      <div class="ai-heading"><div><p class="eyebrow">04 / CONTINUE THE CONVERSATION</p><h2 id="ai-title">和 LUNA AI 聊聊</h2></div><span class="ai-provider">${providerLabel}</span></div>
      <p class="ai-lead">${reading.question?`围绕“${esc(reading.question)}”继续探索。`:`从这次牌面出发，谈谈你眼下在意的事。`} AI 会参考牌的位置、正逆位与解读，不把塔罗当成确定的预言。</p>
      <div class="ai-thread" id="ai-thread" role="log" aria-label="AI 对话" aria-live="polite">${aiThread(reading)}</div>
      <button class="primary ai-start" data-action="ai-start" ${aiMessages(reading).length?"hidden":""}>结合这次牌面开始解读 ${arrow()}</button>
      <div class="ai-suggestions"><span>你也可以问</span><button type="button" data-action="ai-suggest" data-prompt="结合这次牌面，我接下来可以做哪三件具体的小事？">接下来怎么做？</button><button type="button" data-action="ai-suggest" data-prompt="这次牌面提醒我在行动前先确认什么？">先确认什么？</button></div>
      <label for="ai-question" class="ai-label">继续问一个问题</label><textarea id="ai-question" maxlength="1000" rows="3" placeholder="例如：如果我想试着迈出一步，先从哪里开始？"></textarea>
      <div class="ai-controls"><button class="secondary" data-action="ai-send">发送问题 ${arrow()}</button><button class="text-link" data-action="settings">AI 与主题设置</button></div>
      <p class="ai-status" id="ai-status" role="status" aria-live="polite"></p>
      <p class="ai-privacy">点击解读或发送后，这次的问题、牌面和对话会发送至你选择的 AI 服务。本站的对话记录保存在当前浏览器；服务方按其政策处理收到的内容。${privacyTip}</p>
    </section>`;
  };
  const settingsPage = () => {
    const ai=readAiSettings(), theme=themeChoice();
    return shell(`<main class="page settings-page">
      <button class="back-link" data-action="settings-back">${arrow("left")} 返回${state.settingsBack==="result"?"阅读":state.settingsBack==="journal"?"我的记录":"首页"}</button>
      <div class="settings-head"><p class="eyebrow">MAKE IT YOURS</p><h1>偏好与 AI</h1><p>选择阅读时的外观，以及解读和追问使用的 AI 服务。</p></div>
      <section class="settings-panel" aria-labelledby="theme-title"><p class="eyebrow">01 / APPEARANCE</p><h2 id="theme-title">页面主题</h2>
        <div class="choice-group" role="radiogroup" aria-label="页面主题">
          <label><input type="radio" name="theme-choice" value="system" ${theme==="system"?"checked":""}><span>跟随系统<small>随设备的明暗模式变化</small></span></label>
          <label><input type="radio" name="theme-choice" value="light" ${theme==="light"?"checked":""}><span>奶油浅色<small>始终使用浅色</small></span></label>
          <label><input type="radio" name="theme-choice" value="dark" ${theme==="dark"?"checked":""}><span>深色<small>始终使用深色</small></span></label>
        </div>
      </section>
      <section class="settings-panel" aria-labelledby="provider-title"><p class="eyebrow">02 / AI PROVIDER</p><h2 id="provider-title">解读服务</h2>
        <div class="choice-group provider-choices" role="radiogroup" aria-label="AI 服务">
          <label><input type="radio" name="ai-provider" value="zhipu" ${ai.provider==="zhipu"?"checked":""}><span>智谱 GLM-4.7-Flash<small>本站默认提供 · 无需 API Key</small></span></label>
          <label><input type="radio" name="ai-provider" value="custom" ${ai.provider==="custom"?"checked":""}><span>我的 API<small>连接 OpenAI 兼容的聊天接口</small></span></label>
        </div>
        <p class="settings-help">智谱解读由本站服务提供，打开即可使用。也可以选择“我的 API”，填写自己的接口与密钥。本站服务会限制请求频率。</p>
        <p class="settings-help"><a href="https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash" target="_blank" rel="noopener noreferrer">查看智谱免费模型与 API 说明 ↗</a></p>
        <div class="custom-api" id="custom-api" ${ai.provider==="custom"?"":"hidden"}>
          <label class="custom-only" for="ai-endpoint" ${ai.provider==="custom"?"":"hidden"}>Chat Completions 接口 URL</label><input class="custom-only" id="ai-endpoint" type="url" inputmode="url" placeholder="https://api.example.com/v1/chat/completions" value="${esc(ai.endpoint)}" autocomplete="url" spellcheck="false" ${ai.provider==="custom"?"":"hidden"}>
          <label class="custom-only" for="ai-model" ${ai.provider==="custom"?"":"hidden"}>模型名称</label><input class="custom-only" id="ai-model" type="text" placeholder="例如 gpt-4o-mini" value="${esc(ai.model)}" autocomplete="off" spellcheck="false" ${ai.provider==="custom"?"":"hidden"}>
          <label for="ai-api-key" id="ai-key-label">API Key <span>（留空则保留已输入的密钥）</span></label><input id="ai-api-key" type="password" placeholder="${storedApiKey("custom")?"已输入密钥 · 留空以保留":"仅在你的浏览器中使用"}" autocomplete="off" spellcheck="false">
          <label class="remember-key"><input type="checkbox" id="remember-api-key" ${ai.rememberKey?"checked":""}>在此设备保存密钥，关闭浏览器后仍可用</label>
          <p class="settings-help">勾选后密钥保存在此设备的浏览器存储；取消勾选则只留在当前浏览器会话。共享设备建议取消勾选。密钥不会写入网站代码或传给 LUNA 的托管服务器。</p>
          <button class="text-link" data-action="clear-api-key">清除已保存的密钥</button>
        </div>
        <div class="settings-actions"><button class="primary" data-action="save-settings">保存 AI 设置</button><p id="settings-status" role="status" aria-live="polite"></p></div>
      </section>
    </main>`);
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
        ${aiPanel(r)}
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
  const screens = {home,intent,shuffle,select,ready,reveal,result,journal,settings:settingsPage};
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
    else document.title=`${state.view==="journal"?"我的塔罗日志":state.view==="result"?"我的阅读":state.view==="settings"?"偏好与 AI":SPREADS[state.mode]?.title||"抽牌"} · LUNA`;
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
  function flash(message, duration=2600) {
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
    toastTimer=setTimeout(()=>{state.toast="";app.querySelector(".toast")?.remove();},duration);
  }
  function navigate(view) {
    clearTimeout(shuffleTimer);
    state.toast=""; state.view=view;
    if(view==="home"||view==="journal"||view==="settings") history.pushState({view},"",`#${view}`);
    else if(view==="result"&&state.record) history.pushState({view,id:state.record.id},"",`#reading/${encodeURIComponent(state.record.id)}`);
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
      showSaveFeedback(status,button,outcome);
    } catch {
      if(status) {status.classList.remove("is-success");status.textContent="清晰原图加载失败，保存未完成，请重试。";}
      if(button) button.textContent="重试保存图文卡片";
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
      showSaveFeedback(status,button,outcome);
      if(outcome!=="cancelled") flash("✓ 图文图片已保存",5000);
    } catch {
      if(status) {status.classList.remove("is-success");status.textContent="清晰原图加载失败，保存未完成，请重试。";}
      if(button) button.textContent="重试保存图文卡片";
    } finally {if(button) button.disabled=false;}
  }
  async function copyReading() {
    const r=state.record;
    if(!r) return;
    const cards=r.cards.map(cardById).filter(Boolean);
    if(!cards.length) return;
    flash(await copyText(readingText(r,cards))?"解读文字已复制。":"复制失败，请长按文字复制。");
  }
  const aiContext = reading => {
    const cards=reading.cards.map(cardById).filter(Boolean);
    const verdict=reading.spread==="decision"&&cards.length===3?decisionVerdict(cards,reading):null;
    return [
      `阅读类型：${SPREADS[reading.spread].title}`,
      `用户写下的问题：${reading.question?.trim()||"未填写。不要替用户编造具体问题；可以围绕牌面主题提一个澄清问题。"}`,
      verdict?`已有牌面结论：${verdict.title}。${verdict.reason}`:"",
      ...cards.map((card,i)=>`${i+1}. ${SPREADS[reading.spread].positions[i]}：${card.cn}（${orientationName(orientationAt(reading,i))}）；关键词：${keywordsFor(card,orientationAt(reading,i)).join("、")}；牌义：${meaningFor(card,orientationAt(reading,i))}`),
      `原始总结：${readingCaption(reading,cards)}`
    ].filter(Boolean).join("\n");
  };
  const aiSystemPrompt = "你是 LUNA 的中文塔罗反思向导。每次回答都要结合用户写下的问题、实际抽到的牌、牌位和正逆位；只使用提供的牌面资料，不要虚构新的牌或生活事实。把塔罗当作思考工具，不作确定性的未来断言。先回应用户的具体困惑，再说明牌面线索与问题的联系，最后给出可自主选择的小步骤或值得核对的事实。若用户没有填写问题，不要假设其处境，邀请补充。语气温和、清晰、具体，通常控制在 250 到 450 字。若涉及医疗、法律、财务或安全等重要决定，提醒核对事实和咨询合适的专业人士。";
  const aiRequestMessages = (reading, prompt) => [
    {role:"system",content:aiSystemPrompt},
    {role:"user",content:`这次阅读的已知资料：\n${aiContext(reading)}\n\n请以这些资料为依据回答后续问题。`},
    ...aiMessages(reading).slice(-12).map(message=>({role:message.role,content:message.content})),
    {role:"user",content:prompt}
  ];
  const aiResponseText = response => {
    const content=response?.message?.content ?? response?.choices?.[0]?.message?.content ?? response;
    if(typeof content==="string") return content.trim();
    if(Array.isArray(content)) return content.map(part=>typeof part==="string"?part:part?.text||"").join("\n").trim();
    return "";
  };
  const readAiStream = async (response, onDelta) => {
    const reader=response.body?.getReader();
    if(!reader) throw new Error("AI 回复暂不可用，请稍后重试。");
    const decoder=new TextDecoder();
    let pending="", answer="", completed=false;
    const acceptEvent = event => {
      const data=event.split(/\r?\n/).filter(line=>line.startsWith("data:"))
        .map(line=>line.slice(5).trimStart()).join("\n");
      if(!data) return;
      let packet;
      try {packet=JSON.parse(data);} catch {throw new Error("AI 回复格式异常，请稍后重试。");}
      if(typeof packet.error==="string") throw new Error("本站服务："+packet.error);
      if(typeof packet.delta==="string"&&packet.delta) {
        answer+=packet.delta;
        onDelta?.(packet.delta,answer);
      }
      if(packet.done===true) completed=true;
    };
    try {
      while(true) {
        const {done,value}=await reader.read();
        if(done) break;
        pending+=decoder.decode(value,{stream:true});
        let match;
        while((match=/\r?\n\r?\n/.exec(pending))) {
          acceptEvent(pending.slice(0,match.index));
          pending=pending.slice(match.index+match[0].length);
        }
      }
      pending+=decoder.decode();
      if(pending.trim()) acceptEvent(pending);
      if(!completed||!answer.trim()) throw new Error("AI 回复未完成，请稍后重试。");
      return answer.trim();
    } finally {reader.releaseLock();}
  };
  const callAi = async (reading,prompt,onDelta) => {
    const settings=readAiSettings();
    const messages=aiRequestMessages(reading,prompt);
    const siteProvided=settings.provider==="zhipu";
    const key=siteProvided?"":storedApiKey("custom");
    const endpoint=siteProvided?SITE_AI_ENDPOINT:settings.endpoint;
    if(!siteProvided&&(!endpoint||!settings.model)) throw new Error("请先在设置中填写接口 URL 和模型名称。");
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),60000);
    try {
      const response=await fetch(endpoint,{
        method:"POST",headers:{"Content-Type":"application/json",...(siteProvided?{Accept:"text/event-stream"}:{}),...(key?{Authorization:`Bearer ${key}`}:{})},
        body:JSON.stringify(siteProvided?{messages}:{model:settings.model,messages,temperature:0.6,max_tokens:800,stream:false}),
        signal:controller.signal
      });
      if(!response.ok) {
        if(siteProvided) {
          const details=await response.json().catch(()=>null);
          throw new Error(`本站服务：${typeof details?.error==="string"?details.error:"暂不可用，请稍后重试。"}`);
        }
        throw new Error(response.status===401||response.status===403?"接口拒绝访问，请核对密钥和权限。":response.status===429?"接口请求过多或免费额度已用完，请稍后再试。":`接口返回 ${response.status}，请检查地址和模型。`);
      }
      if(siteProvided&&response.headers.get("Content-Type")?.includes("text/event-stream")) return readAiStream(response,onDelta);
      const answer=aiResponseText(await response.json());
      if(answer) onDelta?.(answer,answer);
      return answer;
    } finally {clearTimeout(timeout);}
  };
  const aiErrorMessage = error => {
    const message=String(error?.message||"");
    if(message.includes("402")||message.includes("insufficient")||message.includes("quota")) return "免费额度可能已用完。可稍后再试，或在设置里选择自己的 API。";
    if(error?.name==="AbortError") return "AI 等待超时，请稍后重试。";
    if(message.includes("Failed to fetch")||message.includes("NetworkError")) return readAiSettings().provider==="zhipu"?"暂时无法连接本站 AI 服务，请检查网络并稍后重试。":"浏览器无法直连 AI 接口。请检查网络；若服务方不允许跨域请求，需要后端转发。";
    return message.startsWith("本站服务：")||message.startsWith("请先")||message.startsWith("接口")?message:"AI 暂时没有回答，请稍后重试。";
  };
  async function askAi(prompt, visibleQuestion=prompt) {
    const reading=state.record;
    if(!reading||state.aiBusy||!app.querySelector("#ai-panel")) return;
    const question=prompt.trim();
    const status=app.querySelector("#ai-status");
    if(!question) {if(status) status.textContent="先写下你想问的事。";return;}
    state.aiBusy=true;
    app.querySelectorAll("#ai-panel button, #ai-question").forEach(control=>control.disabled=true);
    const thread=app.querySelector("#ai-thread");
    thread.querySelectorAll("[data-ai-pending]").forEach(message=>message.remove());
    thread.querySelector(".ai-empty")?.remove();
    const userMessage=document.createElement("div");
    userMessage.className="ai-message user";
    userMessage.dataset.aiPending="";
    userMessage.innerHTML="<span>你</span><p>"+esc(visibleQuestion)+"</p>";
    const aiMessage=document.createElement("div");
    aiMessage.className="ai-message assistant is-loading";
    aiMessage.dataset.aiPending="";
    aiMessage.innerHTML='<span>LUNA AI</span><p class="ai-typing" role="status" aria-label="AI 正在回答"><i></i><i></i><i></i></p>';
    thread.append(userMessage,aiMessage);
    thread.scrollTop=thread.scrollHeight;
    app.querySelector(".ai-start").hidden=true;
    app.querySelector("#ai-question").value="";
    if(status) status.textContent="AI 正在阅读问题和牌面…";
    const answerText=aiMessage.querySelector("p");
    const active=()=>state.view==="result"&&state.record?.id===reading.id&&app.querySelector("#ai-thread")===thread;
    try {
      const answer=await callAi(reading,question,(_piece,soFar)=>{
        if(!active()) return;
        const follow=thread.scrollHeight-thread.scrollTop-thread.clientHeight<100;
        aiMessage.classList.remove("is-loading");
        answerText.className="ai-writing";
        answerText.removeAttribute("role");
        answerText.removeAttribute("aria-label");
        answerText.innerHTML=formattedAiText(soFar);
        if(follow) thread.scrollTop=thread.scrollHeight;
        if(status) status.textContent="AI 正在逐段回答…";
      });
      if(!answer) throw new Error("AI 未返回文字");
      reading.aiChat=[...aiMessages(reading),{role:"user",content:visibleQuestion},{role:"assistant",content:answer}].slice(-24);
      persist(reading);
      if(active()) {
        userMessage.removeAttribute("data-ai-pending");
        aiMessage.removeAttribute("data-ai-pending");
        aiMessage.classList.remove("is-loading");
        answerText.className="";
        answerText.removeAttribute("role");
        answerText.removeAttribute("aria-label");
        answerText.innerHTML=formattedAiText(answer);
        thread.scrollTop=thread.scrollHeight;
        if(status) status.textContent="已结合这次牌面回答。你可以继续追问。";
      }
    } catch(error) {
      if(active()) {
        aiMessage.classList.remove("is-loading");
        aiMessage.classList.add("is-error");
        answerText.className="";
        answerText.removeAttribute("role");
        answerText.removeAttribute("aria-label");
        answerText.textContent=aiErrorMessage(error);
        app.querySelector("#ai-question").value=visibleQuestion;
        thread.scrollTop=thread.scrollHeight;
        if(status) status.textContent="回复未完成，问题已保留，可以重试。";
      }
    } finally {
      state.aiBusy=false;
      if(active()) app.querySelectorAll("#ai-panel button, #ai-question").forEach(control=>control.disabled=false);
    }
  }
  function saveSettings() {
    const status=app.querySelector("#settings-status");
    const selected=app.querySelector('input[name="ai-provider"]:checked')?.value;
    const provider=["zhipu","custom"].includes(selected)?selected:"zhipu";
    const endpoint=app.querySelector("#ai-endpoint")?.value.trim()||"";
    const model=app.querySelector("#ai-model")?.value.trim()||"";
    const rememberKey=app.querySelector("#remember-api-key")?.checked===true;
    if(provider==="custom") {
      try {
        const url=new URL(endpoint);
        if(url.protocol!=="https:"||url.username||url.password||url.hash||!url.pathname.endsWith("/chat/completions")) throw new Error();
      } catch {if(status) status.textContent="请填写 HTTPS 的完整 Chat Completions 接口 URL。";return;}
      if(!model) {if(status) status.textContent="请填写模型名称。";return;}
    }
    const key=provider==="custom"?(app.querySelector("#ai-api-key")?.value.trim()||storedApiKey("custom")):"";
    if(!writeStore(AI_SETTINGS_KEY,{provider,endpoint,model,rememberKey})||
      (provider==="custom"&&!saveApiKey(key,rememberKey,"custom"))) {
      if(status) status.textContent="浏览器无法保存设置，请检查存储权限。";return;
    }
    app.querySelector("#ai-api-key").value="";
    app.querySelector("#ai-api-key").placeholder=storedApiKey("custom")?"已输入密钥 · 留空以保留":"仅在你的浏览器中使用";
    if(status) status.textContent="✓ AI 设置已保存。";
    flash("AI 设置已保存。");
  }
  app.addEventListener("input",event=>{
    if(event.target.id==="question") state.question=event.target.value;
  });
  app.addEventListener("change",event=>{
    if(event.target.name==="theme-choice") applyTheme(event.target.value);
    if(event.target.name==="ai-provider") {
      const provider=event.target.value;
      app.querySelector("#custom-api").hidden=provider!=="custom";
      app.querySelectorAll(".custom-only").forEach(field=>field.hidden=provider!=="custom");
      const keyField=app.querySelector("#ai-api-key");
      keyField.value="";
      keyField.placeholder=storedApiKey("custom")?"已输入密钥 · 留空以保留":"仅在你的浏览器中使用";
      app.querySelector("#settings-status").textContent="";
    }
  });
  app.addEventListener("keydown",event=>{
    if(event.target.id==="ai-question"&&event.key==="Enter"&&!event.shiftKey&&!event.isComposing) {
      event.preventDefault();askAi(event.target.value);
    }
  });
  app.addEventListener("click",event=>{
    const button=event.target.closest("[data-action]");
    if(!button) return;
    const action=button.dataset.action;
    if(action==="home") navigate("home");
    else if(action==="journal") navigate("journal");
    else if(action==="settings") {state.settingsBack=["result","journal"].includes(state.view)?state.view:"home";navigate("settings");}
    else if(action==="settings-back") navigate(state.settingsBack);
    else if(action==="save-settings") saveSettings();
    else if(action==="clear-api-key") {
      saveApiKey("",false,"custom");
      const field=app.querySelector("#ai-api-key");
      if(field) {field.value="";field.placeholder="仅在你的浏览器中使用";}
      app.querySelector("#settings-status").textContent="已清除此设备保存的密钥。";
    }
    else if(action==="result-back") navigate(state.resultBack==="journal"?"journal":"home");
    else if(action==="ai-start") askAi(state.record?.question?"请结合我写的问题与本次牌面，给出具体的解读，以及我可以尝试的两三步。":"请根据这次牌面给我一个具体的解读，并告诉我可以从哪里开始思考。若需要更多背景，请向我提问。",state.record?.question||"解读这次牌面");
    else if(action==="ai-suggest") askAi(button.dataset.prompt||"");
    else if(action==="ai-send") askAi(app.querySelector("#ai-question")?.value||"");
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
    else if(hash==="#settings") {state.view="settings";render();}
    else if(hash.startsWith("#reading/")) {
      const found=records().find(r=>r.id===hash.slice(9));
      if(found){state.record=found;state.mode=found.spread;state.resultBack="home";state.view="result";render();}
      else {state.view="home";render();}
    } else {state.view="home";render();}
  });
  const initial=decodeURIComponent(location.hash);
  if(initial==="#journal") state.view="journal";
  else if(initial==="#settings") state.view="settings";
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
