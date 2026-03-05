-- FAZA 1 (doposażenie) + FAZA 2 Storage
-- finalized_at na offers, triggery updated_at, bucket offer-pdfs + policies

-- offers: dodaj finalized_at jeśli brak
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz NULL;

-- Trigger: automatyczne updated_at dla offers
CREATE OR REPLACE FUNCTION public.set_updated_at_offers()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_offers_updated_at ON public.offers;
CREATE TRIGGER trigger_offers_updated_at
  BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_offers();

-- Trigger: automatyczne updated_at dla clients
CREATE OR REPLACE FUNCTION public.set_updated_at_clients()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_clients_updated_at ON public.clients;
CREATE TRIGGER trigger_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_clients();

-- RPC finalize: ustaw finalized_at
CREATE OR REPLACE FUNCTION public.rpc_finalize_offer_number(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int;
  v_next int;
  v_offer_number text;
  v_created_by uuid;
BEGIN
  SELECT created_by INTO v_created_by FROM public.offers WHERE id = p_offer_id;
  IF v_created_by IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Offer not found');
  END IF;
  IF v_created_by != auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Forbidden');
  END IF;

  v_year := EXTRACT(YEAR FROM now())::int;

  INSERT INTO public.offer_counters (year, next_seq)
  VALUES (v_year, 2)
  ON CONFLICT (year) DO UPDATE
  SET next_seq = public.offer_counters.next_seq + 1
  RETURNING next_seq - 1 INTO v_next;

  v_offer_number := v_year || '/' || lpad(v_next::text, 4, '0');

  UPDATE public.offers
  SET offer_number = v_offer_number, offer_number_status = 'FINAL', finalized_at = now(), updated_at = now()
  WHERE id = p_offer_id;

  RETURN jsonb_build_object('ok', true, 'offerNumber', v_offer_number);
END;
$$;

-- FAZA 2: Storage bucket offer-pdfs (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'offer-pdfs',
  'offer-pdfs',
  false,
  52428800,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf']::text[];

-- Ścieżka plików: <owner_id>/<offer_id>/<offer_number_or_temp>.pdf
CREATE POLICY "offer_pdfs_owner_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'offer-pdfs' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "offer_pdfs_admin_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'offer-pdfs' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'MANAGER')));

CREATE POLICY "offer_pdfs_owner_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'offer-pdfs' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "offer_pdfs_owner_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'offer-pdfs' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "offer_pdfs_owner_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'offer-pdfs' AND (auth.uid())::text = (storage.foldername(name))[1]);

COMMENT ON COLUMN public.offers.finalized_at IS 'Set when offer_number_status becomes FINAL (rpc_finalize_offer_number).';
