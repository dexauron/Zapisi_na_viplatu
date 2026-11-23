// Выполнение подписанной команды через прежние функции PostgreSQL и RLS.
// Требует доверенного соединения и внешней транзакции. Произвольный SQL не принимает.
'use strict';
const {error}=require('../../assets/github/protocol.js');
const RPC={
 app_bootstrap:['admin','employee'],rep_history:['admin','employee'],
 set_payout_paid:['admin'],import_reps:['admin'],import_docs:['admin'],finish_import:['admin'],reconcile:['admin'],
 delete_docs:['admin'],docs_stats:['admin'],summary_stats:['admin'],open_invoices:['admin'],search_invoices:['admin'],find_invoices:['admin'],shared_link_token:['admin'],
 my_rep_data:['rep'],my_confirm_receipt:['rep'],get_rep_data:['link'],confirm_receipt:['link'],get_payout_schedule:['shared']
};
const TABLES={orders:['admin','employee'],payouts:['admin'],reps:['admin','employee'],stores:['admin','employee'],
 rep_access:['admin'],staff:['admin','employee'],rep_users:['admin'],one_c_register_reports:['admin'],audit_log:['admin','employee'],docs:['admin']};
const WRITE=new Set(['orders','payouts','reps','stores','rep_access','one_c_register_reports']);
const ident=s=>{if(typeof s!=='string'||!/^[a-z_][a-z0-9_]{0,62}$/.test(s))throw error('INVALID_IDENTIFIER');return '"'+s+'"';};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
async function actorContext(db,profile){
 if(!profile||!profile.active)throw error('ACCESS_DENIED');
 let role,uid=null,email='';
 if(profile.kind==='staff'){
  const r=await db.query('select s.role,s.active,u.email from public.staff s join auth.users u on u.id=s.user_id where s.user_id=$1',[profile.userId]);
  if(r.rows.length!==1||!r.rows[0].active)throw error('ACCESS_DENIED');role=r.rows[0].role;uid=profile.userId;email=r.rows[0].email;
 }else if(profile.kind==='rep'){
  const r=await db.query('select u.email from public.rep_users ru join public.reps r on r.id=ru.rep_id join auth.users u on u.id=ru.user_id where ru.user_id=$1 and ru.active and r.active',[profile.userId]);
  if(r.rows.length!==1)throw error('ACCESS_DENIED');role='rep';uid=profile.userId;email=r.rows[0].email;
 }else if(profile.kind==='link'){
  const r=await db.query('select r.id from public.rep_access a join public.reps r on r.id=a.rep_id where a.token=$1 and r.id=$2 and r.active',[profile.token,profile.repId]);
  if(r.rows.length!==1)throw error('ACCESS_DENIED');role='link';
 }else if(profile.kind==='shared'){
  const r=await db.query('select 1 from private.shared_link where token=$1',[profile.token]);
  if(r.rows.length!==1)throw error('ACCESS_DENIED');role='shared';
 }else throw error('ACCESS_DENIED');
 await db.query(uid?'set local role authenticated':'set local role anon');
 await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:uid?'authenticated':'anon',...(uid?{sub:uid,email,email_verified:true}:{})})]);
 return role;
}
async function rpc(db,role,profile,operation){
 if(!Object.hasOwn(RPC,operation.name)||!RPC[operation.name].includes(role)||!object(operation.args||{}))throw error('ACCESS_DENIED');
 const args={...(operation.args||{})};
 if(role==='link'||role==='shared'){
  if(args.p_token!==undefined&&args.p_token!==profile.token)throw error('ACCESS_DENIED');args.p_token=profile.token;
 }
 // Типы и имена параметров берём из доверенной схемы, не из запроса.
 const f=await db.query(`select p.oid,p.proargnames,p.pronargs,p.pronargdefaults,array(select format_type(t,null) from unnest(p.proargtypes::oid[]) t) as types
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 and p.prokind='f'`,[operation.name]);
 const choices=f.rows.filter(r=>{const names=(r.proargnames||[]).slice(0,r.pronargs);return Object.keys(args).every(k=>names.includes(k))&&names.slice(0,r.pronargs-r.pronargdefaults).every(k=>Object.hasOwn(args,k));});
 if(choices.length!==1)throw error('INVALID_ARGUMENTS');
 const spec=choices[0],names=Object.keys(args),values=[];
 const sqlArgs=names.map((name,i)=>{const type=spec.types[spec.proargnames.indexOf(name)];let value=args[name];
  if(value!==null&&/^(json|jsonb)$/.test(type))value=JSON.stringify(value);
  values.push(value);return ident(name)+' => $'+(i+1)+'::'+type;});
 const result=await db.query('select public.'+ident(operation.name)+'('+sqlArgs.join(',')+') as result',values);
 return result.rows[0]?.result??null;
}
async function table(db,role,operation){
 const t=operation.table;
 if(!Object.hasOwn(TABLES,t)||!TABLES[t].includes(role))throw error('ACCESS_DENIED');
 const action=operation.action||'select';
 if(!['select','insert','update','delete','upsert'].includes(action))throw error('INVALID_ACTION');
 if(action!=='select'&&!WRITE.has(t))throw error('ACCESS_DENIED');
 const cols=await db.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[t]);
 const allowed=new Set(cols.rows.map(r=>r.column_name));
 const col=s=>{if(!allowed.has(s))throw error('INVALID_COLUMN');return ident(s);};
 const selected=operation.columns||'*';
 const projection=selected==='*'?'*':selected.split(',').map(s=>col(s.trim())).join(',');
 const values=[],bind=x=>{values.push(x);return '$'+values.length;};
 const filters=operation.filters||[];if(!Array.isArray(filters)||filters.length>20)throw error('INVALID_FILTER');
 const where=filters.map(f=>{
  if(!object(f))throw error('INVALID_FILTER');const c=col(f.column),ops={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='};
  if(f.op==='in'){if(!Array.isArray(f.value)||f.value.length>5000)throw error('INVALID_FILTER');return f.value.length?c+' in ('+f.value.map(bind).join(',')+')':'false';}
  if(f.op==='is'&&f.value===null)return c+' is null';
  if(!Object.hasOwn(ops,f.op)||f.value===null||typeof f.value==='object')throw error('INVALID_FILTER');return c+ops[f.op]+bind(f.value);
 });
 if(action==='update'||action==='delete'){
  // Никаких случайных UPDATE/DELETE всей таблицы. Штатный UI изменяет одну запись.
  const pk=t==='rep_access'?'rep_id':'id';
  if(!filters.some(f=>f.column===pk&&f.op==='eq'&&typeof f.value==='string'))throw error('MISSING_RECORD_ID');
 }
 let sql;
 if(action==='select')sql='select '+projection+' from public.'+ident(t);
 else if(action==='delete')sql='delete from public.'+ident(t);
 else if(action==='update'){
  if(!object(operation.row)||!Object.keys(operation.row).length)throw error('INVALID_ROW');
  const keys=Object.keys(operation.row);keys.forEach(col);if(keys.includes('id')||keys.includes('rep_id')&&t==='rep_access')throw error('IMMUTABLE_ID');
  const param=bind(JSON.stringify(operation.row));
  sql='update public.'+ident(t)+' set ('+keys.map(col).join(',')+')=(select '+keys.map(col).join(',')+' from jsonb_populate_record(null::public.'+ident(t)+','+param+'::jsonb))';
 }else{
  const rows=Array.isArray(operation.row)?operation.row:[operation.row];
  if(!rows.length||rows.length>2000||rows.some(r=>!object(r)))throw error('INVALID_ROW');
  const keys=Object.keys(rows[0]);if(!keys.length||rows.some(r=>Object.keys(r).sort().join(',')!==[...keys].sort().join(',')))throw error('INVALID_ROW');keys.forEach(col);
  if(filters.length)throw error('INVALID_FILTER');
  sql='insert into public.'+ident(t)+'('+keys.map(col).join(',')+') select '+keys.map(col).join(',')+' from jsonb_populate_recordset(null::public.'+ident(t)+','+bind(JSON.stringify(rows))+'::jsonb)';
  if(action==='upsert'){
   const conflict=operation.onConflict;if(!Array.isArray(conflict)||!conflict.length)throw error('INVALID_CONFLICT');conflict.forEach(col);
   const changed=keys.filter(k=>!conflict.includes(k));
   sql+=' on conflict ('+conflict.map(col).join(',')+') '+(changed.length?'do update set '+changed.map(k=>col(k)+'=excluded.'+col(k)).join(','):'do nothing');
  }
 }
 if(where.length)sql+=' where '+where.join(' and ');
 if(action==='select'){
  const order=operation.order||[];if(!Array.isArray(order)||order.length>5)throw error('INVALID_ORDER');
  if(order.length)sql+=' order by '+order.map(o=>col(o.column)+(o.ascending===false?' desc':' asc')).join(',');
  const limit=operation.limit??1000,offset=operation.offset??0;
  if(!Number.isSafeInteger(limit)||limit<0||limit>5000||!Number.isSafeInteger(offset)||offset<0)throw error('INVALID_RANGE');
  sql+=' limit '+bind(limit)+' offset '+bind(offset);
 }else sql+=' returning '+projection;
 // JSON формируется в PostgreSQL: драйвер Date иначе потеряет микросекунды версии.
 const wrapped=action==='select'?`select coalesce(json_agg(r),'[]'::json) as data from (${sql}) r`:`with r as (${sql}) select coalesce(json_agg(r),'[]'::json) as data from r`;
 const result=await db.query(wrapped,values),rows=result.rows[0].data;
 if(operation.single){if(rows.length!==1)throw error('PGRST116');return rows[0];}
 if(operation.maybeSingle){if(rows.length>1)throw error('PGRST116');return rows[0]||null;}
 return rows;
}
async function execute(db,profile,operation){
 if(!object(operation))throw error('INVALID_OPERATION');
 const role=await actorContext(db,profile);
 if(operation.type==='rpc')return rpc(db,role,profile,operation);
 if(operation.type==='table')return table(db,role,operation);
 throw error('INVALID_OPERATION');
}
module.exports={execute,actorContext,RPC,TABLES};
