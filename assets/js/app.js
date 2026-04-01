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
let assets        = [];
let liabilities   = [];
let lastTotalExpense = 0;
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
async function fbGetValue(path) {
  const token = await getToken();
  const res = await fetch(BASE + '/' + path + '.json?auth=' + token);
  if (!res.ok) throw new Error('GET ' + path + ' failed: ' + res.status);
  return await res.json();
}
async function fbSetValue(path, value) {
  const token = await getToken();
  const res = await fetch(BASE + '/' + path + '.json?auth=' + token, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error('PUT ' + path + ' failed: ' + res.status);
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
      loadSavedDescs();
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
var EXPENSE_CATS = ['Food & Dining','Bills & Utilities','Transportation','Shopping','Entertainment','Health & Medical','Education','Rent','Groceries','Government','Gov Contribution','Subscriptions','Debt Payment','Interest Withheld','Other Expense'];
var NO_PAYMENT_CATS = ['Interest Gained','Interest Withheld'];

// ── SAVED DESCRIPTIONS ──
var SAVED_DESCS_KEY = 'et_saved_descs';
var savedDescs = [];
function getSavedDescs() { return savedDescs; }
function setSavedDescs(arr) {
  savedDescs = arr;
  if (activeAccountId) {
    fbSetValue('accounts/' + activeAccountId + '/savedDescs', arr).catch(function(e) {
      console.warn('Could not save descriptions to Firebase:', e);
      localStorage.setItem(SAVED_DESCS_KEY, JSON.stringify(arr));
    });
  } else {
    localStorage.setItem(SAVED_DESCS_KEY, JSON.stringify(arr));
  }
}
async function loadSavedDescs() {
  if (activeAccountId) {
    try {
      var data = await fbGetValue('accounts/' + activeAccountId + '/savedDescs');
      savedDescs = Array.isArray(data) ? data : [];
      // One-time migration: pull from localStorage if Firebase has none
      if (!savedDescs.length) {
        var local = [];
        try { local = JSON.parse(localStorage.getItem(SAVED_DESCS_KEY) || '[]'); } catch(e) {}
        if (local.length) {
          savedDescs = local;
          fbSetValue('accounts/' + activeAccountId + '/savedDescs', savedDescs).catch(function() {});
          localStorage.removeItem(SAVED_DESCS_KEY);
        }
      }
    } catch(e) {
      console.warn('Could not load savedDescs from Firebase:', e);
      try { savedDescs = JSON.parse(localStorage.getItem(SAVED_DESCS_KEY) || '[]'); } catch(e2) { savedDescs = []; }
    }
  } else {
    try { savedDescs = JSON.parse(localStorage.getItem(SAVED_DESCS_KEY) || '[]'); } catch(e) { savedDescs = []; }
  }
  populateDescDropdown();
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
  var fromLabel = document.getElementById('fFromAccountLabel');
  if (type === 'Income') {
    if (paidByWrap) paidByWrap.style.display = '';
    return;
  }
  if (!wrap || !sel) return;
  if (!payment || payment === 'Other') {
    wrap.style.display = 'none';
    sel.value = '';
    return;
  }
  var myAccounts = accounts.filter(function(a) {
    return a.members && currentUser && currentUser.uid && a.members[currentUser.uid];
  });
  var options = [];
  var labelText = 'From Account';
  if (payment === 'Credit Card') {
    labelText = 'Credit Card';
    options = cards.map(function(c) {
      return '<option value="card:'+escHtml(c.id)+'">'+escHtml(c.name)+(c.group?' ('+escHtml(c.group)+')':'')+' \u2014 '+fmt(c.balance)+' debt</option>';
    });
    if (!options.length) options = ['<option value="" disabled>No credit cards added yet</option>'];
  } else {
    var filtered;
    if (payment === 'Cash') {
      filtered = myAccounts.filter(function(a) { return a.type === 'Cash on Hand' || a.name.toLowerCase().indexOf('cash') !== -1; });
      if (!filtered.length) filtered = myAccounts;
    } else if (payment === 'GCash') {
      filtered = myAccounts.filter(function(a) { return a.name.toLowerCase().indexOf('gcash') !== -1; });
      if (!filtered.length) filtered = myAccounts;
    } else if (payment === 'GrabPay') {
      filtered = myAccounts.filter(function(a) { return a.name.toLowerCase().indexOf('grab') !== -1; });
      if (!filtered.length) filtered = myAccounts;
    } else if (payment === 'Bank Transfer') {
      filtered = myAccounts.filter(function(a) { return a.type === 'Bank Account' || a.type === 'Savings'; });
      if (!filtered.length) filtered = myAccounts;
    } else {
      filtered = myAccounts;
    }
    var current = sel.value;
    options = filtered.map(function(a) {
      return '<option value="'+escHtml(a.id)+'"'+(a.id===current?' selected':'')+'>'+escHtml(a.name)+'</option>';
    });
  }
  if (fromLabel) fromLabel.textContent = labelText;
  wrap.style.display = '';
  sel.innerHTML = '<option value="">\u2014 Select \u2014</option>' + options.join('');
}
function _populateBillFromAccount(paymentId, wrapId, selId, labelId) {
  var payment = document.getElementById(paymentId) ? document.getElementById(paymentId).value : '';
  var wrap = document.getElementById(wrapId);
  var sel  = document.getElementById(selId);
  var fromLabel = document.getElementById(labelId);
  if (!wrap || !sel) return;
  if (!payment || payment === 'Other') {
    wrap.style.display = 'none';
    sel.value = '';
    return;
  }
  var myAccounts = accounts.filter(function(a) {
    return a.members && currentUser && currentUser.uid && a.members[currentUser.uid];
  });
  var options = [];
  var labelText = 'From Account';
  if (payment === 'Credit Card' || payment.toLowerCase().indexOf('credit card') !== -1) {
    labelText = 'Credit Card';
    options = cards.map(function(c) {
      return '<option value="card:'+escHtml(c.id)+'">'+escHtml(c.name)+(c.group?' ('+escHtml(c.group)+')':'')+' \u2014 '+fmt(c.balance)+' debt</option>';
    });
    if (!options.length) options = ['<option value="" disabled>No credit cards added yet</option>'];
  } else {
    var filtered;
    var current = sel.value;
    if (payment === 'Cash') {
      filtered = myAccounts.filter(function(a) { return a.type === 'Cash on Hand' || a.name.toLowerCase().indexOf('cash') !== -1; });
      if (!filtered.length) filtered = myAccounts;
    } else if (payment === 'GCash') {
      filtered = myAccounts.filter(function(a) { return a.name.toLowerCase().indexOf('gcash') !== -1; });
      if (!filtered.length) filtered = myAccounts;
    } else if (payment === 'GrabPay') {
      filtered = myAccounts.filter(function(a) { return a.name.toLowerCase().indexOf('grab') !== -1; });
      if (!filtered.length) filtered = myAccounts;
    } else if (payment === 'Bank Transfer') {
      filtered = myAccounts.filter(function(a) { return a.type === 'Bank Account' || a.type === 'Savings'; });
      if (!filtered.length) filtered = myAccounts;
    } else {
      filtered = myAccounts;
    }
    options = filtered.map(function(a) {
      return '<option value="'+escHtml(a.id)+'"'+(a.id===current?' selected':'')+'>'+escHtml(a.name)+'</option>';
    });
  }
  if (fromLabel) fromLabel.textContent = labelText;
  wrap.style.display = '';
  sel.innerHTML = '<option value="">\u2014 Select \u2014</option>' + options.join('');
}
function onBillPaymentChange() {
  _populateBillFromAccount('bPayment', 'bFromAccountWrap', 'bFromAccount', 'bFromAccountLabel');
}
function onEditBillPaymentChange() {
  _populateBillFromAccount('ebPayment', 'ebFromAccountWrap', 'ebFromAccount', 'ebFromAccountLabel');
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
  var isCardPayment = fromAccountId && fromAccountId.indexOf('card:') === 0;
  var cardId = isCardPayment ? fromAccountId.slice(5) : null;
  var acctId = isCardPayment ? '' : fromAccountId;
  var fromAccountName = '';
  if (isCardPayment && cardId) {
    var payCardItem = cards.find(function(c) { return c.id === cardId; });
    if (payCardItem) fromAccountName = payCardItem.name + (payCardItem.group ? ' (' + payCardItem.group + ')' : '');
  } else if (acctId) {
    var fromAcct = accounts.find(function(a) { return a.id === acctId; });
    if (fromAcct) fromAccountName = fromAcct.name;
  }
  if (!date)     { toast('Please select a date.','error'); return; }
  if (!type)     { toast('Please select a transaction type.','error'); return; }
  if (!category) { toast('Please select a category.','error'); return; }
  if (!amount)   { toast('Please enter an amount.','error'); return; }
  if (amount < 0) { toast('Amount cannot be negative.','error'); return; }
  // For income, the account is the destination (fromAccountId = "To Account")
  // For expense, fall back to activeAccountId
  var txAccountId = (type === 'Income' && acctId) ? acctId : activeAccountId;
  if (!txAccountId) { toast('Select an account first.','error'); return; }
  var resolvedFromName = '';
  if (type === 'Income' && acctId) {
    var destAcct = accounts.find(function(a) { return a.id === acctId; });
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
    if (type === 'Income' && acctId && amountIn > 0) {
      try {
        var toAcct = accounts.find(function(a) { return a.id === acctId; });
        if (toAcct) {
          var newBal = (toAcct.balance || 0) + amountIn;
          var acctData = { name: toAcct.name, type: toAcct.type, balance: newBal, notes: toAcct.notes || '', members: toAcct.members || {} };
          await fbPut('accounts', acctId, acctData);
          toAcct.balance = newBal;
        }
      } catch(balErr) { console.error('Balance update failed:', balErr); toast('Transaction saved but balance update failed — check Firebase rules.', 'error'); }
    }
    // Deduct from account / add to card balance on expense
    if (type === 'Expense' && amountOut > 0) {
      if (isCardPayment && cardId) {
        try {
          var expCard = cards.find(function(c) { return c.id === cardId; });
          if (expCard) {
            var newCardBal = (expCard.balance || 0) + amountOut;
            await fbPut('cards', cardId, { name:expCard.name, group:expCard.group||'', limit:expCard.limit||0, balance:newCardBal, dueDay:expCard.dueDay||0, notes:expCard.notes||'', uid:expCard.uid });
            expCard.balance = newCardBal;
          }
        } catch(balErr) { console.error('Card balance update failed:', balErr); toast('Transaction saved but card balance update failed.', 'error'); }
      } else if (acctId) {
        try {
          var expAcct = accounts.find(function(a) { return a.id === acctId; });
          if (expAcct) {
            var newBal = (expAcct.balance || 0) - amountOut;
            var acctData = { name: expAcct.name, type: expAcct.type, balance: newBal, notes: expAcct.notes || '', members: expAcct.members || {} };
            await fbPut('accounts', acctId, acctData);
            expAcct.balance = newBal;
          }
        } catch(balErr) { console.error('Balance update failed:', balErr); toast('Transaction saved but balance update failed — check Firebase rules.', 'error'); }
      }
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
function acctTypeColor(type) {
  switch (type) {
    case 'Bank Account': return 'var(--blue)';
    case 'Savings':      return 'var(--cyan)';
    case 'E-Wallet':     return 'var(--purple)';
    case 'Cash on Hand': return 'var(--green)';
    case 'Investment':   return 'var(--yellow)';
    default:             return 'var(--text-muted)';
  }
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
    '<div class="acc-balance" style="color:'+acctTypeColor(a.type)+'">'+fmt(a.balance)+'</div>' +
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
var editCardId = null;
function openEditCard(id) {
  var card = cards.find(function(c) { return c.id === id; });
  if (!card) return;
  editCardId = id;
  sv('ecName', card.name);
  sv('ecGroup', card.group || '');
  sv('ecLimit', card.limit || 0);
  sv('ecBalance', card.balance || 0);
  sv('ecDueDay', card.dueDay !== undefined && card.dueDay !== null ? card.dueDay : '');
  sv('ecNotes', card.notes || '');
  document.getElementById('editCardModal').classList.remove('hidden');
}
async function saveEditCard() {
  var name = v('ecName').trim();
  var group = v('ecGroup').trim();
  var limit = parseFloat(v('ecLimit')) || 0;
  var balance = parseFloat(v('ecBalance')) || 0;
  var dueDayRaw = v('ecDueDay');
  var dueDay = dueDayRaw !== '' ? parseInt(dueDayRaw) : 0;
  var notes = v('ecNotes').trim();
  if (!name) { toast('Card name required.', 'error'); return; }
  setLoading(true);
  try {
    var card = cards.find(function(c) { return c.id === editCardId; });
    await fbPut('cards', editCardId, { name:name, group:group, limit:limit, balance:balance, dueDay:dueDay, notes:notes, uid:card.uid });
    card.name = name; card.group = group; card.limit = limit; card.balance = balance; card.dueDay = dueDay; card.notes = notes;
    closeModal('editCardModal');
    renderCards(); renderSummary();
    toast('Card updated!');
  } catch(e) { console.error(e); toast('Failed.', 'error'); }
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
async function payCard(id) {
  var card = cards.find(function(c) { return c.id === id; });
  if (!card) return;
  var input = window.prompt('Payment amount for ' + card.name + '? (Balance: ' + fmt(card.balance) + ')', (card.balance || 0).toFixed(2));
  if (input === null) return;
  var amount = parseFloat(input);
  if (isNaN(amount) || amount <= 0) { toast('Invalid amount.', 'error'); return; }
  if (!activeAccountId) { toast('Select an account first.', 'error'); return; }
  setLoading(true);
  try {
    // 1. Reduce card balance
    var newBal = Math.max(0, (card.balance || 0) - amount);
    await fbPut('cards', id, { name:card.name, group:card.group||'', limit:card.limit||0, balance:newBal, dueDay:card.dueDay||0, notes:card.notes||'', uid:card.uid });
    card.balance = newBal;
    // 2. Log a Debt Payment transaction
    var tx = { date:todayStr(), type:'Expense', category:'Debt Payment', payment:'Bank Transfer', paidBy:(currentUser.displayName||currentUser.email||''), fromAccount:'', desc:'Payment — '+card.name, amountIn:0, amountOut:amount, accountId:activeAccountId };
    var txId = await fbPost('transactions', tx);
    transactions.push(Object.assign({}, tx, { id:txId }));
    renderCards(); renderSummary(); renderTable();
    toast('Payment of ' + fmt(amount) + ' recorded for ' + card.name + '!');
  } catch(e) { console.error(e); toast('Failed to record payment.', 'error'); }
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
      '<div class="acc-actions">' +
        (c.balance > 0 ? '<button class="icon-btn" onclick="payCard(\''+c.id+'\')" title="Record payment" style="color:var(--green);border-color:var(--green);margin-right:4px">&#x2714; Pay</button>' : '') +
        '<button class="icon-btn" onclick="openEditCard(\''+c.id+'\')" title="Edit" style="margin-right:4px">&#x270F;&#xFE0F;</button>' +
        '<button class="icon-btn del" onclick="deleteCard(\''+c.id+'\')" title="Delete">&#x1F5D1;&#xFE0F;</button>' +
      '</div>' +
      '<div class="acc-name">'+escHtml(c.name)+'</div>' +
      (c.group?'<div style="margin:-4px 0 6px"><span class="card-group-tag">'+escHtml(c.group)+'</span></div>':'') +
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
      dueDay=parseInt(v('bDueDay'))||0, payment=v('bPayment'), notes=v('bNotes').trim(),
      fromAccount=v('bFromAccount');
  if (!name)   { toast('Bill name required.','error'); return; }
  if (!amount) { toast('Amount required.','error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('bills', { name:name, category:category, amount:amount, dueDay:dueDay, payment:payment, fromAccount:fromAccount, notes:notes, uid:currentUser.uid });
    bills.push({ id:id, name:name, category:category, amount:amount, dueDay:dueDay, payment:payment, fromAccount:fromAccount, notes:notes, uid:currentUser.uid });
    renderBills();
    ['bName','bAmount','bDueDay','bNotes','bFromAccount'].forEach(function(i) { sv(i,''); });
    var bWrap = document.getElementById('bFromAccountWrap');
    if (bWrap) bWrap.style.display = 'none';
    toast('Bill added!');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
async function payBill(id) {
  var bill = bills.find(function(b) { return b.id === id; });
  if (!bill) return;
  var input = window.prompt('Payment amount for ' + bill.name + '?', (bill.amount || 0).toFixed(2));
  if (input === null) return;
  var amount = parseFloat(input);
  if (isNaN(amount) || amount <= 0) { toast('Invalid amount.', 'error'); return; }
  if (!activeAccountId) { toast('Select an account first.', 'error'); return; }
  setLoading(true);
  try {
    var tx = { date:todayStr(), type:'Expense', category:bill.category||'Bills & Utilities', payment:bill.payment||'', paidBy:(currentUser.displayName||currentUser.email||''), fromAccount:'', desc:'Bill Payment \u2014 '+bill.name, amountIn:0, amountOut:amount, accountId:activeAccountId };
    var txId = await fbPost('transactions', tx);
    transactions.push(Object.assign({}, tx, { id:txId }));
    renderSummary(); renderTable();
    toast('Payment of ' + fmt(amount) + ' recorded for ' + bill.name + '!');
  } catch(e) { console.error(e); toast('Failed to record payment.', 'error'); }
  finally { setLoading(false); }
}
var editingBillId = null;
function openEditBill(id) {
  var bill = bills.find(function(b) { return b.id === id; });
  if (!bill) return;
  editingBillId = id;
  document.getElementById('ebName').value     = bill.name || '';
  document.getElementById('ebCategory').value = bill.category || '';
  document.getElementById('ebAmount').value   = bill.amount || '';
  document.getElementById('ebDueDay').value   = (bill.dueDay !== undefined && bill.dueDay !== null) ? bill.dueDay : '';
  document.getElementById('ebPayment').value  = bill.payment || '';
  document.getElementById('ebNotes').value    = bill.notes || '';
  onEditBillPaymentChange();
  var ebFromSel = document.getElementById('ebFromAccount');
  if (ebFromSel && bill.fromAccount) ebFromSel.value = bill.fromAccount;
  document.getElementById('editBillModal').classList.remove('hidden');
}
async function saveEditBill() {
  var bill = bills.find(function(b) { return b.id === editingBillId; });
  if (!bill) return;
  var name     = document.getElementById('ebName').value.trim();
  var category = document.getElementById('ebCategory').value;
  var amount   = parseFloat(document.getElementById('ebAmount').value) || 0;
  var dueDay   = parseInt(document.getElementById('ebDueDay').value) || 0;
  var payment  = document.getElementById('ebPayment').value;
  var fromAccount = document.getElementById('ebFromAccount') ? document.getElementById('ebFromAccount').value : '';
  var notes    = document.getElementById('ebNotes').value.trim();
  if (!name)   { toast('Bill name required.', 'error'); return; }
  if (!amount) { toast('Amount required.', 'error'); return; }
  setLoading(true);
  try {
    var updated = { name:name, category:category, amount:amount, dueDay:dueDay, payment:payment, fromAccount:fromAccount, notes:notes, uid:bill.uid };
    await fbPut('bills', editingBillId, updated);
    Object.assign(bill, updated);
    closeModal('editBillModal');
    renderBills();
    toast('Bill updated!');
  } catch(e) { console.error(e); toast('Failed to update.', 'error'); }
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
    '<div style="margin-top:10px;display:flex;gap:6px">' +
      '<button class="icon-btn" onclick="payBill(\''+b.id+'\')" style="color:var(--green);border-color:var(--green)">&#x2714; Pay</button>' +
      '<button class="icon-btn" onclick="openEditBill(\''+b.id+'\')" style="color:var(--blue);border-color:var(--blue)">&#x270F;&#xFE0F; Edit</button>' +
      '<button class="icon-btn del" onclick="deleteBill(\''+b.id+'\')">&#x1F5D1;&#xFE0F; Delete</button>' +
    '</div>' +
    '</div>'
  ); }).join('');
}

// ── NET WORTH: ASSETS ──
async function addAsset() {
  var name = document.getElementById('assetName').value.trim();
  var type = document.getElementById('assetType').value;
  var value = parseFloat(document.getElementById('assetValue').value) || 0;
  var notes = document.getElementById('assetNotes').value.trim();
  if (!name)  { toast('Asset name required.', 'error'); return; }
  if (!value) { toast('Value required.', 'error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('assets', { name:name, type:type, value:value, notes:notes, uid:currentUser.uid });
    assets.push({ id:id, name:name, type:type, value:value, notes:notes, uid:currentUser.uid });
    renderNetWorth();
    ['assetName','assetValue','assetNotes'].forEach(function(i) { document.getElementById(i).value = ''; });
    toast('Asset added!');
  } catch(e) { console.error(e); toast('Failed.', 'error'); }
  finally { setLoading(false); }
}
var editingAssetId = null;
function openEditAsset(id) {
  var a = assets.find(function(x) { return x.id === id; });
  if (!a) return;
  editingAssetId = id;
  document.getElementById('eaAssetName').value  = a.name || '';
  document.getElementById('eaAssetType').value  = a.type || '';
  document.getElementById('eaAssetValue').value = a.value || '';
  document.getElementById('eaAssetNotes').value = a.notes || '';
  document.getElementById('editAssetModal').classList.remove('hidden');
}
async function saveEditAsset() {
  var a = assets.find(function(x) { return x.id === editingAssetId; });
  if (!a) return;
  var name  = document.getElementById('eaAssetName').value.trim();
  var type  = document.getElementById('eaAssetType').value;
  var value = parseFloat(document.getElementById('eaAssetValue').value) || 0;
  var notes = document.getElementById('eaAssetNotes').value.trim();
  if (!name)  { toast('Asset name required.', 'error'); return; }
  if (!value) { toast('Value required.', 'error'); return; }
  setLoading(true);
  try {
    var updated = { name:name, type:type, value:value, notes:notes, uid:a.uid };
    await fbPut('assets', editingAssetId, updated);
    Object.assign(a, updated);
    closeModal('editAssetModal');
    renderNetWorth();
    toast('Asset updated!');
  } catch(e) { console.error(e); toast('Failed.', 'error'); }
  finally { setLoading(false); }
}
async function deleteAsset(id) {
  if (!confirm('Delete this asset?')) return;
  setLoading(true);
  try {
    await fbDelete('assets', id);
    assets = assets.filter(function(x) { return x.id !== id; });
    renderNetWorth(); toast('Deleted.', 'error');
  } catch(e) { console.error(e); toast('Failed.', 'error'); }
  finally { setLoading(false); }
}

// ── NET WORTH: LIABILITIES ──
async function addLiability() {
  var name    = document.getElementById('liabName').value.trim();
  var type    = document.getElementById('liabType').value;
  var balance = parseFloat(document.getElementById('liabBalance').value) || 0;
  var notes   = document.getElementById('liabNotes').value.trim();
  if (!name)    { toast('Liability name required.', 'error'); return; }
  if (!balance) { toast('Balance required.', 'error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('liabilities', { name:name, type:type, balance:balance, notes:notes, uid:currentUser.uid });
    liabilities.push({ id:id, name:name, type:type, balance:balance, notes:notes, uid:currentUser.uid });
    renderNetWorth();
    ['liabName','liabBalance','liabNotes'].forEach(function(i) { document.getElementById(i).value = ''; });
    toast('Liability added!');
  } catch(e) { console.error(e); toast('Failed.', 'error'); }
  finally { setLoading(false); }
}
var editingLiabId = null;
function openEditLiab(id) {
  var l = liabilities.find(function(x) { return x.id === id; });
  if (!l) return;
  editingLiabId = id;
  document.getElementById('eLiabName').value    = l.name || '';
  document.getElementById('eLiabType').value    = l.type || '';
  document.getElementById('eLiabBalance').value = l.balance || '';
  document.getElementById('eLiabNotes').value   = l.notes || '';
  document.getElementById('editLiabModal').classList.remove('hidden');
}
async function saveEditLiab() {
  var l = liabilities.find(function(x) { return x.id === editingLiabId; });
  if (!l) return;
  var name    = document.getElementById('eLiabName').value.trim();
  var type    = document.getElementById('eLiabType').value;
  var balance = parseFloat(document.getElementById('eLiabBalance').value) || 0;
  var notes   = document.getElementById('eLiabNotes').value.trim();
  if (!name)    { toast('Liability name required.', 'error'); return; }
  if (!balance) { toast('Balance required.', 'error'); return; }
  setLoading(true);
  try {
    var updated = { name:name, type:type, balance:balance, notes:notes, uid:l.uid };
    await fbPut('liabilities', editingLiabId, updated);
    Object.assign(l, updated);
    closeModal('editLiabModal');
    renderNetWorth();
    toast('Liability updated!');
  } catch(e) { console.error(e); toast('Failed.', 'error'); }
  finally { setLoading(false); }
}
async function deleteLiability(id) {
  if (!confirm('Delete this liability?')) return;
  setLoading(true);
  try {
    await fbDelete('liabilities', id);
    liabilities = liabilities.filter(function(x) { return x.id !== id; });
    renderNetWorth(); toast('Deleted.', 'error');
  } catch(e) { console.error(e); toast('Failed.', 'error'); }
  finally { setLoading(false); }
}
function renderNetWorth() {
  var myAccounts = accounts.filter(function(a) {
    return a.members && currentUser && currentUser.uid && a.members[currentUser.uid];
  });
  var accountsTotal = myAccounts.reduce(function(s, a) { return s + (a.balance || 0); }, 0);
  var cardsDebt     = cards.reduce(function(s, c) { return s + (c.balance || 0); }, 0);
  var manualAssets  = assets.reduce(function(s, a) { return s + (a.value || 0); }, 0);
  var manualLiabs   = liabilities.reduce(function(s, l) { return s + (l.balance || 0); }, 0);
  var totalAssets   = accountsTotal + manualAssets;
  var totalLiabs    = cardsDebt + manualLiabs;
  var netWorth      = totalAssets - totalLiabs;

  // Update nw-summary bar in Net Worth tab
  var nwAt = document.getElementById('nwAssetsTotal');
  var nwLt = document.getElementById('nwLiabilitiesTotal');
  var nwNw = document.getElementById('nwNetWorth');
  var alt  = document.getElementById('assetsListTotal');
  var llt  = document.getElementById('liabsListTotal');
  var nwAssetsSub = document.getElementById('nwAssetsSub');
  var nwLiabsSub  = document.getElementById('nwLiabsSub');
  if (nwAt) nwAt.textContent = fmt(totalAssets);
  if (nwLt) nwLt.textContent = fmt(totalLiabs);
  if (alt)  alt.textContent  = fmt(totalAssets);
  if (llt)  llt.textContent  = fmt(totalLiabs);
  if (nwAssetsSub) nwAssetsSub.textContent = 'Accounts: ' + fmt(accountsTotal) + '  +  Manual: ' + fmt(manualAssets);
  if (nwLiabsSub)  nwLiabsSub.textContent  = 'Cards: ' + fmt(cardsDebt) + '  +  Manual: ' + fmt(manualLiabs);
  if (nwNw) {
    nwNw.textContent = fmt(netWorth);
    nwNw.style.color = netWorth >= 0 ? 'var(--green)' : 'var(--red)';
  }

  // Update summary row: Assets | Net Worth | Liabilities | Expenses
  var nwTopRow = document.getElementById('nwTopRow');
  if (nwTopRow) {
    function makeNwCard(label, value, sublabel, color, tabTarget) {
      var div = document.createElement('div');
      div.className = 'card';
      div.style.cursor = 'pointer';
      div.title = 'Go to ' + tabTarget;
      div.innerHTML =
        '<div class="label">' + label + '</div>' +
        '<div class="value" style="color:' + color + '">' + fmt(value) + '</div>' +
        '<div class="sublabel">' + sublabel + '</div>';
      div.addEventListener('click', function() {
        var tabSel = document.getElementById('tabSelect');
        if (tabSel) tabSel.value = tabTarget;
        switchTab(tabTarget);
      });
      return div;
    }
    nwTopRow.innerHTML = '';
    nwTopRow.appendChild(makeNwCard('Total Assets', totalAssets, 'Accounts + Manual assets', 'var(--green)', 'networth'));
    nwTopRow.appendChild(makeNwCard('Net Worth', netWorth, 'Assets − Liabilities', netWorth >= 0 ? 'var(--green)' : 'var(--red)', 'networth'));
    nwTopRow.appendChild(makeNwCard('Total Liabilities', totalLiabs, 'Card debt + Manual liabilities', 'var(--red)', 'networth'));
    nwTopRow.appendChild(makeNwCard('Total Expenses', lastTotalExpense, 'All-time spending', 'var(--red)', 'transactions'));
  }
  var ag = document.getElementById('assetsGrid');
  if (ag) {
    if (!assets.length) {
      ag.innerHTML = '<div class="empty-state">No assets added yet.</div>';
    } else {
      ag.innerHTML = assets.map(function(a) {
        return '<div class="nw-card">' +
          '<div class="nw-card-name">' + escHtml(a.name) + '</div>' +
          '<div class="nw-card-meta">' + escHtml(a.type) + (a.notes ? ' &bull; ' + escHtml(a.notes) : '') + '</div>' +
          '<div class="nw-card-value" style="color:var(--green)">' + fmt(a.value) + '</div>' +
          '<div style="margin-top:10px;display:flex;gap:6px">' +
            '<button class="icon-btn" onclick="openEditAsset(\'' + a.id + '\')" style="color:var(--blue);border-color:var(--blue)">&#x270F;&#xFE0F; Edit</button>' +
            '<button class="icon-btn del" onclick="deleteAsset(\'' + a.id + '\')">&#x1F5D1;&#xFE0F; Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }
  var lg = document.getElementById('liabsGrid');
  if (lg) {
    if (!liabilities.length) {
      lg.innerHTML = '<div class="empty-state">No liabilities added yet.</div>';
    } else {
      lg.innerHTML = liabilities.map(function(l) {
        return '<div class="nw-card">' +
          '<div class="nw-card-name">' + escHtml(l.name) + '</div>' +
          '<div class="nw-card-meta">' + escHtml(l.type) + (l.notes ? ' &bull; ' + escHtml(l.notes) : '') + '</div>' +
          '<div class="nw-card-value" style="color:var(--red)">' + fmt(l.balance) + '</div>' +
          '<div style="margin-top:10px;display:flex;gap:6px">' +
            '<button class="icon-btn" onclick="openEditLiab(\'' + l.id + '\')" style="color:var(--blue);border-color:var(--blue)">&#x270F;&#xFE0F; Edit</button>' +
            '<button class="icon-btn del" onclick="deleteLiability(\'' + l.id + '\')">&#x1F5D1;&#xFE0F; Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }
}

// ── CONTRIBUTIONS ──
function onContribPaymentChange() {
  _populateBillFromAccount('cPayment', 'cFromAccountWrap', 'cFromAccount', 'cFromAccountLabel');
}
function onEditContribPaymentChange() {
  _populateBillFromAccount('ecPayment', 'ecFromAccountWrap', 'ecFromAccount', 'ecFromAccountLabel');
}
async function addContribution() {
  var name=v('cName').trim(), type=v('cType'), amount=parseFloat(v('cAmount'))||0,
      dueDay=parseInt(v('cDueDay'))||0, notes=v('cNotes').trim(),
      payment=v('cPayment'), fromAccount=v('cFromAccount');
  if (!name)   { toast('Name required.','error'); return; }
  if (!amount) { toast('Amount required.','error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('contributions', { name:name, type:type, amount:amount, dueDay:dueDay, notes:notes, payment:payment, fromAccount:fromAccount, uid:currentUser.uid });
    contributions.push({ id:id, name:name, type:type, amount:amount, dueDay:dueDay, notes:notes, payment:payment, fromAccount:fromAccount, uid:currentUser.uid });
    renderContributions();
    ['cName','cAmount','cDueDay','cNotes','cPayment','cFromAccount'].forEach(function(i) { sv(i,''); });
    document.getElementById('cFromAccountWrap').style.display = 'none';
    toast('Contribution added!');
  } catch(e) { console.error(e); toast('Failed.','error'); }
  finally { setLoading(false); }
}
async function payContrib(id) {
  var contrib = contributions.find(function(c) { return c.id === id; });
  if (!contrib) return;
  var input = window.prompt('Payment amount for ' + contrib.name + '?', (contrib.amount || 0).toFixed(2));
  if (input === null) return;
  var amount = parseFloat(input);
  if (isNaN(amount) || amount <= 0) { toast('Invalid amount.', 'error'); return; }
  if (!activeAccountId) { toast('Select an account first.', 'error'); return; }
  setLoading(true);
  try {
    var tx = { date:todayStr(), type:'Expense', category:'Gov Contribution', payment:contrib.payment||'', paidBy:(currentUser.displayName||currentUser.email||''), fromAccount:contrib.fromAccount||'', desc:'Contribution \u2014 '+contrib.name, amountIn:0, amountOut:amount, accountId:activeAccountId };
    var txId = await fbPost('transactions', tx);
    transactions.push(Object.assign({}, tx, { id:txId }));
    renderSummary(); renderTable();
    toast('Payment of ' + fmt(amount) + ' recorded for ' + contrib.name + '!');
  } catch(e) { console.error(e); toast('Failed to record payment.', 'error'); }
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
var editContribId = null;
function openEditContrib(id) {
  var c = contributions.find(function(x) { return x.id === id; });
  if (!c) return;
  editContribId = id;
  sv('ecName', c.name);
  sv('ecType', c.type);
  sv('ecAmount', c.amount || 0);
  sv('ecDueDay', c.dueDay !== undefined && c.dueDay !== null ? c.dueDay : '');
  sv('ecPayment', c.payment || '');
  sv('ecNotes', c.notes || '');
  // Populate from account if payment set
  _populateBillFromAccount('ecPayment', 'ecFromAccountWrap', 'ecFromAccount', 'ecFromAccountLabel');
  // Restore saved fromAccount selection after populating
  if (c.fromAccount) {
    var sel = document.getElementById('ecFromAccount');
    if (sel) sel.value = c.fromAccount;
  }
  document.getElementById('editContribModal').classList.remove('hidden');
}
async function saveEditContrib() {
  var name = v('ecName').trim();
  var type = v('ecType');
  var amount = parseFloat(v('ecAmount')) || 0;
  var dueDayRaw = v('ecDueDay');
  var dueDay = dueDayRaw !== '' ? parseInt(dueDayRaw) : 0;
  var payment = v('ecPayment');
  var fromAccount = v('ecFromAccount');
  var notes = v('ecNotes').trim();
  if (!name)   { toast('Name required.', 'error'); return; }
  if (!amount) { toast('Amount required.', 'error'); return; }
  setLoading(true);
  try {
    var c = contributions.find(function(x) { return x.id === editContribId; });
    await fbPut('contributions', editContribId, { name:name, type:type, amount:amount, dueDay:dueDay, notes:notes, payment:payment, fromAccount:fromAccount, uid:c.uid });
    c.name=name; c.type=type; c.amount=amount; c.dueDay=dueDay; c.notes=notes; c.payment=payment; c.fromAccount=fromAccount;
    closeModal('editContribModal');
    renderContributions();
    toast('Contribution updated!');
  } catch(e) { console.error(e); toast('Failed.', 'error'); }
  finally { setLoading(false); }
}
function renderContributions() {
  var grid = document.getElementById('contribGrid');
  var total = contributions.reduce(function(s,c) { return s+(c.amount||0); }, 0);
  document.getElementById('contribTotal').textContent = fmt(total);
  if (!contributions.length) { grid.innerHTML='<div class="empty-state">No contributions yet.</div>'; return; }
  grid.innerHTML = contributions.map(function(c) {
    var fromName = '';
    if (c.fromAccount) {
      if (c.fromAccount.indexOf('card:') === 0) {
        var cardId = c.fromAccount.slice(5);
        var foundCard = cards.find(function(x) { return x.id === cardId; });
        fromName = foundCard ? foundCard.name : c.fromAccount;
      } else {
        var foundAcct = accounts.find(function(x) { return x.id === c.fromAccount; });
        fromName = foundAcct ? foundAcct.name : c.fromAccount;
      }
    }
    return (
    '<div class="contrib-card">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">' +
      '<div><strong>'+escHtml(c.name)+'</strong> <span style="font-size:.75rem;color:var(--purple);background:rgba(168,85,247,.15);padding:2px 8px;border-radius:20px">'+escHtml(c.type)+'</span></div>' +
      '<div style="display:flex;gap:4px">' +
        '<button class="icon-btn" onclick="payContrib(\''+c.id+'\')" title="Record payment" style="color:var(--green);border-color:var(--green)">&#x2714; Pay</button>' +
        '<button class="icon-btn" onclick="openEditContrib(\''+c.id+'\')" title="Edit">&#x270F;&#xFE0F;</button>' +
        '<button class="icon-btn del" onclick="deleteContribution(\''+c.id+'\')">&#x1F5D1;&#xFE0F;</button>' +
      '</div>' +
    '</div>' +
    '<div style="font-size:1.15rem;font-weight:700;color:var(--purple)">'+fmt(c.amount)+'<span style="font-size:.72rem;color:var(--text-muted);font-weight:400"> /mo</span></div>' +
    (c.dueDay !== undefined && c.dueDay !== '' ? '<div style="font-size:.78rem;color:var(--text-muted);margin-top:4px">Due: '+fmtDueDay(c.dueDay)+'</div>' : '') +
    (c.payment?'<div style="font-size:.78rem;color:var(--text-muted)">Payment: '+escHtml(c.payment)+(fromName?' &rsaquo; '+escHtml(fromName):'')+'</div>':'') +
    (c.notes?'<div style="font-size:.75rem;color:var(--text-muted);margin-top:4px">'+escHtml(c.notes)+'</div>':'') +
    '</div>'
  ); }).join('');
}

// ── GOALS ──
async function addGoal() {
  var name=v('gName').trim(), target=parseFloat(v('gTarget'))||0,
      accountId=v('gAccount'), notes=v('gNotes').trim();
  if (!name)   { toast('Goal name required.','error'); return; }
  if (!target) { toast('Target amount required.','error'); return; }
  setLoading(true);
  try {
    var id = await fbPost('goals', { name:name, target:target, accountId:accountId||'', notes:notes, uid:currentUser.uid });
    goals.push({ id:id, name:name, target:target, accountId:accountId||'', notes:notes, uid:currentUser.uid });
    renderGoals();
    ['gName','gTarget','gNotes'].forEach(function(i) { sv(i,''); });
    sv('gAccount','');
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
    // Use linked account balance as saved amount for progress bar
    var acct = g.accountId ? accounts.find(function(a) { return a.id === g.accountId; }) : null;
    var saved = acct ? (acct.balance || 0) : 0;
    var pct = g.target ? Math.min(100, (saved / g.target) * 100) : 0;
    var stillNeeded = Math.max(0, g.target - saved);
    var acctHtml = '';
    if (acct) {
      acctHtml =
        '<div style="margin-top:8px;padding:8px 10px;background:rgba(255,255,255,.04);border-radius:6px;font-size:.78rem">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:3px">' +
            '<span style="color:var(--text-muted)">&#x1F4B0; ' + escHtml(acct.name) + '</span>' +
            '<span style="color:var(--cyan)">' + fmt(saved) + ' available</span>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between">' +
            '<span style="color:var(--text-muted)">Still needed</span>' +
            '<span style="color:' + (stillNeeded === 0 ? 'var(--green)' : 'var(--orange)') + ';font-weight:600">' +
              (stillNeeded === 0 ? '&#x2714; Funded!' : fmt(stillNeeded) + ' more') +
            '</span>' +
          '</div>' +
        '</div>';
    }
    return (
      '<div class="goal-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div class="goal-name">'+escHtml(g.name)+'</div>' +
        '<button class="icon-btn del" onclick="deleteGoal(\''+g.id+'\')">&#x1F5D1;&#xFE0F;</button>' +
      '</div>' +
      '<div class="goal-bar-wrap"><div class="goal-bar" style="width:'+pct+'%"></div></div>' +
      '<div class="goal-meta">' +
        '<span>'+fmt(saved)+' saved</span>' +
        '<span>'+pct.toFixed(0)+'%</span>' +
        '<span>Goal: '+fmt(g.target)+'</span>' +
      '</div>' +
      acctHtml +
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
  lastTotalExpense = totalOut;
  document.getElementById('totalExpense').textContent = fmt(totalOut);

  var accountsRow = document.getElementById('accountsRow');
  var cardsRow    = document.getElementById('cardsRow');
  accountsRow.innerHTML = '';
  cardsRow.innerHTML    = '';

  var ACCENT_COLORS = ['var(--blue)','var(--green)','var(--cyan)','var(--yellow)','var(--purple, #a855f7)'];

  function makeCard(name, value, sublabel, color, tabTarget) {
    var div = document.createElement('div');
    div.className = 'card';
    div.style.setProperty('--card-accent', color);
    div.innerHTML =
      '<div class="label">' + name + '</div>' +
      '<div class="value" style="color:' + color + '">' + value + '</div>' +
      '<div class="sublabel">' + sublabel + '</div>';
    if (tabTarget) {
      div.style.cursor = 'pointer';
      div.title = 'Go to ' + tabTarget;
      div.addEventListener('click', function() {
        var tabSel = document.getElementById('tabSelect');
        if (tabSel) tabSel.value = tabTarget;
        switchTab(tabTarget);
      });
    }
    return div;
  }

  // Bank / wallet accounts row
  myAccounts.forEach(function(a) {
    var color = acctTypeColor(a.type);
    accountsRow.appendChild(makeCard(
      escHtml(a.name),
      fmt(a.balance||0),
      escHtml(a.type||'Account') + (a.notes ? ' \u00B7 ' + escHtml(a.notes) : ''),
      color,
      'accounts'
    ));
  });

  // Credit cards row — respect combine toggle
  var groups = {}, ungrouped = [];
  cards.forEach(function(c) {
    if (c.group) { if (!groups[c.group]) groups[c.group] = []; groups[c.group].push(c); }
    else ungrouped.push(c);
  });
  function appendCardSummary(name, balance, limit) {
    cardsRow.appendChild(makeCard(escHtml(name), fmt(balance), 'Limit: ' + fmt(limit), 'var(--orange)', 'cards'));
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
  renderNetWorth();
}

// ── REFRESH ALL ──
function populateGoalAccountSelect() {
  var sel = document.getElementById('gAccount');
  if (!sel) return;
  var current = sel.value;
  var memberAccounts = accounts.filter(function(a) {
    return a.members && currentUser && currentUser.uid && a.members[currentUser.uid];
  });
  sel.innerHTML = '<option value="">\u2014 None \u2014</option>' +
    memberAccounts.map(function(a) {
      return '<option value="'+escHtml(a.id)+'"'+(a.id===current?' selected':'')+'>'+escHtml(a.name)+(a.type?' ('+escHtml(a.type)+')':'')+'</option>';
    }).join('');
}
function refreshAll() {
  populateCategoryFilter();
  populateAccountFilter();
  populateDescDropdown();
  populateGoalAccountSelect();
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
  renderNetWorth();
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
        safeFbGet('incomeSources'), safeFbGet('healthItems'),
        safeFbGet('assets'), safeFbGet('liabilities')
      ]);
      transactions=results[0]; accounts=results[1];
      cards=filterByUid(results[2]); bills=filterByUid(results[3]);
      contributions=filterByUid(results[4]); goals=filterByUid(results[5]);
      incomeSources=filterByUid(results[6]); healthItems=filterByUid(results[7]);
      assets=filterByUid(results[8]); liabilities=filterByUid(results[9]);
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
    loadSavedDescs();
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
var editBillModal = document.getElementById('editBillModal');
if (editBillModal) {
  editBillModal.addEventListener('click', function(e) { if(e.target===this) closeModal('editBillModal'); });
}
var editAssetModal = document.getElementById('editAssetModal');
if (editAssetModal) {
  editAssetModal.addEventListener('click', function(e) { if(e.target===this) closeModal('editAssetModal'); });
}
var editLiabModal = document.getElementById('editLiabModal');
if (editLiabModal) {
  editLiabModal.addEventListener('click', function(e) { if(e.target===this) closeModal('editLiabModal'); });
}
var editCardModal = document.getElementById('editCardModal');
if (editCardModal) {
  editCardModal.addEventListener('click', function(e) { if(e.target===this) closeModal('editCardModal'); });
}
var editContribModal = document.getElementById('editContribModal');
if (editContribModal) {
  editContribModal.addEventListener('click', function(e) { if(e.target===this) closeModal('editContribModal'); });
}
document.addEventListener('keydown', function(e) { if(e.key==='Escape') { closeModal('editModal'); closeModal('editBillModal'); closeModal('editAssetModal'); closeModal('editLiabModal'); closeModal('editCardModal'); closeModal('editContribModal'); } });

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
