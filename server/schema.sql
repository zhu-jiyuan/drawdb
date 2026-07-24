CREATE TABLE IF NOT EXISTS sessions (
  token_hash   text PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS diagrams (
  id           uuid PRIMARY KEY,
  name         text NOT NULL DEFAULT 'Untitled diagram',
  database     text NOT NULL DEFAULT 'generic',
  content      jsonb NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  content_hash text NOT NULL,
  size_bytes   integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS diagrams_updated_idx ON diagrams(updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS diagram_revisions (
  id         bigserial PRIMARY KEY,
  diagram_id uuid NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  version    integer NOT NULL,
  name       text NOT NULL,
  database   text NOT NULL,
  content    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(diagram_id, version)
);

CREATE TABLE IF NOT EXISTS mcp_keys (
  id           integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  key_hash     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
