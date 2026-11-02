-- PostgreSQL 15
CREATE TABLE api_clients (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER      NOT NULL,
  name       VARCHAR(100) NOT NULL,
  key_hash   CHAR(64)     NOT NULL UNIQUE,  -- API キーの SHA-256（16 進）
  revoked_at TIMESTAMPTZ
);

CREATE TABLE tasks (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER      NOT NULL,
  title      VARCHAR(100) NOT NULL,
  status     VARCHAR(10)  NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'DOING', 'DONE')),
  due_date   DATE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, title)
);
