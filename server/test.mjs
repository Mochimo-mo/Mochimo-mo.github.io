import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createLunaServer } from './index.mjs';
import { catalogFromBrowser } from './build-catalog.mjs';
import { createStore } from './db.mjs';

const ORIGIN='http://localhost:3000';
const reading=(id,spread='single',cards=['fool'])=>({id,spread,question:'我应该先做什么？',cards,
  orientations:cards.map(()=> 'upright')});

test('server owns guest, account, crystal ledger and complete reading history', async () => {
  let clock=new Date('2026-10-01T12:00:00+08:00'),rolls=0,upstreamMessages;
  const oldKey=process.env.ZHIPU_API_KEY;
  process.env.ZHIPU_API_KEY='test-only-secret';
  const {server,db,close}=createLunaServer({databasePath:':memory:',origin:ORIGIN,now:()=>clock,
    roll:()=>{rolls++;return 0;},upstreamFetch:async(_url,options)=>{
      assert.equal(options.headers.Authorization,'Bearer test-only-secret');
      upstreamMessages=JSON.parse(options.body).messages;
      if(JSON.parse(options.body).stream) return new Response('data: {"choices":[{"delta":{"content":"先做一件小事。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      return Response.json({choices:[{message:{content:'先做一件小事。'}}]});
    }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const client=()=>{
    let cookie='';
    return async (path,body,method=body===undefined?'GET':'POST',options={})=>{
      const response=await fetch(base+path,{method,headers:{...(cookie&&!options.noCookie?{Cookie:cookie}:{}),
        ...(body===undefined?{}:{Origin:options.origin||ORIGIN,'Content-Type':'application/json'}),
        ...(options.accept?{Accept:options.accept}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      if(response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
      const data=response.headers.get('content-type')?.includes('text/event-stream')?await response.text():
        response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();
      return {status:response.status,data,headers:response.headers};
    };
  };
  const guest=client(),stranger=client();
  try {
    assert.equal((await fetch(base+'/')).status,200);
    assert.equal((await fetch(base+'/server/index.mjs')).status,404);
    assert.equal((await fetch(base+'/assets/cardback.webp')).headers.get('content-type'),'image/webp');
    let result=await guest('/api/bootstrap');
    assert.equal(result.data.guest,true);
    assert.equal(result.data.wallet.balance,1);
    assert.match(result.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    assert.equal((await guest('/api/bootstrap')).data.wallet.balance,1);

    result=await guest('/api/readings',reading('guest-one'));
    assert.equal(result.data.record.crystalSpent,true);
    assert.equal(result.data.record.crystalRewarded,true);
    assert.equal(result.data.wallet.balance,1);
    assert.equal((await guest('/api/readings',reading('guest-one'))).data.wallet.balance,1);
    assert.equal(rolls,1);
    assert.equal((await guest('/api/readings',reading('bad-one','single',['bogus']))).status,400);
    assert.equal((await guest('/api/readings',reading('guest-two','three',['fool','magician','sun']))).data.wallet.balance,0);
    assert.equal((await guest('/api/readings',reading('guest-three'))).status,402);
    result=await guest('/api/readings',reading('guest-daily','daily'));
    assert.equal(result.data.dailyDone,true);
    assert.equal((await guest('/api/readings',reading('guest-daily2','daily'))).status,409);
    assert.equal((await guest('/api/readings',reading('evil-one'),'POST',{origin:'https://evil.example'})).status,403);
    assert.equal((await guest('/api/calendar?month=2026-10')).data.readings[0].id,'guest-daily');
    assert.equal((await guest('/api/calendar')).status,400);
    assert.equal((await stranger('/api/readings/guest-one')).status,401);
    await stranger('/api/bootstrap');
    assert.equal((await stranger('/api/readings/guest-one')).status,404);

    result=await guest('/api/readings/guest-one',{note:'今天先列出选项。'},'PATCH');
    assert.equal(result.data.record.note,'今天先列出选项。');
    result=await guest('/api/readings/guest-one',{aiChat:[{role:'user',content:'下一步？'},{role:'assistant',content:'先列清单。'}]},'PATCH');
    assert.equal(result.data.record.aiChat.length,2);
    assert.equal((await guest('/api/readings/guest-one',{question:'overwrite'},'PATCH')).status,400);
    assert.ok((await guest('/api/readings?limit=1')).data.nextCursor);

    result=await guest('/api/register',{email:' CAT@example.com ',password:'correct horse battery staple'});
    assert.equal(result.status,201);
    assert.equal(result.data.wallet.balance,2);
    assert.equal(result.data.bonusGranted,2);
    assert.equal(result.data.readings.length,3);
    const stored=db.prepare('SELECT password_hash FROM luna_accounts WHERE owner_id=?').get(result.data.account.id);
    assert.match(stored.password_hash,/^scrypt\$/);
    assert.ok(!stored.password_hash.includes('correct horse'));

    result=await guest('/api/ai',{readingId:'guest-one',prompt:'我可以怎样开始？'});
    assert.equal(result.status,200);
    assert.match(upstreamMessages[1].content,/愚者/);
    assert.match(upstreamMessages[1].content,/我应该先做什么/);
    assert.equal(result.data.choices[0].message.content,'先做一件小事。');
    result=await guest('/api/ai',{readingId:'guest-one',prompt:'再说说？'},'POST',{accept:'text/event-stream'});
    assert.match(result.data,/"delta":"先做一件小事。"/);
    assert.match(result.data,/"done":true/);

    result=await guest('/api/logout',{});
    assert.equal(result.data.guest,true);
    assert.equal(result.data.wallet.balance,0);
    assert.equal(result.data.readings.length,0);
    assert.equal((await guest('/api/login',{email:'cat@example.com',password:'wrong password here'})).status,401);
    result=await guest('/api/login',{email:'cat@example.com',password:'correct horse battery staple'});
    assert.equal(result.data.readings.length,3);
    assert.equal(result.data.wallet.balance,2);
    clock=new Date('2026-10-02T09:01:00+08:00');
    result=await guest('/api/bootstrap');
    assert.equal(result.data.granted,true);
    assert.equal(result.data.wallet.balance,3);
    assert.equal((await guest('/api/bootstrap')).data.wallet.balance,3);
    const secondDevice=client();
    await secondDevice('/api/bootstrap');
    let migrated=await secondDevice('/api/readings',reading('other-guest'));
    assert.equal(migrated.status,200);
    migrated=await secondDevice('/api/login',{email:'cat@example.com',password:'correct horse battery staple'});
    assert.equal(migrated.data.readings.length,4);
    assert.equal(migrated.data.wallet.balance,3);
    assert.equal((await secondDevice('/api/readings/guest-one')).data.record.note,'今天先列出选项。');
    const archived={...reading('legacy-one'),createdAt:Date.parse('2026-09-20T00:00:00+08:00'),note:'旧站点里的想法'};
    migrated=await secondDevice('/api/import',{readings:[archived]});
    assert.equal(migrated.status,200,JSON.stringify(migrated.data));
    assert.equal(migrated.data.imported,1);
    assert.equal((await secondDevice('/api/import',{readings:[archived]})).data.skipped,1);
    assert.equal((await secondDevice('/api/readings/legacy-one')).data.record.note,'旧站点里的想法');
    assert.equal((await stranger('/api/import',{readings:[archived]})).status,403);
    for(let day=3;day<=6;day++) {
      clock=new Date(`2026-10-0${day}T09:01:00+08:00`);
      result=await guest('/api/bootstrap');
    }
    assert.equal(result.data.wallet.balance,5);
  } finally {
    await close();
    if(oldKey===undefined) delete process.env.ZHIPU_API_KEY;else process.env.ZHIPU_API_KEY=oldKey;
  }
});

test('server card catalog matches the browser cards and meanings',()=>{
  const source=catalogFromBrowser();
  const built=JSON.parse(readFileSync(new URL('./card-catalog.json',import.meta.url),'utf8'));
  assert.deepEqual(built,source);
  assert.equal(Object.keys(built).length,78);
});

test('prototype accounts migrate once and cannot resurrect after removal',async()=>{
  const parent=join(dirname(fileURLToPath(import.meta.url)),'data');
  await mkdir(parent,{recursive:true});
  const dir=await mkdtemp(join(parent,'migration-test-'));
  const path=join(dir,'luna.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,balance INTEGER,
      claimed_date TEXT,drop_date TEXT,created_at INTEGER);`);
    old.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('old-owner','old@example.com','scrypt$old$hash',4,'2026-10-01','',1000);
    old.close();
    let store=createStore(path);
    assert.equal(store.findAccount('old@example.com').balance,4);
    store.db.prepare('DELETE FROM luna_owners WHERE id=?').run('old-owner');
    store.close();
    store=createStore(path);
    assert.equal(store.findAccount('old@example.com'),null);
    store.close();
  } finally {await rm(dir,{recursive:true,force:true});}
});
