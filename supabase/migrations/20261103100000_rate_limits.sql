-- Milestone 7: durable rate limiting for public (anonymous) endpoints and
-- sign-in, shared by every app instance. Only salted hashes of client
-- addresses are stored, never the addresses themselves.

create table private.rate_limit_hits (
  bucket text not null,
  key_hash text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, key_hash, window_start)
);

-- Returns true while the caller is within `p_limit` hits per window.
create function public.public_rate_limit_hit(p_bucket text, p_key_hash text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_bucket !~ '^[a-z_]{3,40}$' or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit not between 1 and 10000 or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into private.rate_limit_hits (bucket, key_hash, window_start, hits)
  values (p_bucket, p_key_hash, v_window, 1)
  on conflict (bucket, key_hash, window_start) do update set hits = private.rate_limit_hits.hits + 1
  returning hits into v_hits;
  -- Opportunistic cleanup of old windows.
  if random() < 0.01 then
    delete from private.rate_limit_hits where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_limit;
end;
$$;

revoke all on table private.rate_limit_hits from public, anon, authenticated;
revoke all on function public.public_rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.public_rate_limit_hit(text, text, integer, integer) to service_role;
