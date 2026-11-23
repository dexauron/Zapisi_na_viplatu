'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {connect}=require('../scripts/github/github.cjs');
const {main,schemaHash}=require('../scripts/github/worker.cjs');
const response=value=>({ok:true,status:200,json:async()=>value});
test('Чтение привязано к точному коммиту; токен передаётся только GitHub без редиректов',async()=>{
 const calls=[],head='a'.repeat(40),blob='b'.repeat(40),path='data/v1/state.enc';
 const api=connect({repo:'example/test',token:'test-token',fetch:async(url,options)=>{
  calls.push({url,options});if(url.includes('/git/trees/'))return response({truncated:false,tree:[{type:'blob',path,sha:blob,size:100}]});
  return response({encoding:'base64',content:Buffer.from('{"encrypted":true}').toString('base64')});
 }});
 assert.deepEqual(await api.read(path,head),{encrypted:true});
 assert.ok(calls[0].url.endsWith('/git/trees/'+head+'?recursive=1'));
 assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
 await assert.rejects(api.read('../secret',head),{code:'INVALID_READ'});
});
test('Неполное дерево не считается полной базой',async()=>{
 const api=connect({repo:'example/test',token:'test-token',fetch:async()=>response({truncated:true,tree:[]})});
 await assert.rejects(api.read('data/v1/state.enc','a'.repeat(40)),{code:'TREE_TRUNCATED'});
});
test('Страницы очереди собираются до закрытия задач, без пропуска после сдвига',async()=>{
 const calls=[];const api=connect({repo:'example/test',token:'test-token',fetch:async(url,options)=>{
  calls.push(url);
  if(options.method==='PATCH')return response({});
  if(url.endsWith('page=1'))return response(Array.from({length:100},(_,i)=>({number:i+1,title:i===99?'sverka-command-v1':'Обычная задача'})));
  return response([{number:101,title:'sverka-command-v1'}]);
 }});
 const selected=[];for await(const issue of api.list()){selected.push(issue.number);await api.close(issue.number);}
 assert.deepEqual(selected,[100,101]);assert.ok(calls[1].endsWith('page=2'));assert.ok(calls[2].endsWith('/issues/100'));
});
test('Рабочий обработчик выключен без явной настройки; контроль схемы стабилен',async()=>{
 await assert.rejects(main({}),{code:'GITHUB_STORAGE_DISABLED'});
 const hash=await schemaHash();assert.match(hash,/^[a-f0-9]{64}$/);assert.equal(hash,await schemaHash());
});
