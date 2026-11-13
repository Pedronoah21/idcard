const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL não definido. Veja o .env.example');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: /sslmode=require|neon\.tech/.test(connectionString) ? { rejectUnauthorized: false } : false,
  max: 10,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- modelos de crachá (layout de frente e verso)
CREATE TABLE IF NOT EXISTS templates (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  data       JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- alunos (cada linha vira um cartão)
CREATE TABLE IF NOT EXISTS students (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}',
  foto       TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS students_pos_idx ON students(position, id);

-- imagens: fotos, fundos e logos
CREATE TABLE IF NOT EXISTS assets (
  id         TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR NOT NULL PRIMARY KEY,
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`;

async function migrate() {
  await pool.query(SCHEMA);
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  const { rows } = await pool.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1");
  if (rows.length === 0) {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      console.warn('Nenhum admin cadastrado. Defina ADMIN_EMAIL e ADMIN_PASSWORD e reinicie.');
      return;
    }
    await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'admin') ON CONFLICT (email) DO UPDATE SET role='admin', active=TRUE",
      [ADMIN_NAME || 'Administrador', ADMIN_EMAIL.toLowerCase().trim(), await bcrypt.hash(ADMIN_PASSWORD, 12)]
    );
    console.log(`Admin criado: ${ADMIN_EMAIL}`);
  }
}

/** Remove imagens que nenhum aluno ou modelo usa mais (só as com mais de 1 dia, para não apagar uploads recentes). */
async function pruneAssets() {
  const { rowCount } = await pool.query(`
    DELETE FROM assets a
     WHERE a.created_at < now() - interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM students s WHERE s.foto = a.id)
       AND NOT EXISTS (SELECT 1 FROM templates t WHERE position(a.id in t.data::text) > 0)`);
  if (rowCount) console.log(`Limpeza: ${rowCount} imagem(ns) sem uso removida(s).`);
}

module.exports = { pool, query: (text, params) => pool.query(text, params), migrate, pruneAssets };
