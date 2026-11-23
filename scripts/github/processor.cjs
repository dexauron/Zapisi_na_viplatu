// Доверенный обработчик. Возврат результата означает сохранение эффекта И журнала.
'use strict';
const P=require('../../assets/github/protocol.js');
const operationKey=body=>body.actor+'/'+body.operationId;
async function processCommand(signed,{store,profiles,ledger,run,commit,now=Date.now()}){
 const profile=profiles[signed?.body?.actor];
 // Подпись проверяется и для повтора. Отзыв доступа и смена ключа действуют сразу.
 const body=await P.verify(signed,profile,store,{now,checkTime:false});
 const key=operationKey(body), fingerprint=await P.hash(body), old=ledger[key];
 if(old){if(old.fingerprint!==fingerprint)throw P.error('IDEMPOTENCY_CONFLICT');return {duplicate:true,result:old.result};}
 await P.verify(signed,profile,store,{now});
 // run() обязан быть транзакцией и сверять актуальную роль с самой базой.
 return run(profile,body.operation,async result=>{
   // Журнал ещё не изменён: при неудаче commit() повтор не выдаст ложный успех.
   const entry={fingerprint,result,at:new Date(now).toISOString()};
   await commit({key,entry,actor:profile.id,operationId:body.operationId});
   ledger[key]=entry;
   return {duplicate:false,result};
 });
}
module.exports={processCommand,operationKey};
