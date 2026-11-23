// Клиент очереди. Не подключён к HTML до готовности входа и персональных наборов.
(function(root){
'use strict';
const P=typeof module==='object'&&module.exports?require('./protocol.js'):root.SverkaGitProtocol;
const FORMAT='sverka.github.key.v1';
class Queue{
 constructor({store,profile,brokerPublicKey,storage,send,readReceipt,now=()=>Date.now()}){
  if(!profile?.id||!profile.privateKey||!profile.readKey||typeof send!=='function'||typeof readReceipt!=='function')throw P.error('INVALID_QUEUE_CONFIG');
  this.store=store;this.profile=profile;this.brokerPublicKey=brokerPublicKey;this.storage=storage;this.send=send;this.readReceipt=readReceipt;this.now=now;
  this.prefix='sverka-github-pending:'+store+':'+profile.id+':';
 }
 load(id){
  if(!/^[a-f0-9-]{36}$/i.test(id))throw P.error('INVALID_OPERATION_ID');
  try{const raw=this.storage.getItem(this.prefix+id);if(!raw)throw P.error('PENDING_NOT_FOUND');const item=JSON.parse(raw);
   if(item.id!==id||typeof item.fingerprint!=='string'||!item.envelope||item.envelope.store!==this.store)throw P.error('INVALID_PENDING');return item;
  }catch(e){if(e.code)throw e;throw P.error('LOCAL_STORAGE_FAILED');}
 }
 save(item){try{this.storage.setItem(this.prefix+item.id,JSON.stringify(item));}catch{throw P.error('LOCAL_STORAGE_FAILED');}}
 async prepare(operation){
  const body={format:P.FORMAT,store:this.store,actor:this.profile.id,epoch:this.profile.epoch,operationId:globalThis.crypto.randomUUID(),issuedAt:new Date(this.now()).toISOString(),operation};
  const signed=await P.sign(body,this.profile.privateKey),envelope=await P.pack(signed,this.brokerPublicKey,this.store);
  if(JSON.stringify(envelope).length>60000)throw P.error('COMMAND_TOO_LARGE');
  const item={id:body.operationId,createdAt:body.issuedAt,fingerprint:await P.hash(body),envelope,issue:null};
  this.save(item);return item.id;
 }
 async submit(operation){const id=await this.prepare(operation);return this.dispatch(id);}
 async dispatch(id){
  const item=this.load(id);
  if(item.issue!==null)return {id,status:'pending'};
  let issue;
  try{issue=await this.send(item.envelope);}catch{throw Object.assign(P.error('QUEUE_SEND_UNKNOWN'),{operationId:id});}
  if(!Number.isSafeInteger(issue)||issue<1)throw Object.assign(P.error('QUEUE_SEND_UNKNOWN'),{operationId:id});
  this.save({...item,issue});return {id,status:'pending'};
 }
 async check(id){
  const item=this.load(id),audience=this.profile.id+'_'+id;
  const envelope=await this.readReceipt(audience);
  if(!envelope)return {id,status:this.now()-Date.parse(item.createdAt)>25*60*60*1000?'needs_review':'pending'};
  const context={format:FORMAT,store:this.store,audience,revision:1};
  if(Object.keys(context).some(k=>envelope[k]!==context[k])||envelope.alg!=='AES-256-GCM')throw P.error('INVALID_RECEIPT');
  const entry=await P.openKey({v:1,iv:envelope.iv,data:envelope.ciphertext},this.profile.readKey,context);
  if(entry.fingerprint!==item.fingerprint||typeof entry.result?.ok!=='boolean')throw P.error('INVALID_RECEIPT');
  try{this.storage.removeItem(this.prefix+id);}catch{throw P.error('LOCAL_STORAGE_FAILED');}
  return {id,status:entry.result.ok?'confirmed':'rejected',result:entry.result};
 }
}
if(typeof module==='object'&&module.exports)module.exports={Queue};else root.SverkaGitQueue={Queue};
})(typeof window==='object'?window:globalThis);
