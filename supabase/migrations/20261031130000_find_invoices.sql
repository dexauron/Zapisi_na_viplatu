-- Поиск накладной по номеру: входящий номер поставщика (с начала) или номер 1С (полностью).
-- Возвращает и связанную запись на выплату — чтобы из поиска сразу записать или отметить «Оплачено».
create index if not exists docs_in_no_idx on public.docs (lower(in_no) text_pattern_ops) where kind = 'in' and in_no is not null;

create or replace function public.find_invoices(p_q text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_q, '')));
  v_d text := ltrim(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '0');
begin
  if not (select private.is_admin()) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if v_q = '' or length(v_q) > 60 then return '[]'::json; end if;
  return coalesce((select json_agg(x order by x.rank, x.at desc) from (
    select d.id, d.rep_id, d.in_no, d.num, d.doc_at as at, d.inc, d.open_amount as open, p.id as pay_id, p.status as pay_status,
           case when lower(d.in_no) = v_q then 0 when lower(d.in_no) like v_q || '%' then 1
                when v_d <> '' and ltrim(regexp_replace(d.num, '\D', '', 'g'), '0') = v_d then 2 else 3 end as rank
      from public.docs d
      left join lateral (select x.id, x.status from public.payouts x where x.doc_id = d.id order by x.created_at limit 1) p on true
     where d.kind = 'in' and not d.deleted
       and (lower(d.in_no) like v_q || '%'
         -- номер 1С: только если набраны одни цифры (можно с «ПФ»), не короче 5 знаков, совпадение полное
         or (v_q ~ '^(пф)?[0-9]+$' and length(v_d) >= 5 and ltrim(regexp_replace(d.num, '\D', '', 'g'), '0') = v_d))
     order by rank, d.doc_at desc
     limit 40) x), '[]'::json);
end $$;
revoke all on function public.find_invoices(text) from public, anon;
grant execute on function public.find_invoices(text) to authenticated;
