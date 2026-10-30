'use strict';

(() => {
    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    async function api(url, options = {}) {
        let res;
        try {
            res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
        } catch {
            throw new Error('Cannot reach the server. Please try again.');
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
        return data;
    }

    function say(box, type, text) {
        box.textContent = text;
        box.className = `message ${type}`;
        if (type === 'success') setTimeout(() => { box.textContent = ''; box.className = 'message'; }, 5000);
    }

    let editingDept = null;
    let editingDoc = null;
    let searchTimer = null;

    // ---------------- DEPARTMENTS ----------------
    function resetDept() {
        $('deptForm').reset();
        editingDept = null;
        $('deptTitle').textContent = 'Add Department';
        $('deptSave').textContent = 'Save Department';
        $('deptSave').disabled = false;
    }

    function fillDeptSelects(depts) {
        const active = depts.filter((d) => d.status === 'active');
        const keep = $('d_dept').value;
        $('d_dept').innerHTML = '<option value="">Select a department</option>' +
            active.map((d) => `<option value="${d.department_id}">${esc(d.department_name)}</option>`).join('');
        $('d_dept').value = keep;

        const keepFilter = $('docDeptFilter').value;
        $('docDeptFilter').innerHTML = '<option value="">All</option>' +
            depts.map((d) => `<option value="${d.department_id}">${esc(d.department_name)}</option>`).join('');
        $('docDeptFilter').value = keepFilter;
    }

    async function loadDepartments() {
        try {
            const depts = await api('/api/departments');
            fillDeptSelects(depts);
            $('deptList').innerHTML = depts.length ? depts.map((d) => `
                <tr>
                    <td>${esc(d.department_name)}</td>
                    <td>${esc(d.description || '—')}</td>
                    <td>${d.doctor_count}</td>
                    <td><span class="status-badge ${d.status}">${cap(d.status)}</span></td>
                    <td>
                        <button type="button" class="action-btn" data-act="edit" data-id="${d.department_id}"
                            data-name="${esc(d.department_name)}" data-desc="${esc(d.description || '')}">Edit</button>
                        <button type="button" class="action-btn" data-act="toggle" data-id="${d.department_id}"
                            data-status="${d.status}">${d.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                    </td>
                </tr>`).join('')
                : '<tr><td colspan="5" class="empty-state">No departments yet.</td></tr>';
        } catch (err) {
            $('deptList').innerHTML = `<tr><td colspan="5" class="empty-state">${esc(err.message)}</td></tr>`;
        }
    }

    $('deptForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const wasEditing = editingDept !== null;
        $('deptSave').disabled = true;
        try {
            const result = await api(wasEditing ? `/api/departments/${editingDept}` : '/api/departments', {
                method: wasEditing ? 'PUT' : 'POST',
                body: JSON.stringify({
                    department_name: $('department_name').value,
                    description: $('department_description').value
                })
            });
            resetDept();
            say($('deptMsg'), 'success', result.message);
            await loadDepartments();
            await loadDoctors();
        } catch (err) {
            $('deptSave').disabled = false;
            say($('deptMsg'), 'error', err.message);
        }
    });

    $('deptCancel').addEventListener('click', resetDept);

    $('deptList').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        if (btn.dataset.act === 'edit') {
            editingDept = Number(btn.dataset.id);
            $('department_name').value = btn.dataset.name;
            $('department_description').value = btn.dataset.desc;
            $('deptTitle').textContent = `Edit Department #${editingDept}`;
            $('deptSave').textContent = 'Update Department';
            $('department_name').focus();
            return;
        }
        const next = btn.dataset.status === 'active' ? 'inactive' : 'active';
        if (!confirm(`Are you sure you want to ${next === 'inactive' ? 'deactivate' : 'activate'} this department?`)) return;
        try {
            const result = await api(`/api/departments/${btn.dataset.id}/status`,
                { method: 'PATCH', body: JSON.stringify({ status: next }) });
            say($('deptMsg'), 'success', result.message);
            await loadDepartments();
        } catch (err) {
            say($('deptMsg'), 'error', err.message);
        }
    });

    // ---------------- DOCTORS ----------------
    function resetDoc() {
        $('docForm').reset();
        editingDoc = null;
        $('docTitle').textContent = 'Register Doctor';
        $('docSave').textContent = 'Save Doctor';
        $('docSave').disabled = false;
    }

    async function loadDoctors() {
        const params = new URLSearchParams();
        if ($('docSearch').value.trim()) params.set('search', $('docSearch').value.trim());
        if ($('docStatus').value) params.set('status', $('docStatus').value);
        if ($('docDeptFilter').value) params.set('department_id', $('docDeptFilter').value);
        try {
            const docs = await api(`/api/doctors?${params}`);
            $('docList').innerHTML = docs.length ? docs.map((d) => `
                <tr>
                    <td>${d.doctor_id}</td>
                    <td>Dr. ${esc(d.first_name)} ${esc(d.last_name)}</td>
                    <td>${esc(d.specialization || '—')}</td>
                    <td>${esc(d.department_name || '—')}</td>
                    <td>${esc(d.contact_no || '—')}</td>
                    <td><span class="status-badge ${d.status}">${cap(d.status)}</span></td>
                    <td>
                        <button type="button" class="action-btn" data-act="edit" data-id="${d.doctor_id}">Edit</button>
                        <button type="button" class="action-btn" data-act="toggle" data-id="${d.doctor_id}"
                            data-status="${d.status}">${d.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                    </td>
                </tr>`).join('')
                : '<tr><td colspan="7" class="empty-state">No doctors found.</td></tr>';
        } catch (err) {
            $('docList').innerHTML = `<tr><td colspan="7" class="empty-state">${esc(err.message)}</td></tr>`;
        }
    }

    $('docForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const wasEditing = editingDoc !== null;
        $('docSave').disabled = true;
        try {
            const result = await api(wasEditing ? `/api/doctors/${editingDoc}` : '/api/doctors', {
                method: wasEditing ? 'PUT' : 'POST',
                body: JSON.stringify({
                    first_name: $('d_first').value, last_name: $('d_last').value,
                    specialization: $('d_spec').value, department_id: $('d_dept').value,
                    license_no: $('d_license').value, contact_no: $('d_contact').value, email: $('d_email').value
                })
            });
            resetDoc();
            say($('docMsg'), 'success', result.message);
            await loadDepartments();
            await loadDoctors();
        } catch (err) {
            $('docSave').disabled = false;
            say($('docMsg'), 'error', err.message);
        }
    });

    $('docCancel').addEventListener('click', resetDoc);

    $('docList').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        if (btn.dataset.act === 'edit') {
            try {
                const d = await api(`/api/doctors/${btn.dataset.id}`);
                editingDoc = d.doctor_id;
                $('d_first').value = d.first_name; $('d_last').value = d.last_name;
                $('d_spec').value = d.specialization || ''; $('d_dept').value = String(d.department_id || '');
                $('d_license').value = d.license_no || ''; $('d_contact').value = d.contact_no || '';
                $('d_email').value = d.email || '';
                $('docTitle').textContent = `Edit Doctor #${d.doctor_id}`;
                $('docSave').textContent = 'Update Doctor';
                $('doctors').scrollIntoView({ behavior: 'smooth' });
                $('d_first').focus({ preventScroll: true });
            } catch (err) {
                say($('docMsg'), 'error', err.message);
            }
            return;
        }
        const next = btn.dataset.status === 'active' ? 'inactive' : 'active';
        if (!confirm(`Are you sure you want to ${next === 'inactive' ? 'deactivate' : 'activate'} this doctor?`)) return;
        try {
            const result = await api(`/api/doctors/${btn.dataset.id}/status`,
                { method: 'PATCH', body: JSON.stringify({ status: next }) });
            say($('docMsg'), 'success', result.message);
            await loadDoctors();
            await loadDepartments();
        } catch (err) {
            say($('docMsg'), 'error', err.message);
        }
    });

    $('docSearch').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadDoctors, 300);
    });
    $('docStatus').addEventListener('change', loadDoctors);
    $('docDeptFilter').addEventListener('change', loadDoctors);

    loadDepartments().then(loadDoctors);
})();