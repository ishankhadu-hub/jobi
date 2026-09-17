/**
 * Client config. The ONLY required value is EXPO_PUBLIC_API_URL. Supabase values
 * are optional — provide them to switch on real Supabase auth; leave them blank
 * to use the dev-orchestrator's local auth (fully offline dev).
 */
export const config = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5678').replace(/\/+$/, ''),
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  paddleCheckoutUrl: process.env.EXPO_PUBLIC_PADDLE_CHECKOUT_URL || '',
};

// Use real Supabase auth only when both URL + anon key are present.
export const useSupabaseAuth = Boolean(config.supabaseUrl && config.supabaseAnonKey);
