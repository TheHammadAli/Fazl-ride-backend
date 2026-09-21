-- Spatial queries (nearby parking, nearby drivers) use PostGIS geography columns.
-- Supabase keeps extensions in the `extensions` schema, which is on the default search_path.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
