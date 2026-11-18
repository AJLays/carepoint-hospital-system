'use strict';
const $=id=>document.getElementById(id);
const money=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const date=v=>v?new Date(v).toLocaleDateString('en-PH'):'—';
async function api(url){const r=await fetch(url);let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function load(){ $('message').textContent='Loading report data...';try{
 const [summary,beds,admissions,bills]=await Promise.all([api('/api/reports/summary'),api('/api/beds'),api('/api/admissions'),api('/api/bills')]);
 $('patients').textContent=Number(summary.total_patients||0).toLocaleString();$('admissions').textContent=Number(summary.current_admissions||0).toLocaleString();$('revenue').textContent=money(summary.payments_received);$('outstanding').textContent=money(summary.outstanding_bills);
 const occupied=beds.filter(x=>x.status==='occupied').length, available=beds.filter(x=>x.status==='available').length, other=beds.length-occupied-available;const rate=beds.length?occupied/beds.length*100:0;
 $('occupied').textContent=occupied;$('available').textContent=available;$('otherbeds').textContent=other;$('occupancyRate').textContent=rate.toFixed(1)+'%';$('barFill').style.width=rate+'%';
 $('billRows').innerHTML=bills.length?bills.map(b=>{const paid=Number(b.amount_paid||0),total=Number(b.total_amount||0),balance=Math.max(0,total-paid);return `<tr><td>${esc(b.bill_id)}</td><td>${esc((b.first_name||'')+' '+(b.last_name||''))}</td><td>${money(total)}</td><td>${money(paid)}</td><td>${money(balance)}</td><td><span class="status">${esc(b.status)}</span></td><td>${date(b.created_at)}</td></tr>`}).join(''):'<tr><td colspan="7">No bills found.</td></tr>';
 $('admissionRows').innerHTML=admissions.length?admissions.filter(a=>a.status==='admitted').map(a=>`<tr><td>${esc(a.admission_id)}</td><td>${esc((a.first_name||'')+' '+(a.last_name||''))}</td><td>${esc(a.room_number||'—')}</td><td>${esc(a.bed_number||'—')}</td><td>${date(a.admitted_at)}</td></tr>`).join(''):'<tr><td colspan="5">No current admissions.</td></tr>';
 $('message').textContent='Report data updated.';
 }catch(e){$('message').textContent='Could not load reports: '+e.message;}}
$('refresh').addEventListener('click',load);$('print').addEventListener('click',()=>window.print());load();
