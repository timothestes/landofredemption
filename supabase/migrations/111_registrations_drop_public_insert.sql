-- The public /register form used to insert straight into registrations with the
-- anon key, so the "Anyone can register" policy let anyone write rows directly
-- through PostgREST — including the bot that posted 897 rows on 2026-10-05.
-- app/register/actions.ts now validates the submission (open window, Turnstile,
-- input checks) and inserts with the service role, which bypasses RLS, so the
-- public INSERT policy is no longer needed. Admin SELECT/UPDATE/DELETE policies
-- are untouched.
DROP POLICY IF EXISTS "Anyone can register" ON registrations;
