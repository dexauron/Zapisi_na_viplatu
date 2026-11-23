// Запускается только доверенным workflow из основной ветки. Секреты не печатает.
'use strict';
const {readFile,readdir}=require('node:fs/promises');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const P=require('../../assets/github/protocol.js');
const {connect}=require('./github.cjs');
const {drain}=require('./inbox.cjs');
const {command}=require('./engine.cjs');
async function schemaHash(){
 const directory=join(__dirname,'../../supabase/migrations'),hash=createHash('sha256');
 for(const name of (await readdir(directory)).filter(n=>/^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort()){
  hash.update(name+'\0');hash.update(await readFile(join(directory,name)));hash.update('\0');
 }
 return hash.digest('hex');
}
async function main(env=process.env){
 if(env.SVERKA_GITHUB_STORAGE_ENABLED!=='true')throw P.error('GITHUB_STORAGE_DISABLED');
 const key=env.SVERKA_STATE_KEY;if(P.un64(key,32).length!==32)throw P.error('INVALID_KEY');
 let privateKey;try{privateKey=JSON.parse(env.SVERKA_BROKER_PRIVATE_KEY);}catch{throw P.error('INVALID_BROKER_KEY');}
 const store=env.SVERKA_STORE;if(!/^[a-zA-Z0-9_-]{1,80}$/.test(store||''))throw P.error('INVALID_STORE');
 const api=connect({repo:env.GITHUB_REPOSITORY,token:env.GITHUB_TOKEN});
 // URL сервера не принимается: восстановление никогда не направляется в рабочий Supabase.
 const {Client}=require('pg'),db=new Client({host:'127.0.0.1',port:54322,user:'postgres',password:'postgres',database:'postgres'});
 await db.connect();
 try{
  await db.query("select set_config('sverka.github_ephemeral','yes',false)");
  const hash=await schemaHash();let transient=false;
  const result=await drain({...api,privateKey,store,execute:signed=>command(signed,{...api,db,store,key,schemaHash:hash}),onError:()=>{transient=true;}});
  // Только счётчики. Даже текст отклонённого запроса и SQL-ошибки остаётся закрытым.
  console.log(JSON.stringify(result));if(transient)throw P.error('QUEUE_RETRY_REQUIRED');
 }finally{await db.end();}
}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z0-9_]{2,60}$/.test(e.code||'')?e.code:'WORKER_FAILED');process.exitCode=1;});
module.exports={main,schemaHash};
