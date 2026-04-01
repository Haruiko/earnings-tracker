// Firebase init — config is supplied by firebase-config.js (sets window.__fbConfig)
if (!window.__fbConfig) {
  document.body.innerHTML = '<div style="color:#ef4444;font-family:sans-serif;padding:40px;text-align:center"><h2>Configuration missing</h2><p>Create a <code>firebase-config.js</code> file next to index.html.<br>See the comment in firebase-config.js for details.</p></div>';
  throw new Error('window.__fbConfig is not defined. firebase-config.js may be missing.');
}
firebase.initializeApp(window.__fbConfig);
const auth = firebase.auth();

// State
const BASE = window.__fbConfig.databaseURL;
let currentUser   = null;
let editingId     = null;
let transactions  = [];
let accounts      = [];
let cards         = [];
let bills         = [];
let contributions = [];
let goals         = [];
let incomeSources = [];
let healthItems   = [];
let activeAccountId = null; // For joint/shared account selection
let usersCache    = {}; // uid -> { displayName, email }

// Firebase REST helpers
async function getToken() {
  if (!currentUser) throw new Error('Not signed in');
  return currentUser.getIdToken();
}
async function fbGet(path) {
  const token = await getToken();
  const res = await fetch(BASE + '/' + path + '.json?auth=' + token);
  if (!res.ok) throw new Error('GET ' + path + ' failed: ' + res.status);
  const data = await res.json();
  return data ? Object.entries(data).map(([id, v]) => Object.assign({}, v, { id })) : [];
}
async function fbPost(path, obj) {
  const token = await getToken();
  const res = await fetch(BASE + '/' + path + '.json?auth=' + token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj)
  });
  if (!res.ok) throw new Error('POST ' + path + ' failed: ' + res.status);
  return (await res.json()).name;
}
async function fbPut(path, id, obj) {
  const token = await getToken();
  const res = await fetch(BASE + '/' + path + '/' + id + '.json?auth=' + token, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj)
  });
  if (!res.ok) throw new Error('PUT failed: ' + res.status);
}
async function fbDelete(path, id) {
  const token = await getToken();
  const res = await fetch(BASE + '/' + path + '/' + id + '.json?auth=' + token, { method: 'DELETE' });
  if (!res.ok) throw new Error('DELETE failed: ' + res.status);
}

// Auth
const G_SVG = '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

async function signInWithGoogle() {
  const btn = document.getElementById('googleSignInBtn');
  const errEl = document.getElementById('loginError');
  btn.disabled = true;
  btn.innerHTML = G_SVG + ' Signing in\u2026';
  errEl.textContent = '';
  try {
    await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    btn.innerHTML = G_SVG + ' Sign in with Google';
    errEl.textContent = (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')
      ? 'Sign-in cancelled.' : 'Sign-in failed (' + (e.code || e.message) + ').';
  }
}
async function handleSignOut() {
  if (!confirm('Sign out?')) return;
  await auth.signOut();
}
function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appContent').classList.remove('hidden');
  document.getElementById('userBar').classList.remove('hidden');
  document.getElementById('userAvatar').src = currentUser.photoURL || '';
  document.getElementById('userName').textContent = currentUser.displayName || currentUser.email;
}
function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appContent').classList.add('hidden');
  document.getElementById('userBar').classList.add('hidden');
}

// Utils
function fmt(n) { return '\u20B1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDueDay(dueDay) {
  if (dueDay === undefined || dueDay === null || dueDay === '') return '';
  var d = parseInt(dueDay);
  if (d === 0) {
    var now = new Date();
    var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return 'End of Month (' + lastDay + 'th)';
  }
  if (d === 15) return '15th (Mid-month)';
  return 'Day ' + d;
}
function fmtDate(d) {
  if (!d) return '';
  var p = d.split('-');
  return p[1] + '/' + p[2] + '/' + p[0].slice(2);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function toast(msg, type) {
  type = type || 'success';
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  setTimeout(function() { el.className = 'toast'; }, 2800);
}
function setLoading(on) { document.getElementById('loadingOverlay').classList.toggle('hidden', !on); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); editingId = null; }
function v(id) { return document.getElementById(id).value; }
function sv(id, val) { document.getElementById(id).value = val == null ? '' : val; }

// Tabs
function switchTab(name) {
  document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  localStorage.setItem('activeTab', name);
}
function switchTabSelect(sel) {
  switchTab(sel.value);
}
function restoreTab() {
  var saved = localStorage.getItem('activeTab');
  if (saved && document.getElementById('tab-' + saved)) {
    var tabSel = document.getElementById('tabSelect');
    if (tabSel) tabSel.value = saved;
    switchTab(saved);
  }
}

// --- Account Selector Dropdown for Transactions Tab ---
function renderAccountSelect() {
  var sel = document.getElementById('accountSelect');
  if (sel) {
    var memberAccounts = accounts.filter(function(a) {
      return a.members && currentUser && currentUser.uid && a.members[currentUser.uid];
    });
    sel.innerHTML = '<option value="">Select account</option>' +
      memberAccounts.map(function(a) {
        return '<option value="'+a.id+'"'+(a.id===activeAccountId?' selected':'')+'>'+escHtml(a.name)+'</option>';
      }).join('');
    if (!activeAccountId && memberAccounts.length) {
      activeAccountId = memberAccounts[0].id;
      sel.value = activeAccountId;
    }
    sel.onchange = function(e) {
      activeAccountId = e.target.value;
      renderTable();
      populatePaidBySelect();
    };
  }
  populatePaidBySelect();
}

// Populate "Paid by" dropdown from account members
async function populatePaidBySelect() {
  var sel = document.getElementById('fPaidBy');
  if (!sel) return;
  var account = accounts.find(function(a) { return a.id === activeAccountId; });
  // Fall back to just the current user if account has no members data
  var uids = (account && account.members && Object.keys(account.members).length)
    ? Object.keys(account.members)
    : (currentUser ? [currentUser.uid] : []);
  if (!uids.length) {
    sel.innerHTML = '<option value="">&#x2014; Select &#x2014;</option>';
    return;
  }
  // Fetch any uncached users
  try {
    var token = await getToken();
    for (var i = 0; i < uids.length; i++) {
      var uid = uids[i];
      if (!usersCache[uid]) {
        var res = await fetch(BASE + '/users/' + uid + '.json?auth=' + token);
        if (res.ok) {
          var u = await res.json();
          if (u) usersCache[uid] = u;
        }
      }
    }
  } catch(e) { /* ignore */ }
  sel.innerHTML = '<option value="">&#x2014; Select &#x2014;</option>' +
    uids.map(function(uid) {
      var label;
      if (currentUser && uid === currentUser.uid) {
        label = currentUser.displayName || currentUser.email || uid;
      } else {
        var u = usersCache[uid];
        label = u ? (u.displayName || u.email || uid) : uid;
      }
      return '<option value="'+escHtml(label)+'"'+(currentUser && uid===currentUser.uid?' selected':'')+'>'+escHtml(label)+'</option>';
    }).join('');
}

// ── TRANSACTIONS ──
var INCOME_CATS  = ['Salary','Freelance','Business','Investment','Interest Gained','Gift','Refund','Other Income'];
var EXPENSE_CATS = ['Food & Dining','Bills & Utilities','Transportation','Shopping','Entertainment','Health & Medical','Education','Rent','Groceries','Government','Subscriptions','Interest Withheld','Other Expense'];
var NO_PAYMENT_CATS = ['Interest Gained','Interest Withheld'];

// ── SAVED DESCRIPTIONS ──
var SAVED_DESCS_KEY = 'et_saved_descs';
function getSavedDescs() {
  try { return JSON.parse(localStorage.getItem(SAVED_DESCS_KEY) || '[]'); } catch(e) { return []; }
}
function setSavedDescs(arr) {
  localStorage.setItem(SAVED_DESCS_KEY, JSON.stringify(arr));
}
function populateDescDropdown() {
  var list  = document.getElementById('descSavedList');
  var empty = document.getElementById('descSavedEmpty');
  if (!list) return;
  var descs = getSavedDescs();
  if (!descs.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  list.innerHTML = descs.map(function(d, i) {
    return '<div class="desc-saved-item">' +
      '<span class="desc-saved-text" onclick="applyDesc('+i+')" title="'+escHtml(d)+'">'+escHtml(d)+'</span>' +
      '<button type="button" class="icon-btn del desc-saved-del" onclick="deleteDesc('+i+')" title="Remove">&#x2715;</button>' +
      '</div>';
  }).join('');
}
function toggleDescPanel() {
  var panel = document.getElementById('descSavedPanel');
  if (!panel) return;
  panel.classList.toggle('hidden');
}
function applyDesc(idx) {
  var input = document.getElementById('fDesc');
  var descs = getSavedDescs();
  if (input && descs[idx] !== undefined) input.value = descs[idx];
  var panel = document.getElementById('descSavedPanel');
  if (panel) panel.classList.add('hidden');
}
function deleteDesc(idx) {
  var descs = getSavedDescs();
  descs.splice(idx, 1);
  setSavedDescs(descs);
  populateDescDropdown();
}
function saveDesc() {
  var text = (document.getElementById('fDesc') ? document.getElementById('fDesc').value : '').trim();
  if (!text) { toast('Type a description first.', 'error'); return; }
  var descs = getSavedDescs();
  if (descs.indexOf(text) !== -1) { toast('Already saved.', 'error'); return; }
  descs.unshift(text);
  if (descs.length > 50) descs = descs.slice(0, 50);
  setSavedDescs(descs);
  populateDescDropdown();
  toast('Description saved!');
}
function pickSavedDesc() {
  var sel = document.getElementById('fDescSaved');
  var input = document.getElementById('fDesc');
  if (!sel || !input || !sel.value) return;
  input.value = sel.value;
  sel.value = '';
}

function onCategoryChange() {
  var cat = v('fCategory');
  var isInterest = NO_PAYMENT_CATS.indexOf(cat) !== -1;
  var paymentWrap = document.getElementById('fPaymentWrap');
  var paidByWrap  = document.getElementById('fPaidByWrap');
  var fromWrap    = document.getElementById('fFromAccountWrap');
  if (isInterest) {
    if (paymentWrap) paymentWrap.style.display = 'none';
    if (paidByWrap)  paidByWrap.style.display  = 'none';
    if (fromWrap)    fromWrap.style.display     = 'none';
    sv('fPayment', ''); sv('fPaidBy', ''); sv('fFromAccount', '');
  } else {
    if (paymentWrap) paymentWrap.style.display = '';
    // Paid by: only show for Expense non-interest
    if (paidByWrap) paidByWrap.style.display = (v('fType') === 'Income') ? 'none' : '';
    // Re-trigger payment method for From Account visibility
    onPaymentMethodChange();
  }
}
function onTypeChange() {
  var type = v('fType');
  // Update category options
  var catSel = document.getElementById('fCategory');
  if (catSel) {
    if (type === 'Income') {
      catSel.innerHTML = '<option value="">&#x2014; Select &#x2014;</option>' +
        INCOME_CATS.map(function(c) { return '<option>'+c+'</option>'; }).join('');
    } else if (type === 'Expense') {
      catSel.innerHTML = '<option value="">&#x2014; Select &#x2014;</option>' +
        EXPENSE_CATS.map(function(c) { return '<option>'+c+'</option>'; }).join('');
    } else {
      catSel.innerHTML = '<option value="">&#x2014; Select Type First &#x2014;</option>';
    }
  }
  // Reset category-driven field visibility when type changes
  var paymentWrap = document.getElementById('fPaymentWrap');
  if (paymentWrap) paymentWrap.style.display = '';
  var paidByWrap = document.getElementById('fPaidByWrap');
  var fromWrap   = document.getElementById('fFromAccountWrap');
  var fromLabel  = document.getElementById('fFromAccountLabel');
  var sel        = document.getElementById('fFromAccount');
  if (type === 'Income') {
    if (paidByWrap) paidByWrap.style.display = '';
    // Show account selector as "To Account"
    if (fromLabel) fromLabel.textContent = 'To Account';
    if (fromWrap)  fromWrap.style.display = '';
    if (sel) {
      var myAccounts = accounts.filter(function(a) {
        return a.members && currentUser && currentUser.uid && a.members[currentUser.uid];
      });
      sel.innerHTML = '<option value="">&#x2014; Select &#x2014;</option>' +
        myAccounts.map(function(a) {
          return '<option value="'+escHtml(a.id)+'">'+escHtml(a.name)+'</option>';
        }).join('');
    }
    // Show Paid By if Bank Transfer is selected
    onPaymentMethodChange();
  } else {
    if (paidByWrap) paidByWrap.style.display = '';
    if (fromLabel)  fromLabel.textContent = 'From Account';
    // Re-apply payment method logic for expense
    onPaymentMethodChange();
  }
}
function onPaymentMethodChange() {
  var type = v('fType');
  var payment = v('fPayment');
  var paidByWrap = document.getElementById('fPaidByWrap');
  var wrap = document.getElementById('fFromAccountWrap');
  var sel  = document.getElementById('fFromAccount');
  var bankMethods = ['Bank Transfer', 'BDO Debit Card', 'Metrobank', 'BPI', 'UnionBank', 'RCBC'];
  var isBank = bankMethods.indexOf(payment) !== -1;
  if (type === 'Income') {
    // For income, always show Paid By regardless of payment method
    if (paidByWrap) paidByWrap.style.display = '';
    return; // To Account is already handled by onTypeChange
  }
  if (!wrap || !sel) return;
  if (isBank) {
    wrap.style.display = '';
    var myAccounts = accounts.filter(function(a) {
      return a.members && currentUser && currentUser.uid && a.members[currentUser.uid];
    });
    var current = sel.value;
    sel.innerHTML = '<option value="">&#x2014; Select &#x2014;</option>' +
      myAccounts.map(function(a) {
        return '<option value="'+escHtml(a.id)+'"'+(a.id===current?' selected':'')+'>'+escHtml(a.name)+'</option>';
      }).join('');
  } else {
    wrap.style.display = 'none';
    sel.value = '';
  }
}
function clearForm() {
  ['fType','fCategory','fPayment','fDesc','fAmount','fPaidBy','fFromAccount'].forEach(function(id) { sv(id,''); });
  var panel = document.getElementById('descSavedPanel'); if (panel) panel.classList.add('hidden');
  var catSel = document.getElementById('fCategory');
  if (catSel) catSel.innerHTML = '<option value="">&#x2014; Select Type First &#x2014;</option>';
  var paymentWrap = document.getElementById('fPaymentWrap');
  if (paymentWrap) paymentWrap.style.display = '';
  var wrap = document.getElementById('fFromAccountWrap');
  if (wrap) wrap.style.display = 'none';
  var paidByWrap = document.getElementById('fPaidByWrap');
  if (paidByWrap) paidByWrap.style.display = '';
  var fromLabel = document.getElementById('fFromAccountLabel');
  if (fromLabel) fromLabel.textContent = 'From Account';
  sv('fDate', todayStr());
}
async function addTransaction() {
  var date = v('fDate'), type = v('fType'), category = v('fCategory'),
      payment = v('fPayment'), desc = v('fDesc').trim(),
      paidBy = v('fPaidBy'),
      fromAccountId = v('fFromAccount'),
      amount = parseFloat(v('fAmount')) || 0;
  var fromAccountName = '';
  if (fromAccountId) {
    var fromAcct = accounts.find(function(a) { return a.id === fromAccountId; });
    if (fromAcct) fromAccountName = fromAcct.name;
  }
  if (!date)     { toast('Please select a date.','error'); return; }
  if (!type)     { toast('Please select a transaction type.','error'); return; }
  if (!category) { toast('Please select a category.','error'); return; }
  if (!amount)   { toast('Please enter an amount.','error'); return; }
  if (amount < 0) { toast('Amount cannot be negative.','error'); return; }
  // For income, the account is the destination (fromAccountId = "To Account")
  // For expense, fall back to activeAccountId
  var txAccountId = (type === 'Income' && fromAccountId) ? fromAccountId : activeAccountId;
  if (!txAccountId) { toast('Select an account first.','error'); return; }
  var resolvedFromName = '';
  if (type === 'Income' && fromAccountId) {
    var destAcct = accounts.find(function(a) { return a.id === fromAccountId; });
    if (destAcct) resolvedFromName = destAcct.name;
  } else {
    resolvedFromName = fromAccountName;
  }
  var amountIn  = type === 'Income'  ? amount : 0;
  var amountOut = type === 'Expense' ? amount : 0;
  var tx = { date:date, type:type, category:category, payment:payment, paidBy:paidBy, fromAccount:resolvedFromName, desc:desc, amountIn:amountIn, amountOut:amountOut, accountId: txAccountId };
  setLoading(true);
  try {
    var id = await fbPost('transactions', tx);
    transactions.push(Object.assign({}, tx, { id:id }));
    // Credit "To Account" balance on income
    if (type === 'Income' && fromAccountId && amountIn > 0) {
      try {
        var toAcct = accounts.find(function(a) { return a.id === fromAccountId; });
        if (toAcct) {
          var newBal = (toAcct.balance || 0) + amountIn;
          var acctData = { name: toAcct.name, type: toAcct.type, balance: newBal, notes: toAcct.notes || '', members: toAcct.members || {} };
          await fbPut('accounts', fromAccountId, acctData);
          toAcct.balance = newBal;
        }
      } catch(balErr) { console.error('Balance update failed:', balErr); toast('Transaction saved but balance update failed — check Firebase rules.', 'error'); }
    }
    // Deduct from the "From Account" balance on expense
    if (type === 'Expense' && fromAccountId && amountOut > 0) {
      try {
        var fromAcct = accounts.find(function(a) { return a.id === fromAccountId; });
        if (fromAcct) {
          var newBal = (fromAcct.balance || 0) - amountOut;
          var acctData = { name: fromAcct.name, type: fromAcct.type, balance: newBal, notes: fromAcct.notes || '', members: fromAcct.members || {} };
          await fbPut('accounts', fromAccountId, acctData);
          fromAcct.balance = newBal;
        }
      } catch(balErr) { console.error('Balance update failed:', balErr); toast('Transaction saved but balance update failed — check Firebase rules.', 'error'); }
    }
    refreshAll(); clearForm(); toast('Transaction added!');
  } catch(e) { console.error(e); toast('Failed to save.','error'); }
  finally { setLoading(false); }
}
function onEditTypeChange() {
  var type = v('eType');
  var catSel = document.getElementById('eCategory');
  if (!catSel) return;
  if (type === 'Income') {
    catSel.innerHTML = '<option value="">\u2014 Select \u2014</option>' + INCOME_CATS.map(function(c){return '<option>'+c+'</option>';}).join('');
  } else if (type === 'Expense') {
    catSel.innerHTML = '<option value="">\u2014 Select \u2014</option>' + EXPENSE_CATS.map(function(c){return '<option>'+c+'</option>';}).join('');
  } else {
    catSel.innerHTML = '<option value="">\u2014 Select Type First \u2014</option>';
  }
}
function openEdit(id) {
  var tx = transactions.find(function(t) { return t.id === id; });
  if (!tx) return;
  editingId = id;
  sv('eDate', tx.date);
  sv('eType', tx.type);
  onEditTypeChange();
  sv('eCategory', tx.category);
  sv('ePayment', tx.payment || '');
  sv('eDesc', tx.desc || '');
  sv('eAmount', tx.amountIn || tx.amountOut || '');
  document.getElementById('editModal').classList.remove('hidden');
}
async function saveEdit() {
  var date = v('eDate'), type = v('eType'), category = v('eCategory'),
      payment = v('ePayment'), desc = v('eDesc').trim(),
      amount = parseFloat(v('eAmount')) || 0;
  if (!date || !type || !category) { toast('Fill required fields.','error'); return; }
  if (!amount) { toast('Enter an amount.','error'); return; }
  var tx = transactions.find(function(t) { return t.id === editingId; });
  var amountIn  = type === 'Income'  ? amount : 0;
  var amountOut = type === 'Expense' ? amount : 0;
  var accountId = tx ? tx.accountId : '';
  var fromAccount = tx ? (tx.fromAccount || '') : '';
  var paidBy = tx ? (tx.paidBy || '') : '';
  var updated = { id:editingId, date:date, type:type, category:category, payment:payment, desc:desc, amountIn:amountIn, amountOut:amountOut, accountId:accountId, fromAccount:fromAccount, paidBy:paidBy };
  setLoading(true);
  try {
    await fbPut('transactions', editingId, updated);
    var idx = transactions.findIndex(function(t) { return t.id === editingId; });
    if (idx !== -1) transactions[idx] = updated;
    refreshAll(); closeModal('editModal'); toast('Updated!');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
async function deleteTransaction(id) {
  if (!confirm('Delete this transaction?')) return;
  setLoading(true);
  try {
    await fbDelete('transactions', id);
    transactions = transactions.filter(function(t) { return t.id !== id; });
    refreshAll(); toast('Deleted.','error');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
async function confirmClearAll() {
  if (!transactions.length) { toast('No transactions.','error'); return; }
  if (!confirm('Delete ALL transactions? This cannot be undone.')) return;
  setLoading(true);
  try {
    var token = await getToken();
    var res = await fetch(BASE + '/transactions.json?auth=' + token, { method:'DELETE' });
    if (!res.ok) throw new Error(res.status);
    transactions = []; refreshAll(); toast('All cleared.','error');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
function clearFilters() {
  ['filterType','filterCategory','filterFrom','filterTo','filterSearch','filterAccount'].forEach(function(id) { sv(id,''); });
  renderTable();
}
function getFiltered() {
  var type = v('filterType'), cat = v('filterCategory'),
      from = v('filterFrom'), to = v('filterTo'),
      search = v('filterSearch').toLowerCase(),
      acctFilter = v('filterAccount');
  // Build set of account IDs the current user is a member of
  var myAccountIds = {};
  accounts.forEach(function(a) {
    if (a.members && currentUser && currentUser.uid && a.members[currentUser.uid]) {
      myAccountIds[a.id] = true;
    }
  });
  return transactions.slice().sort(function(a,b) { return a.date.localeCompare(b.date); }).filter(function(tx) {
    // Only show transactions for accounts the current user belongs to
    if (!myAccountIds[tx.accountId]) return false;
    if (acctFilter && tx.accountId !== acctFilter) return false;
    if (type && tx.type !== type) return false;
    if (cat  && tx.category !== cat) return false;
    if (from && tx.date < from) return false;
    if (to   && tx.date > to)   return false;
    if (search && !(tx.desc+' '+tx.category+' '+tx.payment).toLowerCase().includes(search)) return false;
    return true;
  });
}
function populateAccountFilter() {
  var sel = document.getElementById('filterAccount');
  if (!sel) return;
  var current = sel.value;
  sel.innerHTML = '<option value="">All Accounts</option>';
  accounts.forEach(function(a) {
    if (a.members && currentUser && currentUser.uid && a.members[currentUser.uid]) {
      var opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name || a.id;
      if (a.id === current) opt.selected = true;
      sel.appendChild(opt);
    }
  });
}
function renderTable() {
  var filtered = getFiltered();
  var body = document.getElementById('txTableBody');
  var allSorted = transactions.slice().sort(function(a,b) { return a.date.localeCompare(b.date); });
  // Build current balance map from accounts
  var accountBalMap = {};
  accounts.forEach(function(a) { accountBalMap[a.id] = a.balance || 0; });
  // First pass: total net per account so we can seed the starting balance
  var totalNetByAcct = {};
  allSorted.forEach(function(tx) {
    var acct = tx.accountId || '';
    totalNetByAcct[acct] = (totalNetByAcct[acct] || 0) + (tx.amountIn||0) - (tx.amountOut||0);
  });
  // Seed = currentBalance minus all transactions (gives balance before any tx)
  var runByAcct = {};
  Object.keys(totalNetByAcct).forEach(function(k) {
    runByAcct[k] = (accountBalMap[k] || 0) - totalNetByAcct[k];
  });
  // Second pass: running balance per account seeded from above
  var balMap = {};
  allSorted.forEach(function(tx) {
    var acct = tx.accountId || '';
    runByAcct[acct] = (runByAcct[acct] || 0) + (tx.amountIn||0) - (tx.amountOut||0);
    balMap[tx.id] = runByAcct[acct];
  });
  var empty = document.getElementById('emptyState');
  if (!filtered.length) { body.innerHTML=''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  // Show newest first in the visible table
  var filteredDesc = filtered.slice().reverse();
  body.innerHTML = filteredDesc.map(function(tx,i) { return (
    '<tr>' +
    '<td style="color:var(--text-muted)">'+(i+1)+'</td>' +
    '<td style="white-space:nowrap">'+fmtDate(tx.date)+'</td>' +
    '<td><span class="badge badge-'+tx.type.toLowerCase()+'">'+tx.type+'</span></td>' +
    '<td>'+escHtml(tx.category)+'</td>' +
    '<td style="color:var(--text-muted)">'+escHtml(tx.payment||'\u2014')+'</td>' +
    '<td style="color:var(--text-muted)">'+escHtml(tx.fromAccount||'\u2014')+'</td>' +
    '<td style="color:var(--text-muted)">'+escHtml(tx.paidBy||'\u2014')+'</td>' +
    '<td class="desc-excerpt" title="'+escHtml(tx.desc||'')+'">'+escHtml((tx.desc||'\u2014').slice(0,40))+((tx.desc||'').length>40?'\u2026':'')+'</td>' +
    '<td class="'+(tx.amountIn ? 'amount-in' : 'amount-out')+'">'+(tx.amountIn ? '+'+fmt(tx.amountIn) : '-'+fmt(tx.amountOut))+'</td>' +
    '<td class="balance-cell">'+fmt(balMap[tx.id]||0)+'</td>' +
    '<td><div class="action-btns">' +
    '<button class="icon-btn" onclick="openEdit(\''+tx.id+'\')">&#x270F;&#xFE0F;</button>' +
    '<button class="icon-btn del" onclick="deleteTransaction(\''+tx.id+'\')">&#x1F5D1;&#xFE0F;</button>' +
    '</div></td></tr>'
  ); }).join('');
}
function populateCategoryFilter() {
  var sel = document.getElementById('filterCategory');
  var cur = sel.value;
  var cats = Array.from(new Set(transactions.map(function(t) { return t.category; }))).sort();
  sel.innerHTML = '<option value="">All Categories</option>';
  cats.forEach(function(c) {
    var o = document.createElement('option'); o.value=c; o.textContent=c;
    if (c===cur) o.selected=true; sel.appendChild(o);
  });
}
function exportCSV() {
  if (!transactions.length) { toast('No data.','error'); return; }
  var sorted = transactions.slice().sort(function(a,b) { return a.date.localeCompare(b.date); });
  var run=0;
  var rows=[['#','Date','Type','Category','Payment','Description','Amount In','Amount Out','Balance']];
  sorted.forEach(function(tx,i) {
    run+=(tx.amountIn||0)-(tx.amountOut||0);
    rows.push([i+1,tx.date,tx.type,tx.category,tx.payment||'','"'+(tx.desc||'').replace(/"/g,'""')+'"',tx.amountIn||0,tx.amountOut||0,run.toFixed(2)]);
  });
  var csv=rows.map(function(r){return r.join(',');}).join('\n');
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='earnings-'+todayStr()+'.csv'; a.click();
  toast('CSV exported!');
}

// ── ACCOUNTS ──
async function addAccount() {
  var name=v('aName').trim(), type=v('aType'), balance=parseFloat(v('aBalance'))||0, notes=v('aNotes').trim();
  if (!name) { toast('Account name required.','error'); return; }
  setLoading(true);
  try {
    var members = {};
    if (currentUser && currentUser.uid) members[currentUser.uid] = true;
    // Auto-add all users already linked at profile level
    try {
      var token0 = await getToken();
      var lr = await fetch(BASE + '/userLinks/' + currentUser.uid + '/linkedWith.json?auth=' + token0);
      var linked = lr.ok ? await lr.json() : null;
      if (linked) Object.keys(linked).forEach(function(uid) { members[uid] = true; });
    } catch(e) { /* ignore */ }
    var id = await fbPost('accounts', { name:name, type:type, balance:balance, notes:notes, members: members });
    accounts.push({ id:id, name:name, type:type, balance:balance, notes:notes, members: members });
    activeAccountId = id;
    renderAccounts(); renderSummary();
    sv('aName',''); sv('aBalance',''); sv('aNotes','');
    toast('Account added!');
    renderAccountSelect();
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
var editingAccountId = null;
function openEditAccount(id) {
  var acct = accounts.find(function(a) { return a.id === id; });
  if (!acct) return;
  editingAccountId = id;
  sv('eaName', acct.name || '');
  sv('eaType', acct.type || 'Bank Account');
  sv('eaBalance', acct.balance || '');
  sv('eaNotes', acct.notes || '');
  document.getElementById('editAccountModal').classList.remove('hidden');
}
async function saveEditAccount() {
  var name    = v('eaName').trim();
  var type    = v('eaType');
  var balance = parseFloat(v('eaBalance')) || 0;
  var notes   = v('eaNotes').trim();
  if (!name) { toast('Account name required.', 'error'); return; }
  var acct = accounts.find(function(a) { return a.id === editingAccountId; });
  if (!acct) return;
  var updated = { name: name, type: type, balance: balance, notes: notes, members: acct.members || {} };
  setLoading(true);
  try {
    await fbPut('accounts', editingAccountId, updated);
    Object.assign(acct, updated);
    closeModal('editAccountModal');
    renderAccounts(); renderSummary(); populateAccountFilter(); toast('Account updated!');
  } catch(e) { console.error(e); toast('Failed.', 'error'); }
  finally { setLoading(false); }
}
async function deleteAccount(id) {
  if (!confirm('Delete this account?')) return;
  setLoading(true);
  try {
    await fbDelete('accounts', id);
    accounts = accounts.filter(function(a) { return a.id!==id; });
    renderAccounts(); renderSummary(); toast('Deleted.','error');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
function renderAccounts() {
  var grid = document.getElementById('accountsGrid');
  // Only show accounts where current user is a member
  var memberAccounts = accounts.filter(function(a) {
    return a.members && currentUser && currentUser.uid && a.members[currentUser.uid];
  });
  var total = memberAccounts.reduce(function(s,a) { return s+(a.balance||0); }, 0);
  document.getElementById('accountsTotal').textContent = fmt(total);
  if (!memberAccounts.length) { grid.innerHTML='<div class="empty-state">No accounts yet.</div>'; return; }
  grid.innerHTML = memberAccounts.map(function(a) { return (
    '<div class="account-card">' +
    '<div class="acc-actions">' +
    '<button class="icon-btn" onclick="openEditAccount(\''+a.id+'\')" title="Edit">&#x270F;&#xFE0F;</button>' +
    '<button class="icon-btn del" onclick="deleteAccount(\''+a.id+'\')" title="Delete">&#x1F5D1;&#xFE0F;</button>' +
    '</div>' +
    '<div class="acc-name">'+escHtml(a.name)+'</div>' +
    '<div class="acc-balance">'+fmt(a.balance)+'</div>' +
    '<div class="acc-type">'+escHtml(a.type)+(a.notes?' \u00B7 '+escHtml(a.notes):'')+'</div>' +
    '</div>'
  ); }).join('');
}

// ── MEMBERS TAB ──
async function renderMembers() {
  var panel = document.getElementById('membersPanel');
  if (!panel) return;
  var linkedUids = [];
  try {
    var token = await getToken();
    var res = await fetch(BASE + '/userLinks/' + currentUser.uid + '/linkedWith.json?auth=' + token);
    var linked = res.ok ? await res.json() : null;
    if (linked) linkedUids = Object.keys(linked);
  } catch(e) { /* ignore */ }

  // Fetch uncached profiles
  try {
    var token2 = await getToken();
    for (var i = 0; i < linkedUids.length; i++) {
      var uid = linkedUids[i];
      if (!usersCache[uid]) {
        var r = await fetch(BASE + '/users/' + uid + '.json?auth=' + token2);
        if (r.ok) { var u = await r.json(); if (u) usersCache[uid] = u; }
      }
    }
  } catch(e) { /* ignore */ }

  var myName = currentUser.displayName || currentUser.email || 'You';
  var myInitials = myName.split(' ').map(function(w){return w[0];}).join('').toUpperCase().slice(0,2);

  var selfHtml =
    '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)">' +
      '<div style="width:42px;height:42px;border-radius:50%;background:var(--blue);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;flex-shrink:0">' + escHtml(myInitials) + '</div>' +
      '<div style="flex:1">' +
        '<div style="font-weight:600">' + escHtml(myName) + ' <span style="font-size:.72rem;color:var(--green);background:rgba(16,185,129,.15);padding:2px 8px;border-radius:20px">You</span></div>' +
        '<div style="font-size:.78rem;color:var(--text-muted)">' + escHtml(currentUser.email||'') + '</div>' +
      '</div>' +
    '</div>';

  var linkedHtml = linkedUids.map(function(uid) {
    var u = usersCache[uid] || {};
    var name = u.displayName || u.email || uid;
    var email = u.email || '';
    var initials = name.split(' ').map(function(w){return w[0];}).join('').toUpperCase().slice(0,2);
    return (
      '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)">' +
        '<div style="width:42px;height:42px;border-radius:50%;background:var(--purple);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;flex-shrink:0">' + escHtml(initials) + '</div>' +
        '<div style="flex:1">' +
          '<div style="font-weight:600">' + escHtml(name) + '</div>' +
          '<div style="font-size:.78rem;color:var(--text-muted)">' + escHtml(email) + '</div>' +
        '</div>' +
        '<button class="btn btn-ghost" style="font-size:.75rem;padding:4px 12px;color:var(--red)" onclick="removeLinkedMember(\''+uid+'\')">Remove</button>' +
      '</div>'
    );
  }).join('');

  panel.innerHTML =
    '<div style="background:var(--surface);border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,.08)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        '<p style="margin:0;color:var(--text-muted);font-size:.85rem">Everyone below can see and add transactions across all your shared accounts.</p>' +
        '<button class="btn btn-primary" style="font-size:.8rem;white-space:nowrap;margin-left:16px" onclick="openInviteModal(null)">\uD83D\uDD17 Share Tracker</button>' +
      '</div>' +
      '<div>' + selfHtml + linkedHtml + '</div>' +
      (!linkedUids.length ? '<div style="color:var(--text-muted);font-size:.85rem;padding:12px 0 0">No one shared yet. Click \u201CShare Tracker\u201D to invite someone.</div>' : '') +
    '</div>';
}

async function removeLinkedMember(uid) {
  if (!confirm('Remove this person? They will lose access to all your shared accounts.')) return;
  setLoading(true);
  try {
    var token = await getToken();
    await fetch(BASE + '/userLinks/' + currentUser.uid + '/linkedWith/' + uid + '.json?auth=' + token, { method: 'DELETE' });
    await fetch(BASE + '/userLinks/' + uid + '/linkedWith/' + currentUser.uid + '.json?auth=' + token, { method: 'DELETE' });
    var myAccounts = accounts.filter(function(a) {
      return a.members && currentUser.uid && a.members[currentUser.uid];
    });
    for (var i = 0; i < myAccounts.length; i++) {
      await fetch(BASE + '/accounts/' + myAccounts[i].id + '/members/' + uid + '.json?auth=' + token, { method: 'DELETE' });
      if (myAccounts[i].members) delete myAccounts[i].members[uid];
    }
    renderMembers();
    renderAccounts();
    renderAccountSelect();
    toast('Member removed.');
  } catch(e) { console.error(e); toast('Failed to remove.','error'); }
  finally { setLoading(false); }
}

// ── CREDIT CARDS ──
async function addCard() {
  var name=v('ccName').trim(), group=v('ccGroup').trim(), limit=parseFloat(v('ccLimit'))||0, balance=parseFloat(v('ccBalance'))||0,
      dueDay=parseInt(v('ccDueDay'))||0, notes=v('ccNotes').trim();
  if (!name) { toast('Card name required.','error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('cards', { name:name, group:group, limit:limit, balance:balance, dueDay:dueDay, notes:notes, uid:currentUser.uid });
    cards.push({ id:id, name:name, group:group, limit:limit, balance:balance, dueDay:dueDay, notes:notes, uid:currentUser.uid });
    renderCards(); renderSummary();
    ['ccName','ccGroup','ccLimit','ccBalance','ccDueDay','ccNotes'].forEach(function(i) { sv(i,''); });
    toast('Card added!');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
async function deleteCard(id) {
  if (!confirm('Delete this card?')) return;
  setLoading(true);
  try {
    await fbDelete('cards', id);
    cards = cards.filter(function(c) { return c.id!==id; });
    renderCards(); renderSummary(); toast('Deleted.','error');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
var cardsCombined = localStorage.getItem('et_cards_combined') === '1';
function toggleCombineCards() {
  cardsCombined = !cardsCombined;
  localStorage.setItem('et_cards_combined', cardsCombined ? '1' : '0');
  renderCards();
}
function renderCards() {
  var grid = document.getElementById('cardsGrid');
  var total = cards.reduce(function(s,c) { return s+(c.balance||0); }, 0);
  document.getElementById('cardsTotal').textContent = fmt(total);
  var btn = document.getElementById('combineCardsBtn');
  if (btn) btn.textContent = cardsCombined ? 'Show Individual' : 'Combine';
  if (!cards.length) { grid.innerHTML='<div class="empty-state">No credit cards yet.</div>'; return; }

  // Separate grouped vs ungrouped cards
  var groups = {}, ungrouped = [];
  cards.forEach(function(c) {
    if (c.group) { if (!groups[c.group]) groups[c.group] = []; groups[c.group].push(c); }
    else ungrouped.push(c);
  });

  function cardHtml(c) {
    var pct = c.limit ? Math.min(100,(c.balance/c.limit)*100) : 0;
    var barColor = pct>80?'var(--red)':pct>50?'var(--orange)':'var(--blue)';
    return '<div class="account-card">' +
      '<div class="acc-actions"><button class="icon-btn del" onclick="deleteCard(\''+c.id+'\')" title="Delete">&#x1F5D1;&#xFE0F;</button></div>' +
      '<div class="acc-name">'+escHtml(c.name)+(c.group?'<span class="card-group-tag">'+escHtml(c.group)+'</span>':'')+'</div>' +
      '<div class="acc-balance" style="color:var(--orange)">'+fmt(c.balance)+'</div>' +
      '<div class="acc-type">Limit: '+fmt(c.limit)+(c.dueDay !== undefined && c.dueDay !== '' ? ' \u00B7 Due: '+fmtDueDay(c.dueDay) : '')+'</div>' +
      (c.limit ? '<div class="goal-bar-wrap" style="margin-top:8px"><div class="goal-bar" style="width:'+pct+'%;background:'+barColor+'"></div></div><div style="font-size:.7rem;color:var(--text-muted)">'+pct.toFixed(0)+'% used</div>' : '') +
      (c.notes ? '<div class="acc-type">'+escHtml(c.notes)+'</div>' : '') +
      '</div>';
  }

  function combinedGroupHtml(groupName, groupCards) {
    var totalBal = groupCards.reduce(function(s,c) { return s+(c.balance||0); }, 0);
    var sharedLimit = groupCards.reduce(function(s,c) { return s+(c.limit||0); }, 0) / groupCards.length;
    sharedLimit = groupCards[0].limit || 0;
    var pct = sharedLimit ? Math.min(100,(totalBal/sharedLimit)*100) : 0;
    var barColor = pct>80?'var(--red)':pct>50?'var(--orange)':'var(--blue)';
    var dueDay = groupCards[0].dueDay;
    return '<div class="account-card card-combined">' +
      '<div class="acc-name">'+escHtml(groupName)+' <span class="card-group-tag">'+groupCards.length+' cards</span></div>' +
      '<div class="acc-balance" style="color:var(--orange)">'+fmt(totalBal)+'</div>' +
      '<div class="acc-type">Shared Limit: '+fmt(sharedLimit)+(dueDay !== undefined && dueDay !== '' ? ' \u00B7 Due: '+fmtDueDay(dueDay) : '')+'</div>' +
      (sharedLimit ? '<div class="goal-bar-wrap" style="margin-top:8px"><div class="goal-bar" style="width:'+pct+'%;background:'+barColor+'"></div></div><div style="font-size:.7rem;color:var(--text-muted)">'+pct.toFixed(0)+'% of shared limit used</div>' : '') +
      '<div class="card-combined-list">'+groupCards.map(function(c){return '<span>'+escHtml(c.name)+': <strong>'+fmt(c.balance)+'</strong></span>';}).join('')+'</div>' +
      '</div>';
  }

  var html = '';
  if (cardsCombined) {
    Object.keys(groups).forEach(function(g) {
      if (groups[g].length > 1) html += combinedGroupHtml(g, groups[g]);
      else html += cardHtml(groups[g][0]);
    });
  } else {
    Object.keys(groups).forEach(function(g) { groups[g].forEach(function(c){ html += cardHtml(c); }); });
  }
  ungrouped.forEach(function(c) { html += cardHtml(c); });
  grid.innerHTML = html || '<div class="empty-state">No credit cards yet.</div>';
}

// ── BILLS ──
async function addBill() {
  var name=v('bName').trim(), category=v('bCategory'), amount=parseFloat(v('bAmount'))||0,
      dueDay=parseInt(v('bDueDay'))||0, payment=v('bPayment'), notes=v('bNotes').trim();
  if (!name)   { toast('Bill name required.','error'); return; }
  if (!amount) { toast('Amount required.','error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('bills', { name:name, category:category, amount:amount, dueDay:dueDay, payment:payment, notes:notes, uid:currentUser.uid });
    bills.push({ id:id, name:name, category:category, amount:amount, dueDay:dueDay, payment:payment, notes:notes, uid:currentUser.uid });
    renderBills();
    ['bName','bAmount','bDueDay','bNotes'].forEach(function(i) { sv(i,''); });
    toast('Bill added!');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
async function deleteBill(id) {
  if (!confirm('Delete this bill?')) return;
  setLoading(true);
  try {
    await fbDelete('bills', id);
    bills = bills.filter(function(b) { return b.id!==id; });
    renderBills(); toast('Deleted.','error');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
function renderBills() {
  var grid = document.getElementById('billsGrid');
  var total = bills.reduce(function(s,b) { return s+(b.amount||0); }, 0);
  document.getElementById('billsTotal').textContent = fmt(total);
  if (!bills.length) { grid.innerHTML='<div class="empty-state">No bills yet.</div>'; return; }
  grid.innerHTML = bills.map(function(b) { return (
    '<div class="bill-card">' +
    '<div class="bill-name">'+escHtml(b.name)+'</div>' +
    '<div class="bill-meta">' +
      '<span>'+escHtml(b.category)+'</span>' +
      (b.dueDay !== undefined && b.dueDay !== '' ? '<span>Due: '+fmtDueDay(b.dueDay)+'</span>' : '') +
      (b.payment?'<span>'+escHtml(b.payment)+'</span>':'') +
    '</div>' +
    '<div class="bill-amount">'+fmt(b.amount)+'<span style="font-size:.72rem;color:var(--text-muted);font-weight:400"> /mo</span></div>' +
    (b.notes?'<div style="font-size:.75rem;color:var(--text-muted);margin-top:4px">'+escHtml(b.notes)+'</div>':'') +
    '<div style="margin-top:8px"><button class="icon-btn del" onclick="deleteBill(\''+b.id+'\')">&#x1F5D1;&#xFE0F; Delete</button></div>' +
    '</div>'
  ); }).join('');
}

// ── CONTRIBUTIONS ──
async function addContribution() {
  var name=v('cName').trim(), type=v('cType'), amount=parseFloat(v('cAmount'))||0,
      dueDay=parseInt(v('cDueDay'))||0, lastPaid=v('cLastPaid'), notes=v('cNotes').trim();
  if (!name)   { toast('Name required.','error'); return; }
  if (!amount) { toast('Amount required.','error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('contributions', { name:name, type:type, amount:amount, dueDay:dueDay, lastPaid:lastPaid, notes:notes, uid:currentUser.uid });
    contributions.push({ id:id, name:name, type:type, amount:amount, dueDay:dueDay, lastPaid:lastPaid, notes:notes, uid:currentUser.uid });
    renderContributions();
    ['cName','cAmount','cDueDay','cLastPaid','cNotes'].forEach(function(i) { sv(i,''); });
    toast('Contribution added!');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
async function deleteContribution(id) {
  if (!confirm('Delete this contribution?')) return;
  setLoading(true);
  try {
    await fbDelete('contributions', id);
    contributions = contributions.filter(function(c) { return c.id!==id; });
    renderContributions(); toast('Deleted.','error');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
function renderContributions() {
  var grid = document.getElementById('contribGrid');
  var total = contributions.reduce(function(s,c) { return s+(c.amount||0); }, 0);
  document.getElementById('contribTotal').textContent = fmt(total);
  if (!contributions.length) { grid.innerHTML='<div class="empty-state">No contributions yet.</div>'; return; }
  grid.innerHTML = contributions.map(function(c) { return (
    '<div class="contrib-card">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">' +
      '<div><strong>'+escHtml(c.name)+'</strong> <span style="font-size:.75rem;color:var(--purple);background:rgba(168,85,247,.15);padding:2px 8px;border-radius:20px">'+escHtml(c.type)+'</span></div>' +
      '<button class="icon-btn del" onclick="deleteContribution(\''+c.id+'\')">&#x1F5D1;&#xFE0F;</button>' +
    '</div>' +
    '<div style="font-size:1.15rem;font-weight:700;color:var(--purple)">'+fmt(c.amount)+'<span style="font-size:.72rem;color:var(--text-muted);font-weight:400"> /mo</span></div>' +
    (c.dueDay !== undefined && c.dueDay !== '' ? '<div style="font-size:.78rem;color:var(--text-muted);margin-top:4px">Due: '+fmtDueDay(c.dueDay)+'</div>' : '') +
    (c.lastPaid?'<div style="font-size:.78rem;color:var(--text-muted)">Last paid: '+fmtDate(c.lastPaid)+'</div>':'') +
    (c.notes?'<div style="font-size:.75rem;color:var(--text-muted);margin-top:4px">'+escHtml(c.notes)+'</div>':'') +
    '</div>'
  ); }).join('');
}

// ── GOALS ──
async function addGoal() {
  var name=v('gName').trim(), target=parseFloat(v('gTarget'))||0,
      saved=parseFloat(v('gSaved'))||0, monthly=parseFloat(v('gMonthly'))||0, notes=v('gNotes').trim();
  if (!name)   { toast('Goal name required.','error'); return; }
  if (!target) { toast('Target amount required.','error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('goals', { name:name, target:target, saved:saved, monthly:monthly, notes:notes, uid:currentUser.uid });
    goals.push({ id:id, name:name, target:target, saved:saved, monthly:monthly, notes:notes, uid:currentUser.uid });
    renderGoals();
    ['gName','gTarget','gSaved','gMonthly','gNotes'].forEach(function(i) { sv(i,''); });
    toast('Goal added!');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
async function deleteGoal(id) {
  if (!confirm('Delete this goal?')) return;
  setLoading(true);
  try {
    await fbDelete('goals', id);
    goals = goals.filter(function(g) { return g.id!==id; });
    renderGoals(); toast('Deleted.','error');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
function renderGoals() {
  var grid = document.getElementById('goalsGrid');
  if (!goals.length) { grid.innerHTML='<div class="empty-state">No goals yet.</div>'; return; }
  grid.innerHTML = goals.map(function(g) {
    var pct = g.target ? Math.min(100,(g.saved/g.target)*100) : 0;
    var rem = Math.max(0, g.target - g.saved);
    var months = g.monthly > 0 ? Math.ceil(rem/g.monthly) : null;
    return (
      '<div class="goal-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div class="goal-name">'+escHtml(g.name)+'</div>' +
        '<button class="icon-btn del" onclick="deleteGoal(\''+g.id+'\')">&#x1F5D1;&#xFE0F;</button>' +
      '</div>' +
      '<div class="goal-bar-wrap"><div class="goal-bar" style="width:'+pct+'%"></div></div>' +
      '<div class="goal-meta">' +
        '<span>'+fmt(g.saved)+' saved</span>' +
        '<span>'+pct.toFixed(0)+'%</span>' +
        '<span>Goal: '+fmt(g.target)+'</span>' +
      '</div>' +
      (months!==null?'<div style="font-size:.75rem;color:var(--text-muted);margin-top:6px">~'+months+' month'+(months!==1?'s':'')+' to go at '+fmt(g.monthly)+'/mo</div>':'') +
      (g.notes?'<div style="font-size:.75rem;color:var(--text-muted);margin-top:4px">'+escHtml(g.notes)+'</div>':'') +
      '</div>'
    );
  }).join('');
}

// ── INCOME SOURCES ──
async function addIncomeSource() {
  var name=v('iName').trim(), platform=v('iPlatform').trim(),
      amount=parseFloat(v('iAmount'))||0, type=v('iType'), notes=v('iNotes').trim();
  if (!name)   { toast('Source name required.','error'); return; }
  if (!amount) { toast('Amount required.','error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('incomeSources', { name:name, platform:platform, amount:amount, type:type, notes:notes, uid:currentUser.uid });
    incomeSources.push({ id:id, name:name, platform:platform, amount:amount, type:type, notes:notes, uid:currentUser.uid });
    renderIncomeSources();
    ['iName','iPlatform','iAmount','iNotes'].forEach(function(i) { sv(i,''); });
    toast('Income source added!');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
async function deleteIncomeSource(id) {
  if (!confirm('Delete this income source?')) return;
  setLoading(true);
  try {
    await fbDelete('incomeSources', id);
    incomeSources = incomeSources.filter(function(i) { return i.id!==id; });
    renderIncomeSources(); toast('Deleted.','error');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
function renderIncomeSources() {
  var list = document.getElementById('incomesList');
  var total = incomeSources.reduce(function(s,i) { return s+(i.amount||0); }, 0);
  document.getElementById('incomesTotal').textContent = fmt(total);
  if (!incomeSources.length) { list.innerHTML='<div class="empty-state">No income sources yet.</div>'; return; }
  list.innerHTML = incomeSources.map(function(i) { return (
    '<div class="income-item">' +
      '<div>' +
        '<div class="inc-name">'+escHtml(i.name)+'</div>' +
        '<div class="inc-detail">'+escHtml(i.type)+(i.platform?' \u00B7 '+escHtml(i.platform):'')+(i.notes?' \u00B7 '+escHtml(i.notes):'')+'</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div class="inc-amount">'+fmt(i.amount)+'<span style="font-size:.72rem;color:var(--text-muted);font-weight:400">/mo</span></div>' +
        '<button class="icon-btn del" onclick="deleteIncomeSource(\''+i.id+'\')">&#x1F5D1;&#xFE0F;</button>' +
      '</div>' +
    '</div>'
  ); }).join('');
}

// ── HEALTH & INSURANCE ──
async function addHealth() {
  var name=v('hName').trim(), type=v('hType'), premium=parseFloat(v('hPremium'))||0,
      lastPaid=v('hLastPaid'), renewal=v('hRenewal'), payment=v('hPayment'), notes=v('hNotes').trim();
  if (!name) { toast('Name required.','error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('healthItems', { name:name, type:type, premium:premium, lastPaid:lastPaid, renewal:renewal, payment:payment, notes:notes, uid:currentUser.uid });
    healthItems.push({ id:id, name:name, type:type, premium:premium, lastPaid:lastPaid, renewal:renewal, payment:payment, notes:notes, uid:currentUser.uid });
    renderHealth();
    ['hName','hPremium','hLastPaid','hRenewal','hNotes'].forEach(function(i) { sv(i,''); });
    toast('Entry added!');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
async function deleteHealth(id) {
  if (!confirm('Delete this entry?')) return;
  setLoading(true);
  try {
    await fbDelete('healthItems', id);
    healthItems = healthItems.filter(function(h) { return h.id!==id; });
    renderHealth(); toast('Deleted.','error');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
function renderHealth() {
  var grid = document.getElementById('healthGrid');
  if (!healthItems.length) { grid.innerHTML='<div class="empty-state">No entries yet.</div>'; return; }
  var today = todayStr();
  grid.innerHTML = healthItems.map(function(h) {
    var renewalBadge = '';
    if (h.renewal) {
      var daysLeft = Math.ceil((new Date(h.renewal) - new Date(today)) / 86400000);
      var cls = daysLeft <= 60 ? 'renewal-soon' : 'renewal-ok';
      var label = daysLeft < 0 ? 'Overdue!' : daysLeft === 0 ? 'Due today' : daysLeft+'d left';
      renewalBadge = '<span class="health-renewal '+cls+'">Renewal: '+fmtDate(h.renewal)+' \u00B7 '+label+'</span>';
    }
    return (
      '<div class="health-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">' +
        '<div class="health-name">'+escHtml(h.name)+'</div>' +
        '<button class="icon-btn del" onclick="deleteHealth(\''+h.id+'\')">&#x1F5D1;&#xFE0F;</button>' +
      '</div>' +
      '<div class="health-meta">'+escHtml(h.type)+(h.payment?' \u00B7 '+escHtml(h.payment):'')+(h.premium?' \u00B7 <strong style="color:var(--text)">'+fmt(h.premium)+'/yr</strong>':'')+'</div>' +
      (h.lastPaid?'<div class="health-meta">Last paid: '+fmtDate(h.lastPaid)+'</div>':'') +
      renewalBadge +
      (h.notes?'<div style="font-size:.75rem;color:var(--text-muted);margin-top:6px">'+escHtml(h.notes)+'</div>':'') +
      '</div>'
    );
  }).join('');
}

// ── SUMMARY ──
function renderSummary() {
  var totalOut=0;
  var myAccounts = accounts.filter(function(a) {
    return a.members && currentUser && currentUser.uid && a.members[currentUser.uid];
  });
  var myAccountIds = {};
  myAccounts.forEach(function(a) { myAccountIds[a.id] = true; });
  var myTransactions = transactions.filter(function(t) {
    return t.accountId && myAccountIds[t.accountId];
  });
  myTransactions.forEach(function(t) { totalOut += (t.amountOut||0); });
  document.getElementById('totalExpense').textContent = fmt(totalOut);

  var accountsRow = document.getElementById('accountsRow');
  var cardsRow    = document.getElementById('cardsRow');
  accountsRow.innerHTML = '';
  cardsRow.innerHTML    = '';

  var ACCENT_COLORS = ['var(--blue)','var(--green)','var(--cyan)','var(--yellow)','var(--purple, #a855f7)'];

  function makeCard(name, value, sublabel, color) {
    var div = document.createElement('div');
    div.className = 'card';
    div.style.setProperty('--card-accent', color);
    div.innerHTML =
      '<div class="label">' + name + '</div>' +
      '<div class="value" style="color:' + color + '">' + value + '</div>' +
      '<div class="sublabel">' + sublabel + '</div>';
    return div;
  }

  // Bank / wallet accounts row
  myAccounts.forEach(function(a, idx) {
    var color = ACCENT_COLORS[idx % ACCENT_COLORS.length];
    accountsRow.appendChild(makeCard(
      escHtml(a.name),
      fmt(a.balance||0),
      escHtml(a.type||'Account') + (a.notes ? ' \u00B7 ' + escHtml(a.notes) : ''),
      color
    ));
  });

  // Credit cards row — respect combine toggle
  var groups = {}, ungrouped = [];
  cards.forEach(function(c) {
    if (c.group) { if (!groups[c.group]) groups[c.group] = []; groups[c.group].push(c); }
    else ungrouped.push(c);
  });
  function appendCardSummary(name, balance, limit) {
    cardsRow.appendChild(makeCard(escHtml(name), fmt(balance), 'Limit: ' + fmt(limit), 'var(--orange)'));
  }
  if (cardsCombined) {
    Object.keys(groups).forEach(function(g) {
      var gc = groups[g];
      if (gc.length > 1) {
        appendCardSummary(g + ' (' + gc.length + ' cards)', gc.reduce(function(s,c){return s+(c.balance||0);},0), gc[0].limit||0);
      } else { appendCardSummary(gc[0].name, gc[0].balance||0, gc[0].limit||0); }
    });
  } else {
    Object.keys(groups).forEach(function(g) {
      groups[g].forEach(function(c) { appendCardSummary(c.name, c.balance||0, c.limit||0); });
    });
  }
  ungrouped.forEach(function(c) { appendCardSummary(c.name, c.balance||0, c.limit||0); });

  // Remove old style hack if present
  var old = document.getElementById('acct-summary-style');
  if (old) old.remove();
}

// ── REFRESH ALL ──
function refreshAll() {
  populateCategoryFilter();
  populateAccountFilter();
  populateDescDropdown();
  renderSummary();
  renderTable();
  renderAccounts();
  renderAccountSelect();
  renderCards();
  renderBills();
  renderContributions();
  renderGoals();
  renderIncomeSources();
  renderHealth();
  renderMembers();
  restoreTab();
}

// ── AUTH STATE ──
auth.onAuthStateChanged(async function(user) {
  if (user) {
    currentUser = user;
    showApp();
    sv('fDate', todayStr());
    setLoading(true);
    try {
      // Save user profile to /users/{uid}
      const token = await getToken();
      const userProfile = { uid: user.uid, email: user.email, displayName: user.displayName || '' };
      await fetch(BASE + '/users/' + user.uid + '.json?auth=' + token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile)
      });
      // Pre-cache current user so Paid By dropdown populates immediately
      usersCache[user.uid] = userProfile;
      // Accept any pending invites for this user's email
      await processPendingInvites(user, token);
      async function safeFbGet(path) { try { return await fbGet(path); } catch(e) { console.warn('Could not load ' + path + ':', e); return []; } }
      var uid = user.uid;
      // Fetch linked member UIDs so their cards/bills/etc are also visible
      var linkedUids = [uid];
      try {
        var lRes = await fetch(BASE + '/userLinks/' + uid + '/linkedWith.json?auth=' + token);
        var lData = lRes.ok ? await lRes.json() : null;
        if (lData && typeof lData === 'object') {
          Object.keys(lData).forEach(function(k) { if (lData[k]) linkedUids.push(k); });
        }
      } catch(e) { console.warn('Could not load linked UIDs:', e); }
      function filterByUid(arr) { return arr.filter(function(x) { return !x.uid || linkedUids.indexOf(x.uid) !== -1; }); }
      var results = await Promise.all([
        safeFbGet('transactions'), safeFbGet('accounts'), safeFbGet('cards'),
        safeFbGet('bills'), safeFbGet('contributions'), safeFbGet('goals'),
        safeFbGet('incomeSources'), safeFbGet('healthItems')
      ]);
      transactions=results[0]; accounts=results[1];
      cards=filterByUid(results[2]); bills=filterByUid(results[3]);
      contributions=filterByUid(results[4]); goals=filterByUid(results[5]);
      incomeSources=filterByUid(results[6]); healthItems=filterByUid(results[7]);
    } catch(e) {
      console.error(e);
      toast('Could not load data from Firebase.','error');
    } finally { setLoading(false); }
    // Set activeAccountId to first member account if not set
    var memberAccounts = accounts.filter(function(a) {
      return a.members && currentUser && currentUser.uid && a.members[currentUser.uid];
    });
    if (memberAccounts.length) {
      activeAccountId = memberAccounts[0].id;
    } else {
      activeAccountId = null;
    }
    refreshAll();
    renderAccountSelect();
  } else {
    currentUser = null;
    showLogin();
  }
});

// Close modals on backdrop click / Escape
var editModal = document.getElementById('editModal');
if (editModal) {
  editModal.addEventListener('click', function(e) { if(e.target===this) closeModal('editModal'); });
}
document.addEventListener('keydown', function(e) { if(e.key==='Escape') closeModal('editModal'); });

function toggleProfileDropdown() {
  var dd = document.getElementById('profileDropdown');
  if (dd) dd.classList.toggle('hidden');
}

document.addEventListener('click', function(e) {
  var dd = document.getElementById('profileDropdown');
  var wrap = document.getElementById('profileDropdownWrap');
  if (!wrap || !dd) return;
  if (!wrap.contains(e.target)) dd.classList.add('hidden');
  // Close saved-desc panel if clicking outside
  var panel = document.getElementById('descSavedPanel');
  var descWrap = document.querySelector('.desc-saved-wrap');
  if (panel && descWrap && !descWrap.contains(e.target)) panel.classList.add('hidden');
});

function goToAccounts() {
  // Switch to accounts tab
  var tabSel = document.getElementById('tabSelect');
  if (tabSel) tabSel.value = 'accounts';
  switchTab('accounts');
  // Hide dropdown
  var dd = document.getElementById('profileDropdown');
  if (dd) dd.classList.add('hidden');
}

async function inviteMemberSubmit() {
  var email = (document.getElementById('inviteEmail').value || '').trim().toLowerCase();
  var errEl = document.getElementById('inviteError');
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Please enter an email address.'; return; }
  setLoading(true);
  try {
    var token = await getToken();
    // Find existing user by scanning /users
    var matchedUid = null;
    var res = await fetch(BASE + '/users.json?auth=' + token);
    var allUsers = res.ok ? await res.json() : null;
    if (allUsers) {
      var uids = Object.keys(allUsers);
      for (var j = 0; j < uids.length; j++) {
        if ((allUsers[uids[j]].email || '').toLowerCase() === email) {
          matchedUid = uids[j]; break;
        }
      }
    }
    if (matchedUid) {
      // Store bidirectional profile-level link
      await fetch(BASE + '/userLinks/' + currentUser.uid + '/linkedWith/' + matchedUid + '.json?auth=' + token, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true'
      });
      await fetch(BASE + '/userLinks/' + matchedUid + '/linkedWith/' + currentUser.uid + '.json?auth=' + token, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true'
      });
      // Add other user to ALL of my accounts
      var myAccounts = accounts.filter(function(a) {
        return a.members && currentUser.uid && a.members[currentUser.uid];
      });
      for (var i = 0; i < myAccounts.length; i++) {
        await fetch(BASE + '/accounts/' + myAccounts[i].id + '/members/' + matchedUid + '.json?auth=' + token, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true'
        });
        if (!myAccounts[i].members) myAccounts[i].members = {};
        myAccounts[i].members[matchedUid] = true;
      }
      // Add me to all of the other person's accounts
      var otherAccounts = accounts.filter(function(a) {
        return a.members && a.members[matchedUid] && !a.members[currentUser.uid];
      });
      for (var k = 0; k < otherAccounts.length; k++) {
        await fetch(BASE + '/accounts/' + otherAccounts[k].id + '/members/' + currentUser.uid + '.json?auth=' + token, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true'
        });
        if (!otherAccounts[k].members) otherAccounts[k].members = {};
        otherAccounts[k].members[currentUser.uid] = true;
      }
      closeModal('inviteMemberModal');
      toast('Tracker shared! You can now both see all accounts and transactions.');
      refreshAll();
    } else {
      // Pending invite — store at profile level keyed by email
      var emailKey = email.replace(/\./g, ',');
      await fetch(BASE + '/pendingInvites/' + emailKey + '/linkedWith/' + currentUser.uid + '.json?auth=' + token, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true'
      });
      closeModal('inviteMemberModal');
      toast('Invite sent! They will be linked when they sign in.');
    }
  } catch(e) {
    console.error(e);
    errEl.textContent = 'Failed to share. Please try again.';
  } finally { setLoading(false); }
}

// Process any pending invites for the signed-in user
async function processPendingInvites(user, token) {
  try {
    var emailKey = user.email.toLowerCase().replace(/\./g, ',');
    var res = await fetch(BASE + '/pendingInvites/' + emailKey + '.json?auth=' + token);
    if (!res.ok) return;
    var pending = await res.json();
    if (!pending || !pending.linkedWith) return;
    var inviterUids = Object.keys(pending.linkedWith);
    for (var i = 0; i < inviterUids.length; i++) {
      var inviterUid = inviterUids[i];
      // Create bidirectional link
      await fetch(BASE + '/userLinks/' + user.uid + '/linkedWith/' + inviterUid + '.json?auth=' + token, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true'
      });
      await fetch(BASE + '/userLinks/' + inviterUid + '/linkedWith/' + user.uid + '.json?auth=' + token, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true'
      });
      // Add new user to all of inviter's accounts
      var allAccRes = await fetch(BASE + '/accounts.json?auth=' + token);
      var allAccData = allAccRes.ok ? await allAccRes.json() : null;
      if (allAccData) {
        var accEntries = Object.entries(allAccData);
        for (var j = 0; j < accEntries.length; j++) {
          var aId = accEntries[j][0], aData = accEntries[j][1];
          if (aData.members && aData.members[inviterUid]) {
            await fetch(BASE + '/accounts/' + aId + '/members/' + user.uid + '.json?auth=' + token, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true'
            });
          }
        }
      }
    }
    // Clear processed invites
    await fetch(BASE + '/pendingInvites/' + emailKey + '.json?auth=' + token, { method: 'DELETE' });
  } catch(e) { console.warn('Could not process pending invites:', e); }
}
