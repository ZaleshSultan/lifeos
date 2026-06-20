alter table public.user_oauth_connections
  drop constraint if exists user_oauth_connections_access_token_encrypted,
  drop constraint if exists user_oauth_connections_refresh_token_encrypted;

alter table public.user_oauth_connections
  add constraint user_oauth_connections_access_token_encrypted
    check (access_token is null or access_token like 'enc:v1:%') not valid,
  add constraint user_oauth_connections_refresh_token_encrypted
    check (refresh_token is null or refresh_token like 'enc:v1:%') not valid;

comment on column public.user_oauth_connections.access_token is
  'Encrypted application-side as enc:v1 AES-256-GCM. Rotate/reconnect any legacy plaintext rows before validating constraint.';

comment on column public.user_oauth_connections.refresh_token is
  'Encrypted application-side as enc:v1 AES-256-GCM. Rotate/reconnect any legacy plaintext rows before validating constraint.';
