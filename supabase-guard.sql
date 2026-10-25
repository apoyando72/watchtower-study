-- 예전 버전 화면(새로고침 전)에서 저장해도 소유자의 수정이 되돌아가지 않게 하는 안전장치.
-- Supabase > SQL Editor 에서 한 번만 실행하세요. 실행한 뒤에 git push 하세요.
--
-- 새 버전 화면은 저장할 때마다 write_nonce 를 새 값으로 보냅니다.
-- 예전 버전은 이 값을 보내지 않으므로(그대로 유지) 서버가 예전 화면의 저장으로 알아보고,
--   * 항/코멘트/제목/서론 등 구조는 서버 값을 그대로 지키고
--   * 해설(answer, extraAnswer)만, 서버 것보다 더 새로 쓴 경우에 한해 반영합니다.

alter table programs add column if not exists write_nonce text;

create or replace function guard_old_clients() returns trigger
language plpgsql as $$
declare
  merged jsonb := '[]'::jsonb;
  oi jsonb;
  ni jsonb;
  item jsonb;
begin
  if new.write_nonce is distinct from old.write_nonce then
    return new;
  end if;

  for oi in select e from jsonb_array_elements(coalesce(old.items, '[]'::jsonb)) with ordinality as t(e, n) order by n loop
    item := oi;
    select e into ni from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) as t(e) where e->>'id' = oi->>'id' limit 1;
    if ni is not null then
      if coalesce((ni->>'updatedAt')::numeric, 0) > coalesce((oi->>'updatedAt')::numeric, 0) then
        item := item || jsonb_build_object('answer', ni->'answer', 'updatedAt', ni->'updatedAt');
      end if;
      if coalesce((ni->>'extraUpdatedAt')::numeric, 0) > coalesce((oi->>'extraUpdatedAt')::numeric, 0) then
        item := item || jsonb_build_object('extraAnswer', ni->'extraAnswer', 'extraUpdatedAt', ni->'extraUpdatedAt');
      end if;
    end if;
    merged := merged || jsonb_build_array(item);
  end loop;

  new.items := merged;
  new.issue := old.issue;
  new.title := old.title;
  new.subtitle := old.subtitle;
  new.intro := old.intro;
  return new;
end;
$$;

drop trigger if exists guard_old_clients on programs;
create trigger guard_old_clients before update on programs
for each row execute function guard_old_clients();

-- 문제가 생기면 아래 한 줄로 즉시 끌 수 있습니다:
-- drop trigger if exists guard_old_clients on programs;
