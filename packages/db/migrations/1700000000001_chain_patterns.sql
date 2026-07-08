-- Up Migration

CREATE TABLE chain_patterns (
  id          BIGSERIAL PRIMARY KEY,
  label       TEXT        NOT NULL,
  pattern     TEXT        NOT NULL UNIQUE,
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE chain_patterns IS
  'Word-boundary patterns matched against normalized store rotulos to flag large chains. Editable at runtime.';

INSERT INTO chain_patterns (label, pattern) VALUES
  ('Mercadona',       'MERCADONA'),
  ('Carrefour',       'CARREFOUR'),
  ('Dia',             'DIA'),
  ('Lidl',            'LIDL'),
  ('Aldi',            'ALDI'),
  ('Alcampo',         'ALCAMPO'),
  ('Ahorramas',       'AHORRAMAS'),
  ('Supercor',        'SUPERCOR'),
  ('El Corte Ingles', 'EL CORTE INGLES'),
  ('Eroski',          'EROSKI');

-- Down Migration

DROP TABLE IF EXISTS chain_patterns;
