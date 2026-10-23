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
        address,
        course_id
    } = data;

    if (!validId(course_id)) {
        return 'Please select a course.';
    }

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
// HELPER: VALIDATE COURSE DETAILS
// ========================================
function validateCourse(data) {
    if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data)
    ) {
        return 'Invalid course data.';
    }

    const { course_code, course_name } = data;

    if (
        typeof course_code !== 'string' ||
        !course_code.trim() ||
        course_code.trim().length > 20
    ) {
        return 'Course code is required (maximum 20 characters).';
    }

    if (
        typeof course_name !== 'string' ||
        !course_name.trim() ||
        course_name.trim().length > 100
    ) {
        return 'Course name is required (maximum 100 characters).';
    }

    return null;
}

// ========================================
// DATABASE SETUP (runs once when the server starts)
// Creates the courses table and adds patients.course_id
// if they do not exist yet. Safe to run many times.
// ========================================
async function ensureSchema() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS courses (
            course_id INT NOT NULL AUTO_INCREMENT,
            course_code VARCHAR(20) NOT NULL,
            course_name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (course_id),
            UNIQUE KEY uq_courses_code (course_code)
        )
    `);

    const [columns] = await db.query(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'patients'
           AND COLUMN_NAME = 'course_id'`
    );

    if (columns.length === 0) {
        await db.query('ALTER TABLE patients ADD COLUMN course_id INT NULL');
        console.log('Added patients.course_id column.');
    }

    const [keys] = await db.query(
        `SELECT CONSTRAINT_NAME
         FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'patients'
           AND CONSTRAINT_NAME = 'fk_patients_course'`
    );

    if (keys.length === 0) {
        try {
            await db.query(
                `ALTER TABLE patients
                 ADD CONSTRAINT fk_patients_course
                 FOREIGN KEY (course_id) REFERENCES courses (course_id)
                 ON DELETE RESTRICT ON UPDATE CASCADE`
            );
            console.log('Added fk_patients_course foreign key.');
        } catch (err) {
            // The app still works without the constraint; the API checks the course itself.
            console.warn('Could not add course foreign key:', err.message);
        }
    }
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
                p.patient_id,
                p.first_name,
                p.last_name,
                p.birthdate,
                p.sex,
                p.contact_no,
                p.address,
                p.status,
                p.created_at,
                p.course_id,
                c.course_code,
                c.course_name
            FROM patients p
            LEFT JOIN courses c ON c.course_id = p.course_id
            WHERE (
                p.first_name LIKE ?
                OR p.last_name LIKE ?
                OR p.contact_no LIKE ?
                OR CONCAT(p.first_name, ' ', p.last_name) LIKE ?
            )
        `;

        const params = [term, term, term, term];

        if (requestedStatus !== 'All') {
            sql += ' AND p.status = ?';
            params.push(requestedStatus.toLowerCase());
        }

        sql += ' ORDER BY p.last_name ASC, p.first_name ASC';

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
                p.patient_id,
                p.first_name,
                p.last_name,
                p.birthdate,
                p.sex,
                p.contact_no,
                p.address,
                p.status,
                p.created_at,
                p.course_id,
                c.course_code,
                c.course_name
             FROM patients p
             LEFT JOIN courses c ON c.course_id = p.course_id
             WHERE p.patient_id = ?
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
            address,
            course_id
        } = req.body;

        const first = first_name.trim();
        const last = last_name.trim();

        const courseId = Number(course_id);

        if (!(await courseExists(courseId))) {
            return res.status(400).json({
                error: 'The selected course does not exist.'
            });
        }

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
                address,
                course_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                first,
                last,
                birthdate,
                sex,
                contact_no?.trim() || null,
                address?.trim() || null,
                courseId
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
            address,
            course_id
        } = req.body;

        const courseId = Number(course_id);

        if (!(await courseExists(courseId))) {
            return res.status(400).json({
                error: 'The selected course does not exist.'
            });
        }

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
                address = ?,
                course_id = ?
             WHERE patient_id = ?`,
            [
                first,
                last,
                birthdate,
                sex,
                contact_no?.trim() || null,
                address?.trim() || null,
                courseId,
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
// HELPER: DOES A COURSE EXIST?
// ========================================
async function courseExists(id) {
    const [rows] = await db.execute(
        'SELECT course_id FROM courses WHERE course_id = ? LIMIT 1',
        [id]
    );

    return rows.length > 0;
}

// ========================================
// COURSES - GET: LIST ALL COURSES
// (also used to fill the Course dropdown)
// ========================================
app.get('/api/courses', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT
                c.course_id,
                c.course_code,
                c.course_name,
                c.created_at,
                COUNT(p.patient_id) AS patient_count
             FROM courses c
             LEFT JOIN patients p ON p.course_id = c.course_id
             GROUP BY c.course_id, c.course_code, c.course_name, c.created_at
             ORDER BY c.course_code ASC`
        );

        res.json(
            rows.map((row) => ({
                ...row,
                patient_count: Number(row.patient_count)
            }))
        );
    } catch (err) {
        console.error('List courses error:', err.message);

        res.status(500).json({ error: 'Unable to load courses.' });
    }
});

// ========================================
// COURSES - GET: ONE COURSE
// ========================================
app.get('/api/courses/:id', async (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid course ID.' });
        }

        const [rows] = await db.execute(
            `SELECT course_id, course_code, course_name, created_at
             FROM courses
             WHERE course_id = ?
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Course not found.' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('Get course error:', err.message);

        res.status(500).json({ error: 'Unable to load course.' });
    }
});

// ========================================
// COURSES - POST: CREATE A COURSE
// ========================================
app.post('/api/courses', async (req, res) => {
    try {
        const error = validateCourse(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        const code = req.body.course_code.trim().toUpperCase();
        const name = req.body.course_name.trim();

        const [duplicates] = await db.execute(
            'SELECT course_id FROM courses WHERE course_code = ? LIMIT 1',
            [code]
        );

        if (duplicates.length > 0) {
            return res.status(409).json({
                error: 'A course with this code already exists.'
            });
        }

        const [result] = await db.execute(
            'INSERT INTO courses (course_code, course_name) VALUES (?, ?)',
            [code, name]
        );

        res.status(201).json({
            ok: true,
            message: 'Course added successfully.',
            course_id: result.insertId
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                error: 'A course with this code already exists.'
            });
        }

        console.error('Create course error:', err.message);

        res.status(500).json({ error: 'Unable to add course.' });
    }
});

// ========================================
// COURSES - PUT: UPDATE A COURSE
// ========================================
app.put('/api/courses/:id', async (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid course ID.' });
        }

        const error = validateCourse(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        const id = Number(req.params.id);
        const code = req.body.course_code.trim().toUpperCase();
        const name = req.body.course_name.trim();

        if (!(await courseExists(id))) {
            return res.status(404).json({ error: 'Course not found.' });
        }

        const [duplicates] = await db.execute(
            `SELECT course_id
             FROM courses
             WHERE course_code = ? AND course_id <> ?
             LIMIT 1`,
            [code, id]
        );

        if (duplicates.length > 0) {
            return res.status(409).json({
                error: 'Another course already uses this code.'
            });
        }

        await db.execute(
            `UPDATE courses
             SET course_code = ?, course_name = ?
             WHERE course_id = ?`,
            [code, name, id]
        );

        res.json({ ok: true, message: 'Course updated successfully.' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                error: 'Another course already uses this code.'
            });
        }

        console.error('Update course error:', err.message);

        res.status(500).json({ error: 'Unable to update course.' });
    }
});

// ========================================
// COURSES - DELETE: REMOVE A COURSE
// A course that is still assigned to patients cannot be deleted.
// ========================================
app.delete('/api/courses/:id', async (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid course ID.' });
        }

        const id = Number(req.params.id);

        if (!(await courseExists(id))) {
            return res.status(404).json({ error: 'Course not found.' });
        }

        const [used] = await db.execute(
            'SELECT COUNT(*) AS total FROM patients WHERE course_id = ?',
            [id]
        );

        if (Number(used[0].total) > 0) {
            return res.status(409).json({
                error: `This course is assigned to ${used[0].total} patient record(s) and cannot be deleted.`
            });
        }

        await db.execute('DELETE FROM courses WHERE course_id = ?', [id]);

        res.json({ ok: true, message: 'Course deleted successfully.' });
    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({
                error: 'This course is still assigned to patient records.'
            });
        }

        console.error('Delete course error:', err.message);

        res.status(500).json({ error: 'Unable to delete course.' });
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

        await ensureSchema();

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