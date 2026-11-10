'use strict';
const API = '/api';
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(message, error=false){ const el=$('notice'); el.textContent=message; el.classList.toggle('error',error); }
async function request(url, options={}){
  const response=await fetch(url,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const data=await response.json().catch(()=>({error:'Server returned an invalid response.'}));
  if(!response.ok) throw new Error(data.error||`Request failed (${response.status})`);
  return data;
}
let rooms=[], beds=[];
async function loadData(){
  notice('Loading rooms and beds…');
  try{
    [rooms,beds]=await Promise.all([request(`${API}/rooms`),request(`${API}/beds`)]);
    renderRooms(); renderBeds(); notice(`Loaded ${rooms.length} room(s) and ${beds.length} bed(s).`);
  }catch(err){ $('roomCards').innerHTML='<div class="empty">Unable to load room records.</div>'; $('bedRows').innerHTML=`<tr><td colspan="5" class="empty">${escapeHtml(err.message)}</td></tr>`; notice(err.message,true); }
}
function renderRooms(){
  const cards=$('roomCards');
  if(!rooms.length) cards.innerHTML='<div class="empty">No rooms found. Add your first room below.</div>';
  else cards.innerHTML=rooms.map(r=>`<article class="room-card"><h3>Room ${escapeHtml(r.room_number)}</h3><div class="muted">${escapeHtml(r.room_type)} · ₱${Number(r.room_rate||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})} / day</div><div class="room-meta"><div><strong>${Number(r.bed_count||0)}</strong><span class="muted">Total beds</span></div><div><strong>${Number(r.available_beds||0)}</strong><span class="muted">Available</span></div></div>${r.notes?`<p class="muted">${escapeHtml(r.notes)}</p>`:''}</article>`).join('');
  $('bed_room').innerHTML='<option value="">Select room</option>'+rooms.map(r=>`<option value="${Number(r.room_id)}">${escapeHtml(r.room_number)} — ${escapeHtml(r.room_type)}</option>`).join('');
}
function renderBeds(){
  const body=$('bedRows');
  if(!beds.length){body.innerHTML='<tr><td colspan="5" class="empty">No beds found.</td></tr>';return;}
  body.innerHTML=beds.map(b=>{const status=String(b.status||'').toLowerCase();const next=status==='maintenance'?'available':'maintenance';const action=status==='occupied'?'':`<button class="secondary" data-bed="${Number(b.bed_id)}" data-status="${next}">${next==='available'?'Mark Available':'Set Maintenance'}</button>`;return `<tr><td>${escapeHtml(b.room_number)}</td><td>${escapeHtml(b.room_type)}</td><td>${escapeHtml(b.bed_number)}</td><td><span class="status ${escapeHtml(status)}">${escapeHtml(status)}</span></td><td>${action||'<span class="muted">Managed by admission</span>'}</td></tr>`;}).join('');
}
$('roomForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form));data.room_rate=Number(data.room_rate);try{await request(`${API}/rooms`,{method:'POST',body:JSON.stringify(data)});form.reset();await loadData();notice('Room created successfully.');}catch(err){notice(err.message,true);}});
$('bedForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form));data.room_id=Number(data.room_id);try{await request(`${API}/beds`,{method:'POST',body:JSON.stringify(data)});form.reset();await loadData();notice('Bed created successfully.');}catch(err){notice(err.message,true);}});
$('bedRows').addEventListener('click',async e=>{const btn=e.target.closest('button[data-bed]');if(!btn)return;try{await request(`${API}/beds/${btn.dataset.bed}/status`,{method:'PATCH',body:JSON.stringify({status:btn.dataset.status})});await loadData();notice('Bed status updated.');}catch(err){notice(err.message,true);}});
$('refreshBtn').addEventListener('click',loadData);
loadData();
