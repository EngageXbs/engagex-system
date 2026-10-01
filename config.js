/* ====================================================================
   ENGAGE X — DEPLOYMENT CONFIG
   Fill in your own Supabase project details below, then deploy.
   This file is loaded as a plain <script> (not bundled), so these values
   ARE visible to anyone who views the page source. That's expected and
   safe for the SUPABASE_ANON_KEY (Supabase's anon key is meant to be
   public — real protection comes from Row Level Security policies, see
   supabase/schema.sql). Never put a Supabase SERVICE ROLE key here, and
   never put your Anthropic API key here — that one stays server-side only,
   set as a Vercel Environment Variable (ANTHROPIC_API_KEY), consumed by
   api/ai.js.
==================================================================== */
window.EX_CONFIG = {
  // From Supabase dashboard → Project Settings → API
  SUPABASE_URL: "https://klhxhgzaynorempujtxo.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_q_tuA8IoBVH7_MNjd65K6A_hGpF_pX3",

  // Storage bucket name created by supabase/schema.sql (used for QR codes / payment
  // proof uploads). Leave as "assets" unless you renamed the bucket.
  STORAGE_BUCKET: "assets",

  // Set to false to hide/disable the AI Advisor, AI lead scoring, and AI proposal
  // drafting features entirely (useful if you don't want to set up an Anthropic key).
  // Leave true if you *have* set ANTHROPIC_API_KEY in Vercel — the app will call
  // /api/ai, which will itself report a friendly error if that key is missing.
  AI_ENABLED: true,
};
