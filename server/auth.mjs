import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError } from './db.mjs';

const derive=promisify(scrypt);
const OPTIONS={N:131072,r:8,p:1,maxmem:256*1024*1024};
const SESSION_AGE=30*86400;
const sha256=text=>createHash('sha256').update(text).digest('hex');

export const normalizeEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
export const validEmail=value=>value.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validPassword=value=>typeof value==='string'&&value.length>=12&&value.length<=128&&Buffer.byteLength(value,'utf8')<=256;
export const hashPassword=async (password,salt=randomBytes(16))=>{
  const hash=await derive(password,salt,64,OPTIONS);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
};
export const checkPassword=async (password,stored)=>{
  const [,salt,expected]=stored.split('$');
  const actual=await derive(password,Buffer.from(salt,'base64url'),64,OPTIONS);
  return timingSafeEqual(actual,Buffer.from(expected,'base64url'));
};

export function createAuth(store,{origin,now=()=>new Date()}={}) {
  const secure=new URL(origin).protocol==='https:';
  const name=secure?'__Host-luna_session':'luna_session';
  const cookie=(token,maxAge)=>`${name}=${token}; Path=/; HttpOnly; SameSite=Strict; ${secure?'Secure; ':''}Max-Age=${maxAge}`;
  const sessionToken=req=>req.headers.cookie?.split(';').map(x=>x.trim())
    .find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
  const sessionHash=req=>{
    const token=sessionToken(req);
    return /^[A-Za-z0-9_-]{43}$/.test(token)?sha256(token):null;
  };
  const owner=req=>store.sessionOwner(sessionHash(req));
  const requireOwner=req=>{
    const found=owner(req);
    if(!found) throw new ApiError(401,'会话已失效，请刷新页面。');
    return found;
  };
  const issue=(res,ownerId)=>{
    const token=randomBytes(32).toString('base64url');
    store.addSession(sha256(token),ownerId,now().getTime()+SESSION_AGE*1000);
    res.setHeader('Set-Cookie',cookie(token,SESSION_AGE));
  };
  const rotate=(req,res,ownerId)=>{store.deleteSession(sessionHash(req));issue(res,ownerId);};
  return {owner,requireOwner,issue,rotate,cookie,sessionHash};
}
