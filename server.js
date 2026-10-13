const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const STORAGE = path.join(ROOT, 'storage');
const VIDEO_DIR = path.join(STORAGE, 'videos');
fs.mkdirSync(VIDEO_DIR, { recursive: true });
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('replace-with')) {
  console.error('Set a unique SESSION_SECRET in .env before starting.');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH.includes('replace-with')) {
  console.error('Set ADMIN_PASSWORD_HASH in .env. See README.md.');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'cinewave.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
const db = new Database(path.join(STORAGE, 'cinewave.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS movies (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, genre TEXT NOT NULL DEFAULT '',
 language TEXT NOT NULL DEFAULT 'తెలుగు', year INTEGER, description TEXT NOT NULL DEFAULT '',
 poster_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS video_files (
 id INTEGER PRIMARY KEY AUTOINCREMENT, movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
 quality INTEGER NOT NULL, filename TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
 size INTEGER NOT NULL, UNIQUE(movie_id, quality)
);
`);
db.pragma('foreign_keys = ON');

function requireAdmin(req, res, next) {
  if (!req.session || req.session.admin !== true) return res.status(401).json({ error: 'Admin login required' });
  next();
}
function movieJson(row) {
  const files = db.prepare('SELECT quality, size FROM video_files WHERE movie_id=? ORDER BY quality').all(row.id);
  return { id: row.id, title: row.title, genre: row.genre, language: row.language, year: row.year,
    description: row.description, posterUrl: row.poster_url, createdAt: row.created_at,
    videos: files.map(f => ({ quality: f.quality, size: f.size, streamUrl: `/api/movies/${row.id}/stream/${f.quality}`, downloadUrl: `/api/movies/${row.id}/download/${f.quality}` })) };
}
app.use(express.static(path.join(ROOT, 'public')));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'CineWave' }));
app.get('/api/auth/status', (req, res) => res.json({ authenticated: req.session?.admin === true }));
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  if (username !== process.env.ADMIN_USERNAME || !(await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start session' });
    req.session.admin = true;
    res.json({ ok: true });
  });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/movies', (req, res) => {
  const rows = db.prepare('SELECT * FROM movies ORDER BY created_at DESC').all();
  res.json(rows.map(movieJson));
});
app.get('/api/movies/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM movies WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Movie not found' });
  res.json(movieJson(row));
});

const maxBytes = Math.max(1, Number(process.env.MAX_VIDEO_GB || 2)) * 1024 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, VIDEO_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${require('crypto').randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['video/mp4', 'video/webm', 'video/ogg', 'application/vnd.apple.mpegurl', 'application/x-mpegURL']);
    if (allowed.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported video format. Use MP4, WebM, or OGG.'));
  }
});

app.post('/api/movies', requireAdmin, (req, res) => {
  const { title, genre='', language='తెలుగు', year=null, description='', posterUrl='' } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Title is required' });
  if (String(title).length > 160 || String(description).length > 3000) return res.status(400).json({ error: 'Title or description too long' });
  const id = require('crypto').randomUUID();
  db.prepare('INSERT INTO movies (id,title,genre,language,year,description,poster_url) VALUES (?,?,?,?,?,?,?)')
    .run(id, String(title).trim(), String(genre).slice(0,80), String(language).slice(0,40),
      year ? Math.min(2100, Math.max(1900, Number(year))) : null, String(description), String(posterUrl).slice(0,1000));
  res.status(201).json({ id });
});
app.post('/api/movies/:id/videos/:quality', requireAdmin, (req, res, next) => {
  const quality = Number(req.params.quality);
  if (![360,480,720,1080].includes(quality)) return res.status(400).json({ error: 'Quality must be 360, 480, 720, or 1080' });
  if (!db.prepare('SELECT id FROM movies WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Movie not found' });
  req.quality = quality; next();
}, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a video file' });
  const old = db.prepare('SELECT filename FROM video_files WHERE movie_id=? AND quality=?').get(req.params.id, req.quality);
  try {
    db.prepare(`INSERT INTO video_files (movie_id,quality,filename,original_name,mime_type,size) VALUES (?,?,?,?,?,?)
      ON CONFLICT(movie_id,quality) DO UPDATE SET filename=excluded.filename, original_name=excluded.original_name, mime_type=excluded.mime_type, size=excluded.size`)
      .run(req.params.id, req.quality, req.file.filename, path.basename(req.file.originalname), req.file.mimetype, req.file.size);
    if (old?.filename) fs.promises.unlink(path.join(VIDEO_DIR, old.filename)).catch(()=>{});
    res.status(201).json({ ok: true, quality: req.quality });
  } catch (e) { fs.promises.unlink(req.file.path).catch(()=>{}); res.status(500).json({ error: 'Could not save video metadata' }); }
});

function sendVideo(req, res, download) {
  const quality = Number(req.params.quality);
  const row = db.prepare('SELECT v.*, m.title FROM video_files v JOIN movies m ON m.id=v.movie_id WHERE v.movie_id=? AND v.quality=?')
    .get(req.params.id, quality);
  if (!row) return res.status(404).json({ error: 'This quality version is not available' });
  const fullPath = path.join(VIDEO_DIR, row.filename);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Video file missing on server' });
  res.type(row.mime_type);
  if (download) res.setHeader('Content-Disposition', `attachment; filename="${String(row.title).replace(/[^a-zA-Z0-9_-]/g,'_')}_${quality}p${path.extname(row.filename)}"`);
  res.sendFile(fullPath);
}
app.get('/api/movies/:id/stream/:quality', (req,res)=>sendVideo(req,res,false));
app.get('/api/movies/:id/download/:quality', (req,res)=>sendVideo(req,res,true));

app.delete('/api/movies/:id/videos/:quality', requireAdmin, (req,res) => {
  const q = Number(req.params.quality);
  const row = db.prepare('SELECT filename FROM video_files WHERE movie_id=? AND quality=?').get(req.params.id,q);
  if (!row) return res.status(404).json({error:'Video version not found'});
  db.prepare('DELETE FROM video_files WHERE movie_id=? AND quality=?').run(req.params.id,q);
  fs.promises.unlink(path.join(VIDEO_DIR,row.filename)).catch(()=>{});
  res.json({ok:true});
});
app.delete('/api/movies/:id', requireAdmin, (req,res) => {
  const rows = db.prepare('SELECT filename FROM video_files WHERE movie_id=?').all(req.params.id);
  const result = db.prepare('DELETE FROM movies WHERE id=?').run(req.params.id);
  if (!result.changes) return res.status(404).json({error:'Movie not found'});
  rows.forEach(r=>fs.promises.unlink(path.join(VIDEO_DIR,r.filename)).catch(()=>{}));
  res.json({ok:true});
});
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large; increase MAX_VIDEO_GB or use a smaller file' : err.message});
  console.error(err);
  res.status(400).json({error: err.message || 'Request failed'});
});
app.listen(PORT, () => console.log(`CineWave running at http://localhost:${PORT}`));
