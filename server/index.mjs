import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

const scryptAsync = promisify(scrypt);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 5;
const SESSION_AGE = 30 * 86400;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.webp':'image/webp', '.avif':'image/avif', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.json':'application/json' };

class ApiError extends Error {
  constructor(status, message) { super(message); this.status=status; }
}
const digest = value => createHash('sha256').update(value).digest('hex');
const dayInShanghai = date => {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{ timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' })
    .formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const randomId = () => randomBytes(32).toString('base64url');
const normalizeEmail = email => typeof email==='string' ? email.trim().toLowerCase() : '';
const validEmail = email => email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validPassword = password => typeof password==='string' && password.length>=12 && password.length<=128 && Buffer.byteLength(password,'utf8')<=256;
const HASH_OPTIONS = { N:131072, r:8, p:1, maxmem:256*1024*1024 };
async function hashPassword(password, salt=randomBytes(16)) {
  const hash=await scryptAsync(password,salt,64,HASH_OPTIONS);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
async function checkPassword(password, stored) {
  const [,salt,expected]=stored.split('$');
  const actual=await scryptAsync(password,Buffer.from(salt,'base64url'),64,HASH_OPTIONS);
  return timingSafeEqual(actual,Buffer.from(expected,'base64url'));
}

export function createLunaServer({ databasePath=process.env.LUNA_DB_PATH || join(root,'server','data','luna.sqlite'),
  publicDir=root, origin=process.env.PUBLIC_ORIGIN || 'http://localhost:3000', now=()=>new Date(), roll=()=>randomInt(5) }={}) {
  const productionOrigin=new URL(origin).origin;
  const secure=productionOrigin.startsWith('https:');
  const cookieName=secure?'__Host-luna_session':'luna_session';
  const db=new DatabaseSync(databasePath,{ timeout:5000 });
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      balance INTEGER NOT NULL CHECK(balance BETWEEN 0 AND 5), claimed_date TEXT NOT NULL,
      drop_date TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reading_receipts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL, spread TEXT NOT NULL, day TEXT NOT NULL,
      spent INTEGER NOT NULL, rewarded INTEGER NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_daily_per_day
      ON reading_receipts(user_id,day) WHERE spread='daily';`);
  const attempts=new Map();
  let activeHashes=0;
  const guardedHash=async task => {
    if(activeHashes>=2) throw new ApiError(503,'注册或登录人数较多，请稍后重试。');
    activeHashes++;
    try { return await task(); } finally { activeHashes--; }
  };
  const countAttempt=(key,limit,windowMs) => {
    const time=now().getTime();
    const active=(attempts.get(key)||[]).filter(t=>time-t<windowMs);
    active.push(time); attempts.set(key,active);
    if(active.length>limit) throw new ApiError(429,'尝试次数过多，请稍后再试。');
    if(attempts.size>5000) for(const [k,v] of attempts) if(v.at(-1)<time-3600000) attempts.delete(k);
  };
  const wallet = user => ({ balance:user.balance, max:MAX, claimedDate:user.claimed_date });
  const readUser = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const sessionUser = req => {
    const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if(!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row=db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(digest(token),now().getTime());
    return row||null;
  };
  const claim = user => {
    const day=dayInShanghai(now());
    if(user.claimed_date===day) return { user, granted:false };
    db.prepare('UPDATE users SET balance=MIN(balance+1,5), claimed_date=? WHERE id=?').run(day,user.id);
    return { user:readUser(user.id), granted:user.balance<MAX };
  };
  const sessionPayload = (user,granted=false) => ({ authenticated:!!user, account:user?{ id:user.id, email:user.email }:null,
    wallet:user?wallet(user):null, granted,
    dailyDone:!!user && !!db.prepare("SELECT 1 FROM reading_receipts WHERE user_id=? AND day=? AND spread='daily'").get(user.id,dayInShanghai(now())) });
  const json=(res,status,body,headers={}) => {
    res.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers });
    res.end(JSON.stringify(body));
  };
  const sessionCookie = (token,maxAge) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; ${secure?'Secure; ':''}Max-Age=${maxAge}`;
  const newSession = (res,user) => {
    const token=randomId();
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),user.id,now().getTime()+SESSION_AGE*1000);
    res.setHeader('Set-Cookie',sessionCookie(token,SESSION_AGE));
  };
  const readBody=async req => {
    if(!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415,'请使用 JSON 请求。');
    let raw='';
    for await(const chunk of req) { raw+=chunk; if(raw.length>4096) throw new ApiError(413,'请求内容过长。'); }
    try { return JSON.parse(raw); } catch { throw new ApiError(400,'请求格式错误。'); }
  };
  const completeReading=(user,id,spread) => {
    if(typeof id!=='string' || !/^[a-zA-Z0-9-]{8,90}$/.test(id) || !['daily','single','three','decision'].includes(spread))
      throw new ApiError(400,'占卜资料无效。');
    const day=dayInShanghai(now());
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous=db.prepare('SELECT * FROM reading_receipts WHERE user_id=? AND id=?').get(user.id,id);
      if(previous) {
        db.exec('COMMIT');
        return { spent:previous.spent===1, rewarded:previous.rewarded===1, wallet:wallet(readUser(user.id)) };
      }
      const current=readUser(user.id);
      if(spread==='daily' && db.prepare("SELECT id FROM reading_receipts WHERE user_id=? AND day=? AND spread='daily'").get(user.id,day))
        throw new ApiError(409,'今天的每日一牌已在这个账号完成，请回原设备查看。');
      if(spread!=='daily' && current.balance<1) throw new ApiError(402,'水晶不足。注册用户明天首次打开会获得 1 颗。');
      const spent=spread!=='daily';
      const balance=current.balance-(spent?1:0);
      const rewarded=current.drop_date!==day && balance<MAX && roll()===0;
      db.prepare('UPDATE users SET balance=?, drop_date=? WHERE id=?').run(balance+(rewarded?1:0),rewarded?day:current.drop_date,user.id);
      db.prepare('INSERT INTO reading_receipts(user_id,id,spread,day,spent,rewarded,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(user.id,id,spread,day,spent?1:0,rewarded?1:0,now().getTime());
      db.exec('COMMIT');
      return { spent, rewarded, wallet:wallet(readUser(user.id)) };
    } catch(error) { db.exec('ROLLBACK'); throw error; }
  };
  const serveStatic=async (req,res,pathname) => {
    const name=pathname==='/'?'index.html':decodeURIComponent(pathname).slice(1);
    if(!['index.html','app.js','style.css','data.js','minor.js','minor-previews.js','sw.js'].includes(name) &&
      (!name.startsWith('assets/') || name.split('/').some(part=>part==='..'||part==='.'||!part))) throw new ApiError(404,'Not found');
    const file=resolve(publicDir,name);
    if(!file.startsWith(resolve(publicDir)+'/')) throw new ApiError(404,'Not found');
    try {
      const bytes=await readFile(file);
      res.writeHead(200,{ 'Content-Type':MIME[extname(file)]||'application/octet-stream', 'X-Content-Type-Options':'nosniff',
        'Cache-Control':name.startsWith('assets/')?'public, max-age=86400':'no-cache' });
      res.end(req.method==='HEAD'?undefined:bytes);
    } catch(error) { if(error.code==='ENOENT') throw new ApiError(404,'Not found'); throw error; }
  };
  const handler=async (req,res) => {
    try {
      const url=new URL(req.url,origin);
      if(!url.pathname.startsWith('/api/')) {
        if(req.method!=='GET'&&req.method!=='HEAD') throw new ApiError(405,'Method not allowed');
        return await serveStatic(req,res,url.pathname);
      }
      if(req.method==='GET' && url.pathname==='/api/session') {
        const user=sessionUser(req);
        const result=user?claim(user):{ user:null,granted:false };
        return json(res,200,sessionPayload(result.user,result.granted));
      }
      if(req.method!=='POST') throw new ApiError(405,'Method not allowed');
      if(req.headers.origin!==productionOrigin) throw new ApiError(403,'请求来源无效。');
      if(url.pathname==='/api/register' || url.pathname==='/api/login') {
        const remote=req.socket.remoteAddress||'unknown';
        const forwarded=req.headers['x-forwarded-for']?.split(',')[0]?.trim();
        const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote);
        const ip=local&&isIP(forwarded||'')?forwarded:remote;
        countAttempt(`${url.pathname}:${ip}`,url.pathname==='/api/register'?3:10,url.pathname==='/api/register'?3600000:900000);
        const body=await readBody(req);
        const email=normalizeEmail(body?.email), password=body?.password;
        if(!validEmail(email)||!validPassword(password)) throw new ApiError(400,'请填写有效邮箱和至少 12 位密码。');
        if(url.pathname==='/api/register') {
          if(db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new ApiError(409,'这个邮箱已注册，请直接登录。');
          const hash=await guardedHash(()=>hashPassword(password));
          const userId=randomId(), today=dayInShanghai(now());
          try { db.prepare('INSERT INTO users(id,email,password_hash,balance,claimed_date,created_at) VALUES(?,?,?,?,?,?)')
            .run(userId,email,hash,2,today,now().getTime()); }
          catch(error) { if(error.code==='ERR_SQLITE_CONSTRAINT_UNIQUE') throw new ApiError(409,'这个邮箱已注册，请直接登录。'); throw error; }
          const user=readUser(userId);
          newSession(res,user);
          return json(res,201,sessionPayload(user));
        }
        const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if(!user || !await guardedHash(()=>checkPassword(password,user.password_hash))) throw new ApiError(401,'邮箱或密码不正确。');
        const result=claim(user);
        newSession(res,result.user);
        return json(res,200,sessionPayload(result.user,result.granted));
      }
      const user=sessionUser(req);
      if(!user) throw new ApiError(401,'请先登录。');
      if(url.pathname==='/api/logout') {
        const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        if(token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
        res.setHeader('Set-Cookie',sessionCookie('',0));
        return json(res,200,{ authenticated:false });
      }
      if(url.pathname==='/api/readings') {
        const body=await readBody(req);
        return json(res,200,completeReading(user,body?.id,body?.spread));
      }
      throw new ApiError(404,'Not found');
    } catch(error) {
      if(!res.headersSent) json(res,error.status||500,{ error:error.status?error.message:'服务器暂时无法处理请求。' });
    }
  };
  const server=createServer(handler);
  return { server, db, close:()=>new Promise((resolveClose,reject)=>server.close(error=>{
    db.close(); error?reject(error):resolveClose();
  })) };
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const path=process.env.LUNA_DB_PATH || join(root,'server','data','luna.sqlite');
  await mkdir(dirname(path),{ recursive:true, mode:0o700 });
  const { server }=createLunaServer({ databasePath:path });
  const port=Number(process.env.PORT||3000), host=process.env.HOST||'127.0.0.1';
  server.listen(port,host,()=>console.log(`LUNA listening on ${host}:${port}`));
}
