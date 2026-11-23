'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../assets/github/protocol.js'),{TITLE,parse,drain}=require('../scripts/github/inbox.cjs');
const {randomUUID}=require('node:crypto');
let keys;const broker=async()=>keys||(keys=await P.brokerKeys());
async function fixture(number=1){const k=await broker();return {number,title:TITLE,body:JSON.stringify(await P.pack({body:{operationId:randomUUID()}},k.publicKey,'test'))};}
test('Очередь не принимает PR, слишком большое тело и произвольный текст',()=>{
 for(const issue of [{title:TITLE,body:'x'},{title:TITLE,body:' '.repeat(60001)},{title:TITLE,body:'{}',pull_request:{}}])assert.throws(()=>parse(issue),{code:'INVALID_INBOX_ITEM'});
});
test('Пропущенные события восстанавливаются из открытых задач, чужие задачи не меняются',async()=>{
 const k=await broker(),closed=[],seen=[],items=[{number:90,title:'Обычная задача'},await fixture(2),await fixture(3)];
 const result=await drain({store:'test',privateKey:k.privateKey,list:async function*(){yield*items;},close:async n=>closed.push(n),execute:async s=>seen.push(s)});
 assert.deepEqual(closed,[2,3]);assert.equal(seen.length,2);assert.deepEqual(result,{processed:2,invalid:0,pending:0});
});
test('Неопределённый ответ Git оставляет команду в очереди и не закрывает следующие',async()=>{
 const k=await broker(),closed=[],errors=[],items=[await fixture(1),await fixture(2)];
 const result=await drain({store:'test',privateKey:k.privateKey,list:async function*(){yield*items;},close:async n=>closed.push(n),execute:async()=>{throw P.error('COMMIT_UNKNOWN');},onError:e=>errors.push(e)});
 assert.deepEqual(closed,[]);assert.equal(result.pending,1);assert.deepEqual(errors,[{code:'COMMIT_UNKNOWN'}]);
});
test('Повреждённый запрос закрывается без публикации содержимого',async()=>{
 const k=await broker(),closed=[];
 const result=await drain({store:'test',privateKey:k.privateKey,list:async function*(){yield {number:1,title:TITLE,body:'{"full_name":"Чужое имя"}'};},close:async n=>closed.push(n),execute:async()=>assert.fail('Не должен исполняться')});
 assert.deepEqual(closed,[1]);assert.equal(result.invalid,1);
});
