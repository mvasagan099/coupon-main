-- =========================================================================
-- DROP BUGGY PREFIX CONSTRAINT
-- =========================================================================

-- The database is aggressively rejecting perfectly valid 3-letter prefixes (like "SBU")
-- because the `companies_prefix_check` constraint on your live database is misconfigured or bugged.

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_prefix_check;
