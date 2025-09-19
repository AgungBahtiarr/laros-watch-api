-- Remove redundant odpId field from connections table
-- Since odpPath already handles multiple ODP IDs

ALTER TABLE "connections" DROP COLUMN IF EXISTS "odp_id";