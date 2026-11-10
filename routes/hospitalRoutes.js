'use strict';
const express = require('express');

module.exports = (db) => {
  const router = express.Router();
  const idOk = (v) => String(v ?? '').trim() !== '' && Number.isSafeInteger(Number(v)) && Number(v) > 0;
  const str = (v) => typeof v === 'string' && v.trim() ? v.trim() : null;
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error(req.method, req.originalUrl, err.message);
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A record with those details already exists.' });
      if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'A selected related record does not exist.' });
      if (err.code === 'WARN_DATA_TRUNCATED' || err.code === 'ER_TRUNCATED_WRONG_VALUE') return res.status(400).json({ error: 'A submitted value is not allowed by the database.' });
      res.status(500).json({ error: 'Operation failed. Check the server terminal for details.' });
    }
  };
  const requiredText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
  const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
  const nonnegative = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;

  // ROOMS AND BEDS
  router.get('/rooms', wrap(async (_req, res) => {
    const [rows] = await db.query(`SELECT r.room_id,r.room_number,r.room_type,r.room_rate,r.status,r.notes,
      COUNT(b.bed_id) AS bed_count, SUM(b.status='available') AS available_beds
      FROM rooms r LEFT JOIN beds b ON b.room_id=r.room_id
      GROUP BY r.room_id ORDER BY r.room_number`);
    res.json(rows);
  }));
  router.post('/rooms', wrap(async (req, res) => {
    const b=req.body||{};
    if (!requiredText(b.room_number,20) || !requiredText(b.room_type,40) || !nonnegative(b.room_rate)) return res.status(400).json({error:'Room number, room type, and a valid room rate are required.'});
    const [r]=await db.execute('INSERT INTO rooms (room_number,room_type,room_rate,notes) VALUES (?,?,?,?)',[b.room_number.trim(),b.room_type.trim(),Number(b.room_rate),str(b.notes)]);
    res.status(201).json({ok:true,room_id:r.insertId,message:'Room created.'});
  }));
  router.put('/rooms/:id', wrap(async (req,res)=>{
    if(!idOk(req.params.id)) return res.status(400).json({error:'Invalid room ID.'});
    const b=req.body||{}; if(!requiredText(b.room_number,20)||!requiredText(b.room_type,40)||!nonnegative(b.room_rate)) return res.status(400).json({error:'Room number, room type, and valid room rate are required.'});
    const [r]=await db.execute('UPDATE rooms SET room_number=?,room_type=?,room_rate=?,notes=? WHERE room_id=?',[b.room_number.trim(),b.room_type.trim(),Number(b.room_rate),str(b.notes),Number(req.params.id)]);
    if(!r.affectedRows) return res.status(404).json({error:'Room not found.'}); res.json({ok:true,message:'Room updated.'});
  }));
  router.get('/beds', wrap(async (_req,res)=>{
    const [rows]=await db.query(`SELECT b.bed_id,b.room_id,b.bed_number,b.status,r.room_number,r.room_type
      FROM beds b JOIN rooms r ON r.room_id=b.room_id ORDER BY r.room_number,b.bed_number`); res.json(rows);
  }));
  router.post('/beds', wrap(async (req,res)=>{
    const b=req.body||{}; if(!idOk(b.room_id)||!requiredText(b.bed_number,20)) return res.status(400).json({error:'Select a room and enter a bed number.'});
    const [r]=await db.execute('INSERT INTO beds (room_id,bed_number) VALUES (?,?)',[Number(b.room_id),b.bed_number.trim()]); res.status(201).json({ok:true,bed_id:r.insertId,message:'Bed created.'});
  }));
  router.patch('/beds/:id/status', wrap(async (req,res)=>{
    if(!idOk(req.params.id)) return res.status(400).json({error:'Invalid bed ID.'});
    if(!['available','maintenance'].includes(req.body?.status)) return res.status(400).json({error:'Bed can only be set to available or maintenance here. Occupancy is managed by admissions.'});
    const [r]=await db.execute("UPDATE beds SET status=? WHERE bed_id=? AND status<>'occupied'",[req.body.status,Number(req.params.id)]);
    if(!r.affectedRows) return res.status(409).json({error:'Bed not found or currently occupied.'}); res.json({ok:true,message:'Bed status updated.'});
  }));

  // ADMISSIONS / DISCHARGE
  router.get('/admissions', wrap(async (req,res)=>{
    let sql=`SELECT a.admission_id,a.patient_id,a.bed_id,a.attending_doctor_id,a.admitted_at,a.admission_reason,a.status,a.discharged_at,a.discharge_notes,
      p.first_name,p.last_name,p.birthdate,p.sex,b.bed_number,r.room_number,d.first_name AS doctor_first_name,d.last_name AS doctor_last_name
      FROM admissions a JOIN patients p ON p.patient_id=a.patient_id JOIN beds b ON b.bed_id=a.bed_id JOIN rooms r ON r.room_id=b.room_id
      LEFT JOIN doctors d ON d.doctor_id=a.attending_doctor_id`;
    const params=[]; if(req.query.status){sql+=' WHERE a.status=?';params.push(String(req.query.status));} sql+=' ORDER BY a.admitted_at DESC';
    const [rows]=await db.execute(sql,params); res.json(rows);
  }));
  router.post('/admissions', wrap(async (req,res)=>{
    const b=req.body||{}; if(!idOk(b.patient_id)||!idOk(b.bed_id)||!str(b.admission_reason)) return res.status(400).json({error:'Patient, available bed, and admission reason are required.'});
    if(b.attending_doctor_id && !idOk(b.attending_doctor_id)) return res.status(400).json({error:'Invalid attending doctor.'});
    const c=await db.getConnection();
    try {
      await c.beginTransaction();
      const [[bed]]=await c.execute('SELECT bed_id,status FROM beds WHERE bed_id=? FOR UPDATE',[Number(b.bed_id)]);
      if(!bed||bed.status!=='available'){await c.rollback();return res.status(409).json({error:'That bed is not available.'});}
      const [[patient]]=await c.execute("SELECT patient_id FROM patients WHERE patient_id=? AND status='active'",[Number(b.patient_id)]);
      if(!patient){await c.rollback();return res.status(400).json({error:'Patient does not exist or is inactive.'});}
      const [r]=await c.execute('INSERT INTO admissions (patient_id,bed_id,attending_doctor_id,admission_reason) VALUES (?,?,?,?)',[Number(b.patient_id),Number(b.bed_id),b.attending_doctor_id?Number(b.attending_doctor_id):null,b.admission_reason.trim()]);
      await c.execute("UPDATE beds SET status='occupied' WHERE bed_id=?",[Number(b.bed_id)]);
      await c.commit(); res.status(201).json({ok:true,admission_id:r.insertId,message:'Patient admitted and bed marked occupied.'});
    } catch(e){await c.rollback();throw e;} finally{c.release();}
  }));
  router.patch('/admissions/:id/discharge', wrap(async (req,res)=>{
    if(!idOk(req.params.id)) return res.status(400).json({error:'Invalid admission ID.'});
    const c=await db.getConnection();
    try{
      await c.beginTransaction();
      const [[a]]=await c.execute("SELECT admission_id,bed_id,status FROM admissions WHERE admission_id=? FOR UPDATE",[Number(req.params.id)]);
      if(!a){await c.rollback();return res.status(404).json({error:'Admission not found.'});}
      if(a.status!=='admitted'){await c.rollback();return res.status(409).json({error:'This admission is not currently active.'});}
      await c.execute("UPDATE admissions SET status='discharged',discharged_at=CURRENT_TIMESTAMP,discharge_notes=? WHERE admission_id=?",[str(req.body?.discharge_notes),a.admission_id]);
      await c.execute("UPDATE beds SET status='available' WHERE bed_id=? AND status='occupied'",[a.bed_id]);
      await c.commit(); res.json({ok:true,message:'Patient discharged and bed released.'});
    }catch(e){await c.rollback();throw e;}finally{c.release();}
  }));

  // TREATMENTS
  router.get('/treatments', wrap(async (_req,res)=>{
    const [rows]=await db.query(`SELECT t.*,p.first_name,p.last_name,d.first_name AS doctor_first_name,d.last_name AS doctor_last_name
      FROM treatments t JOIN admissions a ON a.admission_id=t.admission_id JOIN patients p ON p.patient_id=a.patient_id
      LEFT JOIN doctors d ON d.doctor_id=t.doctor_id ORDER BY t.treatment_date DESC`); res.json(rows);
  }));
  router.post('/treatments', wrap(async (req,res)=>{
    const b=req.body||{}; if(!idOk(b.admission_id)||!requiredText(b.diagnosis,10000)||!requiredText(b.treatment_details,10000)||!nonnegative(b.treatment_cost)) return res.status(400).json({error:'Admission, diagnosis, treatment details, and valid cost are required.'});
    const [r]=await db.execute('INSERT INTO treatments (admission_id,doctor_id,treatment_date,diagnosis,treatment_details,treatment_cost) VALUES (?,?,COALESCE(?,CURRENT_TIMESTAMP),?,?,?)',[Number(b.admission_id),b.doctor_id&&idOk(b.doctor_id)?Number(b.doctor_id):null,b.treatment_date||null,b.diagnosis.trim(),b.treatment_details.trim(),Number(b.treatment_cost)]);
    res.status(201).json({ok:true,treatment_id:r.insertId,message:'Treatment recorded.'});
  }));

  // MEDICATION INVENTORY / ORDERS
  router.get('/medications', wrap(async (_req,res)=>{const [rows]=await db.query('SELECT medication_id,medication_name,description,dosage_form,unit_price,stock_quantity,status,created_at,updated_at FROM medications ORDER BY medication_name');res.json(rows);}));
  router.post('/medications', wrap(async (req,res)=>{
    const b=req.body||{}; if(!requiredText(b.medication_name,120)||!nonnegative(b.unit_price)||!Number.isInteger(Number(b.stock_quantity))||Number(b.stock_quantity)<0) return res.status(400).json({error:'Medication name, valid unit price, and whole-number stock quantity are required.'});
    const [r]=await db.execute('INSERT INTO medications (medication_name,description,dosage_form,unit_price,stock_quantity) VALUES (?,?,?,?,?)',[b.medication_name.trim(),str(b.description),str(b.dosage_form),Number(b.unit_price),Number(b.stock_quantity)]);res.status(201).json({ok:true,medication_id:r.insertId,message:'Medication added.'});
  }));
  router.patch('/medications/:id/stock', wrap(async(req,res)=>{if(!idOk(req.params.id)||!Number.isInteger(Number(req.body?.stock_quantity))||Number(req.body.stock_quantity)<0)return res.status(400).json({error:'Enter a valid stock quantity.'});const [r]=await db.execute('UPDATE medications SET stock_quantity=? WHERE medication_id=?',[Number(req.body.stock_quantity),Number(req.params.id)]);if(!r.affectedRows)return res.status(404).json({error:'Medication not found.'});res.json({ok:true,message:'Stock updated.'});}));
  router.get('/medication-orders', wrap(async(_req,res)=>{const [rows]=await db.query(`SELECT mo.*,p.first_name,p.last_name FROM medication_orders mo JOIN admissions a ON a.admission_id=mo.admission_id JOIN patients p ON p.patient_id=a.patient_id ORDER BY mo.ordered_at DESC`);res.json(rows);}));
  router.post('/medication-orders', wrap(async(req,res)=>{
    const b=req.body||{}; if(!idOk(b.admission_id)||!Array.isArray(b.items)||!b.items.length)return res.status(400).json({error:'Admission and at least one medication item are required.'});
    const c=await db.getConnection();try{await c.beginTransaction();
      const [order]=await c.execute('INSERT INTO medication_orders (admission_id,doctor_id,instructions) VALUES (?,?,?)',[Number(b.admission_id),b.doctor_id&&idOk(b.doctor_id)?Number(b.doctor_id):null,str(b.instructions)]);
      for(const item of b.items){if(!idOk(item.medication_id)||!Number.isInteger(Number(item.quantity))||Number(item.quantity)<1){throw new Error('Each medication item needs a valid medication and quantity.');}
        const [[med]]=await c.execute('SELECT medication_id,unit_price,stock_quantity,status FROM medications WHERE medication_id=? FOR UPDATE',[Number(item.medication_id)]);
        if(!med||med.status!=='active')throw new Error('A selected medication is unavailable.');if(Number(med.stock_quantity)<Number(item.quantity))throw new Error(`Insufficient stock for medication ID ${item.medication_id}.`);
        await c.execute('INSERT INTO medication_order_items (medication_order_id,medication_id,dose,frequency,duration,quantity,unit_price) VALUES (?,?,?,?,?,?,?)',[order.insertId,med.medication_id,str(item.dose),str(item.frequency),str(item.duration),Number(item.quantity),Number(med.unit_price)]);
        await c.execute('UPDATE medications SET stock_quantity=stock_quantity-? WHERE medication_id=?',[Number(item.quantity),med.medication_id]);
      }
      await c.commit();res.status(201).json({ok:true,medication_order_id:order.insertId,message:'Medication order created and stock deducted.'});
    }catch(e){await c.rollback();if(e.message.startsWith('Each medication')||e.message.includes('unavailable')||e.message.includes('Insufficient stock'))return res.status(400).json({error:e.message});throw e;}finally{c.release();}
  }));

  // SERVICES
  router.get('/services', wrap(async(_req,res)=>{const [rows]=await db.query('SELECT service_id,service_name,description,unit_price,status,created_at FROM services ORDER BY service_name');res.json(rows);}));
  router.post('/services', wrap(async(req,res)=>{const b=req.body||{};if(!requiredText(b.service_name,120)||!nonnegative(b.unit_price))return res.status(400).json({error:'Service name and valid unit price are required.'});const [r]=await db.execute('INSERT INTO services (service_name,description,unit_price) VALUES (?,?,?)',[b.service_name.trim(),str(b.description),Number(b.unit_price)]);res.status(201).json({ok:true,service_id:r.insertId,message:'Service created.'});}));

  // BILLING AND PAYMENTS
  router.get('/bills', wrap(async(_req,res)=>{const [rows]=await db.query(`SELECT b.bill_id,b.admission_id,b.total_amount,b.status,b.created_at,b.updated_at,p.first_name,p.last_name,COALESCE(SUM(pay.amount),0) AS amount_paid FROM bills b JOIN admissions a ON a.admission_id=b.admission_id JOIN patients p ON p.patient_id=a.patient_id LEFT JOIN payments pay ON pay.bill_id=b.bill_id GROUP BY b.bill_id ORDER BY b.created_at DESC`);res.json(rows);}));
  router.post('/bills', wrap(async(req,res)=>{if(!idOk(req.body?.admission_id))return res.status(400).json({error:'Valid admission ID is required.'});const [r]=await db.execute('INSERT INTO bills (admission_id,total_amount,status) VALUES (?,0,\'pending\')',[Number(req.body.admission_id)]);res.status(201).json({ok:true,bill_id:r.insertId,message:'Bill created.'});}));
  router.get('/bills/:id/items', wrap(async(req,res)=>{if(!idOk(req.params.id))return res.status(400).json({error:'Invalid bill ID.'});const [rows]=await db.execute('SELECT bill_item_id,bill_id,service_id,treatment_id,medication_order_item_id,description,quantity,unit_price,line_total,created_at FROM bill_items WHERE bill_id=? ORDER BY bill_item_id',[Number(req.params.id)]);res.json(rows);}));
  router.post('/bills/:id/items', wrap(async(req,res)=>{
    if(!idOk(req.params.id))return res.status(400).json({error:'Invalid bill ID.'});const b=req.body||{};if(!requiredText(b.description,255)||!Number.isInteger(Number(b.quantity))||Number(b.quantity)<1||!nonnegative(b.unit_price))return res.status(400).json({error:'Description, positive whole-number quantity, and valid unit price are required.'});
    const line=Number((Number(b.quantity)*Number(b.unit_price)).toFixed(2));const c=await db.getConnection();try{await c.beginTransaction();const [[bill]]=await c.execute("SELECT bill_id,status FROM bills WHERE bill_id=? FOR UPDATE",[Number(req.params.id)]);if(!bill){await c.rollback();return res.status(404).json({error:'Bill not found.'});}if(['paid','cancelled'].includes(bill.status)){await c.rollback();return res.status(409).json({error:'This bill can no longer be edited.'});}
      await c.execute('INSERT INTO bill_items (bill_id,service_id,treatment_id,medication_order_item_id,description,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?,?,?)',[bill.bill_id,idOk(b.service_id)?Number(b.service_id):null,idOk(b.treatment_id)?Number(b.treatment_id):null,idOk(b.medication_order_item_id)?Number(b.medication_order_item_id):null,b.description.trim(),Number(b.quantity),Number(b.unit_price),line]);
      const [[sum]]=await c.execute('SELECT COALESCE(SUM(line_total),0) AS total FROM bill_items WHERE bill_id=?',[bill.bill_id]);await c.execute('UPDATE bills SET total_amount=? WHERE bill_id=?',[Number(sum.total),bill.bill_id]);await c.commit();res.status(201).json({ok:true,line_total:line,total_amount:Number(sum.total),message:'Bill item added.'});
    }catch(e){await c.rollback();throw e;}finally{c.release();}
  }));
  router.post('/bills/:id/payments', wrap(async(req,res)=>{
    if(!idOk(req.params.id))return res.status(400).json({error:'Invalid bill ID.'});const b=req.body||{};if(!positive(b.amount)||!['cash','card','bank_transfer','e_wallet','other'].includes(b.payment_method))return res.status(400).json({error:'Enter a positive payment amount and valid payment method.'});
    const c=await db.getConnection();try{await c.beginTransaction();const [[bill]]=await c.execute('SELECT bill_id,total_amount,status FROM bills WHERE bill_id=? FOR UPDATE',[Number(req.params.id)]);if(!bill){await c.rollback();return res.status(404).json({error:'Bill not found.'});}if(['paid','cancelled'].includes(bill.status)){await c.rollback();return res.status(409).json({error:'This bill cannot receive payments.'});}const [[paid]]=await c.execute('SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE bill_id=?',[bill.bill_id]);const remaining=Number(bill.total_amount)-Number(paid.total);if(Number(b.amount)>remaining+0.001){await c.rollback();return res.status(400).json({error:`Payment exceeds remaining balance (${remaining.toFixed(2)}).`});}
      const [p]=await c.execute('INSERT INTO payments (bill_id,amount,payment_method,reference_no,received_by,notes) VALUES (?,?,?,?,?,?)',[bill.bill_id,Number(b.amount),b.payment_method,str(b.reference_no),idOk(b.received_by)?Number(b.received_by):null,str(b.notes)]);const newPaid=Number(paid.total)+Number(b.amount);const status=newPaid>=Number(bill.total_amount)?'paid':'partially_paid';await c.execute('UPDATE bills SET status=? WHERE bill_id=?',[status,bill.bill_id]);await c.commit();res.status(201).json({ok:true,payment_id:p.insertId,amount_paid:newPaid,balance:Math.max(0,Number(bill.total_amount)-newPaid),bill_status:status,message:'Payment recorded.'});
    }catch(e){await c.rollback();throw e;}finally{c.release();}
  }));
  router.get('/reports/summary', wrap(async(_req,res)=>{const [[p]]=await db.query('SELECT COUNT(*) AS total FROM patients');const [[a]]=await db.query("SELECT COUNT(*) AS total FROM admissions WHERE status='admitted'");const [[rev]]=await db.query('SELECT COALESCE(SUM(amount),0) AS total FROM payments');const [[out]]=await db.query("SELECT COALESCE(SUM(total_amount),0) AS total FROM bills WHERE status IN ('pending','partially_paid')");res.json({total_patients:Number(p.total),current_admissions:Number(a.total),payments_received:Number(rev.total),outstanding_bills:Number(out.total)});}));
  return router;
};
