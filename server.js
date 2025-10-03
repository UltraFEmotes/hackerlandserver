// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change_this_in_prod';
const DATA_FILE = path.join(__dirname, 'db.json');

// load or create DB file (simple file-backed JSON store)
let db = { users: {} };
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    db = JSON.parse(raw);
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  }
} catch (e) {
  console.error('Failed to load db.json — starting with empty DB', e);
  db = { users: {} };
}

// helper: persist immediately (sync for simplicity)
function persist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write db.json', e);
  }
}

const app = express();
app.use(helmet());
app.use(cors()); // adjust origin for production if needed
app.use(bodyParser.json({ limit: '20kb' }));

// rate limit: light limit to protect the endpoint from scraping
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // per IP
});
app.use(limiter);

// GET /user/:id  -> return user state
app.get('/user/:id', (req, res) => {
  const id = String(req.params.id);
  const u = db.users[id];
  if (!u) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.json({
    userId: id,
    IsUsingScript: !!u.IsUsingScript,
    Premium: !!u.Premium,
    Owner: !!u.Owner,
    Admin: !!u.Admin,
    Banned: !!u.Banned,
    lastUpdated: u.lastUpdated || null
  });
});

// POST /user/:id/update  -> update state; protected by x-api-key
app.post('/user/:id/update', (req, res) => {
  const id = String(req.params.id);
  const secret = req.header('x-api-key') || '';
  if (secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const allowedKeys = ['IsUsingScript', 'Premium', 'Owner', 'Admin', 'Banned'];
  const payload = {};
  for (const k of allowedKeys) {
    if (req.body.hasOwnProperty(k)) payload[k] = !!req.body[k];
  }

  // ensure we have at least the IsUsingScript field for your use-case
  if (payload.IsUsingScript === undefined) {
    // If caller didn't send IsUsingScript, we still allow updates to other fields.
    payload.IsUsingScript = db.users[id]?.IsUsingScript ?? false;
  }

  db.users[id] = {
    ...db.users[id],
    ...payload,
    lastUpdated: new Date().toISOString()
  };
  persist();

  return res.json({ ok: true, userId: id, updated: db.users[id] });
});

// optional: list route (protected) - remove or lock down in production
app.get('/_list-all-users', (req, res) => {
  const secret = req.header('x-api-key') || '';
  if (secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.json({ users: db.users });
});

app.get('/', (req, res) => {
  res.send('Roblox script tracker API is running.');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
