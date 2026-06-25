-- Re-point the company unpaid-on-delivery trigger off the dropped status_label column.
DROP TRIGGER IF EXISTS trigger_set_order_unpaid_on_delivery ON public.company_parcels;
CREATE TRIGGER trigger_set_order_unpaid_on_delivery
  AFTER INSERT OR UPDATE OF status_id ON public.company_parcels
  FOR EACH ROW EXECUTE FUNCTION set_order_unpaid_on_delivery();

-- Drop the denormalized parcel status caches. status_id is now the sole status on parcels.
ALTER TABLE public.company_parcels
  DROP COLUMN IF EXISTS status_label,
  DROP COLUMN IF EXISTS status_color;

ALTER TABLE public.courier_parcels
  DROP COLUMN IF EXISTS status_label,
  DROP COLUMN IF EXISTS status_color;
