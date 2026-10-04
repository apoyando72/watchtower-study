-- 참석 체크 기능용. Supabase > SQL Editor 에서 한 번만 실행하세요.
create table if not exists attendance (
  source_url text not null,
  reader_id  text not null,
  kind       text not null,
  checked    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (source_url, reader_id, kind)
);

alter table attendance enable row level security;
drop policy if exists "open" on attendance;
create policy "open" on attendance for all using (true) with check (true);

alter table settings add column if not exists attendance_managers jsonb not null default '[]'::jsonb;
