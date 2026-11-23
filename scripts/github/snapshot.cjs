// Согласованный снимок: строки PostgreSQL остаются текстом JSON без округления JS.
// Восстановление допускается только в специально помеченную временную базу.
'use strict';
const {createHmac}=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const S=require('../../assets/github/store.cjs');
const P=require('../../assets/github/protocol.js');
const TABLES=['auth.users','public.admins','public.staff','public.reps','public.stores','public.rep_access','public.rep_users','public.docs','public.orders','public.payouts','public.one_c_register_reports','public.audit_log','private.shared_link','private.import_seen'];
const AUTH_COLUMNS=['id','instance_id','aud','role','email','created_at','updated_at'];
const BUCKETS=16,MAX_CHUNK=8*1024*1024;
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const relation=t=>{if(!TABLES.includes(t))throw P.error('INVALID_SNAPSHOT_TABLE');return t.split('.').map(quote).join('.');};
const fingerprint=(key,value)=>createHmac('sha256',P.un64(key,32)).update('sverka-snapshot-v1\0').update(value).digest('hex');
const meta=(store,audience,revision)=>({store,audience,revision});
async function layout(db){
 const publicTables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>'public.'+r.tablename);
 if(S.canonical(publicTables)!==S.canonical(TABLES.filter(t=>t.startsWith('public.')).sort()))throw P.error('UNSUPPORTED_SCHEMA');
 const privateTables=(await db.query("select tablename from pg_tables where schemaname='private' order by tablename")).rows.map(r=>'private.'+r.tablename);
 if(S.canonical(privateTables)!==S.canonical(TABLES.filter(t=>t.startsWith('private.')).sort()))throw P.error('UNSUPPORTED_SCHEMA');
 const out=[];
 for(const table of TABLES){
  const [schema,name]=table.split('.');
  const columns=(await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position',[schema,name])).rows.map(r=>r.column_name);
  const keys=(await db.query(`select a.attname from pg_index i cross join lateral unnest(i.indkey) with ordinality k(n,pos)
   join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.n where i.indrelid=$1::regclass and i.indisprimary order by k.pos`,[table])).rows.map(r=>r.attname);
  const selected=table==='auth.users'?AUTH_COLUMNS:columns;
  if(!keys.length||selected.some(c=>!columns.includes(c)))throw P.error('UNSUPPORTED_SCHEMA');
  out.push({table,columns:selected,keys});
 }
 return out;
}
async function exportDatabase(db){
 const isolation=(await db.query('show transaction_isolation')).rows[0].transaction_isolation;
 if(!['repeatable read','serializable'].includes(isolation))throw P.error('SNAPSHOT_NEEDS_TRANSACTION');
 const spec=await layout(db),chunks=[];
 for(const s of spec){
  const projected=s.columns.map(quote).join(','),pk=s.keys.map(quote).join(',');
  // Ключ разбивает таблицу стабильно: изменение одной строки не перезаписывает весь архив 1С.
  const rows=await db.query(`select row_to_json(r)::text as row, get_byte(decode(md5(json_build_array(${s.keys.map(k=>'r.'+quote(k)).join(',')})::text),'hex'),0) % ${BUCKETS} as bucket
   from (select ${projected} from ${relation(s.table)} order by ${pk}) r`);
  const buckets=Array.from({length:BUCKETS},()=>[]);
  for(const row of rows.rows)buckets[row.bucket].push(row.row);
  for(let i=0;i<BUCKETS;i++){
   const data=S.canonical(buckets[i]);if(Buffer.byteLength(data)>MAX_CHUNK)throw P.error('SNAPSHOT_CHUNK_TOO_LARGE');
   chunks.push({id:s.table.replace('.','_')+'_'+String(i).padStart(2,'0'),data,count:buckets[i].length});
  }
 }
 const seq=(await db.query('select last_value::text,is_called from public.audit_log_id_seq')).rows[0];
 return {spec,chunks,sequence:seq};
}
async function encodeSnapshot(snapshot,{store,key,schemaHash,previous=null,extra={}}){
 if(!/^[a-f0-9]{64}$/.test(schemaHash)||previous&&(previous.store!==store||previous.schemaHash!==schemaHash))throw P.error('SCHEMA_MISMATCH');
 const revision=(previous?.revision||0)+1,files=[],chunks={};
 for(const chunk of snapshot.chunks){
  const hash=fingerprint(key,chunk.data),old=previous?.chunks?.[chunk.id];
  if(old?.hash===hash){chunks[chunk.id]=old;continue;}
  if(chunk.count===0){chunks[chunk.id]={path:null,hash,count:0,revision:0};continue;}
  const version=(old?.revision||0)+1,path='data/v1/chunks/'+chunk.id+'.enc';
  const envelope=await S.sealKey({gzip:gzipSync(chunk.data).toString('base64')},key,meta(store,chunk.id,version));
  chunks[chunk.id]={path,hash,count:chunk.count,revision:version};files.push({path,envelope});
 }
 const root={format:'sverka-snapshot-v1',store,schemaHash,revision,spec:snapshot.spec,sequence:snapshot.sequence,chunks,extra};
 files.push({path:'data/v1/state.enc',envelope:await S.sealKey(root,key,meta(store,'state',revision))});
 return {root,files};
}
async function decodeSnapshot(root,{store,key,schemaHash,read}){
 if(root.format!=='sverka-snapshot-v1'||root.store!==store||root.schemaHash!==schemaHash||!Number.isSafeInteger(root.revision)||root.revision<1)throw P.error('SCHEMA_MISMATCH');
 if(S.canonical(root.spec.map(s=>s.table))!==S.canonical(TABLES)||Object.keys(root.chunks).length!==TABLES.length*BUCKETS)throw P.error('INVALID_SNAPSHOT');
 const chunks=[];
 for(const s of root.spec)for(let i=0;i<BUCKETS;i++){
  const id=s.table.replace('.','_')+'_'+String(i).padStart(2,'0'),c=root.chunks[id];
  if(c?.count===0&&c.path===null&&c.revision===0&&c.hash===fingerprint(key,'[]')){chunks.push({id,data:'[]',count:0});continue;}
  if(!c||c.path!=='data/v1/chunks/'+id+'.enc')throw P.error('INVALID_SNAPSHOT');
  const payload=await S.openKey(await read(c.path),key,meta(store,id,c.revision));
  const data=gunzipSync(P.un64(payload.gzip,MAX_CHUNK),{maxOutputLength:MAX_CHUNK}).toString('utf8');
  const rows=JSON.parse(data);
  if(fingerprint(key,data)!==c.hash||!Array.isArray(rows)||rows.length!==c.count||rows.some(r=>typeof r!=='string'))throw P.error('INVALID_SNAPSHOT');
  chunks.push({id,data,count:c.count});
 }
 return {spec:root.spec,chunks,sequence:root.sequence};
}
async function restoreDatabase(db,snapshot){
 const marker=(await db.query("select current_setting('sverka.github_ephemeral',true) as value")).rows[0].value;
 if(marker!=='yes')throw P.error('RESTORE_REQUIRES_EPHEMERAL_DATABASE');
 if(S.canonical(snapshot.spec)!==S.canonical(await layout(db)))throw P.error('SCHEMA_MISMATCH');
 // Только доверенное временное окружение. Иначе сработали бы триггеры выдачи/аудита.
 await db.query('set local session_replication_role=replica');
 // Не сбрасывать чужие счётчики служебного Auth при CASCADE. Наш audit восстанавливаем явно.
 await db.query('truncate '+TABLES.map(relation).join(',')+' continue identity cascade');
 for(const s of snapshot.spec){
  for(let i=0;i<BUCKETS;i++){
   const id=s.table.replace('.','_')+'_'+String(i).padStart(2,'0'),chunk=snapshot.chunks.find(c=>c.id===id);
   if(!chunk)throw P.error('INVALID_SNAPSHOT');
   const rows=JSON.parse(chunk.data);if(!rows.length)continue;
   const columns=s.columns.map(quote).join(',');
   await db.query(`insert into ${relation(s.table)} (${columns}) overriding system value select ${columns} from json_populate_recordset(null::${relation(s.table)},$1::json)`,['['+rows.join(',')+']']);
  }
 }
 if(!/^\d+$/.test(snapshot.sequence.last_value)||typeof snapshot.sequence.is_called!=='boolean')throw P.error('INVALID_SEQUENCE');
 await db.query("select setval('public.audit_log_id_seq'::regclass,$1::bigint,$2)",[snapshot.sequence.last_value,snapshot.sequence.is_called]);
 await db.query('set local session_replication_role=origin');
 // Побайтовая сверка строк, включая точные decimal, микросекунды и авторов.
 const actual=await exportDatabase(db);
 if(S.canonical(actual)!==S.canonical(snapshot))throw P.error('RESTORE_MISMATCH');
}
module.exports={TABLES,exportDatabase,encodeSnapshot,decodeSnapshot,restoreDatabase};
