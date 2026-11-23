// Очередь хранится в Issues, а не в параметрах запуска Actions: события могут склеиваться.
// В публичные ответы никогда не попадают личность, действие, сумма или SQL-ошибка.
'use strict';
const P=require('../../assets/github/protocol.js');
const TITLE='sverka-command-v1';
function parse(issue){
 if(!issue||issue.pull_request||issue.title!==TITLE||typeof issue.body!=='string'||issue.body.length>60000)throw P.error('INVALID_INBOX_ITEM');
 try{return JSON.parse(issue.body);}catch{throw P.error('INVALID_INBOX_ITEM');}
}
async function drain({list,close,privateKey,store,execute,limit=20,onError=()=>{}}){
 let processed=0,invalid=0,pending=0;
 for await(const issue of list()){
  if(processed+invalid+pending>=limit)break;
  if(issue.pull_request||issue.title!==TITLE)continue;
  let signed;
  try{signed=await P.unpack(parse(issue),privateKey,store);}
  catch{invalid++;await close(issue.number);continue;}
  try{await execute(signed);processed++;await close(issue.number);}
  catch(e){
   // Неизвестный результат записи, конфликт и временная ошибка остаются в очереди.
   const permanent=['INVALID_COMMAND','INVALID_SIGNATURE','INVALID_BASE64','ACCESS_DENIED','COMMAND_EXPIRED','IDEMPOTENCY_CONFLICT'].includes(e.code);
   if(permanent){invalid++;await close(issue.number);}else{pending++;onError({code:/^[A-Z0-9_]{2,60}$/.test(e.code||'')?e.code:'WORKER_FAILED'});break;}
  }
 }
 return {processed,invalid,pending};
}
module.exports={TITLE,parse,drain};
