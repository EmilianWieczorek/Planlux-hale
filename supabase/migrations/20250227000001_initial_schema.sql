-- Planlux Hale: initial schema + RLS. Backend: Supabase only (no Google Apps Script).
-- Run with: supabase db push (or supabase migration up)

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum-like: role in profiles
CREATE TYPE app_role AS ENUM ('ADMIN', 'MANAGER', 'SALES');

-- profiles: extends auth.users, role from here
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  role app_role NOT NULL DEFAULT 'SALES',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_email ON public.profiles(email);
CREATE INDEX idx_profiles_role ON public.profiles(role);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins and managers can read all profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

CREATE POLICY "Users can update own profile (limited cols)"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Only service role or trigger from auth can insert (on signup)
CREATE POLICY "Allow insert for authenticated (self)"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- clients
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name text,
  person_name text,
  email text,
  phone text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_clients_email ON public.clients(email);
CREATE INDEX idx_clients_company_name ON public.clients(company_name);
CREATE INDEX idx_clients_created_by ON public.clients(created_by);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creator can manage own clients"
  ON public.clients FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Admins and managers can read all clients"
  ON public.clients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

-- offer_counters: per-year sequence for final offer numbers
CREATE TABLE public.offer_counters (
  year int PRIMARY KEY,
  next_seq int NOT NULL DEFAULT 1
);

ALTER TABLE public.offer_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read counters"
  ON public.offer_counters FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only service role can update counters (RPC will use SECURITY DEFINER)"
  ON public.offer_counters FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- offers
CREATE TABLE public.offers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_number text,
  offer_number_status text NOT NULL DEFAULT 'TEMP', -- 'TEMP' | 'FINAL'
  status text NOT NULL DEFAULT 'DRAFT',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  payload jsonb DEFAULT '{}',
  pricing jsonb DEFAULT '{}',
  totals jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  CONSTRAINT offers_offer_number_final_unique UNIQUE (offer_number) 
    WHERE (offer_number_status = 'FINAL' AND offer_number IS NOT NULL)
);

CREATE INDEX idx_offers_created_by_created_at ON public.offers(created_by, created_at DESC);
CREATE INDEX idx_offers_offer_number ON public.offers(offer_number) WHERE offer_number IS NOT NULL;
CREATE INDEX idx_offers_status ON public.offers(status);

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creator can manage own offers"
  ON public.offers FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Admins and managers can read all offers"
  ON public.offers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

-- email_history
CREATE TABLE public.email_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  subject text,
  body_preview text,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING',
  error text,
  meta jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_email_history_offer_id_sent_at ON public.email_history(offer_id, sent_at DESC);
CREATE INDEX idx_email_history_created_by ON public.email_history(created_by);

ALTER TABLE public.email_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creator can read own offer emails"
  ON public.email_history FOR SELECT
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.offers o
      WHERE o.id = email_history.offer_id AND o.created_by = auth.uid()
    )
  );

CREATE POLICY "Admins and managers can read all email_history"
  ON public.email_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

CREATE POLICY "Authenticated can insert email_history (for own offers)"
  ON public.email_history FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- pdf_history
CREATE TABLE public.pdf_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb DEFAULT '{}',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_pdf_history_offer_id ON public.pdf_history(offer_id);
CREATE INDEX idx_pdf_history_created_by ON public.pdf_history(created_by);

ALTER TABLE public.pdf_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creator can read own pdf_history"
  ON public.pdf_history FOR SELECT
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.offers o
      WHERE o.id = pdf_history.offer_id AND o.created_by = auth.uid()
    )
  );

CREATE POLICY "Admins and managers can read all pdf_history"
  ON public.pdf_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

CREATE POLICY "Authenticated can insert pdf_history"
  ON public.pdf_history FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- base_pricing: replaces Sheets "baza" (cennik, dodatki, standard)
CREATE TABLE public.base_pricing (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  version int NOT NULL,
  source text DEFAULT 'supabase',
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_base_pricing_version ON public.base_pricing(version DESC);
CREATE INDEX idx_base_pricing_created_at ON public.base_pricing(created_at DESC);

ALTER TABLE public.base_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read base_pricing"
  ON public.base_pricing FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can insert/update base_pricing"
  ON public.base_pricing FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'ADMIN'
    )
  );

-- sync_log: device sync audit
CREATE TABLE public.sync_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id text,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  meta jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_log_user_id_created_at ON public.sync_log(user_id, created_at DESC);

ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sync_log"
  ON public.sync_log FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Authenticated can insert sync_log"
  ON public.sync_log FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- RPC: finalize offer number (SECURITY DEFINER to increment counter)
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
  SET offer_number = v_offer_number, offer_number_status = 'FINAL', updated_at = now()
  WHERE id = p_offer_id;

  RETURN jsonb_build_object('ok', true, 'offerNumber', v_offer_number);
END;
$$;

-- Trigger: create profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    'SALES'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON TABLE public.profiles IS 'User profiles and roles; extends auth.users';
COMMENT ON TABLE public.offers IS 'Offers; offer_number finalization via rpc_finalize_offer_number';
COMMENT ON TABLE public.base_pricing IS 'Pricing base (cennik, dodatki, standard); replaces Sheets baza';
