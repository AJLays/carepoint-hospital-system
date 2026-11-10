'use strict';

(() => {
  const API='/api/patients';
  const form=document.getElementById('patientForm');
  const formTitle=document.getElementById('formTitle');
  const messageBox=document.getElementById('message');
  const saveButton=document.getElementById('saveButton');
  const cancelButton=document.getElementById('cancelButton');
  const firstNameInput=document.getElementById('first_name');
  const lastNameInput=document.getElementById('last_name');
  const birthdateInput=document.getElementById('birthdate');
  const sexInput=document.getElementById('sex');
  const contactInput=document.getElementById('contact_no');
  const addressInput=document.getElementById('address');
  const searchInput=document.getElementById('search');
  const statusFilter=document.getElementById('statusFilter');
  const patientList=document.getElementById('patientList');
  const countEl=document.getElementById('count');
  const pageLoader=document.getElementById('pageLoader');
  let editingId=null, requestCounter=0, pending=0, searchTimer=null, messageTimer=null;

  function loader(active){pending=Math.max(0,pending+(active?1:-1));if(pageLoader)pageLoader.classList.toggle('active',pending>0);}
  function escapeHtml(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function dateOnly(v){if(!v)return '';if(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v))return v;const d=new Date(v);if(Number.isNaN(d.getTime()))return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function formatDate(v){const s=dateOnly(v);if(!s)return '—';const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});}
  async function api(url,options={}){loader(true);try{const r=await fetch(url,{headers:{'Content-Type':'application/json'},...options});let data={};try{data=await r.json();}catch{}if(!r.ok)throw new Error(data.error||`Request failed (${r.status}).`);return data;}catch(e){if(e instanceof TypeError)throw new Error('Cannot reach the server. Please try again.');throw e;}finally{loader(false);}}
  function clearMessage(){clearTimeout(messageTimer);messageBox.textContent='';messageBox.className='message';}
  function showMessage(type,text){clearTimeout(messageTimer);messageBox.textContent=text;messageBox.className=`message ${type}`;if(type==='success')messageTimer=setTimeout(clearMessage,5000);}
  function resetForm(){form.reset();editingId=null;formTitle.textContent='Register New Patient';saveButton.disabled=false;saveButton.innerHTML='<span aria-hidden="true">＋</span> Save Patient';clearMessage();}
  function fillForm(p){editingId=p.patient_id;firstNameInput.value=p.first_name||'';lastNameInput.value=p.last_name||'';birthdateInput.value=dateOnly(p.birthdate);sexInput.value=p.sex||'';contactInput.value=p.contact_no||'';addressInput.value=p.address||'';formTitle.textContent=`Edit Patient #${p.patient_id}`;saveButton.textContent='Update Patient';clearMessage();}
  function renderEmpty(msg){patientList.innerHTML=`<tr><td colspan="7" class="empty-state">${escapeHtml(msg)}</td></tr>`;}
  function renderPatients(rows){if(!rows.length){renderEmpty(searchInput.value.trim()||statusFilter.value?'No patients match your search.':'No patients registered yet.');return;}
    patientList.innerHTML=rows.map(p=>{const active=p.status==='Active';return `<tr><td>${escapeHtml(p.patient_id)}</td><td>${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</td><td>${escapeHtml(formatDate(p.birthdate))}</td><td>${escapeHtml(p.sex)}</td><td>${escapeHtml(p.contact_no||'—')}</td><td><span class="status-badge ${active?'active':'inactive'}">${escapeHtml(p.status)}</span></td><td><button type="button" class="action-btn" data-action="edit" data-id="${escapeHtml(p.patient_id)}">Edit</button> <button type="button" class="action-btn" data-action="toggle" data-id="${escapeHtml(p.patient_id)}" data-status="${escapeHtml(p.status)}">${active?'Deactivate':'Activate'}</button></td></tr>`;}).join('');
  }
  async function loadPatients(){const req=++requestCounter;const params=new URLSearchParams({search:searchInput.value.trim(),status:statusFilter.value||'All'});try{const rows=await api(`${API}?${params}`);if(req!==requestCounter)return;renderPatients(rows);if(!searchInput.value.trim()&&(statusFilter.value||'All')==='All')countEl.textContent=rows.length;else{const all=await api(API);if(req===requestCounter)countEl.textContent=all.length;}}catch(e){if(req===requestCounter)renderEmpty(e.message);}}

  form.addEventListener('submit',async e=>{e.preventDefault();clearMessage();const payload={first_name:firstNameInput.value.trim(),last_name:lastNameInput.value.trim(),birthdate:birthdateInput.value,sex:sexInput.value,contact_no:contactInput.value.trim()||null,address:addressInput.value.trim()||null};const wasEditing=editingId!==null;saveButton.disabled=true;saveButton.textContent='Saving...';try{const result=await api(wasEditing?`${API}/${editingId}`:API,{method:wasEditing?'PUT':'POST',body:JSON.stringify(payload)});resetForm();showMessage('success',result.message||'Patient saved.');await loadPatients();}catch(err){saveButton.disabled=false;saveButton.textContent=wasEditing?'Update Patient':'Save Patient';showMessage('error',err.message);}});
  cancelButton.addEventListener('click',resetForm);
  patientList.addEventListener('click',async e=>{const btn=e.target.closest('button[data-action]');if(!btn)return;const {id,action}=btn.dataset;if(action==='edit'){try{const p=await api(`${API}/${id}`);fillForm(p);document.getElementById('registration').scrollIntoView({behavior:'smooth',block:'start'});firstNameInput.focus({preventScroll:true});}catch(err){alert(err.message);}return;}if(action==='toggle'){const status=btn.dataset.status==='Active'?'Inactive':'Active';if(!confirm(`Are you sure you want to ${status==='Inactive'?'deactivate':'activate'} this patient?`))return;btn.disabled=true;try{await api(`${API}/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});await loadPatients();}catch(err){btn.disabled=false;alert(err.message);}}});
  searchInput.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadPatients,300);});
  statusFilter.addEventListener('change',loadPatients);
  document.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.nav-link').forEach(x=>x.classList.remove('active'));link.classList.add('active');}));
  birthdateInput.max=new Date().toISOString().slice(0,10);loadPatients();
})();
