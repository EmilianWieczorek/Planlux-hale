-- app_releases: update control for Planlux Hale desktop app.
-- The Electron updater (packages/desktop/electron/updates) queries this table
-- for the latest stable release and downloads the installer from download_url.

CREATE TABLE IF NOT EXISTS public.app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  title text,
  changelog text,
  download_url text NOT NULL,
  sha256 text NOT NULL,
  mandatory boolean DEFAULT false,
  min_supported_version text,
  rollout_percent integer DEFAULT 100,
  active boolean DEFAULT true,
  channel text DEFAULT 'stable',
  created_at timestamptz DEFAULT now()
);

-- Index for the updater query: active + channel, then order by version desc
CREATE INDEX IF NOT EXISTS idx_app_releases_active_channel_version
  ON public.app_releases (active, channel, version DESC)
  WHERE active = true;

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

-- Allow read access for anon and authenticated only when active = true
CREATE POLICY "allow_read_active_releases"
  ON public.app_releases
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- Inserts/updates/deletes typically done via dashboard or backend; restrict to authenticated (or add service role).
-- For public read-only, the policy above is sufficient.
