import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export class ApiError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}

const MAX=5;
const COUNTS={ daily:1, single:1, three:3, decision:3 };
const id=()=>randomBytes(24).toString('base64url');
export const dayInShanghai=date=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export function createStore(path,{now=()=>new Date(),roll=()=>Math.floor(Math.random()*5),cardIds=new Set()}={}) {
  const db=new DatabaseSync(path,{timeout:5000});
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS luna_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS luna_owners (
      id TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance BETWEEN 0 AND 5),
      claimed_date TEXT NOT NULL, drop_date TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS luna_accounts (
      owner_id TEXT PRIMARY KEY REFERENCES luna_owners(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS luna_sessions (
      token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES luna_owners(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS luna_sessions_expiry ON luna_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS luna_readings (
      owner_id TEXT NOT NULL REFERENCES luna_owners(id) ON DELETE CASCADE,
      id TEXT NOT NULL, spread TEXT NOT NULL, day TEXT NOT NULL,
      created_at INTEGER NOT NULL, spent INTEGER NOT NULL, rewarded INTEGER NOT NULL,
      data_json TEXT NOT NULL, PRIMARY KEY(owner_id,id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS luna_daily_once
      ON luna_readings(owner_id,day) WHERE spread='daily';
    CREATE INDEX IF NOT EXISTS luna_readings_order
      ON luna_readings(owner_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS luna_calendar
      ON luna_readings(owner_id,spread,day);`);

  // Preserve accounts from the earlier self-host prototype if its database was used.
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get() &&
    !db.prepare("SELECT 1 FROM luna_meta WHERE key='legacy_accounts_migrated'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for(const user of db.prepare('SELECT * FROM users').all()) {
        db.prepare('INSERT OR IGNORE INTO luna_owners(id,balance,claimed_date,drop_date,created_at) VALUES(?,?,?,?,?)')
          .run(user.id,user.balance,user.claimed_date,user.drop_date,user.created_at);
        db.prepare('INSERT OR IGNORE INTO luna_accounts(owner_id,email,password_hash,created_at) VALUES(?,?,?,?)')
          .run(user.id,user.email,user.password_hash,user.created_at);
      }
      // Existing accounts migrate; old sessions are deliberately not copied because
      // repeating that migration on restart would reactivate previously logged-out tokens.
      db.prepare("INSERT INTO luna_meta(key,value) VALUES('legacy_accounts_migrated','1')").run();
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK');db.close();throw error; }
  }

  const day=()=>dayInShanghai(now());
  const one=(ownerId)=>db.prepare(`SELECT o.*,a.email FROM luna_owners o
    LEFT JOIN luna_accounts a ON a.owner_id=o.id WHERE o.id=?`).get(ownerId)||null;
  const wallet=owner=>({balance:owner.balance,max:MAX,claimedDate:owner.claimed_date});
  const account=owner=>owner?.email?{id:owner.id,email:owner.email}:null;
  const asRecord=row=>{
    const data=JSON.parse(row.data_json);
    return {...data,id:row.id,spread:row.spread,day:row.day,createdAt:row.created_at,
      crystalSpent:row.spent===1,crystalRewarded:row.rewarded===1,
      crystalDropChecked:true,crystalServerSettled:true};
  };
  const transaction=callback=>{
    db.exec('BEGIN IMMEDIATE');
    try {const result=callback();db.exec('COMMIT');return result;}
    catch(error) {db.exec('ROLLBACK');throw error;}
  };
  const getReading=(ownerId,readingId)=>{
    const row=db.prepare('SELECT * FROM luna_readings WHERE owner_id=? AND id=?').get(ownerId,readingId);
    return row?asRecord(row):null;
  };
  const dailyRecord=ownerId=>{
    const row=db.prepare("SELECT * FROM luna_readings WHERE owner_id=? AND day=? AND spread='daily'").get(ownerId,day());
    return row?asRecord(row):null;
  };
  const encodeCursor=row=>Buffer.from(JSON.stringify([row.created_at,row.id])).toString('base64url');
  const listReadings=(ownerId,{before,limit=100,month}={})=>{
    if(month) {
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400,'月份格式错误。');
      return {readings:db.prepare("SELECT * FROM luna_readings WHERE owner_id=? AND spread='daily' AND day LIKE ? ORDER BY day DESC")
        .all(ownerId,month+'-%').map(asRecord),nextCursor:null};
    }
    const pageSize=Math.min(100,Math.max(1,Number(limit)||100));
    let cursor=null;
    if(before) {
      try {cursor=JSON.parse(Buffer.from(before,'base64url').toString());} catch {}
      if(!Array.isArray(cursor)||!Number.isSafeInteger(cursor[0])||typeof cursor[1]!=='string') throw new ApiError(400,'翻页位置无效。');
    }
    const rows=cursor
      ?db.prepare('SELECT * FROM luna_readings WHERE owner_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?').all(ownerId,cursor[0],cursor[0],cursor[1],pageSize+1)
      :db.prepare('SELECT * FROM luna_readings WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(ownerId,pageSize+1);
    const selected=rows.slice(0,pageSize);
    return {readings:selected.map(asRecord),nextCursor:rows.length>pageSize?encodeCursor(selected.at(-1)):null};
  };
  const snapshot=(owner,granted=false)=>{
    const list=listReadings(owner.id);
    const today=dailyRecord(owner.id);
    return {authenticated:!!owner.email,account:account(owner),guest:!owner.email,
      wallet:wallet(owner),granted,serverDate:day(),dailyDone:!!today,dailyRecord:today,
      readings:list.readings,nextCursor:list.nextCursor};
  };
  const createGuest=(balance=1)=>transaction(()=>{
    const ownerId=id();
    db.prepare('INSERT INTO luna_owners(id,balance,claimed_date,created_at) VALUES(?,?,?,?)')
      .run(ownerId,balance,day(),now().getTime());
    return one(ownerId);
  });
  const claim=ownerId=>transaction(()=>{
    const current=one(ownerId);
    if(!current) throw new ApiError(401,'会话已失效，请刷新页面。');
    if(current.claimed_date===day()) return {owner:current,granted:false};
    db.prepare('UPDATE luna_owners SET balance=MIN(balance+1,5),claimed_date=? WHERE id=?').run(day(),ownerId);
    return {owner:one(ownerId),granted:current.balance<MAX};
  });
  const sessionOwner=tokenHash=>{
    if(!tokenHash) return null;
    const row=db.prepare('SELECT owner_id FROM luna_sessions WHERE token_hash=? AND expires_at>?')
      .get(tokenHash,now().getTime());
    return row?one(row.owner_id):null;
  };
  const addSession=(hash,ownerId,expiresAt)=>db.prepare('INSERT INTO luna_sessions(token_hash,owner_id,expires_at) VALUES(?,?,?)').run(hash,ownerId,expiresAt);
  const deleteSession=hash=>{if(hash) db.prepare('DELETE FROM luna_sessions WHERE token_hash=?').run(hash);};
  const findAccount=email=>db.prepare('SELECT a.*,o.balance FROM luna_accounts a JOIN luna_owners o ON o.id=a.owner_id WHERE a.email=?').get(email)||null;
  const register=(guestId,email,passwordHash)=>transaction(()=>{
    const guest=one(guestId);
    if(!guest||guest.email) throw new ApiError(409,'请先退出当前账号。');
    if(findAccount(email)) throw new ApiError(409,'这个邮箱已注册，请直接登录。');
    db.prepare('INSERT INTO luna_accounts(owner_id,email,password_hash,created_at) VALUES(?,?,?,?)')
      .run(guestId,email,passwordHash,now().getTime());
    const bonus=Math.min(2,MAX-guest.balance);
    db.prepare('UPDATE luna_owners SET balance=balance+? WHERE id=?').run(bonus,guestId);
    return {owner:one(guestId),bonus};
  });
  const mergeGuest=(guestId,accountId)=>transaction(()=>{
    if(!guestId||guestId===accountId||one(guestId)?.email) return;
    const rows=db.prepare('SELECT * FROM luna_readings WHERE owner_id=? ORDER BY created_at ASC').all(guestId);
    for(const row of rows) db.prepare(`INSERT OR IGNORE INTO luna_readings
      (owner_id,id,spread,day,created_at,spent,rewarded,data_json) VALUES(?,?,?,?,?,?,?,?)`)
      .run(accountId,row.id,row.spread,row.day,row.created_at,row.spent,row.rewarded,row.data_json);
    db.prepare('DELETE FROM luna_owners WHERE id=?').run(guestId);
  });
  const validateReading=input=>{
    const {id:readingId,spread,question,cards,orientations}=input||{};
    if(typeof readingId!=='string'||!/^[A-Za-z0-9_-]{8,90}$/.test(readingId)||!COUNTS[spread] ||
      typeof question!=='string'||question.length>1000||!Array.isArray(cards)||cards.length!==COUNTS[spread]||
      new Set(cards).size!==cards.length||cards.some(card=>typeof card!=='string'||!cardIds.has(card))||
      !Array.isArray(orientations)||orientations.length!==cards.length||
      orientations.some(value=>value!=='upright'&&value!=='reversed'))
      throw new ApiError(400,'占卜资料无效，请刷新网页后重试。');
    return {id:readingId,spread,question:question.trim(),cards,orientations};
  };
  const completeReading=(ownerId,input)=>{
    const valid=validateReading(input);
    return transaction(()=>{
      const previous=getReading(ownerId,valid.id);
      if(previous) return {record:previous,wallet:wallet(one(ownerId)),dailyDone:!!dailyRecord(ownerId)};
      const owner=one(ownerId);
      if(!owner) throw new ApiError(401,'会话已失效，请刷新页面。');
      if(valid.spread==='daily' && dailyRecord(ownerId)) throw new ApiError(409,'今天的每日一牌已经完成，可以从日历回看。');
      const spent=valid.spread!=='daily';
      if(spent && owner.balance<1) throw new ApiError(402,'水晶不足，明天首次打开会再获得 1 颗。');
      const next=owner.balance-(spent?1:0);
      const rewarded=owner.drop_date!==day() && next<MAX && roll()===0;
      db.prepare('UPDATE luna_owners SET balance=?,drop_date=? WHERE id=?')
        .run(next+(rewarded?1:0),rewarded?day():owner.drop_date,ownerId);
      const timestamp=now().getTime();
      const data={question:valid.question,cards:valid.cards,orientations:valid.orientations,note:'',aiChat:[]};
      db.prepare(`INSERT INTO luna_readings
        (owner_id,id,spread,day,created_at,spent,rewarded,data_json) VALUES(?,?,?,?,?,?,?,?)`)
        .run(ownerId,valid.id,valid.spread,day(),timestamp,spent?1:0,rewarded?1:0,JSON.stringify(data));
      return {record:getReading(ownerId,valid.id),wallet:wallet(one(ownerId)),dailyDone:!!dailyRecord(ownerId)};
    });
  };
  const updateReading=(ownerId,readingId,changes)=>transaction(()=>{
    const current=getReading(ownerId,readingId);
    if(!current) throw new ApiError(404,'找不到这次阅读。');
    const keys=Object.keys(changes||{});
    if(keys.length!==1||!['note','aiChat'].includes(keys[0])) throw new ApiError(400,'只能更新笔记或对话。');
    if(keys[0]==='note') {
      if(typeof changes.note!=='string'||changes.note.length>5000) throw new ApiError(400,'笔记太长。');
      current.note=changes.note;
    } else {
      const chat=changes.aiChat;
      if(!Array.isArray(chat)||chat.length>24||chat.some(item=>!item||!['user','assistant'].includes(item.role)||
        typeof item.content!=='string'||!item.content.trim()||item.content.length>4000)||
        chat.reduce((sum,item)=>sum+item.content.length,0)>24000) throw new ApiError(400,'对话内容过长。');
      current.aiChat=chat.map(item=>({role:item.role,content:item.content}));
    }
    const data={question:current.question,cards:current.cards,orientations:current.orientations,
      note:current.note||'',aiChat:current.aiChat||[]};
    db.prepare('UPDATE luna_readings SET data_json=? WHERE owner_id=? AND id=?').run(JSON.stringify(data),ownerId,readingId);
    return getReading(ownerId,readingId);
  });
  const importReadings=(ownerId,input)=>{
    if(!Array.isArray(input)||input.length<1||input.length>20) throw new ApiError(400,'每批可导入 1 到 20 条记录。');
    if(!one(ownerId)?.email) throw new ApiError(403,'请先注册或登录，再导入旧记录。');
    const prepared=input.map(raw=>{
      if(!raw||typeof raw!=='object') throw new ApiError(400,'旧记录格式有误，请检查导出文件。');
      const valid=validateReading(raw);
      const timestamp=raw.createdAt;
      if(!Number.isSafeInteger(timestamp)||timestamp<1577836800000||timestamp>now().getTime()+86400000 ||
        typeof raw.note!=='string'&&raw.note!==undefined || (raw.note||'').length>5000 ||
        (raw.aiChat!==undefined && (!Array.isArray(raw.aiChat)||raw.aiChat.length>24||
          raw.aiChat.some(item=>!item||!['user','assistant'].includes(item.role)||
            typeof item.content!=='string'||item.content.length>4000))))
        throw new ApiError(400,'旧记录格式有误，请检查导出文件。');
      const chat=(raw.aiChat||[]).map(item=>({role:item.role,content:item.content}));
      if(chat.reduce((sum,item)=>sum+item.content.length,0)>24000) throw new ApiError(400,'旧记录对话过长。');
      return {valid,timestamp,day:dayInShanghai(new Date(timestamp)),
        data:{question:valid.question,cards:valid.cards,orientations:valid.orientations,
          note:raw.note||'',aiChat:chat,legacyImported:true}};
    });
    return transaction(()=>{
      const total=db.prepare('SELECT COUNT(*) AS count FROM luna_readings WHERE owner_id=?').get(ownerId).count;
      if(total+prepared.length>2000) throw new ApiError(413,'记录数量达到上限，请联系站点管理员。');
      let imported=0;
      for(const item of prepared) {
        const changed=db.prepare(`INSERT OR IGNORE INTO luna_readings
          (owner_id,id,spread,day,created_at,spent,rewarded,data_json) VALUES(?,?,?,?,?,0,0,?)`)
          .run(ownerId,item.valid.id,item.valid.spread,item.day,item.timestamp,JSON.stringify(item.data)).changes;
        imported+=changed;
      }
      return {imported,skipped:prepared.length-imported};
    });
  };
  return {db,day,one,wallet,account,snapshot,createGuest,claim,sessionOwner,addSession,deleteSession,
    findAccount,register,mergeGuest,getReading,dailyRecord,listReadings,completeReading,updateReading,importReadings,
    close:()=>db.close()};
}
