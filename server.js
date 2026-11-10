'use strict';

const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const isProduction = Boolean(process.env.DB_HOST);
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'defaultdb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};
if (isProduction) {
  const caCert = process.env.DB_CA_CERT;
  if (!caCert) throw new Error('Missing DB_CA_CERT for the production database connection.');
  dbConfig.ssl = { ca: caCert.replace(/\\n/g, '\n'), rejectUnauthorized: true };
}
const db = mysql.createPool(dbConfig);

const validId = (value) => value !== undefined && value !== null && String(value).trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
  console.error(`${req.method} ${req.originalUrl}:`, err.message);
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A record with those unique details already exists.' });
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'A referenced record does not exist.' });
  if (err.code === 'ER_BAD_NULL_ERROR' || err.code === 'ER_TRUNCATED_WRONG_VALUE' || err.code === 'WARN_DATA_TRUNCATED') return res.status(400).json({ error: 'One or more submitted values are invalid.' });
  res.status(500).json({ error: 'Server error. Check the server terminal for details.' });
});

// PATIENTS
app.get('/api/patients', asyncRoute(async (req, res) => {
  const term = `%${String(req.query.search || '').trim()}%`;
  const status = String(req.query.status || 'All');
  if (!['All', 'Active', 'Inactive'].includes(status)) return res.status(400).json({ error: 'Invalid patient status filter.' });
  let sql = `SELECT patient_id, first_name, last_name, birthdate, sex, contact_no, address, status, created_at FROM patients WHERE (first_name LIKE ? OR last_name LIKE ? OR contact_no LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ?)`;
  const params = [term, term, term, term];
  if (status !== 'All') { sql += ' AND status = ?'; params.push(status.toLowerCase()); }
  sql += ' ORDER BY last_name, first_name';
  const [rows] = await db.execute(sql, params);
  res.json(rows.map((p) => ({ ...p, status: p.status === 'active' ? 'Active' : 'Inactive' })));
}));

app.get('/api/patients/:id', asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid patient ID.' });
  const [rows] = await db.execute('SELECT patient_id, first_name, last_name, birthdate, sex, contact_no, address, status, created_at FROM patients WHERE patient_id = ?', [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Patient not found.' });
  res.json({ ...rows[0], status: rows[0].status === 'active' ? 'Active' : 'Inactive' });
}));

function validatePatient(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Invalid patient data.';
  const { first_name, last_name, birthdate, sex, contact_no, address } = body;
  if (typeof first_name !== 'string' || !first_name.trim() || first_name.trim().length > 50 ||
      typeof last_name !== 'string' || !last_name.trim() || last_name.trim().length > 50 ||
      typeof birthdate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate) ||
      !['Male', 'Female'].includes(sex) ||
      (contact_no != null && (typeof contact_no !== 'string' || contact_no.trim().length > 20)) ||
      (address != null && (typeof address !== 'string' || address.trim().length > 255))) return 'Enter valid patient details. First name, last name, birthdate, and sex are required.';
  const d = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== birthdate || birthdate > new Date().toISOString().slice(0, 10)) return 'Enter a valid birthdate that is not in the future.';
  return null;
}

app.post('/api/patients', asyncRoute(async (req, res) => {
  const error = validatePatient(req.body); if (error) return res.status(400).json({ error });
  const b = req.body;
  const [dupes] = await db.execute('SELECT patient_id FROM patients WHERE LOWER(first_name)=LOWER(?) AND LOWER(last_name)=LOWER(?) AND birthdate=? LIMIT 1', [b.first_name.trim(), b.last_name.trim(), b.birthdate]);
  if (dupes.length) return res.status(409).json({ error: 'This patient is already registered.' });
  const [result] = await db.execute('INSERT INTO patients (first_name,last_name,birthdate,sex,contact_no,address) VALUES (?,?,?,?,?,?)', [b.first_name.trim(), b.last_name.trim(), b.birthdate, b.sex, clean(b.contact_no), clean(b.address)]);
  res.status(201).json({ ok: true, message: 'Patient registered successfully.', patient_id: result.insertId });
}));

app.put('/api/patients/:id', asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid patient ID.' });
  const error = validatePatient(req.body); if (error) return res.status(400).json({ error });
  const b = req.body; const id = Number(req.params.id);
  const [dupes] = await db.execute('SELECT patient_id FROM patients WHERE LOWER(first_name)=LOWER(?) AND LOWER(last_name)=LOWER(?) AND birthdate=? AND patient_id<>? LIMIT 1', [b.first_name.trim(), b.last_name.trim(), b.birthdate, id]);
  if (dupes.length) return res.status(409).json({ error: 'Another patient has the same name and birthdate.' });
  const [result] = await db.execute('UPDATE patients SET first_name=?,last_name=?,birthdate=?,sex=?,contact_no=?,address=? WHERE patient_id=?', [b.first_name.trim(), b.last_name.trim(), b.birthdate, b.sex, clean(b.contact_no), clean(b.address), id]);
  if (!result.affectedRows) { const [[row]] = await db.execute('SELECT patient_id FROM patients WHERE patient_id=?', [id]); if (!row) return res.status(404).json({ error: 'Patient not found.' }); }
  res.json({ ok: true, message: 'Patient updated successfully.' });
}));

app.patch('/api/patients/:id/status', asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid patient ID.' });
  if (!['Active', 'Inactive'].includes(req.body?.status)) return res.status(400).json({ error: 'Status must be Active or Inactive.' });
  const [result] = await db.execute('UPDATE patients SET status=? WHERE patient_id=?', [req.body.status.toLowerCase(), Number(req.params.id)]);
  if (!result.affectedRows) { const [[row]] = await db.execute('SELECT patient_id FROM patients WHERE patient_id=?', [Number(req.params.id)]); if (!row) return res.status(404).json({ error: 'Patient not found.' }); }
  res.json({ ok: true, message: `Patient ${req.body.status.toLowerCase()} successfully.` });
}));

app.use('/api', require('./routes/doctorRoutes')(db));
app.use('/api', require('./routes/hospitalRoutes')(db));

app.get('/api/health', asyncRoute(async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true, database: dbConfig.database, message: 'CarePoint API and database are running.' });
}));
app.get('/api/dashboard', asyncRoute(async (_req, res) => {
  const [[patients]] = await db.query('SELECT COUNT(*) AS total FROM patients');
  const [[admissions]] = await db.query("SELECT COUNT(*) AS total FROM admissions WHERE status='admitted'");
  const [[beds]] = await db.query("SELECT COUNT(*) AS total, SUM(status='available') AS available FROM beds");
  const [[bills]] = await db.query("SELECT COALESCE(SUM(total_amount),0) AS total FROM bills WHERE status IN ('pending','partially_paid')");
  res.json({ patients: Number(patients.total), admitted: Number(admissions.total), beds: Number(beds.total || 0), available_beds: Number(beds.available || 0), outstanding_billing: Number(bills.total || 0) });
}));

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return res.status(400).json({ error: 'Invalid JSON request body.' });
  next(err);
});

const PORT = Number(process.env.PORT || 3000);
async function startServer() {
  try {
    await db.query('SELECT 1');
    app.listen(PORT, '0.0.0.0', () => console.log(`CarePoint connected to ${dbConfig.database}; server running on port ${PORT}`));
  } catch (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  }
}
startServer();
