-- Trigram similarity search for MenuItem.name (restaurant menu items and supermarket products
-- are the same table — see the MenuItem model), replacing a plain `contains` search that missed
-- typos, word-order differences, and Arabic letter-form variants.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Mirrors apps/api/src/common/arabic-normalize.ts exactly (same three normalizations, same
-- order, same lower-casing) so that the GIN index below and every query against it agree on
-- what "the same text" means. Kept IMMUTABLE so it can back an index; PARALLEL SAFE since it
-- only does pure string manipulation.
CREATE OR REPLACE FUNCTION jovo_normalize_arabic_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(input, '[ً-ْٰ]', '', 'g'), -- strip tashkeel (diacritics)
        '[أإآٱ]', 'ا', 'g' -- unify every alef form to the bare alef
      ),
      'ة', 'ه', 'g' -- taa marbuta -> haa (documented one-way normalization, applied consistently)
    )
  )
$$;

-- A functional GIN trigram index: it only accelerates queries that use this exact expression,
-- which is why every query below reads `jovo_normalize_arabic_text(name)` rather than `name`.
CREATE INDEX IF NOT EXISTS "MenuItem_name_normalized_trgm_idx"
  ON "MenuItem" USING gin (jovo_normalize_arabic_text(name) gin_trgm_ops);
