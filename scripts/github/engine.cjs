// Команда и её результат публикуются в одном git-коммите со снимком базы.
// Локальная SQL-транзакция всегда откатывается: это одноразовая рабочая копия.
'use strict';
const P=require('../../assets/github/protocol.js');
const S=require('../../assets/github/store.cjs');
const {processCommand}=require('./processor.cjs');
const {execute,actorContext}=require('./postgres.cjs');
const {decodeSnapshot,restoreDatabase,exportDatabase,encodeSnapshot}=require('./snapshot.cjs');
const {materialize}=require('./views.cjs');
async function command(signed,{db,repository,read,store,key,schemaHash,now=Date.now()}){
 const head=await repository.head();
 // read(path, head) обязательно читает этот коммит, не меняющуюся вершину ветки.
 const envelope=await read('data/v1/state.enc',head);
 const root=await S.openKey(envelope,key,{store,audience:'state',revision:envelope.revision});
 const profile=root.extra?.profiles?.[signed?.body?.actor];
 await P.verify(signed,profile,store,{now,checkTime:false});
 const snapshot=await decodeSnapshot(root,{store,key,schemaHash,read:path=>read(path,head)});
 await db.query('begin isolation level serializable');
 try{
  // Пометка должна быть поставлена доверенным запуском рабочего окружения заранее.
  await restoreDatabase(db,snapshot);
  await actorContext(db,profile);await db.query('reset role');
  const ledger={...root.extra.ledger};
  return await processCommand(signed,{store,profiles:root.extra.profiles,ledger,now,
   run:async(actor,operation,accept)=>{
    await db.query('savepoint operation');let result;
    try{result={ok:true,data:await execute(db,actor,operation)};await db.query('reset role');await db.query('release savepoint operation');}
    catch(e){
     await db.query('rollback to savepoint operation');await db.query('reset role');await db.query('release savepoint operation');
     // Текст SQL-ошибки может содержать данные. Он не попадает в журнал Actions.
     result={ok:false,error:{code:/^[A-Z0-9_]{2,60}$/.test(e.code||'')?e.code:'COMMAND_FAILED'}};
    }
    return accept(result);
   },
   commit:async({key:operationKey,entry,operationId})=>{
    const visible=await materialize(db,{store,profiles:root.extra.profiles,previous:root.extra.views});
    const state=await exportDatabase(db);
    const next=await encodeSnapshot(state,{store,key,schemaHash,previous:root,extra:{...root.extra,views:visible.views,ledger:{...ledger,[operationKey]:entry}}});
    next.files.push(...visible.files);
    // Ответ читает только инициатор. Факт готовности виден лишь после того же коммита.
    const audience=profile.id+'_'+operationId;
    next.files.push({path:'data/v1/receipts/'+audience+'.enc',envelope:await S.sealKey(entry,profile.readKey,{store,audience,revision:1})});
    await repository.commit(head,next.files,operationId);
   }
  });
 }finally{await db.query('rollback');}
}
module.exports={command};
