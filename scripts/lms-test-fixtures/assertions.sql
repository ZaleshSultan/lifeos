-- Integration assertions against the old schema plus secure_lms_sessions.
begin;
insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.user_lms_settings (user_id,platform_type,username,encrypted_password,ws_token_encrypted,ical_feed_url)
values ('11111111-1111-4111-8111-111111111111','aitu_moodle','existing-student','enc:v1:old-password','enc:v1:old-token','https://example.invalid/existing-calendar');
set local role service_role;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  owner1 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  owner2 uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  r public.user_lms_settings;
begin
  if not public.claim_lms_sync_lease(a,'aitu_moodle',owner1,30) then raise exception 'first lease failed'; end if;
  if public.claim_lms_sync_lease(a,'aitu_moodle',owner2,30) then raise exception 'concurrent lease accepted'; end if;
  if not public.claim_lms_sync_lease(a,'aitu_moodle',owner1,30) then raise exception 'renewal failed'; end if;
  if public.release_lms_sync_lease(a,'aitu_moodle',owner2) then raise exception 'foreign release accepted'; end if;
  if public.save_lms_session(a,owner2,'enc:v1:a:b:c',now()+interval '1 hour') then raise exception 'foreign lease write accepted'; end if;
  if not public.save_lms_session(a,owner1,'enc:v1:a:b:c',now()+interval '1 hour') then raise exception 'session save failed'; end if;
  select * into r from public.user_lms_settings where user_id=a;
  if r.username<>'existing-student' or r.encrypted_password<>'enc:v1:old-password' or r.ws_token_encrypted<>'enc:v1:old-token' or r.ical_feed_url<>'https://example.invalid/existing-calendar' then raise exception 'legacy configuration overwritten'; end if;
  if not public.claim_lms_sync_lease(b,'aitu_moodle',owner2,30) then raise exception 'independent owner blocked'; end if;
  if not public.save_lms_session(b,owner2,'enc:v1:a:b:c',now()+interval '1 hour') then raise exception 'SSO-only save failed'; end if;
  select * into r from public.user_lms_settings where user_id=b;
  if r.username is not null or r.encrypted_password is not null then raise exception 'fake password created'; end if;
  begin
    update public.user_lms_settings set auth_mode='password' where user_id=b;
    raise exception 'password requirement missing';
  exception when check_violation then null;
  end;
  begin
    update public.user_lms_settings set sso_cookie_encrypted='plaintext' where user_id=b;
    raise exception 'plaintext accepted';
  exception when check_violation then null;
  end;
  update public.lms_sync_leases set expires_at=now()-interval '1 second' where user_id=a;
  if public.delete_lms_session(a,owner1) then raise exception 'expired lease delete accepted'; end if;
  if public.save_lms_session(a,owner1,'enc:v1:a:b:c',now()+interval '1 hour') then raise exception 'expired lease save accepted'; end if;
  if not public.claim_lms_sync_lease(a,'aitu_moodle',owner2,30) then raise exception 'expired lease takeover failed'; end if;
  if not public.delete_lms_session(a,owner2) then raise exception 'owned deletion failed'; end if;
  select * into r from public.user_lms_settings where user_id=a;
  if r.sso_cookie_encrypted is not null or r.session_expires_at is not null or r.session_state<>'not_configured' then raise exception 'credential not removed'; end if;
  select * into r from public.user_lms_settings where user_id=b;
  if r.sso_cookie_encrypted is null then raise exception 'foreign credential removed'; end if;
end;
$$;
reset role;
do $$ begin
  if has_column_privilege('authenticated','public.user_lms_settings','sso_cookie_encrypted','SELECT') or has_column_privilege('authenticated','public.user_lms_settings','encrypted_password','SELECT') then raise exception 'browser can read credentials'; end if;
  if has_table_privilege('authenticated','public.user_lms_settings','UPDATE') then raise exception 'browser can write credentials'; end if;
  if has_function_privilege('authenticated','public.claim_lms_sync_lease(uuid,text,uuid,integer)','EXECUTE') or has_function_privilege('anon','public.save_lms_session(uuid,uuid,text,timestamptz)','EXECUTE') then raise exception 'public RPC grant'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
  if (select count(*) from public.safe_user_lms_settings)<>1 or exists(select 1 from public.safe_user_lms_settings where user_id<>auth.uid()) then raise exception 'safe view leaked another owner'; end if;
end $$;
reset role;
rollback;
select 'LMS migration, ownership, ciphertext grants and lease assertions passed' as result;
