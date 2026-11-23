// Узкий транспорт GitHub: никаких URL из тела команды или перенаправлений с токеном.
'use strict';
const P=require('../../assets/github/protocol.js');
const {Repository}=require('../../assets/github/store.cjs');
function connect({repo,token,branch='github-data',fetch:transport=globalThis.fetch}){
 if(typeof token!=='string'||!token||typeof transport!=='function')throw P.error('INVALID_TRANSPORT');
 async function request(path,options={}){
  if(!path.startsWith('/repos/'+repo+'/')||path.includes('..')||/[\r\n]/.test(path))throw P.error('INVALID_API_PATH');
  return transport('https://api.github.com'+path,{...options,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+token,'Content-Type':'application/json'}});
 }
 const repository=new Repository({repo,branch,request}),trees=new Map();
 async function read(path,head){
  if(!/^data\/v1\/[a-zA-Z0-9_/-]+\.enc$/.test(path)||!/^[a-f0-9]{40}$/.test(head))throw P.error('INVALID_READ');
  if(!trees.has(head)){
   const tree=await repository.api('/git/trees/'+head+'?recursive=1');
   if(tree.truncated)throw P.error('TREE_TRUNCATED');
   trees.clear();trees.set(head,new Map(tree.tree.filter(f=>f.type==='blob').map(f=>[f.path,f])));
  }
  const file=trees.get(head).get(path);if(!file)throw P.error('STATE_NOT_FOUND');
  if(file.size>64*1024*1024)throw P.error('STATE_TOO_LARGE');
  const blob=await repository.api('/git/blobs/'+file.sha);
  if(blob.encoding!=='base64')throw P.error('INVALID_BLOB');
  try{return JSON.parse(Buffer.from(blob.content,'base64').toString('utf8'));}catch{throw P.error('INVALID_BLOB');}
 }
 async function* list(){
  // Сначала собрать номера: закрытие Issue во время пагинации сдвигает следующие страницы.
  const selected=[];
  for(let page=1;page<=100;page++){
   const rows=await repository.api('/issues?state=open&sort=created&direction=asc&per_page=100&page='+page);
   selected.push(...rows.filter(i=>!i.pull_request&&i.title==='sverka-command-v1'));
   if(rows.length<100||selected.length>=20){yield*selected.slice(0,20);return;}
  }
  throw P.error('QUEUE_SCAN_LIMIT');
 }
 async function close(number){
  if(!Number.isSafeInteger(number)||number<1)throw P.error('INVALID_ISSUE');
  return repository.api('/issues/'+number,'PATCH',{state:'closed'});
 }
 return {repository,read,list,close};
}
module.exports={connect};
