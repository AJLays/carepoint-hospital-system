'use strict';

(() => {
    const API = '/api/patients';

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

    const searchInput = document.getElementById('search');
    const statusFilter = document.getElementById('statusFilter');
    const patientList = document.getElementById('patientList');
    const countEl = document.getElementById('count');
    const pageLoader = document.getElementById('pageLoader');

    let editingId = null;
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

        formTitle.textContent = `Edit Patient #${patient.patient_id}`;
        setSaveLabel('Update Patient');
        clearMessage();
    }

    // ========================================
    // TABLE RENDERING
    // ========================================
    function renderEmpty(text) {
        patientList.innerHTML =
            `<tr><td colspan="7" class="empty-state">${escapeHtml(text)}</td></tr>`;
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
            address: addressInput.value.trim() || null
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
    loadPatients();
})();