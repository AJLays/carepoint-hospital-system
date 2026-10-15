
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();

// ========================================
// MIDDLEWARE
// ========================================
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========================================
// DATABASE CONFIGURATION
// ========================================
const isProduction = Boolean(process.env.DB_HOST);

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hospital_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Aiven requires an SSL connection.
// Set DB_CA_CERT in Render to the complete contents of ca.pem.
if (isProduction) {
    const caCert = process.env.DB_CA_CERT;

    if (!caCert) {
        throw new Error(
            'Missing DB_CA_CERT. Add your Aiven CA certificate to Render environment variables.'
        );
    }

    dbConfig.ssl = {
        ca: caCert.replace(/\\n/g, '\n'),
        rejectUnauthorized: true
    };
}

const db = mysql.createPool(dbConfig);

// ========================================
// HELPER: VALIDATE PATIENT ID
// ========================================
function validId(id) {
    const value = Number(id);

    return (
        id !== undefined &&
        id !== null &&
        String(id).trim() !== '' &&
        Number.isSafeInteger(value) &&
        value > 0
    );
}

// ========================================
// HELPER: VALIDATE PATIENT DETAILS
// ========================================
function validatePatient(data) {
    if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data)
    ) {
        return 'Invalid patient data.';
    }

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

        (
            contact_no != null &&
            (
                typeof contact_no !== 'string' ||
                contact_no.trim().length > 20
            )
        ) ||

        (
            address != null &&
            (
                typeof address !== 'string' ||
                address.trim().length > 255
            )
        )
    ) {
        return 'Enter valid patient details. First name, last name, birthdate, and sex are required.';
    }

    const date = new Date(`${birthdate}T00:00:00Z`);
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

// ========================================
// HELPER: FORMAT PATIENT STATUS
// ========================================
function formatPatient(patient) {
    return {
        ...patient,
        status:
            String(patient.status).toLowerCase() === 'active'
                ? 'Active'
                : 'Inactive'
    };
}

// ========================================
// GET: LIST AND SEARCH PATIENTS
// ========================================
app.get('/api/patients', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim();
        const requestedStatus = String(req.query.status || 'All');

        if (
            !['All', 'Active', 'Inactive'].includes(requestedStatus)
        ) {
            return res.status(400).json({
                error: 'Invalid patient status filter.'
            });
        }

        const term = `%${search}%`;

        let sql = `
            SELECT
                patient_id,
                first_name,
                last_name,
                birthdate,
                sex,
                contact_no,
                address,
                status,
                created_at
            FROM patients
            WHERE (
                first_name LIKE ?
                OR last_name LIKE ?
                OR contact_no LIKE ?
                OR CONCAT(first_name, ' ', last_name) LIKE ?
            )
        `;

        const params = [term, term, term, term];

        if (requestedStatus !== 'All') {
            sql += ' AND status = ?';
            params.push(requestedStatus.toLowerCase());
        }

        sql += ' ORDER BY last_name ASC, first_name ASC';

        const [rows] = await db.execute(sql, params);

        res.json(rows.map(formatPatient));
    } catch (err) {
        console.error('List patients error:', err.message);

        res.status(500).json({
            error: 'Unable to load patients.'
        });
    }
});

// ========================================
// GET: ONE PATIENT
// ========================================
app.get('/api/patients/:id', async (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({
                error: 'Invalid patient ID.'
            });
        }

        const [rows] = await db.execute(
            `SELECT
                patient_id,
                first_name,
                last_name,
                birthdate,
                sex,
                contact_no,
                address,
                status,
                created_at
             FROM patients
             WHERE patient_id = ?
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: 'Patient not found.'
            });
        }

        res.json(formatPatient(rows[0]));
    } catch (err) {
        console.error('Get patient error:', err.message);

        res.status(500).json({
            error: 'Unable to load patient.'
        });
    }
});

// ========================================
// POST: REGISTER A PATIENT
// ========================================
app.post('/api/patients', async (req, res) => {
    try {
        const error = validatePatient(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        const {
            first_name,
            last_name,
            birthdate,
            sex,
            contact_no,
            address
        } = req.body;

        const first = first_name.trim();
        const last = last_name.trim();

        // Prevent duplicate registrations with the same name and birthdate.
        const [duplicates] = await db.execute(
            `SELECT patient_id
             FROM patients
             WHERE LOWER(first_name) = LOWER(?)
               AND LOWER(last_name) = LOWER(?)
               AND birthdate = ?
             LIMIT 1`,
            [first, last, birthdate]
        );

        if (duplicates.length > 0) {
            return res.status(409).json({
                error: 'This patient is already registered.'
            });
        }

        const [result] = await db.execute(
            `INSERT INTO patients (
                first_name,
                last_name,
                birthdate,
                sex,
                contact_no,
                address
            ) VALUES (?, ?, ?, ?, ?, ?)`,
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

        res.status(500).json({
            error: 'Unable to register patient.'
        });
    }
});

// ========================================
// PUT: EDIT PATIENT DETAILS
// ========================================
app.put('/api/patients/:id', async (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({
                error: 'Invalid patient ID.'
            });
        }

        const error = validatePatient(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        const id = Number(req.params.id);

        const {
            first_name,
            last_name,
            birthdate,
            sex,
            contact_no,
            address
        } = req.body;

        const first = first_name.trim();
        const last = last_name.trim();

        const [duplicates] = await db.execute(
            `SELECT patient_id
             FROM patients
             WHERE LOWER(first_name) = LOWER(?)
               AND LOWER(last_name) = LOWER(?)
               AND birthdate = ?
               AND patient_id <> ?
             LIMIT 1`,
            [first, last, birthdate, id]
        );

        if (duplicates.length > 0) {
            return res.status(409).json({
                error: 'Another patient has the same name and birthdate.'
            });
        }

        const [result] = await db.execute(
            `UPDATE patients
             SET
                first_name = ?,
                last_name = ?,
                birthdate = ?,
                sex = ?,
                contact_no = ?,
                address = ?
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

            if (rows.length === 0) {
                return res.status(404).json({
                    error: 'Patient not found.'
                });
            }
        }

        res.json({
            ok: true,
            message: 'Patient updated successfully.'
        });
    } catch (err) {
        console.error('Update patient error:', err.message);

        res.status(500).json({
            error: 'Unable to update patient.'
        });
    }
});

// ========================================
// PATCH: ACTIVATE OR DEACTIVATE PATIENT
// ========================================
app.patch('/api/patients/:id/status', async (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({
                error: 'Invalid patient ID.'
            });
        }

        const requestedStatus = req.body?.status;

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

            if (rows.length === 0) {
                return res.status(404).json({
                    error: 'Patient not found.'
                });
            }
        }

        res.json({
            ok: true,
            message: `Patient ${status} successfully.`
        });
    } catch (err) {
        console.error('Change patient status error:', err.message);

        res.status(500).json({
            error: 'Unable to update patient status.'
        });
    }
});

// ========================================
// HEALTH CHECK
// ========================================
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        message: 'CarePoint API is running.'
    });
});

// ========================================
// HANDLE INVALID JSON
// ========================================
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            error: 'Invalid JSON request body.'
        });
    }

    next(err);
});

// ========================================
// START SERVER
// ========================================
const PORT = Number(process.env.PORT || 3000);

async function startServer() {
    let connection;

    try {
        connection = await db.getConnection();
        await connection.ping();
        connection.release();
        connection = null;

        app.listen(PORT, '0.0.0.0', () => {
            console.log('Database connected successfully.');
            console.log(`CarePoint server running on port ${PORT}`);
        });
    } catch (err) {
        if (connection) {
            connection.release();
        }
        
console.error('Database connection failed!');
console.error('Error code:', err.code);
console.error('Error message:', err.message);
console.error('Error details:', err);
process.exit(1);


       
    }
}

startServer();
