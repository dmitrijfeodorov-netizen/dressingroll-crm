do $$
declare
  target record;
  current_def text;
  check_expr text;
  new_check_expr text;
begin
  for target in
    select *
    from (
      values
        ('public'::text, 'clinics'::text, 'clinics_status_check'::text),
        ('public'::text, 'follow_ups'::text, 'follow_ups_status_check'::text)
    ) as t(schema_name, table_name, constraint_name)
  loop
    select pg_get_constraintdef(c.oid)
      into current_def
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = target.schema_name
      and rel.relname = target.table_name
      and c.conname = target.constraint_name
      and c.contype = 'c';

    if current_def is null then
      raise notice 'Constraint %.%.% not found, skipping.',
        target.schema_name,
        target.table_name,
        target.constraint_name;
      continue;
    end if;

    if current_def ilike '%''sending''%' then
      raise notice 'Constraint %.%.% already allows sending, skipping.',
        target.schema_name,
        target.table_name,
        target.constraint_name;
      continue;
    end if;

    check_expr := regexp_replace(current_def, '^CHECK \((.*)\)$', '\1');

    if check_expr = current_def then
      raise exception 'Unsupported CHECK definition format for %.%.%: %',
        target.schema_name,
        target.table_name,
        target.constraint_name,
        current_def;
    end if;

    new_check_expr := format('(%s) OR (status = %L)', check_expr, 'sending');

    execute format(
      'alter table %I.%I drop constraint %I',
      target.schema_name,
      target.table_name,
      target.constraint_name
    );

    execute format(
      'alter table %I.%I add constraint %I check (%s)',
      target.schema_name,
      target.table_name,
      target.constraint_name,
      new_check_expr
    );

    raise notice 'Updated constraint %.%.% to allow sending.',
      target.schema_name,
      target.table_name,
      target.constraint_name;
  end loop;
end $$;
