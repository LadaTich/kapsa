-- Kapsa: databázové schéma pro Supabase
-- Spusť celé najednou v Supabase → SQL Editor → New query → Run.
-- Skript jde spustit opakovaně, nic nesmaže.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Nastavení (jeden řádek na uživatele)
create table if not exists public.settings (
  user_id          uuid primary key default auth.uid() references auth.users on delete cascade,
  period_start_day int  not null default 1  check (period_start_day between 1 and 28),
  alert_threshold  int  not null default 80 check (alert_threshold between 50 and 100),
  capture_token    text not null default encode(extensions.gen_random_bytes(18), 'hex') unique,
  created_at       timestamptz not null default now()
);

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  kind       text not null default 'expense' check (kind in ('expense', 'income')),
  color      text not null default '#2F7D5B',
  budget     numeric(12, 2) check (budget is null or budget >= 0),
  sort       int  not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.recurring (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  amount      numeric(12, 2) not null check (amount > 0),
  kind        text not null default 'expense' check (kind in ('expense', 'income')),
  category_id uuid references public.categories on delete set null,
  every       text not null default 'month' check (every in ('week', 'month', 'quarter', 'year')),
  next_date   date not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  occurred_at  timestamptz not null default now(),
  amount       numeric(12, 2) not null check (amount >= 0),
  kind         text not null default 'expense' check (kind in ('expense', 'income')),
  category_id  uuid references public.categories on delete set null,
  merchant     text,
  note         text,
  source       text not null default 'manual' check (source in ('manual', 'applepay', 'csv', 'recurring')),
  status       text not null default 'confirmed' check (status in ('pending', 'confirmed')),
  external_id  text,
  recurring_id uuid references public.recurring on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists transactions_user_date on public.transactions (user_id, occurred_at desc);
create unique index if not exists transactions_user_external on public.transactions (user_id, external_id) where external_id is not null;

create table if not exists public.rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  pattern     text not null,
  category_id uuid not null references public.categories on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, pattern)
);

create table if not exists public.goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  target     numeric(12, 2) not null check (target > 0),
  saved      numeric(12, 2) not null default 0,
  deadline   date,
  color      text not null default '#3B6EA8',
  created_at timestamptz not null default now()
);

-- Rozdělení výplaty a limity v procentech (bezpečné i pro už existující databázi)
alter table public.settings add column if not exists allocation jsonb not null default
  '[{"id":"save","name":"Krátkodobé úspory","pct":20,"type":"save","color":"#3B6EA8"},
    {"id":"invest","name":"Dlouhodobé investice","pct":30,"type":"save","color":"#8E4F9E"},
    {"id":"spend","name":"Spotřeba","pct":50,"type":"spend","color":"#2F7D5B"}]'::jsonb;
alter table public.categories add column if not exists fixed boolean not null default false;
alter table public.categories add column if not exists budget_pct numeric(5, 2) check (budget_pct is null or (budget_pct >= 0 and budget_pct <= 100));
alter table public.transactions add column if not exists bucket text;
alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check check (kind in ('expense', 'income', 'transfer'));

-- Zabezpečení: každý vidí a mění jen svoje řádky
do $$
declare t text;
begin
  foreach t in array array['settings', 'categories', 'recurring', 'transactions', 'rules', 'goals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Přístup přes Data API (přihlášený uživatel, řádky omezuje zabezpečení výše)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.settings, public.categories, public.recurring,
  public.transactions, public.rules, public.goals to authenticated;

-- Pomocné funkce
create or replace function public.kapsa_norm(p text)
returns text language sql immutable
set search_path = public, extensions
as $$ select trim(regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g')) $$;

create or replace function public.kapsa_kc(p numeric)
returns text language sql immutable
as $$ select replace(to_char(round(p), 'FM999,999,990'), ',', ' ') || ' Kč' $$;

-- Peníze na spotřebu v období: (příjem − pevné výdaje) × podíl spotřeby.
-- Když v období ještě nepřišel příjem, počítá s příjmem z minulého období.
create or replace function public.kapsa_pot(p_user uuid, p_start date, p_end date)
returns numeric
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_income numeric;
  v_fixed  numeric;
  v_future numeric := 0;
  v_pct    numeric;
  v_n      bigint;
  r        record;
begin
  select coalesce(sum(amount), 0) into v_income from transactions
   where user_id = p_user and kind = 'income'
     and (occurred_at at time zone 'Europe/Prague')::date >= p_start
     and (occurred_at at time zone 'Europe/Prague')::date < p_end;
  if v_income = 0 then
    select coalesce(sum(amount), 0) into v_income from transactions
     where user_id = p_user and kind = 'income'
       and (occurred_at at time zone 'Europe/Prague')::date >= (p_start - interval '1 month')::date
       and (occurred_at at time zone 'Europe/Prague')::date < p_start;
  end if;

  select coalesce(sum(t.amount), 0) into v_fixed
    from transactions t left join categories c on c.id = t.category_id
   where t.user_id = p_user and t.kind = 'expense'
     and (t.recurring_id is not null or coalesce(c.fixed, false))
     and (t.occurred_at at time zone 'Europe/Prague')::date >= p_start
     and (t.occurred_at at time zone 'Europe/Prague')::date < p_end;

  for r in select * from recurring where user_id = p_user and active and kind = 'expense' loop
    select count(*) into v_n
      from generate_series(r.next_date::timestamp, (p_end - 1)::timestamp,
        case r.every when 'week' then interval '7 days' when 'month' then interval '1 month'
                     when 'quarter' then interval '3 months' else interval '1 year' end) g
     where g::date >= p_start;
    v_future := v_future + v_n * r.amount;
  end loop;

  select (e ->> 'pct')::numeric into v_pct
    from settings s, jsonb_array_elements(s.allocation) e
   where s.user_id = p_user and e ->> 'type' = 'spend' limit 1;

  return greatest(0, v_income - v_fixed - v_future) * coalesce(v_pct, 100) / 100;
end $$;

-- Zápis platby ze Zkratek na iPhonu (automatizace „Transakce“ z Apple Pay).
-- Volá se bez přihlášení, ověřuje se osobním klíčem z nastavení aplikace.
create or replace function public.capture_payment(
  p_token    text,
  p_amount   text,
  p_merchant text default null,
  p_card     text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user      uuid;
  v_start_day int;
  v_threshold int;
  v_raw       text := coalesce(p_amount, '');
  v_clean     text;
  v_amount    numeric;
  v_merchant  text := nullif(trim(coalesce(p_merchant, '')), '');
  v_who       text;
  v_note      text;
  v_cat       uuid;
  v_cat_name  text;
  v_fixed     boolean;
  v_limit     numeric;
  v_spent     numeric;
  v_today     date := (now() at time zone 'Europe/Prague')::date;
  v_pstart    date;
  v_pend      date;
  v_pot       numeric;
  v_var       numeric;
  v_var_today numeric;
  v_days      int;
  v_left      numeric;
  v_pct       numeric;
  v_line1     text;
  v_line2     text := '';
begin
  select s.user_id, s.period_start_day, s.alert_threshold
    into v_user, v_start_day, v_threshold
    from settings s where s.capture_token = p_token;
  if v_user is null then
    raise exception 'Neplatný osobní klíč' using errcode = '28000';
  end if;

  -- Částka může přijít jako „249,00 Kč“, „CZK 1,249.00“ apod.
  v_clean := regexp_replace(v_raw, '[^0-9,.]', '', 'g');
  if strpos(v_clean, ',') > 0 and strpos(v_clean, '.') > 0 then
    if strpos(reverse(v_clean), ',') < strpos(reverse(v_clean), '.') then
      v_clean := replace(replace(v_clean, '.', ''), ',', '.');
    else
      v_clean := replace(v_clean, ',', '');
    end if;
  else
    v_clean := replace(v_clean, ',', '.');
  end if;
  v_clean := trim(both '.' from v_clean);
  begin
    v_amount := v_clean::numeric;
  exception when others then
    raise exception 'Nerozumím částce: %', v_raw;
  end;

  if v_raw !~* '(kč|czk)' and v_raw ~ '[^0-9,.\s]' then
    v_note := 'Cizí měna: ' || v_raw || '. Uprav částku v korunách.';
  end if;

  select r.category_id into v_cat
    from rules r
    join categories c on c.id = r.category_id and not c.archived
   where r.user_id = v_user
     and (' ' || kapsa_norm(v_merchant) || ' ') like ('% ' || r.pattern || '%')
   order by length(r.pattern) desc
   limit 1;

  insert into transactions (user_id, occurred_at, amount, kind, category_id, merchant, note, source, status)
  values (v_user, now(), v_amount, 'expense', v_cat, v_merchant, v_note, 'applepay', 'pending');

  v_who := coalesce(v_merchant, 'platba');
  if v_note is not null then
    return json_build_object('zprava', 'Zapsáno: ' || v_who || ', ' || v_raw || '. Částku v korunách doplň v Kapse.');
  end if;

  -- rozpočtové období
  if extract(day from v_today) >= v_start_day then
    v_pstart := make_date(extract(year from v_today)::int, extract(month from v_today)::int, v_start_day);
  else
    v_pstart := (date_trunc('month', v_today) - interval '1 month')::date + (v_start_day - 1);
  end if;
  v_pend := (v_pstart + interval '1 month')::date;
  v_days := greatest(1, v_pend - v_today);
  v_pot := kapsa_pot(v_user, v_pstart, v_pend);

  -- proměnlivé výdaje (bez pevných a pravidelných)
  select coalesce(sum(t.amount), 0),
         coalesce(sum(t.amount) filter (where (t.occurred_at at time zone 'Europe/Prague')::date = v_today), 0)
    into v_var, v_var_today
    from transactions t left join categories c on c.id = t.category_id
   where t.user_id = v_user and t.kind = 'expense'
     and t.recurring_id is null and not coalesce(c.fixed, false)
     and (t.occurred_at at time zone 'Europe/Prague')::date >= v_pstart
     and (t.occurred_at at time zone 'Europe/Prague')::date < v_pend;

  if v_pot > 0 then
    v_left := (v_pot - v_var + v_var_today) / v_days - v_var_today;
    v_line2 := case when v_left >= 0 then ' Dnes ještě ' || kapsa_kc(v_left) || '.'
                    else ' Dnes nad plánem o ' || kapsa_kc(-v_left) || '.' end;
  end if;

  if v_cat is null then
    return json_build_object('zprava', 'Zapsáno: ' || v_who || ', ' || kapsa_kc(v_amount) || '. Kategorii doplň v Kapse.' || v_line2);
  end if;

  select name, fixed, coalesce(budget_pct * v_pot / 100, budget)
    into v_cat_name, v_fixed, v_limit
    from categories where id = v_cat;

  if v_fixed then
    return json_build_object('zprava', v_cat_name || ': ' || kapsa_kc(v_amount) || ', pevný výdaj.' || v_line2);
  end if;

  select coalesce(sum(amount), 0) into v_spent
    from transactions
   where user_id = v_user and kind = 'expense' and category_id = v_cat
     and (occurred_at at time zone 'Europe/Prague')::date >= v_pstart
     and (occurred_at at time zone 'Europe/Prague')::date < v_pend;

  if v_limit is null or v_limit = 0 then
    v_line1 := v_cat_name || ': ' || kapsa_kc(v_amount) || '.';
  else
    v_pct := round(v_spent / v_limit * 100);
    if v_spent > v_limit then
      v_line1 := v_cat_name || ': přes limit o ' || kapsa_kc(v_spent - v_limit) || '.';
    elsif v_pct >= v_threshold then
      v_line1 := v_cat_name || ': vyčerpáno ' || v_pct || ' % limitu, zbývá ' || kapsa_kc(v_limit - v_spent) || '.';
    else
      v_line1 := v_cat_name || ': zbývá ' || kapsa_kc(v_limit - v_spent) || ' z ' || kapsa_kc(v_limit) || '.';
    end if;
  end if;

  return json_build_object('zprava', v_line1 || v_line2);
end $$;

revoke all on function public.capture_payment(text, text, text, text) from public;
grant execute on function public.capture_payment(text, text, text, text) to anon, authenticated;
revoke all on function public.kapsa_pot(uuid, date, date) from public, anon, authenticated;
