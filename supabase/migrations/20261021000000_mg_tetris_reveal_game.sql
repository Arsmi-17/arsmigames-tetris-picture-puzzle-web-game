-- Shape Reveal picture catalog for Supabase (Postgres).
--
-- Table names contain hyphens, so they must always be written in double
-- quotes, e.g. select * from public."mg-tetris-reveal-game";
--
-- Access model:
--   * Players (anon / authenticated roles) can read only published pictures,
--     and only the public columns. They cannot write anything.
--   * All writes go through the server with the service_role key, which
--     bypasses row level security. Never expose that key in the browser.

-- ---------------------------------------------------------------------------
-- Pictures: metadata and image URLs only. Image files live in storage.
-- ---------------------------------------------------------------------------
create table if not exists public."mg-tetris-reveal-game" (
  id            text primary key
                check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title         text not null check (char_length(title) between 1 and 80),
  theme         text not null check (char_length(theme) between 1 and 40),
  url           text not null unique
                check (url ~ '^https://' and char_length(url) <= 2048),
  thumb_url     text check (thumb_url is null or (thumb_url ~ '^https://' and char_length(thumb_url) <= 2048)),
  alt           text not null check (char_length(alt) between 1 and 300),
  attribution   text check (attribution is null or char_length(attribution) <= 200),
  license       text check (license is null or char_length(license) <= 80),
  min_challenge smallint not null default 0 check (min_challenge between 0 and 7),
  max_challenge smallint not null default 7 check (max_challenge between 0 and 7),
  status        text not null default 'draft'
                check (status in ('draft', 'published', 'unpublished')),
  sort_order    integer not null default 0,
  width         integer check (width is null or width > 0),
  height        integer check (height is null or height > 0),
  bytes         integer check (bytes is null or bytes > 0),
  content_type  text check (content_type is null or content_type in ('image/jpeg', 'image/png', 'image/webp')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text not null,
  constraint "mg-tetris-reveal-game_challenge_range" check (min_challenge <= max_challenge)
);

create index if not exists "mg-tetris-reveal-game_status_order_idx"
  on public."mg-tetris-reveal-game" (status, sort_order, created_at);

-- Keep updated_at current on every change.
create or replace function public."mg-tetris-reveal-game_touch_updated_at"()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists "mg-tetris-reveal-game_touch_updated_at" on public."mg-tetris-reveal-game";
create trigger "mg-tetris-reveal-game_touch_updated_at"
  before update on public."mg-tetris-reveal-game"
  for each row execute function public."mg-tetris-reveal-game_touch_updated_at"();

-- ---------------------------------------------------------------------------
-- Every attempt to publish the public catalog, so a failure is visible
-- and can be retried.
-- ---------------------------------------------------------------------------
create table if not exists public."mg-tetris-reveal-game_publications" (
  version       bigint generated always as identity primary key,
  status        text not null check (status in ('pending', 'succeeded', 'failed')),
  picture_count integer,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  published_by  text not null
);

-- ---------------------------------------------------------------------------
-- Who changed what in the admin.
-- ---------------------------------------------------------------------------
create table if not exists public."mg-tetris-reveal-game_audit_log" (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  picture_id  text references public."mg-tetris-reveal-game" (id) on delete set null,
  detail      jsonb
);

create index if not exists "mg-tetris-reveal-game_audit_log_at_idx"
  on public."mg-tetris-reveal-game_audit_log" (at desc);

-- ---------------------------------------------------------------------------
-- Row level security and privileges
-- ---------------------------------------------------------------------------
alter table public."mg-tetris-reveal-game"              enable row level security;
alter table public."mg-tetris-reveal-game_publications" enable row level security;
alter table public."mg-tetris-reveal-game_audit_log"    enable row level security;

-- Start from no access for the public API roles.
revoke all on public."mg-tetris-reveal-game"              from anon, authenticated;
revoke all on public."mg-tetris-reveal-game_publications" from anon, authenticated;
revoke all on public."mg-tetris-reveal-game_audit_log"    from anon, authenticated;

-- Players may read the public columns only (not updated_by, file details or
-- internal status)...
grant select (id, title, theme, url, thumb_url, alt, attribution, license,
              min_challenge, max_challenge, sort_order)
  on public."mg-tetris-reveal-game" to anon, authenticated;

-- ...and only rows that are published.
drop policy if exists "Players read published pictures" on public."mg-tetris-reveal-game";
create policy "Players read published pictures"
  on public."mg-tetris-reveal-game"
  for select
  to anon, authenticated
  using (status = 'published');

-- No insert/update/delete policies: only the service_role key (server side)
-- can write. Publications and the audit log have no policies at all, so
-- they are invisible to anon and authenticated users.
