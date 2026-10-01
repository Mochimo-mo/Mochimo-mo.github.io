import test from 'node:test';
import assert from 'node:assert/strict';
import { createLunaServer } from './index.mjs';

test('account gift, daily claim, server ledger, session and request protection', async () => {
  let clock=new Date('2026-10-01T12:00:00+08:00');
  let rolls=0;
  const {server,db,close}=createLunaServer({databasePath:':memory:',origin:'http://localhost:3000',
    now:()=>clock,roll:()=>{rolls++;return 0;}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let cookie='';
  const call=async (route,body,options={}) => {
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{
      ...(body===undefined?{}:{Origin:options.origin||'http://localhost:3000','Content-Type':'application/json'}),
      ...(options.cookie===false?{}:cookie?{Cookie:cookie}:{})
    },body:body===undefined?undefined:JSON.stringify(body)});
    if(response.headers.get('set-cookie') && options.saveCookie!==false) cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,headers:response.headers,data:await response.json()};
  };
  try {
    const homepage=await fetch(base+'/');
    assert.equal(homepage.status,200);
    assert.match(await homepage.text(),/app\.js\?v=20261001-32/);
    assert.equal((await fetch(base+'/server/index.mjs')).status,404);
    const artwork=await fetch(base+'/assets/cardback.webp');
    assert.equal(artwork.status,200);
    assert.equal(artwork.headers.get('content-type'),'image/webp');
    let result=await call('/api/session');
    assert.equal(result.data.authenticated,false);
    result=await call('/api/register',{email:'  CAT@example.com ',password:'correct horse battery staple'});
    assert.equal(result.status,201);
    assert.equal(result.data.wallet.balance,2);
    assert.equal(result.data.granted,false);
    assert.match(result.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    const userId=result.data.account.id;
    const stored=db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash;
    assert.match(stored,/^scrypt\$/);
    assert.ok(!stored.includes('correct horse'));
    const originalCookie=cookie;

    assert.equal((await call('/api/register',{email:'cat@example.com',password:'correct horse battery staple'})).status,409);
    assert.equal((await call('/api/readings',{id:'reading-1',spread:'single'},{origin:'https://evil.example'})).status,403);
    result=await call('/api/readings',{id:'reading-1',spread:'single'});
    assert.equal(result.data.spent,true);
    assert.equal(result.data.rewarded,true);
    assert.equal(result.data.wallet.balance,2);
    result=await call('/api/readings',{id:'reading-1',spread:'single'});
    assert.equal(result.data.wallet.balance,2);
    assert.equal(rolls,1);
    result=await call('/api/readings',{id:'reading-2',spread:'three'});
    assert.equal(result.data.spent,true);
    assert.equal(result.data.rewarded,false);
    assert.equal(result.data.wallet.balance,1);
    assert.equal(rolls,1);
    result=await call('/api/readings',{id:'reading-3',spread:'daily'});
    assert.equal(result.data.spent,false);
    assert.equal(result.data.wallet.balance,1);
    assert.equal((await call('/api/readings',{id:'reading-4',spread:'daily'})).status,409);
    result=await call('/api/session');
    assert.equal(result.data.dailyDone,true);
    assert.equal(result.data.wallet.balance,1);
    result=await call('/api/readings',{id:'reading-6',spread:'decision'});
    assert.equal(result.data.wallet.balance,0);
    assert.equal((await call('/api/readings',{id:'reading-7',spread:'single'})).status,402);

    result=await call('/api/logout',{});
    assert.equal(result.status,200);
    assert.equal((await call('/api/session')).data.authenticated,false);
    assert.equal((await call('/api/readings',{id:'reading-5',spread:'single'},{cookie:false})).status,401);
    result=await call('/api/login',{email:'cat@example.com',password:'wrong password here'});
    assert.equal(result.status,401);
    result=await call('/api/login',{email:'cat@example.com',password:'correct horse battery staple'});
    assert.equal(result.status,200);
    assert.notEqual(cookie,originalCookie);
    assert.equal(result.data.wallet.balance,0);
    clock=new Date('2026-10-02T08:01:00+08:00');
    result=await call('/api/session');
    assert.equal(result.data.granted,true);
    assert.equal(result.data.wallet.balance,1);
    assert.equal((await call('/api/session')).data.wallet.balance,1);
    for(let day=3;day<=8;day++) {
      clock=new Date(`2026-10-${String(day).padStart(2,'0')}T08:01:00+08:00`);
      result=await call('/api/session');
    }
    assert.equal(result.data.wallet.balance,5);
    assert.equal(result.data.granted,false);
  } finally { await close(); }
});
