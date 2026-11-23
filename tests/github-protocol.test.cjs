'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),P=require('../assets/github/protocol.js');
const {processCommand}=require('../scripts/github/processor.cjs');
const actor='11111111-1111-4111-8111-111111111111',op='22222222-2222-4222-8222-222222222222',store='fixture';
const body=()=>({format:P.FORMAT,store,actor,operationId:op,epoch:1,issuedAt:new Date().toISOString(),operation:{type:'rpc',name:'set_payout_paid',args:{p_paid:true}}});
async function fixture(){const id=await P.identity();return {id,profile:{id:actor,active:true,epoch:1,publicKey:id.publicKey},signed:await P.sign(body(),id.privateKey)};}
test('Подделка тела, чужой ключ, магазин и отзыв доступа запрещены',async()=>{
 const {id,profile,signed}=await fixture();assert.equal((await P.verify(signed,profile,store)).actor,actor);
 for(const patch of [{actor:op},{operation:{type:'rpc',name:'delete_docs'}},{epoch:2}])await assert.rejects(P.verify({...signed,body:{...signed.body,...patch}},profile,store));
 await assert.rejects(P.verify(signed,{...profile,active:false},store));
 await assert.rejects(P.verify(signed,{...profile,publicKey:(await P.identity()).publicKey},store));
 await assert.rejects(P.verify(signed,profile,'other'));
});
test('Команда не раскрывает сведения в публичной очереди',async()=>{
 const {signed}=await fixture(),keys=await P.brokerKeys();
 const packed=await P.pack(signed,keys.publicKey,store),text=JSON.stringify(packed);
 assert.ok(!text.includes(actor)&&!text.includes('set_payout_paid')&&!text.includes('p_paid'));
 assert.deepEqual(await P.unpack(packed,keys.privateKey,store),signed);
 await assert.rejects(P.unpack(packed,keys.privateKey,'other'));
});
test('Ключ получателя и контекст зашифрованного ответа не взаимозаменяемы',async()=>{
 const a=crypto.getRandomValues(new Uint8Array(32)),b=crypto.getRandomValues(new Uint8Array(32));
 const e=await P.sealKey({amount:'15000.50'},a,{store,actor,op});
 assert.deepEqual(await P.openKey(e,a,{store,actor,op}),{amount:'15000.50'});
 await assert.rejects(P.openKey(e,b,{store,actor,op}));await assert.rejects(P.openKey(e,a,{store,actor:op,op}));
});
test('Повтор команды возвращает сохранённый ответ без второй выдачи',async()=>{
 const {signed,profile}=await fixture(),ledger={};let runs=0,commits=0;
 const ctx={store,profiles:{[actor]:profile},ledger,run:async(p,o,finish)=>{runs++;return finish({paid:true});},commit:async()=>{commits++;}};
 assert.equal((await processCommand(signed,ctx)).duplicate,false);
 assert.equal((await processCommand(signed,ctx)).duplicate,true);assert.equal(runs,1);assert.equal(commits,1);
});
test('Один идентификатор с другим содержимым не повторяет эффект',async()=>{
 const {signed,profile,id}=await fixture(),ledger={};
 const ctx={store,profiles:{[actor]:profile},ledger,run:async(p,o,f)=>f({ok:true}),commit:async()=>{}};
 await processCommand(signed,ctx);const changed=await P.sign({...signed.body,operation:{type:'rpc',name:'other'}},id.privateKey);
 await assert.rejects(processCommand(changed,ctx),{code:'IDEMPOTENCY_CONFLICT'});
});
test('Ошибка долговременного сохранения не отмечает операцию завершённой',async()=>{
 const {signed,profile}=await fixture(),ledger={};
 await assert.rejects(processCommand(signed,{store,profiles:{[actor]:profile},ledger,run:async(p,o,f)=>f({paid:true}),commit:async()=>{throw P.error('COMMIT_UNKNOWN');}}),{code:'COMMIT_UNKNOWN'});
 assert.equal(Object.keys(ledger).length,0);
});
test('Просроченный новый запрос не исполняется, подтверждённый повтор остаётся идемпотентным',async()=>{
 const {signed,profile}=await fixture(),ledger={};const ctx={store,profiles:{[actor]:profile},ledger,run:async(p,o,f)=>f({ok:true}),commit:async()=>{}};
 await processCommand(signed,ctx);assert.equal((await processCommand(signed,{...ctx,now:Date.now()+2*86400000})).duplicate,true);
 await assert.rejects(processCommand(signed,{...ctx,ledger:{},now:Date.now()+2*86400000}),{code:'COMMAND_EXPIRED'});
});
