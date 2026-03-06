-- Allow unauthenticated (anon) read of base_pricing so the desktop app can load
-- the pricing base at startup before login. RLS still restricts INSERT/UPDATE to admins.
-- Idempotent: drop if exists then create.

DROP POLICY IF EXISTS "Allow anon read base_pricing" ON public.base_pricing;
CREATE POLICY "Allow anon read base_pricing"
  ON public.base_pricing FOR SELECT
  TO anon
  USING (true);
