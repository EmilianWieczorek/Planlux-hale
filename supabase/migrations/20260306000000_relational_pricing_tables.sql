-- Relational pricing tables: real source of truth for pricing (replaces base_pricing.payload for pricing).
-- Desktop app loads from these tables and caches locally for offline. configSync uses these, not base_pricing JSON.

-- pricing_surface: one row per variant + area tier (variant + name + area_min_m2 + area_max_m2 + price).
CREATE TABLE IF NOT EXISTS public.pricing_surface (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant text NOT NULL,
  name text NOT NULL,
  area_min_m2 numeric NOT NULL DEFAULT 0,
  area_max_m2 numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'm2',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_surface_variant ON public.pricing_surface(variant);
CREATE INDEX IF NOT EXISTS idx_pricing_surface_area ON public.pricing_surface(area_min_m2, area_max_m2);

ALTER TABLE public.pricing_surface ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read pricing_surface"
  ON public.pricing_surface FOR SELECT TO anon USING (true);

CREATE POLICY "Authenticated read pricing_surface"
  ON public.pricing_surface FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only admins can insert/update pricing_surface"
  ON public.pricing_surface FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'ADMIN')
  );

-- addons_surcharges: one row per variant + addon (variant, nazwa, stawka, jednostka).
CREATE TABLE IF NOT EXISTS public.addons_surcharges (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant text NOT NULL,
  nazwa text NOT NULL,
  stawka numeric NOT NULL DEFAULT 0,
  jednostka text NOT NULL DEFAULT 'szt',
  warunek text,
  warunek_type text,
  warunek_min numeric,
  warunek_max numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_addons_surcharges_variant ON public.addons_surcharges(variant);

ALTER TABLE public.addons_surcharges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read addons_surcharges"
  ON public.addons_surcharges FOR SELECT TO anon USING (true);

CREATE POLICY "Authenticated read addons_surcharges"
  ON public.addons_surcharges FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only admins can insert/update addons_surcharges"
  ON public.addons_surcharges FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'ADMIN')
  );

-- standard_included: one row per variant + element (variant, element, ilosc, wartosc_ref).
CREATE TABLE IF NOT EXISTS public.standard_included (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant text NOT NULL,
  element text NOT NULL,
  ilosc numeric NOT NULL DEFAULT 1,
  wartosc_ref numeric NOT NULL DEFAULT 0,
  jednostka text,
  uwagi text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_standard_included_variant ON public.standard_included(variant);

ALTER TABLE public.standard_included ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read standard_included"
  ON public.standard_included FOR SELECT TO anon USING (true);

CREATE POLICY "Authenticated read standard_included"
  ON public.standard_included FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only admins can insert/update standard_included"
  ON public.standard_included FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'ADMIN')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'ADMIN')
  );

COMMENT ON TABLE public.pricing_surface IS 'Pricing tiers per hall variant (real source); desktop syncs and caches for offline';
COMMENT ON TABLE public.addons_surcharges IS 'Addons/surcharges per variant';
COMMENT ON TABLE public.standard_included IS 'Standard included items per variant';
