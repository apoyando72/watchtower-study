-- 등단 순서 페이지의 유의 사항 저장용. Supabase > SQL Editor 에서 한 번만 실행하세요.
alter table settings add column if not exists order_notes text;
