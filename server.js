
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'hospital_db',
    waitForConnections: true,
    connectionLimit: 10
});

// Helper: Validate patient ID
function validId(id) {
    return Number.isSafeInteger(Number(id)) && Number(id) > 0;
}

// Helper: Validate patient details
function validatePatient(data) {
    const {
        first_name,
        last_name,
        birthdate,
        sex,
        contact_no,
        address
    } = data;

    if (
        typeof first_name !== 'string' ||
        !first_name.trim() ||
        first_name.trim().length > 50 ||
        typeof last_name !== 'string' ||
        !last_name.trim() ||
        last_name.trim().length > 50 ||
        typeof birthdate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(birthdate) ||
        !['Male', 'Female'].includes(sex) ||
        (contact_no != null &&
            (typeof contact_no !== 'string' || contact_no.trim().length > 20)) ||
        (address != null &&
            (typeof address !== 'string' || address.trim().length > 255))
    ) {
        return 'Enter valid patient details. First name, last name, birthdate and sex are required.';
    }

    const date = new Date(birthdate + 'T00:00:00Z');
    const today = new Date().toISOString().slice(0, 10);

    if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== birthdate ||
        birthdate > today
    ) {
        return 'Enter a valid birthdate that is not in the future.';
    }

    return null;
}

// GET: List and search patients
app.get('/api/patients', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim();
        const status = String(req.query.status || 'All');

        const term = `%${search}%`;

        let sql = `
            SELECT patient_id, first_name, last_name, birthdate,
                   sex, contact_no, address, status, created_at
            FROM patients
            WHERE (
                first_name LIKE ?
                OR last_name LIKE ?
                OR contact_no LIKE ?
                OR CONCAT(first_name, ' ', last_name) LIKE ?
            )
        `;

        const params = [term, term, term, term];

        if (['Active', 'Inactive'].includes(status)) {
            sql += ' AND status = ?';
            params.push(status.toLowerCase());
        }

        sql += ' ORDER BY last_name, first_name';

        const [rows] = await db.execute(sql, params);

        // Display status consistently in the frontend
        const patients = rows.map(patient => ({
            ...patient,
            status: patient.status === 'active' ? 'Active' : 'Inactive'
        }));

        res.json(patients);
    } catch (err) {
        console.error('List patients error:', err.message);
        res.status(500).json({ error: 'Unable to load patients.' });
    }
});

// POST: Register a patient
app.post('/api/patients', async (req, res) => {
    try {
        const error = validatePatient(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        const {
            first_name, last_name, birthdate,
            sex, contact_no, address
        } = req.body;

        const first = first_name.trim();
        const last = last_name.trim();

        const [duplicates] = await db.execute(
            `SELECT patient_id FROM patients
             WHERE LOWER(first_name) = LOWER(?)
               AND LOWER(last_name) = LOWER(?)
               AND birthdate = ?
             LIMIT 1`,
            [first, last, birthdate]
        );

        if (duplicates.length) {
            return res.status(409).json({
                error: 'This patient is already registered.'
            });
        }

        const [result] = await db.execute(
            `INSERT INTO patients
             (first_name, last_name, birthdate, sex, contact_no, address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                first,
                last,
                birthdate,
                sex,
                contact_no?.trim() || null,
                address?.trim() || null
            ]
        );

        res.status(201).json({
            ok: true,
            message: 'Patient registered successfully.',
            patient_id: result.insertId
        });
    } catch (err) {
        console.error('Register patient error:', err.message);
        res.status(500).json({ error: 'Unable to register patient.' });
    }
});

// PUT: Edit patient details
app.put('/api/patients/:id', async (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid patient ID.' });
        }

        const error = validatePatient(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        const id = Number(req.params.id);

        const {
            first_name, last_name, birthdate,
            sex, contact_no, address
        } = req.body;

        const first = first_name.trim();
        const last = last_name.trim();

        const [duplicates] = await db.execute(
            `SELECT patient_id FROM patients
             WHERE LOWER(first_name) = LOWER(?)
               AND LOWER(last_name) = LOWER(?)
               AND birthdate = ?
               AND patient_id <> ?
             LIMIT 1`,
            [first, last, birthdate, id]
        );

        if (duplicates.length) {
            return res.status(409).json({
                error: 'Another patient has the same name and birthdate.'
            });
        }

        const [result] = await db.execute(
            `UPDATE patients
             SET first_name = ?, last_name = ?, birthdate = ?,
                 sex = ?, contact_no = ?, address = ?
             WHERE patient_id = ?`,
            [
                first,
                last,
                birthdate,
                sex,
                contact_no?.trim() || null,
                address?.trim() || null,
                id
            ]
        );

        if (result.affectedRows === 0) {
            const [rows] = await db.execute(
                'SELECT patient_id FROM patients WHERE patient_id = ?',
                [id]
            );

            if (!rows.length) {
                return res.status(404).json({ error: 'Patient not found.' });
            }
        }

        res.json({ ok: true, message: 'Patient updated successfully.' });
    } catch (err) {
        console.error('Update patient error:', err.message);
        res.status(500).json({ error: 'Unable to update patient.' });
    }
});

// PATCH: Deactivate or reactivate a patient
app.patch('/api/patients/:id/status', async (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid patient ID.' });
        }

        const requestedStatus = req.body.status;

        if (!['Active', 'Inactive'].includes(requestedStatus)) {
            return res.status(400).json({
                error: 'Status must be Active or Inactive.'
            });
        }

        const id = Number(req.params.id);
        const status = requestedStatus.toLowerCase();

        const [result] = await db.execute(
            'UPDATE patients SET status = ? WHERE patient_id = ?',
            [status, id]
        );

        if (result.affectedRows === 0) {
            const [rows] = await db.execute(
                'SELECT patient_id FROM patients WHERE patient_id = ?',
                [id]
            );

            if (!rows.length) {
                return res.status(404).json({ error: 'Patient not found.' });
            }
        }

        res.json({
            ok: true,
            message: `Patient ${status} successfully.`
        });
    } catch (err) {
        console.error('Change patient status error:', err.message);
        res.status(500).json({ error: 'Unable to update patient status.' });
    }
});

// Start server after checking the database connection
async function startServer() {
    try {
        const connection = await db.getConnection();
        await connection.ping();
        connection.release();

        app.listen(3000, () => {
            console.log('Database connected successfully.');
            console.log('Hospital System: http://localhost:3000');
        });
    } catch (err) {
        console.error('Database connection failed:', err.message);
        process.exit(1);
    }
}

startServer();
