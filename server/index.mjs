import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, ApiError } from './db.mjs';
import { createAuth, normalizeEmail, validEmail, validPassword, hashPassword, checkPassword } from './auth.mjs';
import { aiResponse } from './ai.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'};
const ASSETS=['index.html','app.js','style.css','data.js','minor.js','minor-previews.js','sw.js'];

export function createLunaServer({databasePath=process.env.LUNA_DB_PATH||join(root,'server','data','luna.sqlite'),
  publicDir=root,origin=process.env.PUBLIC_ORIGIN||'http://localhost:3000',now=()=>new Date(),
  roll=()=>randomInt(5),upstreamFetch=fetch}={}) {
  const publicOrigin=new URL(origin).origin;
  const cardIds=new Set();
  const catalog=JSON.parse(readFileSync(join(root,'server','card-catalog.json'),'utf8'));
  for(const folder of ['assets/cards','assets/cards/minor']) {
    for(const name of readdirSync(join(publicDir,folder))) if(name.endsWith('.webp')) cardIds.add(name.slice(0,-5));
  }
  if(cardIds.size!==Object.keys(catalog).length || [...cardIds].some(id=>!catalog[id]))
    throw new Error('Card catalog and artwork disagree; run npm --prefix server run catalog.');
  const store=createStore(databasePath,{now,roll,cardIds});
  const auth=createAuth(store,{origin:publicOrigin,now});
  const limits=new Map();
  let activeHashes=0;
  const guardedHash=async task=>{
    if(activeHashes>=2) throw new ApiError(503,'注册或登录人数较多，请稍后重试。');
    activeHashes++;
    try {return await task();} finally {activeHashes--;}
  };
  const clientIp=req=>{
    const remote=req.socket.remoteAddress||'unknown';
    const forwarded=req.headers['x-forwarded-for']?.split(',')[0]?.trim();
    return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&isIP(forwarded||'')?forwarded:remote;
  };
  const limit=(key,max,windowMs)=>{
    const time=now().getTime();
    const active=(limits.get(key)||[]).filter(t=>time-t<windowMs);
    active.push(time);limits.set(key,active);
    if(active.length>max) throw new ApiError(429,'请求太频繁，请稍后再试。');
    if(limits.size>5000) for(const [k,v] of limits) if(v.at(-1)<time-3600000) limits.delete(k);
  };
  const json=(res,status,body)=>{
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    res.end(JSON.stringify(body));
  };
  const readJson=async (req,max=24000)=>{
    if(!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415,'请使用 JSON 请求。');
    let raw='';
    for await(const chunk of req) {raw+=chunk;if(raw.length>max) throw new ApiError(413,'请求内容过长。');}
    try {return JSON.parse(raw);} catch {throw new ApiError(400,'请求格式错误。');}
  };
  const serveStatic=async (req,res,pathname)=>{
    const name=pathname==='/'?'index.html':decodeURIComponent(pathname).slice(1);
    if(!ASSETS.includes(name)&&(!name.startsWith('assets/')||name.split('/').some(part=>!part||part==='.'||part==='..')))
      throw new ApiError(404,'Not found');
    const file=resolve(publicDir,name);
    if(!file.startsWith(resolve(publicDir)+'/')) throw new ApiError(404,'Not found');
    try {
      const bytes=await readFile(file);
      res.writeHead(200,{'Content-Type':MIME[extname(file)]||'application/octet-stream',
        'Cache-Control':name.startsWith('assets/')?'public, max-age=86400':'no-cache',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY'});
      res.end(req.method==='HEAD'?undefined:bytes);
    } catch(error) {if(error.code==='ENOENT') throw new ApiError(404,'Not found');throw error;}
  };
  const handler=async (req,res)=>{
    try {
      const url=new URL(req.url,publicOrigin);
      const path=url.pathname;
      if(!path.startsWith('/api/')) {
        if(req.method!=='GET'&&req.method!=='HEAD') throw new ApiError(405,'Method not allowed');
        return await serveStatic(req,res,path);
      }
      if(req.method==='GET' && (path==='/api/bootstrap'||path==='/api/session')) {
        let owner=auth.owner(req),granted=false;
        if(!owner) {owner=store.createGuest();auth.issue(res,owner.id);granted=true;}
        else ({owner,granted}=store.claim(owner.id));
        return json(res,200,store.snapshot(owner,granted));
      }
      if(req.method==='GET') {
        const owner=auth.requireOwner(req);
        if(path==='/api/readings') return json(res,200,store.listReadings(owner.id,{before:url.searchParams.get('before'),limit:url.searchParams.get('limit')}));
        if(path==='/api/calendar') return json(res,200,store.listReadings(owner.id,{month:url.searchParams.get('month')||'invalid'}));
        const single=/^\/api\/readings\/([A-Za-z0-9_-]{8,90})$/.exec(path);
        if(single) {
          const record=store.getReading(owner.id,single[1]);
          if(!record) throw new ApiError(404,'找不到这次阅读。');
          return json(res,200,{record});
        }
        throw new ApiError(404,'Not found');
      }
      if(req.method!=='POST'&&req.method!=='PATCH') throw new ApiError(405,'Method not allowed');
      if(req.headers.origin!==publicOrigin) throw new ApiError(403,'请求来源无效。');
      if(path==='/api/register'||path==='/api/login') {
        limit(`${path}:${clientIp(req)}`,path==='/api/register'?3:10,path==='/api/register'?3600000:900000);
        const body=await readJson(req,4096);
        const email=normalizeEmail(body?.email),password=body?.password;
        if(!validEmail(email)||!validPassword(password)) throw new ApiError(400,'请填写有效邮箱和至少 12 位密码。');
        if(path==='/api/register') {
          const current=auth.requireOwner(req);
          if(current.email) throw new ApiError(409,'请先退出当前账号。');
          if(store.findAccount(email)) throw new ApiError(409,'这个邮箱已注册，请直接登录。');
          const hash=await guardedHash(()=>hashPassword(password));
          let result;
          try {result=store.register(current.id,email,hash);} catch(error) {
            if(error.code?.startsWith('ERR_SQLITE_CONSTRAINT')) throw new ApiError(409,'这个邮箱已注册，请直接登录。');
            throw error;
          }
          auth.rotate(req,res,result.owner.id);
          return json(res,201,{...store.snapshot(result.owner),bonusGranted:result.bonus});
        }
        const account=store.findAccount(email);
        if(!account||!await guardedHash(()=>checkPassword(password,account.password_hash)))
          throw new ApiError(401,'邮箱或密码不正确。');
        const current=auth.owner(req);
        if(current&&!current.email&&current.id!==account.owner_id) store.mergeGuest(current.id,account.owner_id);
        auth.rotate(req,res,account.owner_id);
        const claimed=store.claim(account.owner_id);
        return json(res,200,store.snapshot(claimed.owner,claimed.granted));
      }
      const owner=auth.requireOwner(req);
      if(path==='/api/logout'&&req.method==='POST') {
        const guest=store.createGuest(0);
        auth.rotate(req,res,guest.id);
        return json(res,200,store.snapshot(guest));
      }
      if(path==='/api/readings'&&req.method==='POST') {
        const body=await readJson(req);
        return json(res,200,{...store.completeReading(owner.id,body),serverDate:store.day()});
      }
      if(path==='/api/import'&&req.method==='POST') {
        limit(`import:${owner.id}`,12,3600000);
        const body=await readJson(req,700000);
        return json(res,200,store.importReadings(owner.id,body?.readings));
      }
      const update=/^\/api\/readings\/([A-Za-z0-9_-]{8,90})$/.exec(path);
      if(update&&req.method==='PATCH') {
        const body=await readJson(req,30000);
        return json(res,200,{record:store.updateReading(owner.id,update[1],body)});
      }
      if(path==='/api/ai'&&req.method==='POST') {
        limit(`ai-ip:${clientIp(req)}`,4,60000);
        limit(`ai-owner:${owner.id}`,4,60000);
        const body=await readJson(req,20000);
        const reading=typeof body?.readingId==='string'?store.getReading(owner.id,body.readingId):null;
        if(!reading) throw new ApiError(404,'请先完成这次占卜。');
        const stream=req.headers.accept?.includes('text/event-stream')===true;
        const prompt=body.prompt??body.messages?.at(-1)?.content;
        const response=await aiResponse({prompt,reading,catalog,stream,key:process.env.ZHIPU_API_KEY,fetchImpl:upstreamFetch});
        res.writeHead(response.status,Object.fromEntries(response.headers));
        if(response.body) for await(const chunk of response.body) res.write(chunk);
        res.end();
        return;
      }
      throw new ApiError(404,'Not found');
    } catch(error) {
      if(!error.status) console.error(`LUNA ${req.method} ${req.url?.split('?')[0]} failed`,error);
      if(!res.headersSent) json(res,error.status||500,{error:error.status?error.message:'服务器暂时无法处理请求。'});
      else res.destroy(error);
    }
  };
  const server=createServer(handler);
  return {server,db:store.db,close:()=>new Promise((resolveClose,reject)=>server.close(error=>{
    store.close();error?reject(error):resolveClose();
  }))};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const path=process.env.LUNA_DB_PATH||join(root,'server','data','luna.sqlite');
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const {server}=createLunaServer({databasePath:path});
  const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
  server.listen(port,host,()=>console.log(`LUNA listening on ${host}:${port}`));
}
