// Общий формат подписанных команд браузера и обработчика GitHub Actions.
(function(root){
'use strict';
const C=globalThis.crypto || (typeof require==='function'?require('node:crypto').webcrypto:null);
const encoder=new TextEncoder(), decoder=new TextDecoder('utf-8',{fatal:true});
const FORMAT='sverka-command-v1', UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const error=code=>Object.assign(new Error(code),{code});
function canonical(x){
 if(x===null||typeof x==='string'||typeof x==='boolean')return JSON.stringify(x);
 if(typeof x==='number'){if(!Number.isFinite(x))throw error('INVALID_NUMBER');return JSON.stringify(x);}
 if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
 if(!x||typeof x!=='object'||Object.getPrototypeOf(x)!==Object.prototype)throw error('INVALID_JSON');
 return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
}
function b64(bytes){if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');let s='';for(const b of new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s);}
function un64(s,max=2*1024*1024){
 if(typeof s!=='string'||s.length>max*2||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw error('INVALID_BASE64');
 const b=typeof Buffer!=='undefined'?new Uint8Array(Buffer.from(s,'base64')):Uint8Array.from(atob(s),x=>x.charCodeAt(0));if(b.length>max)throw error('TOO_LARGE');return b;
}
const encoded=x=>encoder.encode(canonical(x));
async function hash(x){return b64(await C.subtle.digest('SHA-256',encoded(x)));}
async function identity(){
 const keys=await C.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 return {privateKey:await C.subtle.exportKey('jwk',keys.privateKey),publicKey:await C.subtle.exportKey('jwk',keys.publicKey)};
}
function validate(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='actor,epoch,format,issuedAt,operation,operationId,store'
 ||body.format!==FORMAT||!UUID.test(body.actor)||!UUID.test(body.operationId)||!Number.isSafeInteger(body.epoch)||body.epoch<1
 ||typeof body.store!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(body.store)||typeof body.issuedAt!=='string'
 ||!Number.isFinite(Date.parse(body.issuedAt))||!body.operation||typeof body.operation!=='object'||Array.isArray(body.operation))throw error('INVALID_COMMAND');
 if(encoded(body).length>1024*1024)throw error('TOO_LARGE');
}
async function sign(body,privateKey){
 validate(body);const key=await C.subtle.importKey('jwk',privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 return {body,signature:b64(await C.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoded(body)))};
}
async function verify(signed,profile,store,{now=Date.now(),checkTime=true}={}){
 if(!signed||Object.keys(signed).sort().join(',')!=='body,signature')throw error('INVALID_COMMAND');
 validate(signed.body);const b=signed.body;
 if(!profile||!profile.active||profile.id!==b.actor||profile.epoch!==b.epoch||b.store!==store)throw error('ACCESS_DENIED');
 const signature=un64(signed.signature,64);if(signature.length!==64)throw error('INVALID_SIGNATURE');
 let ok=false;
 try{const key=await C.subtle.importKey('jwk',profile.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);ok=await C.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,encoded(b));}catch{throw error('INVALID_SIGNATURE');}
 if(!ok)throw error('INVALID_SIGNATURE');
 if(checkTime&&(Date.parse(b.issuedAt)>now+5*60*1000||Date.parse(b.issuedAt)<now-24*60*60*1000))throw error('COMMAND_EXPIRED');
 return b;
}
async function aesKey(raw,uses){const bytes=typeof raw==='string'?un64(raw,32):raw;if(bytes.byteLength!==32)throw error('INVALID_KEY');return C.subtle.importKey('raw',bytes,'AES-GCM',false,uses);}
async function sealKey(value,raw,context){
 const bytes=encoded(value);if(bytes.length>64*1024*1024)throw error('TOO_LARGE');
 const iv=C.getRandomValues(new Uint8Array(12)),key=await aesKey(raw,['encrypt']);
 const data=await C.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoded(context)},key,bytes);
 return {v:1,iv:b64(iv),data:b64(data)};
}
async function openKey(envelope,raw,context){
 if(!envelope||envelope.v!==1||Object.keys(envelope).sort().join(',')!=='data,iv,v')throw error('INVALID_ENVELOPE');
 const iv=un64(envelope.iv,12);if(iv.length!==12)throw error('INVALID_ENVELOPE');
 const key=await aesKey(raw,['decrypt']);
 try{return JSON.parse(decoder.decode(await C.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoded(context)},key,un64(envelope.data,64*1024*1024))));}catch{throw error('DECRYPT_FAILED');}
}
async function brokerKeys(){const k=await C.subtle.generateKey({name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);return {publicKey:await C.subtle.exportKey('jwk',k.publicKey),privateKey:await C.subtle.exportKey('jwk',k.privateKey)};}
async function pack(signed,publicKey,store){
 const raw=C.getRandomValues(new Uint8Array(32)),key=await C.subtle.importKey('jwk',publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
 return {v:1,store,key:b64(await C.subtle.encrypt('RSA-OAEP',key,raw)),payload:await sealKey(signed,raw,{format:FORMAT,store,purpose:'inbox'})};
}
async function unpack(envelope,privateKey,store){
 if(!envelope||envelope.v!==1||envelope.store!==store||Object.keys(envelope).sort().join(',')!=='key,payload,store,v'||canonical(envelope).length>2*1024*1024)throw error('INVALID_ENVELOPE');
 try{const key=await C.subtle.importKey('jwk',privateKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
 const raw=await C.subtle.decrypt('RSA-OAEP',key,un64(envelope.key,512));return await openKey(envelope.payload,raw,{format:FORMAT,store,purpose:'inbox'});}catch{throw error('DECRYPT_FAILED');}
}
const api={FORMAT,error,canonical,hash,identity,sign,verify,sealKey,openKey,brokerKeys,pack,unpack,b64,un64};
if(typeof module==='object'&&module.exports)module.exports=api;else root.SverkaGitProtocol=api;
})(typeof window==='object'?window:globalThis);
