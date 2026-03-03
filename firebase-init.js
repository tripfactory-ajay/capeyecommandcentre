// ═══════════════════════════════════════════════════════════════════
//  CapeEye Auto Capital — Firebase Init & Data Layer
//  All pages include this after firebase-config.js
// ═══════════════════════════════════════════════════════════════════

import { initializeApp }                          from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc,
         deleteDoc, addDoc, query, where, orderBy, limit, onSnapshot,
         serverTimestamp, writeBatch }             from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Initialise ───────────────────────────────────────────────────────
const _app  = initializeApp(FIREBASE_CONFIG);
const auth  = getAuth(_app);
const db    = getFirestore(_app);

// ── Auth helpers ─────────────────────────────────────────────────────
async function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
async function logoutUser() {
  return signOut(auth);
}
function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}
function currentUser() {
  return auth.currentUser;
}

// Guard — call at top of every protected page
function requireAuth(redirectTo = './login.html') {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => {
      unsub();
      if (!user) { window.location.href = redirectTo; }
      else resolve(user);
    });
  });
}

// ── Generic Firestore helpers ────────────────────────────────────────
async function fsGet(col, id) {
  const snap = await getDoc(doc(db, col, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
async function fsGetAll(col) {
  const snap = await getDocs(collection(db, col));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function fsSet(col, id, data) {
  await setDoc(doc(db, col, id), { ...data, _updatedAt: serverTimestamp() }, { merge: true });
}
async function fsAdd(col, data) {
  return addDoc(collection(db, col), { ...data, _createdAt: serverTimestamp() });
}
async function fsDelete(col, id) {
  await deleteDoc(doc(db, col, id));
}
async function fsUpdate(col, id, data) {
  await updateDoc(doc(db, col, id), { ...data, _updatedAt: serverTimestamp() });
}
function fsListen(col, cb) {
  return onSnapshot(collection(db, col), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ── VEHICLES ─────────────────────────────────────────────────────────
async function getVehicles() {
  const docs = await fsGetAll('vehicles');
  if (docs.length) return docs;
  return AC_VEHICLES; // fallback to seed data
}
async function saveVehicle(v) {
  await fsSet('vehicles', v.stockNo, v);
}
async function saveVehicles(vehicles) {
  const batch = writeBatch(db);
  vehicles.forEach(v => {
    batch.set(doc(db, 'vehicles', v.stockNo), { ...v, _updatedAt: serverTimestamp() }, { merge: true });
  });
  await batch.commit();
}
async function deleteVehicle(stockNo) {
  await fsDelete('vehicles', stockNo);
}

// ── WORKFLOW ──────────────────────────────────────────────────────────
async function getWorkflow(stockNo) {
  const d = await fsGet('workflow', stockNo);
  return d ? d : {};
}
async function saveWorkflow(stockNo, data) {
  await fsSet('workflow', stockNo, data);
}

// ── HANDOVERS ─────────────────────────────────────────────────────────
async function saveHandover(stockNo, stageId, data) {
  const id = `${stockNo}_stage${stageId}`;
  await fsSet('handovers', id, { stockNo, stageId, ...data });
}
async function getHandover(stockNo, stageId) {
  return fsGet('handovers', `${stockNo}_stage${stageId}`);
}

// ── TASKS ─────────────────────────────────────────────────────────────
async function assignTask(staffName, stockNo, stageId, stageName, note, vehicle, priority) {
  await fsAdd('tasks', {
    staffName, stockNo, stageId, stageName, note, priority: priority || 'normal',
    vehicle: vehicle ? { make: vehicle.make, model: vehicle.model, registration: vehicle.registration, location: vehicle.location } : null,
    assignedAt: serverTimestamp(), status: 'pending'
  });
  await addAlert({ type: 'handover', level: 'info',
    title: `${stageName} complete — handover to ${staffName}`,
    body: `${vehicle?.registration || stockNo} · ${vehicle?.make || ''} ${vehicle?.model || ''} · ${note || 'No note'}`,
    stockNo });
}
async function getMyTasks(staffName) {
  const q = query(collection(db, 'tasks'), where('staffName', '==', staffName), orderBy('assignedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function completeTask(taskId) {
  await fsUpdate('tasks', taskId, { status: 'done', completedAt: serverTimestamp() });
}

// ── ALERTS ────────────────────────────────────────────────────────────
async function addAlert(alert) {
  await fsAdd('alerts', { ...alert, read: false });
}
async function getAlerts(limitN = 100) {
  const q = query(collection(db, 'alerts'), orderBy('_createdAt', 'desc'), limit(limitN));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function markAlertRead(id) {
  await fsUpdate('alerts', id, { read: true });
}
async function markAllAlertsRead() {
  const alerts = await getAlerts(200);
  const batch = writeBatch(db);
  alerts.filter(a => !a.read).forEach(a => batch.update(doc(db, 'alerts', a.id), { read: true }));
  await batch.commit();
}
function listenAlerts(cb) {
  const q = query(collection(db, 'alerts'), orderBy('_createdAt', 'desc'), limit(50));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ── STAFF ─────────────────────────────────────────────────────────────
async function getStaff() {
  const docs = await fsGetAll('staff');
  if (docs.length) return docs;
  // Seed from AC_STAFF defaults if Firestore is empty
  return AC_STAFF.map(s => ({ ...s, id: s.name.replace(/\s/g, '_') }));
}
async function saveStaffMember(member) {
  const id = member.id || member.name.replace(/\s+/g, '_');
  await fsSet('staff', id, { ...member, id });
  return id;
}
async function deleteStaffMember(id) {
  await fsDelete('staff', id);
}

// ── DEPARTMENTS ───────────────────────────────────────────────────────
async function getDepartments() {
  const docs = await fsGetAll('departments');
  if (docs.length) return docs;
  return AC_DEPARTMENTS.map(d => ({ ...d, id: d.name.replace(/\s/g, '_') }));
}
async function saveDepartment(dept) {
  const id = dept.id || dept.name.replace(/\s+/g, '_');
  await fsSet('departments', id, { ...dept, id });
  return id;
}
async function deleteDepartment(id) {
  await fsDelete('departments', id);
}

// ── LISTS (faults, repairs, parts, locations) ─────────────────────────
async function getLists() {
  const d = await fsGet('lists', 'main');
  return d || {
    faults: AC_FAULTS, repairs: AC_REPAIRS,
    parts: AC_PARTS, locations: AC_LOCATIONS
  };
}
async function saveLists(lists) {
  await fsSet('lists', 'main', lists);
}

// ── MARKETING ─────────────────────────────────────────────────────────
async function saveMarketingImport(platform, rows, dateRange) {
  await fsAdd('marketing', { platform, rows, dateRange, importedAt: serverTimestamp() });
}
async function getMarketingData(platform) {
  const q = platform
    ? query(collection(db, 'marketing'), where('platform', '==', platform), orderBy('importedAt', 'desc'))
    : query(collection(db, 'marketing'), orderBy('importedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── INSPECTIONS ───────────────────────────────────────────────────────
async function saveInspection(data) {
  await fsAdd('inspections', { ...data, inspectedAt: serverTimestamp() });
}
async function getInspections(stockNo) {
  const q = stockNo
    ? query(collection(db, 'inspections'), where('stockNo', '==', stockNo), orderBy('inspectedAt', 'desc'))
    : query(collection(db, 'inspections'), orderBy('inspectedAt', 'desc'), limit(100));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── SIGNOFFS ──────────────────────────────────────────────────────────
async function saveSignoff(data) {
  await fsAdd('signoffs', { ...data, signedAt: serverTimestamp() });
}

// ── HOURS IN STAGE (uses Firestore workflow timestamps) ───────────────
function hoursInStage(workflowData, stageId) {
  const stage = workflowData?.[stageId];
  if (!stage?.startedAt) return 0;
  const ts = stage.startedAt.toDate ? stage.startedAt.toDate() : new Date(stage.startedAt);
  return Math.floor((Date.now() - ts.getTime()) / 3600000);
}

// ── UTILITIES ─────────────────────────────────────────────────────────
function formatGBP(n) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0);
}
function daysSince(dateStr) {
  if (!dateStr) return 0;
  const p = dateStr.split('/');
  if (p.length !== 3) return 0;
  return Math.floor((Date.now() - new Date(p[2], p[1] - 1, p[0]).getTime()) / 86400000);
}
function motDaysRemaining(motStr) {
  if (!motStr) return null;
  const p = motStr.split('/');
  if (p.length !== 3) return null;
  return Math.ceil((new Date(p[2], p[1] - 1, p[0]).getTime() - Date.now()) / 86400000);
}
function timeAgo(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ── SEED FIRESTORE (run once to populate from AC_VEHICLES) ───────────
async function seedFirestore() {
  console.log('Seeding Firestore with vehicle data...');
  await saveVehicles(AC_VEHICLES);
  // Seed staff
  for (const s of AC_STAFF) {
    await saveStaffMember(s);
  }
  // Seed departments
  for (const d of AC_DEPARTMENTS) {
    await saveDepartment(d);
  }
  // Seed lists
  await saveLists({ faults: AC_FAULTS, repairs: AC_REPAIRS, parts: AC_PARTS, locations: AC_LOCATIONS });
  console.log('Seed complete.');
}

// Expose to window for non-module pages via global
window.CE = {
  // auth
  loginUser, logoutUser, onAuthChange, currentUser, requireAuth,
  // vehicles
  getVehicles, saveVehicle, saveVehicles, deleteVehicle,
  // workflow
  getWorkflow, saveWorkflow,
  // handovers
  saveHandover, getHandover,
  // tasks
  assignTask, getMyTasks, completeTask,
  // alerts
  addAlert, getAlerts, markAlertRead, markAllAlertsRead, listenAlerts,
  // staff
  getStaff, saveStaffMember, deleteStaffMember,
  // departments
  getDepartments, saveDepartment, deleteDepartment,
  // lists
  getLists, saveLists,
  // marketing
  saveMarketingImport, getMarketingData,
  // inspections
  saveInspection, getInspections,
  // signoffs
  saveSignoff,
  // utils
  formatGBP, daysSince, motDaysRemaining, timeAgo, hoursInStage, slugify,
  // seed
  seedFirestore,
  // raw db access
  db, auth
};
