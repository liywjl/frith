-- Full-text search over message bodies: retrieval v0 for the Ask surface.
-- A stored generated column keeps the index in sync with zero application code.
ALTER TABLE "messages"
  ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "body")) STORED;

CREATE INDEX "messages_search_idx" ON "messages" USING gin ("search");
