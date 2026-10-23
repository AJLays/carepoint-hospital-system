'use strict';

(() => {
    const API = '/api/patients';
    const COURSE_API = '/api/courses';

    // ========================================
    // ELEMENTS
    // ========================================
    const form = document.getElementById('patientForm');
    const formTitle = document.getElementById('formTitle');
    const messageBox = document.getElementById('message');
    const saveButton = document.getElementById('saveButton');
    const cancelButton = document.getElementById('cancelButton');

    const firstNameInput = document.getElementById('first_name');
    const lastNameInput = document.getElementById('last_name');
    const birthdateInput = document.getElementById('birthdate');
    const sexInput = document.getElementById('sex');
    const contactInput = document.getElementById('contact_no');
    const addressInput = document.getElementById('address');
    const courseSelect = document.getElementById('course_id');

    // Course management elements
    const courseForm = document.getElementById('courseForm');
    const courseFormTitle = document.getElementById('courseFormTitle');
    const courseMessageBox = document.getElementById('courseMessage');
    const courseSaveButton = document.getElementById('courseSaveButton');
    const courseCancelButton = document.getElementById('courseCancelButton');
    const courseCodeInput = document.getElementById('course_code');
    const courseNameInput = document.getElementById('course_name');
    const courseList = document.getElementById('courseList');

    const searchInput = document.getElementById('search');
    const statusFilter = document.getElementById('statusFilter');
    const patientList = document.getElementById('patientList');
    const countEl = document.getElementById('count');
    const pageLoader = document.getElementById('pageLoader');

    let editingId = null;
    let editingCourseId = null;
    let courseMessageTimer = null;
    let requestCounter = 0;
    let pendingRequests = 0;
    let searchTimer = null;
    let messageTimer = null;

    // ========================================
    // PAGE LOADING BAR
    // ========================================
    function injectLoaderStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .page-loader {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                height: 3px;
                z-index: 9999;
                opacity: 0;
                transition: opacity 0.2s;
                pointer-events: none;
                overflow: hidden;
            }
            .page-loader.active { opacity: 1; }
            .page-loader-bar {
                height: 100%;
                width: 40%;
                background: #1769d2;
                animation: pageLoaderSlide 1s ease-in-out infinite;
            }
            @keyframes pageLoaderSlide {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(250%); }
            }
        `;
        document.head.appendChild(style);
    }

    function startLoading() {
        pendingRequests++;
        if (pageLoader) pageLoader.classList.add('active');
    }

    function stopLoading() {
        pendingRequests = Math.max(0, pendingRequests - 1);
        if (pendingRequests === 0 && pageLoader) {
            pageLoader.classList.remove('active');
        }
    }

    // ========================================
    // HELPERS
    // ========================================
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    // Returns YYYY-MM-DD from a DATE value coming from the API.
    function toDateString(value) {
        if (!value) return '';

        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return value;
        }

        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';

        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function formatDate(value) {
        const s = toDateString(value);
        if (!s) return '—';

        const [y, m, d] = s.split('-').map(Number);

        return new Date(y, m - 1, d).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    function todayString() {
        const d = new Date();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    async function api(url, options = {}) {
        startLoading();

        try {
            const res = await fetch(url, {
                headers: { 'Content-Type': 'application/json' },
                ...options
            });

            let data = null;
            try {
                data = await res.json();
            } catch {
                data = null;
            }

            if (!res.ok) {
                throw new Error(
                    (data && data.error) || `Request failed (${res.status}).`
                );
            }

            return data;
        } catch (err) {
            if (err instanceof TypeError) {
                throw new Error('Cannot reach the server. Please try again.');
            }
            throw err;
        } finally {
            stopLoading();
        }
    }

    // ========================================
    // FORM MESSAGES
    // ========================================
    function clearMessage() {
        clearTimeout(messageTimer);
        messageBox.textContent = '';
        messageBox.className = 'message';
    }

    function showMessage(type, text) {
        clearTimeout(messageTimer);
        messageBox.textContent = text;
        messageBox.className = `message ${type}`;

        if (type === 'success') {
            messageTimer = setTimeout(clearMessage, 5000);
        }
    }

    // ========================================
    // FORM MODE (ADD / EDIT)
    // ========================================
    function setSaveLabel(text) {
        saveButton.innerHTML =
            '<span aria-hidden="true">＋</span> ' + escapeHtml(text);
    }

    function resetForm() {
        form.reset();
        editingId = null;
        formTitle.textContent = 'Register New Patient';
        setSaveLabel('Save Patient');
        saveButton.disabled = false;
        clearMessage();
    }

    function fillForm(patient) {
        editingId = patient.patient_id;

        firstNameInput.value = patient.first_name || '';
        lastNameInput.value = patient.last_name || '';
        birthdateInput.value = toDateString(patient.birthdate);
        sexInput.value = patient.sex || '';
        contactInput.value = patient.contact_no || '';
        addressInput.value = patient.address || '';
        courseSelect.value = patient.course_id ? String(patient.course_id) : '';

        formTitle.textContent = `Edit Patient #${patient.patient_id}`;
        setSaveLabel('Update Patient');
        clearMessage();
    }

    // ========================================
    // TABLE RENDERING
    // ========================================
    function renderEmpty(text) {
        patientList.innerHTML =
            `<tr><td colspan="8" class="empty-state">${escapeHtml(text)}</td></tr>`;
    }

    function renderPatients(patients) {
        if (!patients.length) {
            const filtering =
                searchInput.value.trim() !== '' || statusFilter.value !== '';

            renderEmpty(
                filtering
                    ? 'No patients match your search.'
                    : 'No patients registered yet.'
            );
            return;
        }

        patientList.innerHTML = patients
            .map((p) => {
                const isActive = p.status === 'Active';
                const badgeClass = isActive ? 'active' : 'inactive';
                const toggleLabel = isActive ? 'Deactivate' : 'Activate';

                return `
                <tr>
                    <td>${escapeHtml(p.patient_id)}</td>
                    <td>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</td>
                    <td>${escapeHtml(formatDate(p.birthdate))}</td>
                    <td>${escapeHtml(p.sex)}</td>
                    <td>${
                        p.course_code
                            ? `<span title="${escapeHtml(p.course_name)}">${escapeHtml(p.course_code)}</span>`
                            : '—'
                    }</td>
                    <td>${escapeHtml(p.contact_no || '—')}</td>
                    <td>
                        <span class="status-badge ${badgeClass}">
                            ${escapeHtml(p.status)}
                        </span>
                    </td>
                    <td>
                        <button type="button" class="action-btn"
                            data-action="edit"
                            data-id="${escapeHtml(p.patient_id)}">Edit</button>
                        <button type="button" class="action-btn"
                            data-action="toggle"
                            data-id="${escapeHtml(p.patient_id)}"
                            data-status="${escapeHtml(p.status)}">${toggleLabel}</button>
                    </td>
                </tr>`;
            })
            .join('');
    }

    // ========================================
    // LOAD PATIENTS
    // ========================================
    async function refreshTotal() {
        try {
            const all = await api(API);
            countEl.textContent = all.length;
        } catch {
            // Keep the previous total if this fails.
        }
    }

    async function loadPatients() {
        const myRequest = ++requestCounter;

        const search = searchInput.value.trim();
        const status = statusFilter.value || 'All';

        const params = new URLSearchParams();
        if (search) params.set('search', search);
        params.set('status', status);

        try {
            const patients = await api(`${API}?${params.toString()}`);

            // Ignore results from an older request.
            if (myRequest !== requestCounter) return;

            renderPatients(patients);

            if (!search && status === 'All') {
                countEl.textContent = patients.length;
            } else {
                refreshTotal();
            }
        } catch (err) {
            if (myRequest !== requestCounter) return;
            renderEmpty(err.message || 'Unable to load patients.');
        }
    }

    // ========================================
    // FORM SUBMIT (REGISTER OR UPDATE)
    // ========================================
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearMessage();

        const payload = {
            first_name: firstNameInput.value.trim(),
            last_name: lastNameInput.value.trim(),
            birthdate: birthdateInput.value,
            sex: sexInput.value,
            contact_no: contactInput.value.trim() || null,
            address: addressInput.value.trim() || null,
            course_id: courseSelect.value
        };

        const wasEditing = editingId !== null;
        const url = wasEditing ? `${API}/${editingId}` : API;
        const method = wasEditing ? 'PUT' : 'POST';

        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';

        try {
            const result = await api(url, {
                method,
                body: JSON.stringify(payload)
            });

            resetForm();
            showMessage('success', result.message || 'Saved successfully.');
            await loadCourses();
            await loadPatients();
        } catch (err) {
            saveButton.disabled = false;
            setSaveLabel(wasEditing ? 'Update Patient' : 'Save Patient');
            showMessage('error', err.message);
        }
    });

    cancelButton.addEventListener('click', resetForm);

    // ========================================
    // TABLE ACTIONS (EDIT / ACTIVATE / DEACTIVATE)
    // ========================================
    patientList.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;

        const id = button.dataset.id;
        const action = button.dataset.action;

        if (action === 'edit') {
            try {
                const patient = await api(`${API}/${id}`);
                fillForm(patient);

                document
                    .getElementById('registration')
                    .scrollIntoView({ behavior: 'smooth', block: 'start' });

                firstNameInput.focus({ preventScroll: true });
            } catch (err) {
                alert(err.message);
            }
            return;
        }

        if (action === 'toggle') {
            const newStatus =
                button.dataset.status === 'Active' ? 'Inactive' : 'Active';

            const verb = newStatus === 'Inactive' ? 'deactivate' : 'activate';

            if (!confirm(`Are you sure you want to ${verb} this patient?`)) {
                return;
            }

            button.disabled = true;

            try {
                await api(`${API}/${id}/status`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: newStatus })
                });

                await loadPatients();
            } catch (err) {
                button.disabled = false;
                alert(err.message);
            }
        }
    });

    // ========================================
    // COURSES: MESSAGES
    // ========================================
    function clearCourseMessage() {
        clearTimeout(courseMessageTimer);
        courseMessageBox.textContent = '';
        courseMessageBox.className = 'message';
    }

    function showCourseMessage(type, text) {
        clearTimeout(courseMessageTimer);
        courseMessageBox.textContent = text;
        courseMessageBox.className = `message ${type}`;

        if (type === 'success') {
            courseMessageTimer = setTimeout(clearCourseMessage, 5000);
        }
    }

    // ========================================
    // COURSES: FORM MODE (ADD / EDIT)
    // ========================================
    function setCourseSaveLabel(text) {
        courseSaveButton.innerHTML =
            '<span aria-hidden="true">＋</span> ' + escapeHtml(text);
    }

    function resetCourseForm() {
        courseForm.reset();
        editingCourseId = null;
        courseFormTitle.textContent = 'Add New Course';
        setCourseSaveLabel('Save Course');
        courseSaveButton.disabled = false;
        clearCourseMessage();
    }

    // ========================================
    // COURSES: LOAD, DROPDOWN, AND TABLE
    // ========================================
    // Fills the Course dropdown in the patient form from the database.
    function populateCourseDropdown(courses) {
        const previous = courseSelect.value;

        courseSelect.innerHTML = '<option value="">Select a course</option>';

        courses.forEach((c) => {
            const option = document.createElement('option');
            option.value = String(c.course_id);
            option.textContent = `${c.course_code} — ${c.course_name}`;
            courseSelect.appendChild(option);
        });

        // Keep the current choice if it still exists.
        if (previous && courses.some((c) => String(c.course_id) === previous)) {
            courseSelect.value = previous;
        }
    }

    function renderCourseEmpty(text) {
        courseList.innerHTML =
            `<tr><td colspan="5" class="empty-state">${escapeHtml(text)}</td></tr>`;
    }

    function renderCourses(courses) {
        if (!courses.length) {
            renderCourseEmpty('No courses yet. Add your first course above.');
            return;
        }

        courseList.innerHTML = courses
            .map((c) => `
                <tr>
                    <td>${escapeHtml(c.course_id)}</td>
                    <td>${escapeHtml(c.course_code)}</td>
                    <td>${escapeHtml(c.course_name)}</td>
                    <td>${escapeHtml(c.patient_count)}</td>
                    <td>
                        <button type="button" class="action-btn"
                            data-action="edit-course"
                            data-id="${escapeHtml(c.course_id)}">Edit</button>
                        <button type="button" class="action-btn"
                            data-action="delete-course"
                            data-id="${escapeHtml(c.course_id)}"
                            data-code="${escapeHtml(c.course_code)}">Delete</button>
                    </td>
                </tr>`)
            .join('');
    }

    async function loadCourses() {
        try {
            const courses = await api(COURSE_API);
            populateCourseDropdown(courses);
            renderCourses(courses);
        } catch (err) {
            renderCourseEmpty(err.message || 'Unable to load courses.');
        }
    }

    // ========================================
    // COURSES: SUBMIT (CREATE OR UPDATE)
    // ========================================
    courseForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearCourseMessage();

        const payload = {
            course_code: courseCodeInput.value.trim(),
            course_name: courseNameInput.value.trim()
        };

        const wasEditing = editingCourseId !== null;
        const url = wasEditing ? `${COURSE_API}/${editingCourseId}` : COURSE_API;
        const method = wasEditing ? 'PUT' : 'POST';

        courseSaveButton.disabled = true;
        courseSaveButton.textContent = 'Saving...';

        try {
            const result = await api(url, {
                method,
                body: JSON.stringify(payload)
            });

            resetCourseForm();
            showCourseMessage('success', result.message || 'Saved successfully.');

            // Refresh the table and dropdown, then the patient list
            // (a renamed course changes what the patient table shows).
            await loadCourses();
            await loadPatients();
        } catch (err) {
            courseSaveButton.disabled = false;
            setCourseSaveLabel(wasEditing ? 'Update Course' : 'Save Course');
            showCourseMessage('error', err.message);
        }
    });

    courseCancelButton.addEventListener('click', resetCourseForm);

    // ========================================
    // COURSES: TABLE ACTIONS (EDIT / DELETE)
    // ========================================
    courseList.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;

        const id = button.dataset.id;
        const action = button.dataset.action;

        if (action === 'edit-course') {
            try {
                const course = await api(`${COURSE_API}/${id}`);

                editingCourseId = course.course_id;
                courseCodeInput.value = course.course_code || '';
                courseNameInput.value = course.course_name || '';
                courseFormTitle.textContent = `Edit Course #${course.course_id}`;
                setCourseSaveLabel('Update Course');
                clearCourseMessage();

                document
                    .getElementById('courses')
                    .scrollIntoView({ behavior: 'smooth', block: 'start' });

                courseCodeInput.focus({ preventScroll: true });
            } catch (err) {
                alert(err.message);
            }
            return;
        }

        if (action === 'delete-course') {
            if (!confirm(`Delete course ${button.dataset.code}? This cannot be undone.`)) {
                return;
            }

            button.disabled = true;

            try {
                const result = await api(`${COURSE_API}/${id}`, { method: 'DELETE' });

                if (editingCourseId === Number(id)) resetCourseForm();

                showCourseMessage('success', result.message || 'Course deleted.');
                await loadCourses();
            } catch (err) {
                button.disabled = false;
                showCourseMessage('error', err.message);
            }
        }
    });

    // ========================================
    // SEARCH AND FILTER
    // ========================================
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadPatients, 300);
    });

    statusFilter.addEventListener('change', loadPatients);

    // ========================================
    // SIDEBAR NAVIGATION HIGHLIGHT
    // ========================================
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach((link) => {
        link.addEventListener('click', () => {
            navLinks.forEach((l) => l.classList.remove('active'));
            link.classList.add('active');
        });
    });

    // ========================================
    // START
    // ========================================
    injectLoaderStyles();
    birthdateInput.max = todayString();
    loadCourses();
    loadPatients();
})();