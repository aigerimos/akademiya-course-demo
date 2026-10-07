create table if not exists public.academy_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  record_type text not null check (record_type in ('lesson', 'quiz')),
  course_id text not null,
  item_id text not null,
  completed boolean not null default false,
  score integer,
  updated_at timestamptz not null default now(),
  unique (user_id, record_type, course_id, item_id),
  check (
    (record_type = 'lesson' and item_id <> 'latest' and completed = true and score is null)
    or
    (record_type = 'quiz' and item_id = 'latest' and completed = false and score between 0 and 5)
  )
);

alter table public.academy_progress enable row level security;

revoke all on table public.academy_progress from anon;
revoke all on table public.academy_progress from public;
grant select, insert, update, delete on table public.academy_progress to authenticated;

drop policy if exists "Users can read their own academy progress" on public.academy_progress;
create policy "Users can read their own academy progress"
  on public.academy_progress for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own academy progress" on public.academy_progress;
create policy "Users can insert their own academy progress"
  on public.academy_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own academy progress" on public.academy_progress;
create policy "Users can update their own academy progress"
  on public.academy_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own academy progress" on public.academy_progress;
create policy "Users can delete their own academy progress"
  on public.academy_progress for delete
  using (auth.uid() = user_id);
