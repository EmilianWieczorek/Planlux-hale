-- =============================================================================
-- Diagnostyka RLS i liczb wierszy: pricing_surface, addons_surcharges, standard_included
-- Uruchom w Supabase Dashboard → SQL Editor (jako użytkownik z uprawnieniami).
-- =============================================================================

-- 1) Liczby wierszy (dla anon/authenticated zależą od RLS)
SELECT 'pricing_surface' AS tbl, COUNT(*) AS cnt FROM public.pricing_surface
UNION ALL
SELECT 'addons_surcharges', COUNT(*) FROM public.addons_surcharges
UNION ALL
SELECT 'standard_included', COUNT(*) FROM public.standard_included;

-- 2) Polityki RLS na tych tabelach
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename IN ('pricing_surface', 'addons_surcharges', 'standard_included')
ORDER BY tablename, policyname;

-- 3) Czy RLS jest włączone
SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname IN ('pricing_surface', 'addons_surcharges', 'standard_included');

-- =============================================================================
-- NAPRAWA: jeśli brakuje polityk SELECT dla anon/authenticated (np. po ręcznej
-- zmianie schemy), odkomentuj i uruchom poniższe bloki.
-- =============================================================================

-- DROP istniejących polityk read (tylko jeśli chcesz je zastąpić):
-- DROP POLICY IF EXISTS "Allow anon read addons_surcharges" ON public.addons_surcharges;
-- DROP POLICY IF EXISTS "Authenticated read addons_surcharges" ON public.addons_surcharges;
-- DROP POLICY IF EXISTS "Allow anon read standard_included" ON public.standard_included;
-- DROP POLICY IF EXISTS "Authenticated read standard_included" ON public.standard_included;

-- Tworzenie polityk SELECT (idempotent – ignoruj błąd „policy already exists”):
-- addons_surcharges
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'addons_surcharges' AND policyname = 'Allow anon read addons_surcharges') THEN
    CREATE POLICY "Allow anon read addons_surcharges" ON public.addons_surcharges FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'addons_surcharges' AND policyname = 'Authenticated read addons_surcharges') THEN
    CREATE POLICY "Authenticated read addons_surcharges" ON public.addons_surcharges FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- standard_included
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'standard_included' AND policyname = 'Allow anon read standard_included') THEN
    CREATE POLICY "Allow anon read standard_included" ON public.standard_included FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'standard_included' AND policyname = 'Authenticated read standard_included') THEN
    CREATE POLICY "Authenticated read standard_included" ON public.standard_included FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
