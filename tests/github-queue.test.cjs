'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const P=require('../assets/github/protocol.js'),S=require('../assets/github/store.cjs'),{Queue}=require('../assets/github/queue.js');
let keys;const broker=async()=>keys||(keys=await P.brokerKeys());
async function fixture(options={}){
 const identity=await P.identity(),k=await broker(),map=new Map(),receipts=new Map(),sent=[];
 const profile={id:randomUUID(),epoch:1,...identity,readKey:randomBytes(32).toString('base64')};
 const storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const config={store:'test',profile,brokerPublicKey:k.publicKey,storage,send:async e=>{sent.push(e);return sent.length;},readReceipt:async a=>receipts.get(a)||null,...options};
 const queue=new Queue(config);
 async function response(id,result={ok:true,data:{status:'paid'}}){const item=queue.load(id),audience=profile.id+'_'+id;receipts.set(audience,await S.sealKey({fingerprint:item.fingerprint,result},profile.readKey,{store:'test',audience,revision:1}));}
 return {queue,config,map,receipts,sent,response};
}
test('Отправленная команда остаётся ожидающей; секреты и открытые данные не сохраняются на устройстве',async()=>{
 const f=await fixture();const r=await f.queue.submit({type:'test',full_name:'Тестовый поставщик',amount:'12345.67'});
 assert.equal(r.status,'pending');assert.equal((await f.queue.check(r.id)).status,'pending');
 const saved=JSON.stringify([...f.map.values()]);for(const secret of ['Тестовый поставщик','12345.67',f.config.profile.privateKey.d,f.config.profile.readKey])assert.ok(!saved.includes(secret));
 assert.equal(f.sent.length,1);
});
test('Подтверждение появляется только из шифрованного ответа того же запроса',async()=>{
 const f=await fixture(),r=await f.queue.submit({type:'test'});await f.response(r.id);
 const result=await f.queue.check(r.id);assert.equal(result.status,'confirmed');assert.equal(f.map.size,0);
});
test('Отказ не выглядит как подтверждённая выплата',async()=>{
 const f=await fixture(),r=await f.queue.submit({type:'test'});await f.response(r.id,{ok:false,error:{code:'40001'}});
 const result=await f.queue.check(r.id);assert.equal(result.status,'rejected');assert.equal(result.result.error.code,'40001');
});
test('Потерянный ответ отправки сохраняет тот же подписанный запрос для повтора',async()=>{
 const f=await fixture({send:async()=>{throw new Error('network');}});let id;
 await assert.rejects(f.queue.submit({type:'test'}),e=>{id=e.operationId;return e.code==='QUEUE_SEND_UNKNOWN';});
 const pending=f.queue.load(id),signedEnvelope=JSON.stringify(pending.envelope);let seen;
 const resumed=new Queue({...f.config,send:async envelope=>{seen=JSON.stringify(envelope);return 2;}});
 assert.equal((await resumed.dispatch(id)).id,id);assert.equal(seen,signedEnvelope);
});
test('Нельзя отправить команду, если невозможно сохранить её на устройстве',async()=>{
 let called=false;const f=await fixture({storage:{setItem:()=>{throw new Error('quota');}},send:async()=>{called=true;return 1;}});
 await assert.rejects(f.queue.submit({type:'test'}),{code:'LOCAL_STORAGE_FAILED'});assert.equal(called,false);
});
test('Подмена ответа другой операции не подтверждает текущую',async()=>{
 const f=await fixture(),a=await f.queue.submit({type:'a'}),b=await f.queue.submit({type:'b'});await f.response(a.id);
 f.receipts.set(f.config.profile.id+'_'+b.id,f.receipts.get(f.config.profile.id+'_'+a.id));
 await assert.rejects(f.queue.check(b.id),{code:'INVALID_RECEIPT'});assert.ok(f.queue.load(b.id));
});
