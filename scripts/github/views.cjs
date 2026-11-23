// Персональные наборы для чтения без ожидания Actions. Права определяет PostgreSQL.
'use strict';
const {createHmac}=require('node:crypto');
const P=require('../../assets/github/protocol.js'),S=require('../../assets/github/store.cjs');
const {actorContext,execute,TABLES}=require('./postgres.cjs');
const hash=(key,value)=>createHmac('sha256',P.un64(key,32)).update('sverka-view-v1\0').update(S.canonical(value)).digest('hex');
async function materialize(db,{store,profiles,previous={}}){
 const files=[],views={};
 for(const profile of Object.values(profiles)){
  if(!/^[a-f0-9-]{36}$/i.test(profile.id))throw P.error('INVALID_PROFILE');
  const old=previous[profile.id],parts={},tables={};let bootstrap,revoked=!profile.active;
  await db.query('savepoint read_view');
  try{
   if(!revoked){
    const role=await actorContext(db,profile);await db.query('reset role');
    const name=profile.kind==='staff'?'app_bootstrap':profile.kind==='rep'?'my_rep_data':profile.kind==='link'?'get_rep_data':'get_payout_schedule';
    bootstrap=await execute(db,profile,{type:'rpc',name});await db.query('reset role');
    if(profile.kind==='staff'){
     await actorContext(db,profile);
     for(const [table,roles]of Object.entries(TABLES)){
      if(!roles.includes(role))continue;
      // Имена — только из констант кода, данные — через RLS текущего сотрудника.
      const rows=(await db.query('select row_to_json(r)::text as data from public."'+table+'" r order by to_jsonb(r)::text')).rows;
      const buckets=Array.from({length:16},()=>[]);
      for(const row of rows){const value=JSON.parse(row.data),id=value.id??value.rep_id??value.user_id;
       const bucket=parseInt(require('node:crypto').createHash('sha256').update(String(id)).digest('hex').slice(0,2),16)%16;buckets[bucket].push(row.data);}
      tables[table]=[];
      for(let i=0;i<16;i++){const id=table+'_'+i;parts[id]=buckets[i];tables[table].push(id);}
     }
     await db.query('reset role');
    }
   }
   await db.query('release savepoint read_view');
  }catch(e){
   await db.query('rollback to savepoint read_view');await db.query('reset role');await db.query('release savepoint read_view');
   if(!['ACCESS_DENIED','42501'].includes(e.code))throw e;revoked=true;bootstrap=null;
  }
  if(revoked){for(const k of Object.keys(parts))delete parts[k];for(const k of Object.keys(tables))delete tables[k];bootstrap=null;}
  const chunks={};
  for(const [id,data]of Object.entries(parts)){
   const digest=hash(profile.readKey,data),prior=old?.chunks?.[id];
   if(prior?.hash===digest&&old.epoch===profile.epoch){chunks[id]=prior;continue;}
   if(data.length===0){chunks[id]={empty:true,hash:digest};continue;}
   const revision=(prior?.revision||0)+1,audience=profile.id+'_'+id,path='data/v1/views/'+audience+'.enc';
   chunks[id]={path,audience,revision,hash:digest};
   files.push({path,envelope:await S.sealKey(data,profile.readKey,{store,audience,revision})});
  }
  const data={actor:profile.id,epoch:profile.epoch,revoked,bootstrap:bootstrap??null,tables,chunks},digest=hash(profile.readKey,data);
  if(old?.hash===digest&&old.epoch===profile.epoch){views[profile.id]=old;continue;}
  const revision=(old?.revision||0)+1,path='data/v1/views/'+profile.id+'.enc';
  views[profile.id]={path,revision,epoch:profile.epoch,hash:digest,chunks};
  files.push({path,envelope:await S.sealKey(data,profile.readKey,{store,audience:profile.id,revision})});
 }
 return {files,views};
}
module.exports={materialize};
