/**
 * Supabase client runs only in the Electron main process (electron/supabase/client.ts).
 * Renderer must not hold Supabase credentials; use IPC for backend data.
 * Accessing supabase in renderer throws.
 */
function throwNoSupabaseInRenderer(): never {
  throw new Error("Supabase is only in main process; use IPC for backend data.");
}

export const supabase = new Proxy({} as import("@supabase/supabase-js").SupabaseClient, {
  get() {
    throwNoSupabaseInRenderer();
  },
});
