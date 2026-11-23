-- Единый контракт с assets/search.js: номера без опечаток, деньги строго до копейки.
-- Имена распознаёт общий клиентский поиск и передаёт упорядоченный список поставщиков.
create or replace function private.search_compact(p_text text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(translate(replace(replace(replace(replace(lower(normalize(coalesce(p_text, ''), NFKC)),
    'ё', 'е'), 'ӏ', 'i'), 'Ӏ', 'i'), 'і', 'i'), 'авекмнорстху', 'abekmhopctxy'), '[^a-zа-я0-9]', '', 'g')
$$;

create or replace function private.search_alternate(p_text text) returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare v text := lower(normalize(coalesce(p_text, ''), NFKC));
begin
  v := replace(replace(replace(replace(v, 'ё', 'е'), 'ӏ', 'i'), 'Ӏ', 'i'), 'і', 'i');
  v := replace(replace(replace(replace(replace(replace(replace(v,
    'ж', 'zh'), 'ц', 'ts'), 'ч', 'ch'), 'ш', 'sh'), 'щ', 'sh'), 'ю', 'yu'), 'я', 'ya');
  v := translate(replace(replace(v, 'ъ', ''), 'ь', ''), 'абвгдезийклмнопрстуфхыэ', 'abvgdeziiklmnoprstufhye');
  v := regexp_replace(regexp_replace(regexp_replace(regexp_replace(v, 'shch|sch', 'sh', 'g'),
    'kh', 'h', 'g'), 'dzh|dj', 'zh', 'g'), 'iy|yi|ii', 'i', 'g');
  v := regexp_replace(v, '[^a-z0-9]', '', 'g');
  return regexp_replace(v, '(^|\D)0+(?=\d)', '\1', 'g');
end $$;

create or replace function private.search_invoice_number_score(p_term jsonb, p_in_no text, p_num text, p_inc numeric)
returns integer language plpgsql immutable parallel safe set search_path = '' as $$
declare
  v_score integer := case when p_inc * 100 = (p_term->>'amount_cents')::numeric then 220 else 0 end;
  v_q text; v_alt text; v_digits text;
  v_num text; v_compact text; v_nd text;
begin
  if (p_term->>'amount_only')::boolean then return v_score; end if;
  v_q := private.search_compact(p_term->>'raw');
  v_alt := private.search_alternate(p_term->>'raw');
  v_digits := regexp_replace(regexp_replace(p_term->>'raw', '\D', '', 'g'), '^0+(?=\d)', '');
  foreach v_num in array array[p_in_no, p_num] loop
    if v_num is null or v_num = '' then continue; end if;
    v_compact := private.search_compact(v_num);
    v_nd := regexp_replace(regexp_replace(v_num, '\D', '', 'g'), '^0+(?=\d)', '');
    if v_compact = v_q then v_score := greatest(v_score, 220);
    elsif private.search_alternate(v_num) = v_alt then v_score := greatest(v_score, 212);
    elsif (p_term->>'digit_only')::boolean and v_nd = v_digits then v_score := greatest(v_score, 210);
    elsif starts_with(v_compact, v_q) or ((p_term->>'digit_only')::boolean and starts_with(v_nd, v_digits)) then v_score := greatest(v_score, 170);
    elsif strpos(v_compact, v_q) > 0 or ((p_term->>'digit_only')::boolean and length(v_digits) >= 2 and strpos(v_nd, v_digits) > 0) then v_score := greatest(v_score, 130);
    end if;
  end loop;
  return v_score;
end $$;

revoke all on function private.search_compact(text), private.search_alternate(text),
  private.search_invoice_number_score(jsonb, text, text, numeric) from public, anon, authenticated;

create index if not exists docs_search_amount_idx on public.docs (inc, doc_at desc, id) where kind = 'in' and not deleted;

create or replace function public.search_invoices(p_filter jsonb, p_limit integer default 40) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  v_reps uuid[]; v_exclude uuid[]; v_terms jsonb; v_text boolean; v_term jsonb; v_money numeric;
  v_limit integer := greatest(1, least(coalesce(p_limit, 40), 200));
begin
  if not (select private.is_admin()) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if jsonb_typeof(p_filter) is distinct from 'object'
     or length(btrim(coalesce(p_filter->>'query', ''))) not between 1 and 160
     or jsonb_typeof(p_filter->'has_text') is distinct from 'boolean'
     or jsonb_typeof(p_filter->'rep_ids') is distinct from 'array'
     or jsonb_typeof(p_filter->'exclude_ids') is distinct from 'array'
     or jsonb_typeof(p_filter->'terms') is distinct from 'array' then
    raise exception 'Некорректный поисковый запрос' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filter->'rep_ids') > 5000 or jsonb_array_length(p_filter->'exclude_ids') > 5000
     or jsonb_array_length(p_filter->'terms') > 8 then
    raise exception 'Слишком большой поисковый запрос' using errcode = '22023';
  end if;
  begin
    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_reps from jsonb_array_elements_text(p_filter->'rep_ids') x;
    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_exclude from jsonb_array_elements_text(p_filter->'exclude_ids') x;
  exception when invalid_text_representation then
    raise exception 'Некорректный поставщик или документ' using errcode = '22023';
  end;
  v_terms := p_filter->'terms'; v_text := (p_filter->>'has_text')::boolean;
  for v_term in select value from jsonb_array_elements(v_terms) loop
    if jsonb_typeof(v_term) is distinct from 'object' or length(coalesce(v_term->>'raw', '')) not between 1 and 64
       or (v_term->>'raw') !~ '[0-9]' or private.search_compact(v_term->>'raw') = ''
       or jsonb_typeof(v_term->'amount_only') is distinct from 'boolean'
       or jsonb_typeof(v_term->'digit_only') is distinct from 'boolean'
       or not (v_term ? 'amount_cents') then
      raise exception 'Некорректный номер или сумма' using errcode = '22023';
    end if;
    if v_term->'amount_cents' <> 'null'::jsonb then
      if jsonb_typeof(v_term->'amount_cents') is distinct from 'number' or (v_term->>'amount_cents') !~ '^[0-9]{1,16}$'
         or (v_term->>'amount_cents')::numeric > 9007199254740991 then
        raise exception 'Некорректная сумма' using errcode = '22023';
      end if;
    end if;
  end loop;
  select coalesce(jsonb_agg(term || jsonb_build_object('digits', regexp_replace(regexp_replace(term->>'raw', '\D', '', 'g'), '^0+(?=\d)', ''))), '[]')
    into v_terms from jsonb_array_elements(v_terms) term;
  select (term->>'amount_cents')::numeric / 100 into v_money from jsonb_array_elements(v_terms) term
    where (term->>'amount_only')::boolean limit 1;
  if (v_text and cardinality(v_reps) = 0) or (not v_text and jsonb_array_length(v_terms) = 0) then
    return json_build_object('items', '[]'::json, 'total', 0);
  end if;
  return (
    -- Дешёвый числовой отбор до транслитерации: одинаковые цифры или точная сумма.
    -- Он может оставить лишнего кандидата, но никогда не подтверждает совпадение сам.
    with candidates as materialized (
      select d.* from public.docs d
      where d.kind = 'in' and not d.deleted and (v_money is null or d.inc = v_money)
        and (not v_text or d.rep_id = any(v_reps)) and not (d.id = any(v_exclude))
        and not exists (
          select 1 from jsonb_array_elements(v_terms) term
          where not (coalesce(d.inc * 100 = (term->>'amount_cents')::numeric, false)
            or (not (term->>'amount_only')::boolean and strpos(regexp_replace(coalesce(d.in_no, '') || ' ' || d.num, '\D', '', 'g'), term->>'digits') > 0))
        )
    ), found as materialized (
      select d.*, s.rank
      from candidates d
      cross join lateral (
        select coalesce(sum(score), 0) as rank, coalesce(bool_and(score > 0), true) as matched
        from (select private.search_invoice_number_score(term, d.in_no, d.num, d.inc) as score
          from jsonb_array_elements(v_terms) term) t
      ) s
      where s.matched
    ), limited as (
      select d.id, d.rep_id, d.in_no, d.num, d.doc_at as at, d.inc, d.open_amount as open,
        p.id as pay_id, p.status as pay_status, d.rank, array_position(v_reps, d.rep_id) as rep_rank
      from found d
      left join lateral (select x.id, x.status from public.payouts x where x.doc_id = d.id order by x.created_at, x.id limit 1) p on true
      order by d.rank desc, array_position(v_reps, d.rep_id), d.doc_at desc, d.id
      limit v_limit
    )
    select json_build_object('items', coalesce((select json_agg(to_jsonb(l) - 'rank' - 'rep_rank'
      order by rank desc, rep_rank, at desc, id) from limited l), '[]'::json), 'total', (select count(*) from found))
  );
end $$;
revoke all on function public.search_invoices(jsonb, integer) from public, anon;
grant execute on function public.search_invoices(jsonb, integer) to authenticated;
comment on function public.search_invoices(jsonb, integer) is 'Поиск накладных по всем датам: поставщики из общего поиска, строгие суммы и номера. Только администратор; никаких изменений выплат.';
