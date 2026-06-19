-- The generator writes last_generated_date back onto recurring_charges,
-- which re-fired the AFTER UPDATE sync trigger -> infinite recursion.
-- Scope the sync trigger to the columns that actually define the schedule
-- so the bookkeeping write (last_generated_date / updated_at) never
-- re-enters the generator.
drop trigger if exists trg_recurring_charges_sync on public.recurring_charges;
create trigger trg_recurring_charges_sync
  after insert or update of
    "DigiCom Business", name, type_id, amount, frequency,
    start_date, end_date, active, description
  on public.recurring_charges
  for each row execute function public.tg_recurring_charges_sync();
