'use strict';
const $ = (id) => document.getElementById(id);
const api = async (url, options = {}) => {
  const response = await fetch(`/api${url}`, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
};
const showNotice = (message, type = '') => { const el = $('notice'); el.textContent = message; el.className = `notice ${type}`.trim(); };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateText = (v) => v ? new Date(v).toLocaleString() : '—';
async function loadChoices() {
  const [patients, beds, doctors] = await Promise.all([api('/patients?status=Active'), api('/beds'), api('/doctors?status=active')]);
  $('patient_id').innerHTML = '<option value="">Select patient</option>' + patients.map(p => `<option value="${p.patient_id}">${esc(p.last_name)}, ${esc(p.first_name)} (#${p.patient_id})</option>`).join('');
  const available = beds.filter(b => b.status === 'available');
  $('bed_id').innerHTML = '<option value="">Select available bed</option>' + available.map(b => `<option value="${b.bed_id}">Room ${esc(b.room_number)} · Bed ${esc(b.bed_number)} (${esc(b.room_type)})</option>`).join('');
  $('attending_doctor_id').innerHTML = '<option value="">No doctor selected</option>' + doctors.map(d => `<option value="${d.doctor_id}">Dr. ${esc(d.first_name)} ${esc(d.last_name)}</option>`).join('');
}
async function loadAdmissions() {
  const status = $('statusFilter').value;
  const rows = await api(`/admissions${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  $('admissionRows').innerHTML = rows.length ? rows.map(a => {
    const patient = `${a.first_name} ${a.last_name}`;
    const doctor = a.doctor_first_name ? `Dr. ${a.doctor_first_name} ${a.doctor_last_name}` : '—';
    const action = a.status === 'admitted' ? `<button class="btn-small" data-discharge="${a.admission_id}" type="button">Discharge</button>` : '—';
    return `<tr><td>${a.admission_id}</td><td>${esc(patient)}</td><td>${esc(a.room_number)} / ${esc(a.bed_number)}</td><td>${esc(doctor)}</td><td>${esc(dateText(a.admitted_at))}</td><td><span class="pill ${a.status === 'admitted' ? 'admitted' : 'discharged'}">${esc(a.status)}</span></td><td>${action}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No admission records found.</td></tr>';
}
async function refresh() {
  try { await Promise.all([loadChoices(), loadAdmissions()]); showNotice('Admissions data loaded successfully.', 'success'); }
  catch (e) { showNotice(e.message, 'error'); }
}
$('admissionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = { patient_id: $('patient_id').value, bed_id: $('bed_id').value, attending_doctor_id: $('attending_doctor_id').value || null, admission_reason: $('admission_reason').value.trim() };
  try { const result = await api('/admissions', { method: 'POST', body: JSON.stringify(body) }); $('admissionForm').reset(); showNotice(result.message || 'Patient admitted.', 'success'); await refresh(); }
  catch (e) { showNotice(e.message, 'error'); }
});
$('admissionRows').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-discharge]'); if (!button) return;
  const id = button.dataset.discharge;
  const notes = window.prompt('Enter discharge notes (optional):'); if (notes === null) return;
  button.disabled = true;
  try { const result = await api(`/admissions/${id}/discharge`, { method: 'PATCH', body: JSON.stringify({ discharge_notes: notes }) }); showNotice(result.message || 'Patient discharged and bed released.', 'success'); await refresh(); }
  catch (e) { showNotice(e.message, 'error'); button.disabled = false; }
});
$('refreshBtn').addEventListener('click', refresh);
$('statusFilter').addEventListener('change', loadAdmissions);
refresh();
