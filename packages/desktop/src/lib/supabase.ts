/**
 * Supabase client for remote config (pricing, addons, standard).
 * Uses anon/public key only – never service role in the desktop app.
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://fxsqwmflnzdnalkhwnuz.supabase.co";
const supabaseKey = "sb_publishable_-uI4LEze8IwCUmgK-K6Jkg_bJEDB-wl";

export const supabase = createClient(supabaseUrl, supabaseKey);
