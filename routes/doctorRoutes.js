const express = require('express');

// Phase 3: Departments and Doctors. Mounted at /api in server.js.
module.exports = (db) => {
    const router = express.Router();

    // ---------- helpers ----------
    const idOk = (v) => String(v ?? '').trim() !== '' && Number.isSafeInteger(Number(v)) && Number(v) > 0;
    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const wrap = (fn) => async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: 'That name or license number is already in use.' });
            }
            console.error(req.method, req.originalUrl, err.message);
            res.status(500).json({ error: 'Something went wrong. Please try again.' });
        }
    };

    function validateDepartment(d) {
        const name = clean(d?.department_name);
        if (!name || name.length > 100) return 'Department name is required (maximum 100 characters).';
        if (d.description != null && (typeof d.description !== 'string' || d.description.trim().length > 255)) {
            return 'Description must be 255 characters or fewer.';
        }
        return null;
    }

    function validateDoctor(d) {
        if (!d || typeof d !== 'object' || Array.isArray(d)) return 'Invalid doctor data.';
        const first = clean(d.first_name), last = clean(d.last_name);
        if (!first || first.length > 50 || !last || last.length > 50) {
            return 'First and last name are required (maximum 50 characters each).';
        }
        const spec = clean(d.specialization);
        if (!spec || spec.length > 100) return 'Specialization is required (maximum 100 characters).';
        if (!idOk(d.department_id)) return 'Please select a department.';
        const limits = { license_no: 80, contact_no: 20, email: 120 };
        for (const [key, max] of Object.entries(limits)) {
            const v = d[key];
            if (v != null && v !== '' && (typeof v !== 'string' || v.trim().length > max)) {
                return `${key.replace('_', ' ')} is invalid or longer than ${max} characters.`;
            }
        }
        const email = clean(d.email);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
        return null;
    }

    const activeDepartment = async (id) => {
        const [rows] = await db.execute(
            "SELECT department_id FROM departments WHERE department_id = ? AND status = 'active'", [id]);
        return rows.length > 0;
    };

    // ---------- DEPARTMENTS ----------
    router.get('/departments', wrap(async (req, res) => {
        const [rows] = await db.execute(
            `SELECT d.department_id, d.department_name, d.description, d.status,
                    COUNT(doc.doctor_id) AS doctor_count
             FROM departments d
             LEFT JOIN doctors doc ON doc.department_id = d.department_id
             GROUP BY d.department_id, d.department_name, d.description, d.status
             ORDER BY d.department_name`);
        res.json(rows.map((r) => ({ ...r, doctor_count: Number(r.doctor_count) })));
    }));

    router.post('/departments', wrap(async (req, res) => {
        const error = validateDepartment(req.body);
        if (error) return res.status(400).json({ error });
        const [result] = await db.execute(
            'INSERT INTO departments (department_name, description) VALUES (?, ?)',
            [clean(req.body.department_name), clean(req.body.description)]);
        res.status(201).json({ ok: true, message: 'Department added successfully.', department_id: result.insertId });
    }));

    router.put('/departments/:id', wrap(async (req, res) => {
        if (!idOk(req.params.id)) return res.status(400).json({ error: 'Invalid department ID.' });
        const error = validateDepartment(req.body);
        if (error) return res.status(400).json({ error });
        const [result] = await db.execute(
            'UPDATE departments SET department_name = ?, description = ? WHERE department_id = ?',
            [clean(req.body.department_name), clean(req.body.description), Number(req.params.id)]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Department not found.' });
        res.json({ ok: true, message: 'Department updated successfully.' });
    }));

    router.patch('/departments/:id/status', wrap(async (req, res) => {
        const status = req.body?.status;
        if (!idOk(req.params.id)) return res.status(400).json({ error: 'Invalid department ID.' });
        if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Status must be active or inactive.' });
        const id = Number(req.params.id);
        if (status === 'inactive') {
            const [[row]] = await db.execute(
                "SELECT COUNT(*) AS n FROM doctors WHERE department_id = ? AND status = 'active'", [id]);
            if (Number(row.n) > 0) {
                return res.status(409).json({ error: `Reassign or deactivate its ${row.n} active doctor(s) first.` });
            }
        }
        const [result] = await db.execute('UPDATE departments SET status = ? WHERE department_id = ?', [status, id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Department not found.' });
        res.json({ ok: true, message: `Department ${status}.` });
    }));

    // ---------- DOCTORS ----------
    const DOCTOR_SELECT = `
        SELECT d.doctor_id, d.first_name, d.last_name, d.specialization, d.license_no,
               d.contact_no, d.email, d.status, d.department_id, dep.department_name
        FROM doctors d
        LEFT JOIN departments dep ON dep.department_id = d.department_id`;

    router.get('/doctors', wrap(async (req, res) => {
        const term = `%${String(req.query.search || '').trim()}%`;
        let sql = `${DOCTOR_SELECT}
            WHERE (CONCAT(d.first_name, ' ', d.last_name) LIKE ? OR d.specialization LIKE ? OR d.license_no LIKE ?)`;
        const params = [term, term, term];
        if (['active', 'inactive'].includes(req.query.status)) { sql += ' AND d.status = ?'; params.push(req.query.status); }
        if (idOk(req.query.department_id)) { sql += ' AND d.department_id = ?'; params.push(Number(req.query.department_id)); }
        sql += ' ORDER BY d.last_name, d.first_name';
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    }));

    router.get('/doctors/:id', wrap(async (req, res) => {
        if (!idOk(req.params.id)) return res.status(400).json({ error: 'Invalid doctor ID.' });
        const [rows] = await db.execute(`${DOCTOR_SELECT} WHERE d.doctor_id = ? LIMIT 1`, [Number(req.params.id)]);
        if (rows.length === 0) return res.status(404).json({ error: 'Doctor not found.' });
        res.json(rows[0]);
    }));

    const doctorValues = (b) => [
        clean(b.first_name), clean(b.last_name), clean(b.specialization), Number(b.department_id),
        clean(b.license_no), clean(b.contact_no), clean(b.email)
    ];

    router.post('/doctors', wrap(async (req, res) => {
        const error = validateDoctor(req.body);
        if (error) return res.status(400).json({ error });
        if (!(await activeDepartment(Number(req.body.department_id)))) {
            return res.status(400).json({ error: 'Choose an active department.' });
        }
        const [result] = await db.execute(
            `INSERT INTO doctors (first_name, last_name, specialization, department_id, license_no, contact_no, email)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, doctorValues(req.body));
        res.status(201).json({ ok: true, message: 'Doctor registered successfully.', doctor_id: result.insertId });
    }));

    router.put('/doctors/:id', wrap(async (req, res) => {
        if (!idOk(req.params.id)) return res.status(400).json({ error: 'Invalid doctor ID.' });
        const error = validateDoctor(req.body);
        if (error) return res.status(400).json({ error });
        if (!(await activeDepartment(Number(req.body.department_id)))) {
            return res.status(400).json({ error: 'Choose an active department.' });
        }
        const [result] = await db.execute(
            `UPDATE doctors SET first_name = ?, last_name = ?, specialization = ?, department_id = ?,
                    license_no = ?, contact_no = ?, email = ?
             WHERE doctor_id = ?`, [...doctorValues(req.body), Number(req.params.id)]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Doctor not found.' });
        res.json({ ok: true, message: 'Doctor updated successfully.' });
    }));

    router.patch('/doctors/:id/status', wrap(async (req, res) => {
        const status = req.body?.status;
        if (!idOk(req.params.id)) return res.status(400).json({ error: 'Invalid doctor ID.' });
        if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Status must be active or inactive.' });
        const id = Number(req.params.id);
        if (status === 'inactive') {
            const [[row]] = await db.execute(
                "SELECT COUNT(*) AS n FROM admissions WHERE attending_doctor_id = ? AND status = 'admitted'", [id]);
            if (Number(row.n) > 0) {
                return res.status(409).json({ error: `This doctor still has ${row.n} admitted patient(s).` });
            }
        }
        const [result] = await db.execute('UPDATE doctors SET status = ? WHERE doctor_id = ?', [status, id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Doctor not found.' });
        res.json({ ok: true, message: `Doctor ${status}.` });
    }));

    return router;
};