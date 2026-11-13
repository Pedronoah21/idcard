require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { loginPage } = require('./pages');

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
// Subpasta onde o sistema roda, ex.: BASE_PATH=/cracha  ->  https://cedcci.com.br/cracha
let BASE = String(process.env.BASE_PATH || '').trim().replace(/\/+$/, '');
if (BASE && !BASE.startsWith('/')) BASE = `/${BASE}`;
const APP_NAME = process.env.APP_NAME || 'Estúdio de Crachás';

if (!process.env.SESSION_SECRET && isProd) {
  console.error('Defina SESSION_SECRET em produção.');
  process.exit(1);
}

const app = express();
const site = express.Router();
app.set('trust proxy', true); // Render e o repasse do PhotoDesk ficam na frente

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

site.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: isProd ? '1d' : 0, index: false }));

site.use(session({
  store: new PgSession({ pool: db.pool, tableName: 'session' }),
  name: 'crc.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-troque-isto',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, path: BASE || '/', maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

const go = (p) => BASE + p;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------------- login ---------------- */
const DUMMY_HASH = bcrypt.hashSync('nao-existe', 12);
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).send(loginPage({ base: BASE, appName: APP_NAME, error: 'Muitas tentativas. Aguarde alguns minutos.', email: req.body?.email || '' })),
});

site.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(go('/'));
  res.send(loginPage({ base: BASE, appName: APP_NAME, error: null, email: '' }));
});

site.post('/login', express.urlencoded({ extended: false, limit: '20kb' }), loginLimiter, wrap(async (req, res, next) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const { rows } = await db.query('SELECT * FROM users WHERE email=$1', [email]);
  const u = rows[0];
  const ok = await bcrypt.compare(String(req.body.password || ''), u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok || !u.active) {
    return res.status(401).send(loginPage({ base: BASE, appName: APP_NAME, error: 'E-mail ou senha incorretos.', email }));
  }
  await db.query('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
    req.session.save(() => res.redirect(go('/')));
  });
}));

site.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('crc.sid', { path: BASE || '/' });
    res.redirect(go('/login'));
  });
});

/* ---------------- guardas ---------------- */
// confere a cada pedido se o usuário continua ativo (desativar derruba o acesso na hora)
const requireLogin = wrap(async (req, res, next) => {
  const s = req.session.user;
  if (s) {
    const { rows } = await db.query('SELECT id,name,email,role,active FROM users WHERE id=$1', [s.id]);
    const u = rows[0];
    if (u && u.active) { req.user = { id: u.id, name: u.name, email: u.email, role: u.role }; req.session.user = req.user; return next(); }
    req.session.destroy(() => {});
  }
  if (req.originalUrl.startsWith(BASE + '/api/')) return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
  return res.redirect(go('/login'));
});
const requireAdmin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Somente administradores podem fazer isso.' }));

/* ---------------- editor ---------------- */
const EDITOR = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.html'), 'utf8');
site.get('/', requireLogin, (req, res) => {
  const boot = JSON.stringify({ base: BASE, user: req.user, appName: APP_NAME }).replace(/</g, '\\u003c');
  res.set('Cache-Control', 'no-store');
  res.type('html').send(EDITOR.replace('"__BOOT__"', boot));
});

/* ---------------- API ---------------- */
const api = express.Router();
api.use(requireLogin);
api.use(express.json({ limit: '12mb' }));

async function getSetting(key, fallback) {
  const { rows } = await db.query('SELECT value FROM settings WHERE key=$1', [key]);
  return rows[0] ? rows[0].value : fallback;
}
const setSetting = (key, value) => db.query(
  'INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, JSON.stringify(value)]);

const listTemplates = async () => (await db.query(
  'SELECT t.id, t.name, t.updated_at, u.name AS updated_by FROM templates t LEFT JOIN users u ON u.id=t.updated_by ORDER BY t.name, t.id')).rows;
const listStudents = async () => (await db.query('SELECT id, data, foto FROM students ORDER BY position, id')).rows
  .map((r) => ({ ...r.data, _id: r.id, foto: r.foto || null }));

api.get('/bootstrap', wrap(async (req, res) => {
  const templates = await listTemplates();
  const lastId = await getSetting('last_template', null);
  const pick = templates.find((t) => t.id === lastId) || templates[0];
  let current = null;
  if (pick) current = (await db.query('SELECT id,name,data,updated_at FROM templates WHERE id=$1', [pick.id])).rows[0];
  res.json({
    user: req.user,
    fields: await getSetting('fields', null),
    templates,
    current,
    students: await listStudents(),
  });
}));

/* modelos */
const cleanName = (n) => String(n || '').trim().slice(0, 80);
api.get('/templates', wrap(async (req, res) => res.json(await listTemplates())));
api.get('/templates/:id', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT id,name,data,updated_at FROM templates WHERE id=$1', [+req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Modelo não encontrado.' });
  await setSetting('last_template', rows[0].id);
  res.json(rows[0]);
}));
api.post('/templates', wrap(async (req, res) => {
  const name = cleanName(req.body.name) || 'Novo modelo';
  if (!req.body.data || typeof req.body.data !== 'object') return res.status(400).json({ error: 'Modelo sem layout.' });
  const { rows } = await db.query('INSERT INTO templates (name,data,updated_by) VALUES ($1,$2,$3) RETURNING id,name,data,updated_at',
    [name, req.body.data, req.user.id]);
  await setSetting('last_template', rows[0].id);
  res.status(201).json(rows[0]);
}));
api.put('/templates/:id', wrap(async (req, res) => {
  const sets = []; const vals = [];
  if (req.body.name !== undefined) { const n = cleanName(req.body.name); if (!n) return res.status(400).json({ error: 'Dê um nome ao modelo.' }); vals.push(n); sets.push(`name=$${vals.length}`); }
  if (req.body.data !== undefined) { vals.push(req.body.data); sets.push(`data=$${vals.length}`); }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.user.id); sets.push(`updated_by=$${vals.length}`, 'updated_at=now()');
  vals.push(+req.params.id);
  const { rows } = await db.query(`UPDATE templates SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING id,name,updated_at`, vals);
  if (!rows[0]) return res.status(404).json({ error: 'Modelo não encontrado (pode ter sido excluído por outra pessoa).' });
  res.json(rows[0]);
}));
api.delete('/templates/:id', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM templates');
  if (rows[0].n <= 1) return res.status(400).json({ error: 'Mantenha pelo menos um modelo.' });
  await db.query('DELETE FROM templates WHERE id=$1', [+req.params.id]);
  res.json({ ok: true });
}));

/* campos */
api.put('/fields', wrap(async (req, res) => {
  const f = Array.isArray(req.body.fields) ? req.body.fields.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 60) : null;
  if (!f || !f.length) return res.status(400).json({ error: 'Lista de campos inválida.' });
  await setSetting('fields', f);
  res.json({ ok: true });
}));

/* alunos: o editor manda só o que mudou */
api.get('/students', wrap(async (req, res) => res.json(await listStudents())));
api.post('/students/sync', wrap(async (req, res) => {
  const up = Array.isArray(req.body.upsert) ? req.body.upsert : [];
  const del = Array.isArray(req.body.delete) ? req.body.delete.map(String) : [];
  if (up.length > 5000) return res.status(400).json({ error: 'Envie no máximo 5000 alunos por vez.' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (del.length) await client.query('DELETE FROM students WHERE id = ANY($1)', [del]);
    for (const s of up) {
      const id = String(s.id || '').slice(0, 40);
      if (!id) continue;
      const data = s.data && typeof s.data === 'object' ? s.data : {};
      await client.query(
        `INSERT INTO students (id,data,foto,position,updated_at) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, foto=EXCLUDED.foto, position=EXCLUDED.position, updated_at=now()`,
        [id, data, s.foto ? String(s.foto).slice(0, 60) : null, Number.isInteger(s.position) ? s.position : 0]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

/* imagens */
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
api.post('/assets', express.raw({ type: IMG_TYPES, limit: '8mb' }), wrap(async (req, res) => {
  const mime = String(req.headers['content-type'] || '').split(';')[0];
  if (!IMG_TYPES.includes(mime) || !Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'Envie uma imagem JPG, PNG ou WEBP.' });
  }
  // o editor escolhe o id (aleatório) para mostrar a imagem antes do envio terminar; nunca sobrescreve uma existente
  const wanted = String(req.query.id || '');
  const id = /^a[a-z0-9]{12,40}$/.test(wanted) ? wanted : 'a' + crypto.randomBytes(12).toString('hex');
  await db.query('INSERT INTO assets (id,mime,data,size_bytes,created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',
    [id, mime, req.body, req.body.length, req.user.id]);
  res.status(201).json({ id });
}));
api.get('/assets/:id', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT mime,data FROM assets WHERE id=$1', [String(req.params.id)]);
  if (!rows[0]) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(rows[0].mime).send(rows[0].data);
}));

/* conta e usuários */
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
api.put('/me/password', wrap(async (req, res) => {
  const { current, password } = req.body || {};
  if (String(password || '').length < 8) return res.status(400).json({ error: 'A nova senha precisa de pelo menos 8 caracteres.' });
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(String(current || ''), rows[0].password_hash))) return res.status(400).json({ error: 'A senha atual está incorreta.' });
  await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(String(password), 12), req.user.id]);
  res.json({ ok: true });
}));
api.get('/users', requireAdmin, wrap(async (req, res) => {
  res.json((await db.query('SELECT id,name,email,role,active,last_login_at,created_at FROM users ORDER BY name')).rows);
}));
api.post('/users', requireAdmin, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = String(req.body.email || '').toLowerCase().trim();
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const pw = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'Informe o nome.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (pw.length < 8) return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres.' });
  try {
    const { rows } = await db.query('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, email, await bcrypt.hash(pw, 12), role]);
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Já existe um usuário com esse e-mail.' });
    throw e;
  }
}));
api.put('/users/:id', requireAdmin, wrap(async (req, res) => {
  const id = +req.params.id;
  const b = req.body || {};
  if (id === req.user.id && (b.active === false || b.role === 'user')) {
    return res.status(400).json({ error: 'Você não pode desativar nem rebaixar a própria conta.' });
  }
  const sets = []; const vals = [];
  const add = (sql, v) => { vals.push(v); sets.push(sql.replace('?', `$${vals.length}`)); };
  if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 80); if (!n) return res.status(400).json({ error: 'Informe o nome.' }); add('name=?', n); }
  if (b.role !== undefined) add('role=?', b.role === 'admin' ? 'admin' : 'user');
  if (b.active !== undefined) add('active=?', !!b.active);
  if (b.password !== undefined) {
    if (String(b.password).length < 8) return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres.' });
    add('password_hash=?', await bcrypt.hash(String(b.password), 12));
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(id);
  await db.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
  res.json({ ok: true });
}));
api.delete('/users/:id', requireAdmin, wrap(async (req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir a própria conta.' });
  await db.query('DELETE FROM users WHERE id=$1', [+req.params.id]);
  res.json({ ok: true });
}));

site.use('/api', api);
site.get('/health', (req, res) => res.json({ ok: true }));

if (BASE) {
  // "/cracha" sem barra no fim: leva para "/cracha/" (os caminhos relativos da página dependem disso)
  app.use((req, res, next) => (req.path === BASE ? res.redirect(301, BASE + '/' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')) : next()));
  app.use(BASE, site);
  app.get('/', (req, res) => res.redirect(BASE + '/'));
} else {
  app.use(site);
}
app.use((req, res) => res.status(404).type('text').send('Página não encontrada.'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Arquivo grande demais.' });
  console.error(err);
  if (req.originalUrl.includes('/api/')) return res.status(500).json({ error: 'Erro no servidor. Tente novamente.' });
  res.status(500).type('text').send('Algo deu errado. Tente novamente.');
});

db.migrate()
  .then(() => {
    const server = app.listen(PORT, () => console.log(`${APP_NAME} na porta ${PORT}${BASE ? ` em ${BASE}` : ''}`));
    server.keepAliveTimeout = 120 * 1000;
    server.headersTimeout = 125 * 1000;
    db.pruneAssets().catch((e) => console.error('Limpeza falhou:', e.message));
    setInterval(() => db.pruneAssets().catch(() => {}), 24 * 60 * 60 * 1000).unref();
  })
  .catch((e) => {
    console.error('Falha ao preparar o banco:', e);
    process.exit(1);
  });
