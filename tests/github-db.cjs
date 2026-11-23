// Настоящий PostgreSQL с существующими миграциями; данные вымышлены, в конце rollback.
'use strict';
const assert=require('node:assert/strict');
// Восстановление использует нетранзакционный setval. Никогда не запускать на удалённой БД.
if(process.env.DB_URL){
 let local=false;
 try{const u=new URL(process.env.DB_URL);local=['postgres:','postgresql:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&['54322','55432'].includes(u.port)&&u.pathname==='/postgres'&&!u.search&&!u.hash;}catch{}
 if(!local)throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
}
const {execute}=require('../scripts/github/postgres.cjs');
const {Client}=require(process.env.PG_MODULE||'pg');
const {randomUUID,randomBytes}=require('node:crypto');
const db=new Client(process.env.DB_URL?{connectionString:process.env.DB_URL}:{host:'127.0.0.1',port:55432,user:'postgres',password:'local-test-only',database:'postgres'});
let checks=0;const ok=(x,m)=>{assert.ok(x,m);checks++;};
(async()=>{
 await db.connect();await db.query('begin isolation level serializable');
 const admin=randomUUID(),employee=randomUUID(),repUser=randomUUID();
 const fakeUsers=[[admin,'github-admin@test.local'],[employee,'github-employee@test.local'],[repUser,'github-rep@test.local']];
 for(const [id,email]of fakeUsers)await db.query('insert into auth.users(id,email,created_at,updated_at) values($1,$2,now(),now())',[id,email]);
 await db.query("insert into public.staff(user_id,login,full_name,role) values($1,'github_test_admin','Тестовый администратор GitHub','admin'),($2,'github_test_employee','Тестовый сотрудник GitHub','employee')",[admin,employee]);
 const rep=(await db.query("insert into public.reps(full_name) values('Тест GitHub обработчика') returning id")).rows[0].id;
 await db.query("insert into public.rep_users(user_id,rep_id,login) values($1,$2,'github_test_rep')",[repUser,rep]);
 const token=(await db.query('select token from public.rep_access where rep_id=$1',[rep])).rows[0].token;
 const pay=(await db.query("insert into public.payouts(rep_id,amount,payout_date) values($1,15000.50,current_date) returning id,updated_at::text",[rep])).rows[0];
 const profiles={admin:{kind:'staff',userId:admin,active:true},employee:{kind:'staff',userId:employee,active:true},rep:{kind:'rep',userId:repUser,active:true},link:{kind:'link',repId:rep,token,active:true}};
 async function run(profile,op){
  await db.query('savepoint command_test');
  try{const result=await execute(db,profile,op);await db.query('reset role');await db.query('release savepoint command_test');return result;}
  catch(e){await db.query('rollback to savepoint command_test');await db.query('reset role');await db.query('release savepoint command_test');throw e;}
 }
 const rpc=(name,args={})=>({type:'rpc',name,args});
 const t=(table,action,rest={})=>({type:'table',table,action,...rest});
 const exact=await run(profiles.admin,t('payouts','select',{filters:[{column:'id',op:'eq',value:pay.id}],single:true}));
 ok(new Date(exact.updated_at).getTime()===new Date(pay.updated_at).getTime()&&(exact.updated_at.match(/\.(\d+)/)?.[1]||'').padEnd(6,'0')===(pay.updated_at.match(/\.(\d+)/)?.[1]||'').padEnd(6,'0'),'Версия строки сохраняет микросекунды PostgreSQL');
 const paid=rpc('set_payout_paid',{p_id:pay.id,p_paid:true,p_expected_updated_at:pay.updated_at});
 const data=await run(profiles.admin,rpc('app_bootstrap'));ok(data.me.user_id===admin&&data.me.role==='admin','Идентичность берётся из доверенного профиля');
 await assert.rejects(run({...profiles.employee,role:'admin'},paid),{code:'ACCESS_DENIED'});checks++;
 await assert.rejects(run(profiles.rep,paid),{code:'ACCESS_DENIED'});checks++;
 await assert.rejects(run(profiles.employee,t('payouts','select')),{code:'ACCESS_DENIED'});checks++;
 const issued=await run(profiles.admin,paid);ok(issued.status==='paid'&&issued.paid_by===admin,'Автор и факт выдачи ставятся прежним SQL');
 const repeat=await run(profiles.admin,paid);ok(repeat.paid_at===issued.paid_at&&repeat.updated_at===issued.updated_at,'Повтор защищён прежним RPC');
 await assert.rejects(run(profiles.admin,t('payouts','update',{row:{amount:16000},filters:[{column:'id',op:'eq',value:pay.id}]})));checks++;
 await assert.rejects(run(profiles.admin,t('payouts','delete',{filters:[{column:'id',op:'eq',value:pay.id}]})));checks++;
 const own=await run(profiles.link,rpc('get_rep_data'));ok(own.rep.full_name==='Тест GitHub обработчика'&&own.payouts.some(p=>p.id===pay.id),'Личная ссылка видит своего представителя');
 await assert.rejects(run(profiles.link,rpc('get_rep_data',{p_token:'0'.repeat(36)})),{code:'ACCESS_DENIED'});checks++;
 const at=await run(profiles.link,rpc('confirm_receipt',{p_id:pay.id}));ok(typeof at==='string'&&!!Date.parse(at),'Получение подтверждается через прежний защищённый RPC');
 const order=await run(profiles.employee,t('orders','insert',{row:{rep_id:rep,amount:125.25},single:true}));ok(order.rep_id===rep,'Сотрудник добавляет заказ');
 const row=await run(profiles.employee,t('orders','update',{row:{comment:"Тест '; drop table public.payouts; --"},filters:[{column:'id',op:'eq',value:order.id}],single:true}));ok(row.comment.includes('drop table'),'Текст не становится SQL');
 await assert.rejects(run(profiles.admin,t('orders','delete')),{code:'MISSING_RECORD_ID'});checks++;
 await assert.rejects(run(profiles.admin,t('orders','select',{columns:'id;drop table staff'})),{code:'INVALID_COLUMN'});checks++;
 await assert.rejects(run(profiles.admin,rpc('pg_read_file',{p_path:'/etc/passwd'})),{code:'ACCESS_DENIED'});checks++;
 const rows=await run(profiles.employee,t('orders','select',{filters:[{column:'id',op:'in',value:[order.id]}],order:[{column:'id'}],limit:1}));ok(rows.length===1,'Фильтр IN и пагинация');

 const importId=randomUUID();
 const imported=await run(profiles.admin,rpc('import_docs',{p_import:importId,p_fields:['inc','dec','basis'],p_rows:[
  {title:'Приходная накладная',num:'GH-INV',at:'2026-11-01T10:00:00',kontr:'Тест GitHub обработчика',inc:1000.25,dec:0},
  {title:'Расходный кассовый ордер',num:'GH-CASH',at:'2026-11-02T10:00:00',kontr:'Тест GitHub обработчика',inc:0,dec:400.10,basis:'Приходная накладная|GH-INV|2026'}
 ]}));ok(imported.added===2,'Импорт принимает JSON и массив полей через типизированные аргументы');
 await run(profiles.admin,rpc('finish_import',{p_import:importId,p_scopes:[]}));
 await run(profiles.admin,rpc('reconcile',{p_reps:[rep]}));
 const invoice=(await run(profiles.admin,t('docs','select',{filters:[{column:'num',op:'eq',value:'GH-INV'}],single:true})));
 const reserved=await run(profiles.admin,t('payouts','insert',{row:{rep_id:rep,amount:1000.25,doc_id:invoice.id,payout_date:'2026-01-01'},single:true}));
 ok(reserved.status==='reserved'&&reserved.reserved_amount===400.10&&!reserved.paid_at&&!reserved.paid_by,'Расходник означает отложенные деньги, не фактическую выдачу');
 ok((await run(profiles.link,rpc('get_rep_data'))).payouts.some(p=>p.id===reserved.id&&p.status==='reserved'),'Старый резерв остаётся у торгового');
 ok((await run(profiles.rep,rpc('my_rep_data'))).payouts.some(p=>p.id===reserved.id),'Учётка торгового видит свой резерв');
 ok((await run(profiles.rep,rpc('my_confirm_receipt',{p_id:reserved.id})))===null,'Торговый не подтверждает получение ещё не выданных денег');
 const sharedToken=await run(profiles.admin,rpc('shared_link_token'));
 ok((await run({kind:'shared',active:true,token:sharedToken},rpc('get_payout_schedule'))).some(p=>p.id===reserved.id),'Общий график сохраняет резерв');
 for(const [name,args]of [['rep_history',{p_rep:rep}],['docs_stats',{p_from:'2026-11-01',p_to:'2026-11-30'}],['summary_stats',{}],['open_invoices',{}],['find_invoices',{p_q:'GH-INV'}],['search_invoices',{p_filter:{query:'Тест GitHub',has_text:true,rep_ids:[rep],exclude_ids:[],terms:[]},p_limit:40}]]){
  ok((await run(profiles.admin,rpc(name,args)))!==null,'Адаптер выполняет '+name);
 }
 await run(profiles.admin,rpc('import_reps',{p_rows:[{key:'github-fixture',full_name:'Тест импорта GitHub'}]}));checks++;
 await run(profiles.admin,rpc('delete_docs',{p_from:'1900-01-01',p_to:'1900-01-01',p_kinds:['in']}));checks++;

 const {materialize}=require('../scripts/github/views.cjs');
 const viewProfiles=Object.fromEntries(Object.entries(profiles).map(([kind,p])=>{const id=p.userId||randomUUID();return [kind,{...p,id,epoch:1,readKey:randomBytes(32).toString('base64')}];}));
 const visible=await materialize(db,{store:'test-views',profiles:viewProfiles});
 const S=require('../assets/github/store.cjs');
 async function readView(p,v=visible){const m=v.views[p.id];return S.openKey(v.files.find(f=>f.path===m.path).envelope,p.readKey,{store:'test-views',audience:p.id,revision:m.revision});}
 const staffView=await readView(viewProfiles.employee),repView=await readView(viewProfiles.rep);
 ok(!staffView.revoked&&!staffView.tables.payouts&&!staffView.tables.docs&&!staffView.tables.rep_access,'Набор сотрудника не содержит финансовой базы');
 ok(repView.bootstrap.rep.full_name==='Тест GitHub обработчика'&&!Object.keys(repView.tables).length,'Торговый получает только данные своего кабинета');
 const adminView=await readView(viewProfiles.admin),chunk=Object.values(adminView.chunks).find(c=>!c.empty);
 await assert.rejects(S.openKey(visible.files.find(f=>f.path===chunk.path).envelope,viewProfiles.employee.readKey,{store:'test-views',audience:chunk.audience,revision:chunk.revision}));checks++;
 await db.query('update public.staff set active=false where user_id=$1',[employee]);
 await assert.rejects(run(profiles.employee,t('orders','select')),{code:'ACCESS_DENIED'});checks++;
 await db.query('update public.rep_access set token=$1 where rep_id=$2',['f'.repeat(36),rep]);
 await assert.rejects(run(profiles.link,rpc('get_rep_data')),{code:'ACCESS_DENIED'});checks++;
 const revoked=await materialize(db,{store:'test-views',profiles:{[viewProfiles.link.id]:viewProfiles.link},previous:visible.views});
 const revokedView=await readView(viewProfiles.link,revoked);ok(revokedView.revoked&&revokedView.bootstrap===null&&!Object.keys(revokedView.chunks).length,'Смена личной ссылки отзывает свежий набор');


 const {exportDatabase,encodeSnapshot,decodeSnapshot,restoreDatabase}=require('../scripts/github/snapshot.cjs');
 const {canonical}=require('../assets/github/store.cjs');
 const beforePay=await run(profiles.admin,t('payouts','select',{filters:[{column:'id',op:'eq',value:pay.id}],single:true}));
 const before=await exportDatabase(db),key=randomBytes(32).toString('base64'),schemaHash='a'.repeat(64),store='test-store';
 const P=require('../assets/github/protocol.js'),identity=await P.identity();
 const profile={...profiles.admin,id:admin,epoch:1,publicKey:identity.publicKey,readKey:randomBytes(32).toString('base64')};
 const repIdentity=await P.identity(),repProfile={...profiles.rep,id:repUser,epoch:1,publicKey:repIdentity.publicKey,readKey:randomBytes(32).toString('base64')};
 const encoded=await encodeSnapshot(before,{store,key,schemaHash,extra:{ledger:{},profiles:{[admin]:profile,[repUser]:repProfile}}});
 const memory=new Map(encoded.files.map(f=>[f.path,f.envelope]));
 ok(!JSON.stringify(encoded.files).includes('github-admin@test.local'),'Снимок не раскрывает учётки');
 const decoded=await decodeSnapshot(encoded.root,{store,key,schemaHash,read:async p=>memory.get(p)});
 ok(canonical(decoded)===canonical(before),'Шифрованный снимок восстанавливает все строки');
 const unchanged=await encodeSnapshot(before,{store,key,schemaHash,previous:encoded.root});
 ok(unchanged.files.length===1,'Без изменений таблицы не перешифровываются');
 await assert.rejects(restoreDatabase(db,decoded),{code:'RESTORE_REQUIRES_EPHEMERAL_DATABASE'});checks++;
 await db.query("select set_config('sverka.github_ephemeral','yes',true)");
 await restoreDatabase(db,decoded);checks++;
 const restored=await run(profiles.admin,t('payouts','select',{filters:[{column:'id',op:'eq',value:pay.id}],single:true}));
 ok(restored.paid_by===admin&&restored.updated_at===beforePay.updated_at&&restored.amount===15000.50,'Сумма, автор и микросекунды выдачи после восстановления');
 await run(profiles.admin,t('orders','update',{row:{comment:'Проверка изменения одного блока'},filters:[{column:'id',op:'eq',value:order.id}]}));
 const changed=await encodeSnapshot(await exportDatabase(db),{store,key,schemaHash,previous:encoded.root});
 ok(changed.files.length>1&&changed.files.length<=5,'Изменение не переписывает весь архив');
 const nonempty=Object.keys(encoded.root.chunks).filter(k=>encoded.root.chunks[k].count>0);
 const first=nonempty[0],original=memory.get(encoded.root.chunks[first].path);
 memory.set(encoded.root.chunks[first].path,memory.get(encoded.root.chunks[nonempty[1]].path));
 await assert.rejects(decodeSnapshot(encoded.root,{store,key,schemaHash,read:async p=>memory.get(p)}));checks++;
 memory.set(encoded.root.chunks[first].path,original);

 // Отдельная временная транзакция обработчика, вне транзакции тестовых вставок.
 await db.query('rollback');
 await db.query("select set_config('sverka.github_ephemeral','yes',false)");
 const {command}=require('../scripts/github/engine.cjs');
 let head='1'.repeat(40),commits=0;const versions=new Map([[head,new Map(encoded.files.map(f=>[f.path,f.envelope]))]]);
 const repository={head:async()=>head,commit:async(expected,files)=>{
  assert.equal(expected,head);const next=new Map(versions.get(head));for(const f of files)next.set(f.path,f.envelope);
  head=String(++commits+1).repeat(40);versions.set(head,next);
 }};
 const options={db,repository,read:async(path,ref)=>versions.get(ref).get(path),store,key,schemaHash};
 const signed=await P.sign({format:P.FORMAT,actor:admin,epoch:1,store,operationId:randomUUID(),issuedAt:new Date().toISOString(),operation:rpc('set_payout_paid',{p_id:pay.id,p_paid:false,p_expected_updated_at:beforePay.updated_at})},identity.privateKey);
 const result=await command(signed,options);ok(result.result.ok&&result.result.data.status==='to_pay'&&commits===1,'Команда и результат сохранены атомарно');
 const receiptAudience=admin+'_'+signed.body.operationId;
 const receipt=await require('../assets/github/store.cjs').openKey(versions.get(head).get('data/v1/receipts/'+receiptAudience+'.enc'),profile.readKey,{store,audience:receiptAudience,revision:1});
 ok(receipt.result.ok&&canonical(receipt.result)===canonical(result.result),'Зашифрованный ответ сотрудника сохранён вместе с базой');
 const again=await command(signed,options);ok(again.duplicate&&canonical(again.result)===canonical(result.result)&&commits===1,'Повтор после восстановления не меняет выплату второй раз');
 const denied=await P.sign({...signed.body,operationId:randomUUID(),operation:t('payouts','delete')},identity.privateKey);
 const rejected=await command(denied,options);ok(!rejected.result.ok&&rejected.result.error.code==='MISSING_RECORD_ID'&&commits===2,'Отказ тоже подтверждается без изменения выплаты');
 const declined=await command(denied,options);ok(declined.duplicate&&!declined.result.ok&&commits===2,'Повтор отказа возвращает тот же результат');

 const uncertain=await P.sign({...signed.body,operationId:randomUUID(),operation:t('orders','update',{row:{comment:'Результат потерян в сети'},filters:[{column:'id',op:'eq',value:order.id}],single:true})},identity.privateKey);
 const realCommit=repository.commit;
 repository.commit=async(...args)=>{await realCommit(...args);throw P.error('COMMIT_UNKNOWN');};
 await assert.rejects(command(uncertain,options),{code:'COMMIT_UNKNOWN'});checks++;
 repository.commit=realCommit;
 const recovered=await command(uncertain,options);ok(recovered.duplicate&&recovered.result.ok&&commits===3,'Потерянный ответ восстанавливается из коммита без повторного изменения');
 const conflict=await P.sign({...uncertain.body,operationId:randomUUID()},identity.privateKey);
 repository.commit=async()=>{throw P.error('CONFLICT');};
 await assert.rejects(command(conflict,options),{code:'CONFLICT'});checks++;
 repository.commit=realCommit;
 const retried=await command(conflict,options);ok(!retried.duplicate&&retried.result.ok&&commits===4,'Конфликт не подтверждает несохранённую команду');

 const repSigned=await P.sign({format:P.FORMAT,actor:repUser,epoch:1,store,operationId:randomUUID(),issuedAt:new Date().toISOString(),operation:rpc('my_confirm_receipt',{p_id:pay.id})},repIdentity.privateKey);
 let repFiles;const repOptions={...options,repository:{head:async()=>'1'.repeat(40),commit:async(expected,files)=>{repFiles=files;}}};
 const repResult=await command(repSigned,repOptions);ok(repResult.result.ok&&typeof repResult.result.data==='string','Сквозное подтверждение ТП сохраняет строковый timestamp');
 ok(repFiles.some(f=>f.path==='data/v1/receipts/'+repUser+'_'+repSigned.body.operationId+'.enc'),'Подтверждение ТП получает свой шифрованный ответ');
 console.log('GitHub PostgreSQL PASS: '+checks+' checks; all fixture data rolled back');
})().catch(e=>{console.error(e.code||'TEST_FAILED',e.message);process.exitCode=1;}).finally(async()=>{await db.query('rollback').catch(()=>{});await db.end();});
