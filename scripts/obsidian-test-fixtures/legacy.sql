-- Existing rows seeded before the additive migration; no real account or note.
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');
insert into public.profiles(user_id,status,role,telegram_user_id,timezone) values
  ('00000000-0000-4000-8000-000000000001','active','user',101,'UTC'),
  ('00000000-0000-4000-8000-000000000002','active','user',102,'UTC');
insert into public.user_obsidian_settings(user_id,enabled,is_active,mode,status) values
  ('00000000-0000-4000-8000-000000000001',true,true,'syncthing','connected'),
  ('00000000-0000-4000-8000-000000000002',true,true,'syncthing','connected');
insert into public.life_entities(id,user_id,entity_type,title) values
  ('00000000-0000-4000-8000-000000003001','00000000-0000-4000-8000-000000000001','capture','synthetic legacy fixture');
insert into public.obsidian_sync_queue(id,user_id,life_entity_id,status,attempts,locked_at,completed_at,last_error,payload_json) values
  ('00000000-0000-4000-8000-000000004001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000003001','processing',2,'2000-01-01T00:00:00Z',null,null,'{}'),
  ('00000000-0000-4000-8000-000000004002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000003001','completed',1,null,'2000-01-02T00:00:00Z',null,'{}'),
  ('00000000-0000-4000-8000-000000004003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000003001','failed',4,null,null,'synthetic previous error','{}'),
  ('00000000-0000-4000-8000-000000004004','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000003001','cancelled',0,null,null,null,'{}');
