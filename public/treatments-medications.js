'use strict';
const $ = (id) => document.getElementById(id);
const money = (v) => `₱${Number(v || 0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, options={}) {
  const response = await fetch(`/api${url}`, {headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const data = await response.json().catch(()=>({error:'The server returned an invalid response.'}));
  if(!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function message(id,text,kind='success'){const el=$(id);el.textContent=text;el.className=`tm-message ${kind}`;}
function fullName(p){return `${p.first_name||''} ${p.last_name||''}`.trim();}
let admissions=[], doctors=[], medications=[];
async function loadReferenceData(){
  const [a,d,m]=await Promise.all([api('/admissions'),api('/doctors'),api('/medications')]);
  admissions=a.filter(x=>x.status==='admitted'); doctors=d.filter(x=>x.status==='active'); medications=m;
  const admissionOptions='<option value="">Select active admission</option>'+admissions.map(x=>`<option value="${x.admission_id}">#${x.admission_id} — ${esc(fullName(x))} (Room ${esc(x.room_number||'—')}, Bed ${esc(x.bed_number||'—')})</option>`).join('');
  $('tAdmission').innerHTML=admissionOptions;$('oAdmission').innerHTML=admissionOptions;
  const doctorOptions='<option value="">Not specified</option>'+doctors.map(x=>`<option value="${x.doctor_id}">Dr. ${esc(fullName(x))}</option>`).join('');
  $('tDoctor').innerHTML=doctorOptions;$('oDoctor').innerHTML=doctorOptions;
  $('oMedication').innerHTML='<option value="">Select medication</option>'+medications.filter(x=>x.status==='active'&&Number(x.stock_quantity)>0).map(x=>`<option value="${x.medication_id}">${esc(x.medication_name)} — ${Number(x.stock_quantity)} in stock (${money(x.unit_price)})</option>`).join('');
}
async function loadTables(){
  const [t,o,m]=await Promise.all([api('/treatments'),api('/medication-orders'),api('/medications')]); medications=m;
  $('treatmentRows').innerHTML=t.length?t.map(x=>`<tr><td>${esc(new Date(x.treatment_date).toLocaleString())}</td><td>${esc(`${x.first_name} ${x.last_name}`)}</td><td>${esc(x.diagnosis)}</td><td>${esc(x.treatment_details)}</td><td>${esc(x.doctor_first_name?`Dr. ${x.doctor_first_name} ${x.doctor_last_name}`:'—')}</td><td>${money(x.treatment_cost)}</td></tr>`).join(''):'<tr><td colspan="6">No treatment records yet.</td></tr>';
  $('orderRows').innerHTML=o.length?o.map(x=>`<tr><td>#${x.medication_order_id}</td><td>${esc(`${x.first_name} ${x.last_name}`)}</td><td>${esc(x.ordered_at?new Date(x.ordered_at).toLocaleString():'—')}</td><td>${esc(x.instructions||'—')}</td></tr>`).join(''):'<tr><td colspan="4">No medication orders yet.</td></tr>';
  $('medicationRows').innerHTML=m.length?m.map(x=>`<tr><td>${esc(x.medication_name)}</td><td>${esc(x.dosage_form||'—')}</td><td>${money(x.unit_price)}</td><td>${Number(x.stock_quantity)}</td><td><span class="tm-pill">${esc(x.status)}</span></td><td><form class="tm-inline stock-form" data-id="${x.medication_id}"><input aria-label="New stock quantity" type="number" min="0" step="1" value="${Number(x.stock_quantity)}" required><button class="tm-btn secondary" type="submit">Save</button></form></td></tr>`).join(''):'<tr><td colspan="6">No medications in inventory.</td></tr>';
  document.querySelectorAll('.stock-form').forEach(form=>form.addEventListener('submit',updateStock));
}
async function refresh(){try{await loadReferenceData();await loadTables();}catch(e){console.error(e);message('treatmentMessage',e.message,'error');}}
$('treatmentForm').addEventListener('submit',async e=>{e.preventDefault();try{const date=$('tDate').value;await api('/treatments',{method:'POST',body:JSON.stringify({admission_id:$('tAdmission').value,doctor_id:$('tDoctor').value||null,treatment_date:date?new Date(date).toISOString().slice(0,19).replace('T',' '):null,diagnosis:$('tDiagnosis').value,treatment_details:$('tDetails').value,treatment_cost:$('tCost').value})});e.target.reset();message('treatmentMessage','Treatment recorded successfully.');await refresh();}catch(err){message('treatmentMessage',err.message,'error');}});
$('medicationForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/medications',{method:'POST',body:JSON.stringify({medication_name:$('mName').value,description:$('mDescription').value,dosage_form:$('mForm').value,unit_price:$('mPrice').value,stock_quantity:$('mStock').value})});e.target.reset();$('mPrice').value='0';$('mStock').value='0';message('medicationMessage','Medication added successfully.');await refresh();}catch(err){message('medicationMessage',err.message,'error');}});
$('orderForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/medication-orders',{method:'POST',body:JSON.stringify({admission_id:$('oAdmission').value,doctor_id:$('oDoctor').value||null,instructions:$('oInstructions').value,items:[{medication_id:$('oMedication').value,quantity:$('oQuantity').value,dose:$('oDose').value,frequency:$('oFrequency').value,duration:$('oDuration').value}]})});e.target.reset();$('oQuantity').value='1';message('orderMessage','Medication order created. Inventory stock has been deducted.');await refresh();}catch(err){message('orderMessage',err.message,'error');}});
async function updateStock(e){e.preventDefault();const form=e.currentTarget;try{const quantity=form.querySelector('input').value;await api(`/medications/${form.dataset.id}/stock`,{method:'PATCH',body:JSON.stringify({stock_quantity:quantity})});message('medicationMessage','Inventory stock updated.');await refresh();}catch(err){message('medicationMessage',err.message,'error');}}
$('refreshButton').addEventListener('click',refresh);
refresh();
