import { ApiError } from './db.mjs';

const UPSTREAM='https://open.bigmodel.cn/api/paas/v4/chat/completions';
const SYSTEM='你是 LUNA 的中文塔罗反思向导。只依据服务端提供的真实问题、实际牌位和正逆位，以及用户追问来回答；不要编造牌或生活事实。塔罗用来整理思绪，不做确定的未来预言。先回应问题，再说明牌面线索，最后提出可选择的小步骤。重大医疗、法律、财务或安全决定提醒核对事实并求助专业人士。不要输出思考过程。';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const clean=value=>typeof value==='string'?value.replace(/<think>[\s\S]*?<\/think>/g,'').trim():'';

// The browser only supplies its latest question. Reading context and prior chat come from our database.
export async function aiResponse({prompt,reading,catalog,stream,key,fetchImpl=fetch}) {
  if(!key) throw new ApiError(503,'本站 AI 尚未配置完成。');
  if(typeof prompt!=='string') throw new ApiError(400,'请先完成抽牌，再提出简短的问题。');
  const question=prompt.trim();
  if(!question||question.length>4000) throw new ApiError(400,'问题太长，请缩短后重试。');
  const positions={daily:['今日'],single:['此刻'],three:['过去','现在','下一步'],decision:['需要','遗漏','提醒']}[reading.spread];
  const context=`阅读类型：${reading.spread}\n用户原问题：${reading.question||'未填写'}\n`+
    reading.cards.map((id,i)=>{
      const card=catalog[id],reversed=reading.orientations[i]==='reversed';
      return `${positions[i]}：${card.cn}（${reversed?'逆位':'正位'}）；牌义：${reversed?card.reversed:card.meaning}`;
    }).join('\n');
  const history=(reading.aiChat||[]).slice(-12).filter(item=>['user','assistant'].includes(item.role)&&typeof item.content==='string');
  let upstream;
  try {
    upstream=await fetchImpl(UPSTREAM,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
      body:JSON.stringify({model:'glm-4.7-flash',messages:[{role:'system',content:SYSTEM},
        {role:'user',content:`这次阅读的已知资料：\n${context}\n请结合牌面和用户问题回答。`},...history,{role:'user',content:question}],
        thinking:{type:'disabled'},max_tokens:1024,temperature:0.6,stream}),signal:AbortSignal.timeout(55000)});
  } catch {return json({error:'智谱模型连接超时或暂不可用，请稍后重试。'},503);}
  if(!upstream.ok) return json({error:upstream.status===429?'智谱当前限流或免费额度已用完，请稍后重试。':
    [401,403].includes(upstream.status)?'本站的智谱服务密钥暂不可用。':'智谱模型暂不可用，请稍后重试。'},upstream.status===429?429:503);
  if(!stream) {
    try {
      const answer=clean((await upstream.json())?.choices?.[0]?.message?.content);
      return answer?json({choices:[{message:{role:'assistant',content:answer}}]}):json({error:'AI 暂时没有回答，请稍后重试。'},503);
    } catch {return json({error:'AI 暂时没有回答，请稍后重试。'},503);}
  }
  if(!upstream.body) return json({error:'智谱模型暂不可用，请稍后重试。'},503);
  const decoder=new TextDecoder(),encoder=new TextEncoder();
  const body=new ReadableStream({async start(controller) {
    const send=value=>controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
    let pending='',answer='',finished=false,thinking=false,tag='';
    const visible=part=>{
      let input=tag+part,out='';tag='';
      while(input) {
        if(thinking) {
          const end=input.indexOf('</think>');
          if(end<0) {tag=input.slice(-7);return out;}
          input=input.slice(end+8);thinking=false;
        } else {
          const start=input.indexOf('<think>');
          if(start>=0) {out+=input.slice(0,start);input=input.slice(start+7);thinking=true;}
          else {
            let suffix=0;
            for(let n=Math.min(6,input.length);n>0;n--) if(input.endsWith('<think>'.slice(0,n))) {suffix=n;break;}
            out+=input.slice(0,input.length-suffix);tag=input.slice(input.length-suffix);return out;
          }
        }
      }
      return out;
    };
    const event=block=>{
      const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(data==='[DONE]') {finished=true;return;}
      if(!data) return;
      let packet;try {packet=JSON.parse(data);} catch {return;}
      if(packet?.error) throw new Error('upstream error');
      const choice=packet?.choices?.[0];
      if(typeof choice?.delta?.content==='string') {
        const piece=visible(choice.delta.content).slice(0,Math.max(0,12000-answer.length));
        if(piece) {answer+=piece;send({delta:piece});}
      }
      if(choice?.finish_reason) finished=true;
    };
    try {
      for await(const chunk of upstream.body) {
        pending+=decoder.decode(chunk,{stream:true});
        if(pending.length>250000) throw new Error('oversized stream');
        let match;
        while((match=/\r?\n\r?\n/.exec(pending))) {event(pending.slice(0,match.index));pending=pending.slice(match.index+match[0].length);}
      }
      pending+=decoder.decode();if(pending.trim()) event(pending);
      send(finished&&answer.trim()?{done:true}:{error:'AI 回复未完成，请稍后重试。'});
    } catch {send({error:'智谱模型连接中断，请稍后重试。'});}
    finally {controller.close();}
  }});
  return new Response(body,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
