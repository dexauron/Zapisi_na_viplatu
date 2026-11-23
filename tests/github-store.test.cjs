'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {canonical,digest,seal,open,Repository}=require('../assets/github/store.cjs');
const password='Только-вымышленный-пароль-123', meta={store:'fixture',audience:'rep_1',revision:1};
let env;
test('Шифрование не содержит ФИО, сумм и токенов; точное восстановление',async()=>{
 const data={name:'Тестовый торговый',amount:'15000.50',token:'FAKE-ACCESS'};
 env=await seal(data,password,meta); const text=JSON.stringify(env);
 assert.ok(!text.includes(data.name)&&!text.includes(data.amount)&&!text.includes(data.token));
 assert.deepEqual(await open(env,password,meta),data);
});
test('Чужая роль, магазин, версия, пароль и изменённый шифртекст отвергаются',async()=>{
 const e=await seal({amount:100},password,meta);
 for(const x of [{...meta,audience:'owner'},{...meta,store:'other'},{...meta,revision:2}]) await assert.rejects(open(e,password,x));
 await assert.rejects(open(e,'Другой-вымышленный-пароль',meta));
 const b=Buffer.from(e.ciphertext,'base64');b[0]^=1;await assert.rejects(open({...e,ciphertext:b.toString('base64')},password,meta));
});
test('Слабый пароль и неограниченная работа KDF не принимаются',async()=>{
 await assert.rejects(seal({},'123',meta));
 const e=await seal({},password,meta);await assert.rejects(open({...e,iterations:2000000000},password,meta));
});
test('Канонический хеш не зависит от порядка свойств; NaN не сохраняется',async()=>{
 assert.equal(await digest({b:2,a:1}),await digest({a:1,b:2}));
 assert.throws(()=>canonical({a:NaN}));assert.throws(()=>canonical({a:undefined}));
});
const base='a'.repeat(40), next='b'.repeat(40), other='c'.repeat(40);
function fake({race=false,unknown=false}={}){
 let head=base;const calls=[];
 const request=async(path,opts)=>{
 calls.push({path,...opts});let data={};
 if(path.endsWith('/git/ref/heads/github-data')) data={object:{sha:head}};
 else if(path.endsWith('/git/commits/'+base))data={tree:{sha:'d'.repeat(40)}};
 else if(path.endsWith('/git/blobs'))data={sha:'e'.repeat(40)};
 else if(path.endsWith('/git/trees'))data={sha:'f'.repeat(40)};
 else if(path.endsWith('/git/commits'))data={sha:next};
 else if(path.endsWith('/git/refs/heads/github-data')){
 if(race){head=other;return {ok:false,status:422};}head=next;if(unknown)throw new Error('network timeout');
 }
 return {ok:true,status:200,json:async()=>data};};
 return {r:new Repository({repo:'fixture/test',request}),calls};
}
test('Публикация атомарная и без force',async()=>{
 const e=await seal({a:1},password,meta),{r,calls}=fake();
 assert.equal((await r.commit(base,[{path:'data/v1/owner.enc',envelope:e}],'operation_test_0001')).sha,next);
 const update=calls.find(c=>c.method==='PATCH');assert.equal(JSON.parse(update.body).force,false);
 assert.equal(calls.filter(c=>c.method==='PATCH').length,1);
});
test('Конфликт не пересобирает старый снимок на новой вершине',async()=>{
 const e=await seal({},password,meta),{r,calls}=fake({race:true});
 await assert.rejects(r.commit(base,[{path:'data/v1/owner.enc',envelope:e}],'operation_test_0002'),{code:'CONFLICT'});
 assert.equal(calls.filter(c=>c.method==='PATCH').length,1);
});
test('Обрыв после записи не выдаётся за отказ и не повторяет запись',async()=>{
 const e=await seal({},password,meta),{r,calls}=fake({unknown:true});
 await assert.rejects(r.commit(base,[{path:'data/v1/owner.enc',envelope:e}],'operation_test_0003'),{code:'COMMIT_UNKNOWN'});
 assert.equal(calls.filter(c=>c.method==='PATCH').length,1);
});
test('Открытые данные и посторонний путь не уходят в GitHub',async()=>{
 const e=await seal({},password,meta),{r,calls}=fake();
 await assert.rejects(r.commit(base,[{path:'data/v1/owner.enc',envelope:{...e,secret:'FAKE'}}],'operation_test_0004'));
 await assert.rejects(r.commit(base,[{path:'.github/workflows/x.enc',envelope:e}],'operation_test_0004'));
 assert.equal(calls.length,0);
});
