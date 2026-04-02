// ═══════════════════════════════════════════════════════════
// GOOGLE SHEETS BIDIRECTIONAL SYNC
// ═══════════════════════════════════════════════════════════
// App → Sheets: every write in the app mirrors to the sheet.
// Sheets → App: via an Apps Script trigger (generated here).
// Token storage: sessionStorage (expires with the tab session).
// ═══════════════════════════════════════════════════════════

// ── State ──
var sheetsAccessToken   = null;   // Google OAuth access token for Sheets API
var spreadsheetId       = null;   // User's linked spreadsheet ID
var sheetSyncEnabled    = false;  // true once linked + token present
var _tokenRefreshTimer  = null;   // setInterval handle

// ── Tab definitions: key = our collection name, name = sheet tab title ──
var SHEETS_TABS = {
  transactions:    { name: 'Transactions',       headers: ['ID','Date','Type','Category','Payment Method','From Account','Paid By','Description','Amount In','Amount Out','Account ID'] },
  accounts:        { name: 'Accounts',           headers: ['ID','Name','Type','Balance','Notes'] },
  cards:           { name: 'Credit Cards',       headers: ['ID','Name','Group','Limit','Balance','Due Day','Notes'] },
  bills:           { name: 'Monthly Bills',      headers: ['ID','Name','Category','Amount','Due Day','Payment','From Account','Notes'] },
  contributions:   { name: 'Gov Contributions',  headers: ['ID','Name','Type','Amount','Due Day','Payment','From Account','Notes'] },
  goals:           { name: 'Savings Goals',      headers: ['ID','Name','Target','Linked Account ID','Notes'] },
  incomeSources:   { name: 'Income Sources',     headers: ['ID','Name','Platform','Monthly Amount','Type','Notes'] },
  healthItems:     { name: 'Health & Insurance', headers: ['ID','Name','Type','Annual Premium','Last Paid','Renewal','Payment','Notes'] },
  members:         { name: 'Members',            headers: ['UID','Display Name','Email'] },
  assets:          { name: 'Assets',             headers: ['ID','Name','Type','Value','Notes'] },
  liabilities:     { name: 'Liabilities',        headers: ['ID','Name','Type','Balance Owed','Notes'] },
};

// ── Map data item → flat row array ──
function itemToRow(collKey, item) {
  switch (collKey) {
    case 'transactions':
      return [item.id||'', item.date||'', item.type||'', item.category||'', item.payment||'',
              item.fromAccount||'', item.paidBy||'', item.desc||'',
              item.amountIn||0, item.amountOut||0, item.accountId||''];
    case 'accounts':
      return [item.id||'', item.name||'', item.type||'', item.balance||0, item.notes||''];
    case 'cards':
      return [item.id||'', item.name||'', item.group||'', item.limit||0,
              item.balance||0, item.dueDay!==undefined?item.dueDay:'', item.notes||''];
    case 'bills':
      return [item.id||'', item.name||'', item.category||'', item.amount||0,
              item.dueDay!==undefined?item.dueDay:'', item.payment||'',
              item.fromAccount||'', item.notes||''];
    case 'contributions':
      return [item.id||'', item.name||'', item.type||'', item.amount||0,
              item.dueDay!==undefined?item.dueDay:'', item.payment||'',
              item.fromAccount||'', item.notes||''];
    case 'goals':
      return [item.id||'', item.name||'', item.target||0, item.accountId||'', item.notes||''];
    case 'incomeSources':
      return [item.id||'', item.name||'', item.platform||'', item.amount||0, item.type||'', item.notes||''];
    case 'healthItems':
      return [item.id||'', item.name||'', item.type||'', item.premium||0,
              item.lastPaid||'', item.renewal||'', item.payment||'', item.notes||''];
    case 'assets':
      return [item.id||'', item.name||'', item.type||'', item.value||0, item.notes||''];
    case 'liabilities':
      return [item.id||'', item.name||'', item.type||'', item.balance||0, item.notes||''];
    default: return [];
  }
}

// ── Sheets REST API helpers ──
function sheetsBase(sheetId) {
  return 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId;
}
function sheetsAuthHeader() {
  return { 'Authorization': 'Bearer ' + sheetsAccessToken };
}

async function sheetsGetMeta(sheetId) {
  var res = await fetch(sheetsBase(sheetId) + '?fields=sheets.properties',
    { headers: sheetsAuthHeader() });
  if (!res.ok) {
    var e = await res.json().catch(function() { return {}; });
    throw new Error((e.error && e.error.message) || ('Cannot read spreadsheet: HTTP ' + res.status));
  }
  return res.json();
}

async function sheetsGetRange(sheetId, range) {
  var url = sheetsBase(sheetId) + '/values/' + encodeURIComponent(range);
  var res = await fetch(url, { headers: sheetsAuthHeader() });
  if (!res.ok) {
    var e = await res.json().catch(function() { return {}; });
    throw new Error((e.error && e.error.message) || 'GET range failed: ' + res.status);
  }
  return res.json();
}

async function sheetsUpdateRange(sheetId, range, values) {
  var url = sheetsBase(sheetId) + '/values/' + encodeURIComponent(range)
          + '?valueInputOption=USER_ENTERED';
  var res = await fetch(url, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, sheetsAuthHeader()),
    body: JSON.stringify({ range: range, majorDimension: 'ROWS', values: values })
  });
  if (!res.ok) {
    var e = await res.json().catch(function() { return {}; });
    throw new Error((e.error && e.error.message) || 'PUT range failed: ' + res.status);
  }
  return res.json();
}

async function sheetsClearRange(sheetId, range) {
  var url = sheetsBase(sheetId) + '/values/' + encodeURIComponent(range) + ':clear';
  var res = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, sheetsAuthHeader()),
    body: JSON.stringify({})
  });
  if (!res.ok) {
    var e = await res.json().catch(function() { return {}; });
    throw new Error((e.error && e.error.message) || 'Clear failed: ' + res.status);
  }
}

async function sheetsAppendRows(sheetId, tabName, rows) {
  var range = "'" + tabName + "'!A:A";
  var url = sheetsBase(sheetId) + '/values/' + encodeURIComponent(range)
          + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
  var res = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, sheetsAuthHeader()),
    body: JSON.stringify({ majorDimension: 'ROWS', values: rows })
  });
  if (!res.ok) {
    var e = await res.json().catch(function() { return {}; });
    throw new Error((e.error && e.error.message) || 'Append failed: ' + res.status);
  }
  return res.json();
}

async function sheetsBatchUpdate(sheetId, requests) {
  var url = sheetsBase(sheetId) + ':batchUpdate';
  var res = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, sheetsAuthHeader()),
    body: JSON.stringify({ requests: requests })
  });
  if (!res.ok) {
    var e = await res.json().catch(function() { return {}; });
    throw new Error((e.error && e.error.message) || 'batchUpdate failed: ' + res.status);
  }
  return res.json();
}

// ── Tab setup ──
async function ensureSheetTabs(sheetId) {
  var meta = await sheetsGetMeta(sheetId);
  var existing = (meta.sheets || []).map(function(s) { return s.properties.title; });

  // Build list of all tabs we need (data tabs + _settings)
  var needed = Object.values(SHEETS_TABS).map(function(t) { return t.name; });
  needed.push('_settings');

  var toCreate = needed.filter(function(t) { return existing.indexOf(t) === -1; });
  if (toCreate.length) {
    var addReqs = toCreate.map(function(title) {
      return { addSheet: { properties: { title: title } } };
    });
    await sheetsBatchUpdate(sheetId, addReqs);
  }

  // Write / overwrite headers on each data tab (row 1)
  for (var key in SHEETS_TABS) {
    var tab = SHEETS_TABS[key];
    var headerRange = "'" + tab.name + "'!A1:" + colLetter(tab.headers.length) + '1';
    await sheetsUpdateRange(sheetId, headerRange, [tab.headers]);
  }

  // Hide _settings tab by making it very small / hiding it
  try {
    var freshMeta = await sheetsGetMeta(sheetId);
    var settingsSheet = (freshMeta.sheets || []).find(function(s) {
      return s.properties.title === '_settings';
    });
    if (settingsSheet) {
      await sheetsBatchUpdate(sheetId, [{
        updateSheetProperties: {
          properties: {
            sheetId: settingsSheet.properties.sheetId,
            hidden: true
          },
          fields: 'hidden'
        }
      }]);
    }
  } catch(e) { /* non-critical */ }

  // Apply dropdown validation to key columns
  try {
    await applySheetValidation(sheetId);
  } catch(e) { console.warn('[Sheets] Validation setup failed (non-critical):', e.message); }
}

// ── Data validation (dropdowns) for key columns ──
var SHEET_VALIDATION = {
  // Transactions tab
  'Transactions': [
    { col: 3, values: ['Income','Expense'] },                                               // Type
    { col: 4, values: ['Salary','Freelance','Business','Investment','Interest Gained','Gift','Refund','Other Income',
                       'Food & Dining','Bills & Utilities','Transportation','Shopping','Entertainment',
                       'Health & Medical','Education','Rent','Groceries','Government','Gov Contribution',
                       'Subscriptions','Debt Payment','Interest Withheld','Other Expense'] }, // Category
    { col: 5, values: ['Cash','Credit Card','GCash','GrabPay','Bank Transfer','Other'] },   // Payment Method
  ],
  // Accounts tab
  'Accounts': [
    { col: 3, values: ['Bank Account','E-Wallet','Cash on Hand','Savings','Investment','Other'] }, // Type
  ],
  // Credit Cards tab — no strict dropdowns needed
  // Monthly Bills tab
  'Monthly Bills': [
    { col: 3, values: ['Utilities','Internet','Water','Rent','Loan / Installment','Subscription','Other'] }, // Category
    { col: 6, values: ['Cash','Credit Card','GCash','GrabPay','Bank Transfer','Other'] },   // Payment
  ],
  // Gov Contributions tab
  'Gov Contributions': [
    { col: 3, values: ['SSS','PhilHealth','Pag-IBIG','MP2','Other'] },                      // Type
    { col: 6, values: ['Cash','Credit Card','GCash','GrabPay','Bank Transfer','Other'] },   // Payment
  ],
  // Income Sources tab
  'Income Sources': [
    { col: 5, values: ['Full-time','Part-time','Freelance','Business','Passive','Other'] }, // Type
  ],
  // Health & Insurance tab
  'Health & Insurance': [
    { col: 3, values: ['Medicaid','HMO','Life Insurance','Health Insurance','Dental','Other'] }, // Type
    { col: 7, values: ['Cash','Credit Card','GCash','GrabPay','Bank Transfer','Other'] },   // Payment
  ],
  // Assets tab
  'Assets': [
    { col: 3, values: ['Cash / Bank','Real Estate','Vehicle','Investment','Personal Property','Other'] }, // Type
  ],
  // Liabilities tab
  'Liabilities': [
    { col: 3, values: ['Home Loan / Mortgage','Car Loan','Personal Loan','Credit Card Debt','Other'] }, // Type
  ],
};

function makeDropdownRequest(sheetId, startRowIndex, colIndex, values) {
  return {
    setDataValidation: {
      range: {
        sheetId:          sheetId,
        startRowIndex:    startRowIndex,  // 0-based, row after header
        endRowIndex:      1000,
        startColumnIndex: colIndex - 1,   // 0-based
        endColumnIndex:   colIndex
      },
      rule: {
        condition: {
          type:   'ONE_OF_LIST',
          values: values.map(function(v) { return { userEnteredValue: v }; })
        },
        showCustomUi: true,
        strict:       false   // allow typing custom values not in the list
      }
    }
  };
}

async function applySheetValidation(sheetId) {
  var meta = await sheetsGetMeta(sheetId);
  var sheetMap = {};
  (meta.sheets || []).forEach(function(s) {
    sheetMap[s.properties.title] = s.properties.sheetId;
  });

  var requests = [];
  Object.keys(SHEET_VALIDATION).forEach(function(tabName) {
    var numericSheetId = sheetMap[tabName];
    if (numericSheetId === undefined) return;
    SHEET_VALIDATION[tabName].forEach(function(rule) {
      requests.push(makeDropdownRequest(numericSheetId, 1, rule.col, rule.values));
    });
  });

  if (requests.length) {
    await sheetsBatchUpdate(sheetId, requests);
  }
}

// Helper: convert column index (1-based) to letter(s): 1→A, 26→Z, 27→AA
function colLetter(n) {
  var s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// ── Full sync: write all in-memory collections to the sheet ──
async function fullSyncToSheets() {
  if (!sheetSyncEnabled || !spreadsheetId) return;

  var collectionMap = {
    transactions:  typeof transactions  !== 'undefined' ? transactions  : [],
    accounts:      typeof accounts      !== 'undefined' ? accounts      : [],
    cards:         typeof cards         !== 'undefined' ? cards         : [],
    bills:         typeof bills         !== 'undefined' ? bills         : [],
    contributions: typeof contributions !== 'undefined' ? contributions : [],
    goals:         typeof goals         !== 'undefined' ? goals         : [],
    incomeSources: typeof incomeSources !== 'undefined' ? incomeSources : [],
    healthItems:   typeof healthItems   !== 'undefined' ? healthItems   : [],
    assets:        typeof assets        !== 'undefined' ? assets        : [],
    liabilities:   typeof liabilities   !== 'undefined' ? liabilities   : [],
  };

  for (var key in SHEETS_TABS) {
    if (key === 'members') continue; // handled separately
    var tab = SHEETS_TABS[key];
    var items = collectionMap[key] || [];
    var rows = [tab.headers];
    items.forEach(function(item) { rows.push(itemToRow(key, item)); });

    // Clear old data then write fresh (avoids stale rows below new data)
    var clearRange = "'" + tab.name + "'!A:Z";
    await sheetsClearRange(spreadsheetId, clearRange);
    if (rows.length) {
      var writeRange = "'" + tab.name + "'!A1";
      await sheetsUpdateRange(spreadsheetId, writeRange, rows);
    }
  }

  await syncMembersToSheet();
  await updateSheetSettings();

  // Apply dynamic dropdowns (account names, member names, saved descs) after data is written
  try {
    await applyDynamicValidation(spreadsheetId);
  } catch(e) { console.warn('[Sheets] Dynamic validation failed (non-critical):', e.message); }
}

// Write Members tab
async function syncMembersToSheet() {
  if (!sheetSyncEnabled || !spreadsheetId) return;
  var tab = SHEETS_TABS.members;
  var rows = [tab.headers];
  var seen = {};
  var accs = typeof accounts !== 'undefined' ? accounts : [];
  accs.forEach(function(a) {
    if (a.members) {
      Object.keys(a.members).forEach(function(uid) {
        if (!seen[uid]) {
          seen[uid] = true;
          var u = (typeof usersCache !== 'undefined' && usersCache[uid]) || {};
          rows.push([uid, u.displayName || '', u.email || '']);
        }
      });
    }
  });
  var clearRange = "'" + tab.name + "'!A:Z";
  await sheetsClearRange(spreadsheetId, clearRange);
  await sheetsUpdateRange(spreadsheetId, "'" + tab.name + "'!A1", rows);
}

// Write Firebase token + metadata to _settings tab (read by Apps Script)
async function updateSheetSettings() {
  if (!sheetSyncEnabled || !spreadsheetId) return;
  if (typeof currentUser === 'undefined' || !currentUser) return;
  try {
    var token = await (typeof getToken === 'function' ? getToken() : Promise.reject('no getToken'));
    var values = [
      ['firebase_token', token],
      ['user_uid',       currentUser.uid],
      ['database_url',   typeof BASE !== 'undefined' ? BASE : ''],
      ['last_updated',   new Date().toISOString()],
    ];
    await sheetsUpdateRange(spreadsheetId, "'_settings'!A1:B4", values);
  } catch(e) {
    console.warn('[Sheets] Could not update _settings:', e.message);
  }
}

// ── Dynamic validation: populate dropdowns from live data ──
// Called after every fullSyncToSheets so account/member/desc lists stay current.
async function applyDynamicValidation(sheetId) {
  var meta = await sheetsGetMeta(sheetId);
  var sheetMap = {};
  (meta.sheets || []).forEach(function(s) {
    sheetMap[s.properties.title] = s.properties.sheetId;
  });

  var txSheetId   = sheetMap['Transactions'];
  var goalSheetId = sheetMap['Savings Goals'];
  if (txSheetId === undefined) return;

  // Collect live data
  var accs     = typeof accounts      !== 'undefined' ? accounts      : [];
  var ucache   = typeof usersCache    !== 'undefined' ? usersCache    : {};
  var descs    = (typeof getSavedDescs === 'function') ? getSavedDescs() : [];

  // Account names (for "From Account" col 6 in Transactions and "From Account" cols in Bills/Contribs)
  var accountNames = accs
    .filter(function(a) {
      return a.members && typeof currentUser !== 'undefined' && currentUser && a.members[currentUser.uid];
    })
    .map(function(a) { return a.name; })
    .filter(Boolean);

  // Credit card names prefixed so user can pick them too
  var cds = typeof cards !== 'undefined' ? cards : [];
  var cardNames = cds.map(function(c) { return c.name + (c.group ? ' (' + c.group + ')' : ''); });

  var fromAccountOptions = accountNames.concat(cardNames);

  // Member display names (for "Paid By" col 7 in Transactions)
  var memberNames = [];
  var seen = {};
  accs.forEach(function(a) {
    if (!a.members) return;
    Object.keys(a.members).forEach(function(uid) {
      if (seen[uid]) return;
      seen[uid] = true;
      var u = ucache[uid];
      if (u) memberNames.push(u.displayName || u.email || uid);
    });
  });

  // Saved descriptions (for "Description" col 8 in Transactions)
  var descOptions = descs.slice(0, 200); // Sheets validation max ~500 chars total

  var requests = [];

  // Helper: wrap makeDropdownRequest with a guard for empty lists
  function addValidation(numericSheetId, col, values) {
    if (!values.length) return;
    requests.push(makeDropdownRequest(numericSheetId, 1, col, values));
  }

  // Transactions tab
  if (txSheetId !== undefined) {
    addValidation(txSheetId, 6, fromAccountOptions);     // From Account
    addValidation(txSheetId, 7, memberNames);            // Paid By
    if (descOptions.length) {
      addValidation(txSheetId, 8, descOptions);          // Description (saved descs)
    }
  }

  // Savings Goals: Linked Account ID col 4 → use "Name (ID)" format so user picks by name
  if (goalSheetId !== undefined && accountNames.length) {
    addValidation(goalSheetId, 4, accountNames);         // Linked Account (by name for readability)
  }

  // Monthly Bills & Gov Contributions: From Account col 7
  ['Monthly Bills', 'Gov Contributions'].forEach(function(tabName) {
    var sid = sheetMap[tabName];
    if (sid !== undefined) addValidation(sid, 7, fromAccountOptions);
  });

  if (requests.length) {
    await sheetsBatchUpdate(sheetId, requests);
  }
}

// ── Incremental sync: one item at a time ──
// collKey = key in SHEETS_TABS, item = object with .id, isDelete = bool
async function syncItemToSheet(collKey, item, isDelete) {
  if (!sheetSyncEnabled || !spreadsheetId) return;
  if (!SHEETS_TABS[collKey]) return;
  if (!item || !item.id) return;

  var tab = SHEETS_TABS[collKey];
  try {
    // Read col A to find existing row
    var result = await sheetsGetRange(spreadsheetId, "'" + tab.name + "'!A:A");
    var colA = (result.values || []);

    var foundRow = -1;
    for (var i = 1; i < colA.length; i++) { // row 1 is header
      if (colA[i] && colA[i][0] === item.id) {
        foundRow = i + 1; // 1-based sheet row number
        break;
      }
    }

    if (isDelete) {
      if (foundRow > 1) {
        // Get the sheet's numeric sheetId for batchUpdate
        var meta = await sheetsGetMeta(spreadsheetId);
        var sheet = (meta.sheets || []).find(function(s) {
          return s.properties.title === tab.name;
        });
        if (sheet) {
          await sheetsBatchUpdate(spreadsheetId, [{
            deleteDimension: {
              range: {
                sheetId:    sheet.properties.sheetId,
                dimension:  'ROWS',
                startIndex: foundRow - 1,   // 0-based
                endIndex:   foundRow        // exclusive
              }
            }
          }]);
        }
      }
    } else if (foundRow > 1) {
      // Update existing row in-place
      var row = itemToRow(collKey, item);
      var range = "'" + tab.name + "'!A" + foundRow + ':' + colLetter(row.length) + foundRow;
      await sheetsUpdateRange(spreadsheetId, range, [row]);
    } else {
      // Append as new row
      var newRow = itemToRow(collKey, item);
      await sheetsAppendRows(spreadsheetId, tab.name, [newRow]);
    }
  } catch(e) {
    console.warn('[Sheets] syncItemToSheet failed for', collKey, ':', e.message);
  }
}

// ── OAuth: acquire Sheets scope ──
async function acquireSheetsToken() {
  try {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/spreadsheets');
    // reauthenticateWithPopup gets credentialledwith Sheets scope
    var result = await auth.currentUser.reauthenticateWithPopup(provider);
    sheetsAccessToken = result.credential.accessToken;
    sessionStorage.setItem('et_sheets_token', sheetsAccessToken);
    return true;
  } catch(e) {
    console.error('[Sheets] OAuth failed:', e.code, e.message);
    return false;
  }
}

// ── Link modal UI ──
function openLinkSheetModal() {
  var modal = document.getElementById('linkSheetModal');
  if (!modal) return;
  document.getElementById('sheetLinkError').textContent = '';
  if (spreadsheetId) {
    document.getElementById('sheetIdInput').value = spreadsheetId;
    document.getElementById('sheetLinkedActions').classList.remove('hidden');
    document.getElementById('sheetLinkStatus').textContent = 'Linked & syncing';
    document.getElementById('sheetLinkStatus').style.color  = 'var(--green)';
  } else {
    document.getElementById('sheetIdInput').value = '';
    document.getElementById('sheetLinkedActions').classList.add('hidden');
    document.getElementById('sheetLinkStatus').textContent = 'Not linked';
    document.getElementById('sheetLinkStatus').style.color  = 'var(--text-muted)';
  }
  modal.classList.remove('hidden');
}

// Parse spreadsheet ID from a URL or raw ID
function extractSpreadsheetId(input) {
  input = (input || '').trim();
  var m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input;
  return null;
}

async function doLinkSpreadsheet() {
  var raw    = document.getElementById('sheetIdInput').value;
  var errEl  = document.getElementById('sheetLinkError');
  var linkBtn = document.getElementById('sheetLinkBtn');
  errEl.textContent = '';

  var sheetId = extractSpreadsheetId(raw);
  if (!sheetId) {
    errEl.textContent = 'Enter a valid Google Sheets URL or spreadsheet ID.';
    return;
  }

  // Acquire Sheets OAuth scope if we don't have a token
  if (!sheetsAccessToken) {
    linkBtn.disabled = true;
    linkBtn.textContent = 'Authorizing…';
    var ok = await acquireSheetsToken();
    linkBtn.disabled = false;
    linkBtn.textContent = 'Link & Sync';
    if (!ok) {
      errEl.textContent = 'Google Sheets permission denied. Please try again.';
      return;
    }
  }

  linkBtn.disabled = true;
  linkBtn.textContent = 'Setting up…';
  if (typeof setLoading === 'function') setLoading(true);
  try {
    // Verify access
    await sheetsGetMeta(sheetId);
    // Create/verify tabs + headers
    await ensureSheetTabs(sheetId);

    // Persist sheetId to Firebase user profile
    var token = await getToken();
    await fetch(BASE + '/users/' + currentUser.uid + '/sheetId.json?auth=' + token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sheetId)
    });

    spreadsheetId   = sheetId;
    sheetSyncEnabled = true;
    sessionStorage.setItem('et_sheets_token', sheetsAccessToken);

    // Full sync + start auto-refresh
    await fullSyncToSheets();
    startTokenRefreshTimer();
    renderSheetStatusBtn();

    document.getElementById('linkSheetModal').classList.add('hidden');
    if (typeof toast === 'function') toast('Google Sheet linked and synced!');
  } catch(e) {
    console.error('[Sheets] Link failed:', e);
    errEl.textContent = 'Failed: ' + e.message;
  } finally {
    linkBtn.disabled = false;
    linkBtn.textContent = 'Link & Sync';
    if (typeof setLoading === 'function') setLoading(false);
  }
}

async function unlinkSpreadsheet() {
  if (!confirm('Unlink this spreadsheet? The app will stop syncing, but your existing sheet data stays.')) return;
  try {
    var token = await getToken();
    await fetch(BASE + '/users/' + currentUser.uid + '/sheetId.json?auth=' + token,
      { method: 'DELETE' });
  } catch(e) { /* ignore */ }
  spreadsheetId   = null;
  sheetSyncEnabled = false;
  sheetsAccessToken = null;
  sessionStorage.removeItem('et_sheets_token');
  clearInterval(_tokenRefreshTimer);
  renderSheetStatusBtn();
  document.getElementById('linkSheetModal').classList.add('hidden');
  if (typeof toast === 'function') toast('Spreadsheet unlinked.', 'error');
}

async function forceFullSync() {
  if (!spreadsheetId) {
    if (typeof toast === 'function') toast('No spreadsheet linked.', 'error');
    return;
  }
  if (!sheetsAccessToken) {
    var ok = await acquireSheetsToken();
    if (!ok) { if (typeof toast === 'function') toast('Sheets authorization required.', 'error'); return; }
    sheetSyncEnabled = true;
  }
  if (typeof setLoading === 'function') setLoading(true);
  try {
    await fullSyncToSheets();
    if (typeof toast === 'function') toast('Spreadsheet fully synced!');
  } catch(e) {
    if (typeof toast === 'function') toast('Sync failed: ' + e.message, 'error');
  } finally {
    if (typeof setLoading === 'function') setLoading(false);
  }
}

function openSpreadsheetTab() {
  if (spreadsheetId) {
    window.open('https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit', '_blank');
  }
}

// ── Token auto-refresh (keep _settings fresh for Apps Script) ──
function startTokenRefreshTimer() {
  clearInterval(_tokenRefreshTimer);
  // Refresh the token written to the sheet every 50 minutes
  _tokenRefreshTimer = setInterval(function() {
    if (sheetSyncEnabled && spreadsheetId) {
      updateSheetSettings().catch(function(e) {
        console.warn('[Sheets] Token refresh failed:', e.message);
      });
    }
  }, 50 * 60 * 1000);
}

// Update the profile dropdown button to reflect sync status
function renderSheetStatusBtn() {
  var btn = document.getElementById('sheetStatusBtn');
  if (!btn) return;
  if (sheetSyncEnabled && spreadsheetId) {
    btn.innerHTML = '&#x1F4CA; Google Sheets <span class="sheet-sync-dot active"></span>';
  } else {
    btn.innerHTML = '&#x1F4CA; Google Sheets <span class="sheet-sync-dot"></span>';
  }
}

// ── Load sheet settings on startup (called from app.js auth handler) ──
async function loadSheetSettings() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  try {
    var token = await getToken();
    var res = await fetch(BASE + '/users/' + currentUser.uid + '/sheetId.json?auth=' + token);
    if (!res.ok) return;
    var id = await res.json();
    if (id && typeof id === 'string' && id.length > 10) {
      spreadsheetId = id;
      // Restore access token from session (valid for ~1 hr)
      var saved = sessionStorage.getItem('et_sheets_token');
      if (saved) {
        sheetsAccessToken = saved;
        sheetSyncEnabled  = true;
        renderSheetStatusBtn();
        // Refresh token in sheet so Apps Script has a fresh one
        updateSheetSettings().catch(function() {});
        startTokenRefreshTimer();
      } else {
        // Sheet is linked but token not in session – show indicator but not enabled
        sheetSyncEnabled = false;
        renderSheetStatusBtn();
      }
    }
  } catch(e) {
    console.warn('[Sheets] Could not load sheet settings:', e.message);
  }
}

// ── Apps Script code generator ──
function showAppsScriptModal() {
  var code = generateAppsScriptCode();
  document.getElementById('appsScriptCodeBlock').textContent = code;
  document.getElementById('appsScriptModal').classList.remove('hidden');
}

function copyAppsScriptCode() {
  var code = document.getElementById('appsScriptCodeBlock').textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(function() {
      if (typeof toast === 'function') toast('Apps Script code copied!');
    }).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
  function fallbackCopy() {
    var ta = document.createElement('textarea');
    ta.value = code;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (typeof toast === 'function') toast('Apps Script code copied!');
  }
}

function generateAppsScriptCode() {
  var dbUrl  = (typeof BASE !== 'undefined' ? BASE : 'YOUR_FIREBASE_DATABASE_URL');
  var uid    = (typeof currentUser !== 'undefined' && currentUser ? currentUser.uid : 'YOUR_USER_UID');

  return [
'/**',
' * Earnings Tracker — Google Sheets ↔ Firebase Sync',
' *',
' * HOW TO INSTALL (one-time setup):',
' * 1. In your Google Sheet, click: Extensions > Apps Script',
' * 2. Delete all default code, paste this entire script, and Save (Ctrl+S).',
' * 3. Click Run > "setupTrigger" ONCE to install the edit trigger.',
' *    Grant the permissions Google asks for.',
' * 4. Done! Edits made in the sheet will now sync to Firebase.',
' *',
' * NOTES:',
' * • Keep the Earnings Tracker web app open so it keeps the auth',
' *   token fresh in the hidden _settings tab (auto-refreshes every 50 min).',
' * • Col A of every data tab holds the Firebase record ID — do not edit it.',
' * • Members tab is read-only (managed by the app).',
' * • For Accounts: member/permissions data is preserved (PATCH used).',
' */',
'',
'var FIREBASE_URL = "' + dbUrl + '";',
'var USER_UID     = "' + uid + '";',
'',
'var TAB_PATHS = {',
'  "Transactions":       "transactions",',
'  "Accounts":           "accounts",',
'  "Credit Cards":       "cards",',
'  "Monthly Bills":      "bills",',
'  "Gov Contributions":  "contributions",',
'  "Savings Goals":      "goals",',
'  "Income Sources":     "incomeSources",',
'  "Health & Insurance": "healthItems",',
'  "Assets":             "assets",',
'  "Liabilities":        "liabilities"',
'};',
'',
'var FIELD_MAPS = {',
'  "Transactions":       ["id","date","type","category","payment","fromAccount","paidBy","desc","amountIn","amountOut","accountId"],',
'  "Accounts":           ["id","name","type","balance","notes"],',
'  "Credit Cards":       ["id","name","group","limit","balance","dueDay","notes"],',
'  "Monthly Bills":      ["id","name","category","amount","dueDay","payment","fromAccount","notes"],',
'  "Gov Contributions":  ["id","name","type","amount","dueDay","payment","fromAccount","notes"],',
'  "Savings Goals":      ["id","name","target","accountId","notes"],',
'  "Income Sources":     ["id","name","platform","amount","type","notes"],',
'  "Health & Insurance": ["id","name","type","premium","lastPaid","renewal","payment","notes"],',
'  "Assets":             ["id","name","type","value","notes"],',
'  "Liabilities":        ["id","name","type","balance","notes"]',
'};',
'',
'var NUMERIC_FIELDS = ["balance","amount","amountIn","amountOut","limit","value","target","premium"];',
'',
'// Called once: sets up the onEdit trigger',
'function setupTrigger() {',
'  var ss = SpreadsheetApp.getActiveSpreadsheet();',
'  var triggers = ScriptApp.getProjectTriggers();',
'  for (var i = 0; i < triggers.length; i++) {',
'    if (triggers[i].getHandlerFunction() === "onSheetEdit") {',
'      ScriptApp.deleteTrigger(triggers[i]);',
'    }',
'  }',
'  ScriptApp.newTrigger("onSheetEdit")',
'    .forSpreadsheet(ss)',
'    .onEdit()',
'    .create();',
'  Logger.log("Trigger installed.");',
'}',
'',
'// Read the Firebase auth token from the hidden _settings tab',
'function getFirebaseToken() {',
'  var ss = SpreadsheetApp.getActiveSpreadsheet();',
'  var settings = ss.getSheetByName("_settings");',
'  if (!settings) return null;',
'  var rows = settings.getDataRange().getValues();',
'  for (var i = 0; i < rows.length; i++) {',
'    if (rows[i][0] === "firebase_token") return String(rows[i][1]);',
'  }',
'  return null;',
'}',
'',
'// Main edit handler — fires on every cell edit',
'function onSheetEdit(e) {',
'  try {',
'    var sheet     = e.range.getSheet();',
'    var sheetName = sheet.getName();',
'    var editedRow = e.range.getRow();',
'',
'    // Skip non-data tabs and header row',
'    if (!TAB_PATHS[sheetName] || editedRow <= 1) return;',
'',
'    var path   = TAB_PATHS[sheetName];',
'    var fields = FIELD_MAPS[sheetName];',
'    var numCols = fields.length;',
'',
'    // Read the full edited row',
'    var values = sheet.getRange(editedRow, 1, 1, numCols).getValues()[0];',
'    var fbId   = String(values[0] || "").trim();',
'',
'    // Detect if the row is effectively empty (to trigger delete)',
'    var allEmpty = values.slice(1).every(function(v) {',
'      return v === "" || v === null || v === undefined;',
'    });',
'',
'    var token = getFirebaseToken();',
'    if (!token) {',
'      Logger.log("No Firebase token — open the web app to refresh.");',
'      return;',
'    }',
'',
'    // ── DELETE: row cleared after having an ID ──',
'    if (allEmpty && fbId) {',
'      var delUrl = FIREBASE_URL + "/" + path + "/" + fbId + ".json?auth=" + token;',
'      UrlFetchApp.fetch(delUrl, { method: "DELETE", muteHttpExceptions: true });',
'      sheet.getRange(editedRow, 1).clearContent();',
'      Logger.log("Deleted " + path + "/" + fbId);',
'      return;',
'    }',
'',
'    // Build the object from the row data',
'    var obj = {};',
'    for (var fi = 0; fi < fields.length; fi++) {',
'      var field = fields[fi];',
'      if (field === "id") continue;',
'      var val = values[fi];',
'      if (NUMERIC_FIELDS.indexOf(field) !== -1) {',
'        val = parseFloat(val) || 0;',
'      } else {',
'        val = val === null || val === undefined ? "" : String(val);',
'      }',
'      obj[field] = val;',
'    }',
'',
'    // Accounts MUST keep their members node — use PATCH',
'    var isAccount = (sheetName === "Accounts");',
'',
'    // ── UPDATE: existing row with a Firebase ID ──',
'    if (fbId) {',
'      var baseUrl = FIREBASE_URL + "/" + path + "/" + fbId + ".json?auth=" + token;',
'      if (isAccount) {',
'        // PATCH preserves nested fields (members, etc.) not visible in the sheet',
'        UrlFetchApp.fetch(baseUrl, {',
'          method: "PATCH",',
'          contentType: "application/json",',
'          payload: JSON.stringify(obj),',
'          muteHttpExceptions: true',
'        });',
'      } else {',
'        obj.uid = USER_UID;',
'        UrlFetchApp.fetch(baseUrl, {',
'          method: "PUT",',
'          contentType: "application/json",',
'          payload: JSON.stringify(obj),',
'          muteHttpExceptions: true',
'        });',
'      }',
'      Logger.log("Updated " + path + "/" + fbId);',
'      return;',
'    }',
'',
'    // ── CREATE: new row with no Firebase ID ──',
'    if (!allEmpty) {',
'      if (!isAccount) obj.uid = USER_UID;',
'      var postUrl = FIREBASE_URL + "/" + path + ".json?auth=" + token;',
'      var response = UrlFetchApp.fetch(postUrl, {',
'        method: "POST",',
'        contentType: "application/json",',
'        payload: JSON.stringify(obj),',
'        muteHttpExceptions: true',
'      });',
'      var newId = JSON.parse(response.getContentText()).name;',
'      if (newId) {',
'        // Write the new Firebase ID back to col A',
'        sheet.getRange(editedRow, 1).setValue(newId);',
'      }',
'      Logger.log("Created " + path + "/" + newId);',
'    }',
'  } catch(err) {',
'    Logger.log("onSheetEdit error: " + err);',
'  }',
'}',
  ].join('\n');
}
