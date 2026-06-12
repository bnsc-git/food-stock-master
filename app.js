/* ====================================================
   Food Stock Master — app.js
==================================================== */

// ---- State ----
let STATE = {
  inventory: [],
  shoppingList: [],
  customRecipes: [],
  consumptionHistory: []
};

let nutritionChart = null;
let ingRowCounter = 0;
const inventorySelected = new Set();

// ---- Affiliate / Monetization Config ----
// ▼ ここに各サービスのIDを設定してください
const AFFILIATE = {
  amazonTag:  'bnscafil-22',             // AmazonアソシエイトのトラッキングID
  kofi:       'YOUR_KOFI_USERNAME',      // Ko-fiのユーザー名
  paypay:     'YOUR_PAYPAY_URL',         // PayPay.meのURL（例: https://paypay.ne.jp/qr/XXXX）
};

// ---- LocalStorage ----
function loadState() {
  STATE.inventory         = JSON.parse(localStorage.getItem('fsm_inventory') || '[]');
  STATE.shoppingList      = JSON.parse(localStorage.getItem('fsm_shopping')  || '[]');
  STATE.customRecipes     = JSON.parse(localStorage.getItem('fsm_recipes')   || '[]');
  STATE.consumptionHistory= JSON.parse(localStorage.getItem('fsm_history')   || '[]');
}

function persist() {
  autoCleanup();
  localStorage.setItem('fsm_inventory', JSON.stringify(STATE.inventory));
  localStorage.setItem('fsm_shopping',  JSON.stringify(STATE.shoppingList));
  localStorage.setItem('fsm_recipes',   JSON.stringify(STATE.customRecipes));
  localStorage.setItem('fsm_history',   JSON.stringify(STATE.consumptionHistory));
}

// Remove zero-quantity duplicates (keep latest 1 per name)
function autoCleanup() {
  const grouped = {};
  STATE.inventory.forEach(item => {
    if (!grouped[item.name]) grouped[item.name] = [];
    grouped[item.name].push(item);
  });

  const result = [];
  Object.values(grouped).forEach(items => {
    const nonZero = items.filter(i => i.quantity > 0);
    if (nonZero.length > 0) {
      result.push(...nonZero);
    } else {
      // Keep only the most recently registered record
      const latest = [...items].sort(
        (a, b) => new Date(b.registered_at) - new Date(a.registered_at)
      )[0];
      result.push({ ...latest, quantity: 0 });
    }
  });

  STATE.inventory = result;
}

// ---- Utilities ----
function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysLeft(expiryDateStr) {
  const now = new Date(); now.setHours(0,0,0,0);
  const exp = new Date(expiryDateStr + 'T00:00:00');
  return Math.floor((exp - now) / 86400000);
}

function expiryStatus(expiryDateStr) {
  const d = daysLeft(expiryDateStr);
  if (d < 0)  return 'expired';
  if (d <= 3) return 'soon';
  return 'fresh';
}

function daysLabel(expiryDateStr) {
  const d = daysLeft(expiryDateStr);
  if (d < 0)  return `${Math.abs(d)}日超過`;
  if (d === 0) return '今日まで';
  return `あと${d}日`;
}

function getInventoryNames() {
  return [...new Set([
    ...STATE.inventory.map(i => i.name),
    ...STATE.shoppingList.map(i => i.name)
  ])];
}

function refreshNameDatalist() {
  const dl = document.getElementById('all-item-names');
  if (!dl) return;
  dl.innerHTML = getInventoryNames().map(n => `<option value="${escHtml(n)}">`).join('');
}

// ---- Tab Switching ----
function switchTab(tabName) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tabName}"]`).classList.add('active');
  renderTab(tabName);
}

function renderTab(name) {
  switch (name) {
    case 'dashboard': renderDashboard(); break;
    case 'inventory': renderInventory(); break;
    case 'shopping':  renderShoppingList(); break;
    case 'recipes':   renderRecipes(); break;
  }
}

// ====================================================
// DASHBOARD
// ====================================================
function renderDashboard() {
  renderAlerts();
  renderStats();
  renderNutritionChart();
  renderRecipeSuggestion();
}

function renderAlerts() {
  const el = document.getElementById('alert-list');
  const items = STATE.inventory
    .filter(i => i.quantity > 0 && expiryStatus(i.expiryDate) !== 'fresh')
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

  if (!items.length) {
    el.innerHTML = `<div class="alert-item ok">
      <span class="alert-name">✅ 期限切れ・期限間近の食材はありません</span>
    </div>`;
    return;
  }

  el.innerHTML = items.map(item => {
    const st = expiryStatus(item.expiryDate);
    return `<div class="alert-item ${st}">
      <span class="alert-name">${escHtml(item.name)}</span>
      <span class="alert-expiry">${item.expiryDate}</span>
      <span class="alert-badge ${st}">${daysLabel(item.expiryDate)}</span>
    </div>`;
  }).join('');
}

function renderStats() {
  const active   = STATE.inventory.filter(i => i.quantity > 0);
  const expired  = active.filter(i => expiryStatus(i.expiryDate) === 'expired');
  const soon     = active.filter(i => expiryStatus(i.expiryDate) === 'soon');
  document.getElementById('total-items').textContent   = active.length;
  document.getElementById('expiring-soon').textContent = soon.length;
  document.getElementById('expired-count').textContent = expired.length;
}

function renderNutritionChart() {
  const chartNote = document.getElementById('chart-note');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  cutoff.setHours(0,0,0,0);

  const recent = STATE.consumptionHistory.filter(h => new Date(h.date) >= cutoff);
  const canvas = document.getElementById('nutrition-chart');

  if (!recent.length) {
    chartNote.style.display = 'block';
    if (nutritionChart) { nutritionChart.destroy(); nutritionChart = null; }
    canvas.style.display = 'none';
    return;
  }

  chartNote.style.display = 'none';
  canvas.style.display = 'block';

  const totals = { protein:0, fat:0, carbs:0, vitamins:0, minerals:0 };
  recent.forEach(h => {
    if (!h.nutrients) return;
    Object.keys(totals).forEach(k => { totals[k] += (h.nutrients[k] || 0); });
  });

  const data = [totals.protein, totals.fat, totals.carbs, totals.vitamins, totals.minerals];

  if (nutritionChart) nutritionChart.destroy();
  nutritionChart = new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: {
      labels: ['タンパク質', '脂質', '炭水化物', 'ビタミン', 'ミネラル'],
      datasets: [{
        data,
        backgroundColor: 'rgba(22,163,74,.18)',
        borderColor: '#16a34a',
        borderWidth: 2,
        pointBackgroundColor: '#16a34a',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          suggestedMax: Math.max(...data, 5),
          ticks: { display: false },
          grid: { color: 'rgba(0,0,0,.08)' },
          pointLabels: { font: { size: 11 } }
        }
      },
      plugins: { legend: { display: false } }
    }
  });
}

function renderRecipeSuggestion() {
  const el = document.getElementById('recipe-suggestion');
  const items = getNearExpiryItems(3);
  if (!items.length) {
    el.innerHTML = '<span class="suggest-chip-none">期限間近の食材はありません</span>';
  } else {
    el.innerHTML = items.map(i =>
      `<span class="suggest-chip">⚠️ ${escHtml(i.name)}</span>`
    ).join('');
  }
}

function getNearExpiryItems(max) {
  return STATE.inventory
    .filter(i => i.quantity > 0 && expiryStatus(i.expiryDate) !== 'fresh')
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))
    .slice(0, max);
}

function openGoogleRecipe() {
  const items = getNearExpiryItems(3);
  const q = items.length
    ? items.map(i => i.name).join('と') + 'を使ったレシピ'
    : '簡単 時短レシピ';
  window.open(`https://www.google.com/search?udm=5&q=${encodeURIComponent(q)}`, '_blank');
}

// ====================================================
// INVENTORY
// ====================================================
function renderInventory() {
  refreshNameDatalist();
  const el = document.getElementById('inventory-list');
  const q = (document.getElementById('inventory-search')?.value || '').toLowerCase();

  const items = STATE.inventory
    .filter(i => i.quantity > 0)
    .filter(i => !q || i.name.toLowerCase().includes(q))
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

  if (!items.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🥗</div>
      <div class="empty-text">${q ? '見つかりません' : '食材を追加してください'}</div>
    </div>`;
    return;
  }

  el.innerHTML = items.map(item => {
    const st = expiryStatus(item.expiryDate);
    const sel = inventorySelected.has(item.id);
    return `<div class="inventory-item ${st}${sel ? ' selected' : ''}" id="inv-item-${item.id}">
      <input type="checkbox" class="item-check" ${sel ? 'checked' : ''}
        onchange="toggleInventorySelect('${item.id}', this.checked)">
      <div class="item-info">
        <div class="item-name">${escHtml(item.name)}
          <span class="item-expiry-badge ${st}">${daysLabel(item.expiryDate)}</span>
        </div>
        <div class="item-meta">期限: ${item.expiryDate}</div>
      </div>
      <div class="item-qty-wrap">
        <button class="qty-btn" onclick="adjustQty('${item.id}',-1)">−</button>
        <input class="qty-input" type="number" value="${item.quantity}" min="0" step="0.1"
          onchange="updateQty('${item.id}',this.value)" onclick="this.select()">
        <span class="qty-unit">${escHtml(item.unit)}</span>
        <button class="qty-btn" onclick="adjustQty('${item.id}',1)">＋</button>
      </div>
      <button class="icon-btn" onclick="deleteInventoryItem('${item.id}')" title="削除">🗑️</button>
    </div>`;
  }).join('');
}

function adjustQty(id, delta) {
  const item = STATE.inventory.find(i => i.id === id);
  if (!item) return;
  item.quantity = Math.max(0, +(item.quantity + delta).toFixed(3));
  persist();
  renderInventory();
  renderStats();
}

function updateQty(id, val) {
  const item = STATE.inventory.find(i => i.id === id);
  if (!item) return;
  item.quantity = Math.max(0, parseFloat(val) || 0);
  persist();
  renderInventory();
  renderStats();
}

function deleteInventoryItem(id) {
  if (!confirm('この食材を削除しますか？')) return;
  STATE.inventory = STATE.inventory.filter(i => i.id !== id);
  inventorySelected.delete(id);
  persist();
  renderInventory();
  updateInventoryBulkBar();
  renderStats();
  renderAlerts();
}

function toggleInventorySelect(id, checked) {
  if (checked) inventorySelected.add(id);
  else inventorySelected.delete(id);
  const el = document.getElementById('inv-item-' + id);
  if (el) el.classList.toggle('selected', checked);
  updateInventoryBulkBar();
}

function updateInventoryBulkBar() {
  const bar = document.getElementById('inventory-bulk-bar');
  const countEl = document.getElementById('inventory-select-count');
  if (!bar) return;
  const n = inventorySelected.size;
  bar.style.display = n ? 'flex' : 'none';
  if (countEl) countEl.textContent = `${n}件選択中`;
}

function addSelectedToShopping() {
  if (!inventorySelected.size) return;
  inventorySelected.forEach(id => {
    const item = STATE.inventory.find(i => i.id === id);
    if (!item) return;
    STATE.shoppingList.push({
      id: uid(), name: item.name, quantity: item.quantity,
      unit: item.unit, checked: false, struck: false
    });
  });
  inventorySelected.clear();
  persist();
  updateInventoryBulkBar();
  renderInventory();
  alert('買い物リストに追加しました');
}

function deleteSelectedInventory() {
  if (!inventorySelected.size) return;
  if (!confirm(`${inventorySelected.size}件を削除しますか？`)) return;
  STATE.inventory = STATE.inventory.filter(i => !inventorySelected.has(i.id));
  inventorySelected.clear();
  persist();
  updateInventoryBulkBar();
  renderInventory();
  renderStats();
  renderAlerts();
}

function toggleAllInventory() {
  const q = (document.getElementById('inventory-search')?.value || '').toLowerCase();
  const visible = STATE.inventory.filter(i => i.quantity > 0 && (!q || i.name.toLowerCase().includes(q)));
  const allSel = visible.length > 0 && visible.every(i => inventorySelected.has(i.id));
  visible.forEach(i => { if (allSel) inventorySelected.delete(i.id); else inventorySelected.add(i.id); });
  updateInventoryBulkBar();
  renderInventory();
}

function toggleAllShopping() {
  const allChecked = STATE.shoppingList.length > 0 && STATE.shoppingList.every(i => i.checked);
  STATE.shoppingList.forEach(i => { i.checked = !allChecked; });
  persist();
  renderShoppingList();
}

function openAddInventoryModal() {
  refreshNameDatalist();
  const defaultExpiry = new Date();
  defaultExpiry.setDate(defaultExpiry.getDate() + 7);
  const defExp = defaultExpiry.toISOString().split('T')[0];

  showModal('食材を追加', `
    <div class="form-group">
      <label class="form-label">食材名 *</label>
      <input id="inv-name" class="form-input" type="text" placeholder="例: 牛乳" list="all-item-names"
        oninput="autoFillInventoryHistory(this.value)">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">数量 *</label>
        <input id="inv-qty" class="form-input" type="number" value="1" min="0" step="0.1">
      </div>
      <div class="form-group">
        <label class="form-label">単位</label>
        <input id="inv-unit" class="form-input" type="text" placeholder="個/g/ml" list="unit-list">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">賞味期限 *</label>
      <input id="inv-expiry" class="form-input" type="date" value="${defExp}" min="${todayStr()}">
    </div>
    <div class="form-group">
      <label class="form-label">栄養素（0〜5 の目安）</label>
      <div class="nutrients-grid">
        ${['protein:タンパク質','fat:脂質','carbs:炭水化物','vitamins:ビタミン','minerals:ミネラル'].map(s => {
          const [key, label] = s.split(':');
          return `<div class="nutrient-cell">
            <div class="nutrient-label">${label}</div>
            <input class="nutrient-input" id="nut-${key}" type="number" value="0" min="0" max="5" step="0.5">
          </div>`;
        }).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-full" onclick="addInventoryItem()">追加する</button>
  `);
}

function autoFillInventoryHistory(name) {
  const matches = STATE.inventory.filter(i => i.name === name);
  if (matches.length) {
    const latest = matches.sort((a,b) => new Date(b.registered_at)-new Date(a.registered_at))[0];
    if (latest.unit) document.getElementById('inv-unit').value = latest.unit;
    const withDates = matches.filter(i => i.registered_at && i.expiryDate);
    if (withDates.length) {
      const avg = withDates.reduce((s,i) =>
        s + (new Date(i.expiryDate) - new Date(i.registered_at)) / 86400000, 0
      ) / withDates.length;
      const suggested = new Date();
      suggested.setDate(suggested.getDate() + Math.max(1, Math.round(avg)));
      document.getElementById('inv-expiry').value = suggested.toISOString().split('T')[0];
    }
    if (latest.nutrients) {
      ['protein','fat','carbs','vitamins','minerals'].forEach(k => {
        const el = document.getElementById(`nut-${k}`);
        if (el) el.value = latest.nutrients[k] || 0;
      });
    }
  } else {
    // 登録履歴がなければ食材DBから栄養値・単位を補完
    const db = INGREDIENT_DB[name];
    if (!db) return;
    if (db.unit) document.getElementById('inv-unit').value = db.unit;
    ['protein','fat','carbs','vitamins','minerals'].forEach(k => {
      const el = document.getElementById(`nut-${k}`);
      if (el) el.value = db.nutrients[k] || 0;
    });
  }
}

function addInventoryItem() {
  const name   = document.getElementById('inv-name').value.trim();
  const qty    = parseFloat(document.getElementById('inv-qty').value) || 0;
  const unit   = document.getElementById('inv-unit').value.trim();
  const expiry = document.getElementById('inv-expiry').value;
  if (!name || !expiry) { alert('食材名と賞味期限は必須です'); return; }

  const nutrients = {};
  ['protein','fat','carbs','vitamins','minerals'].forEach(k => {
    nutrients[k] = parseFloat(document.getElementById(`nut-${k}`).value) || 0;
  });

  STATE.inventory.push({ id: uid(), name, quantity: qty, unit, expiryDate: expiry,
    registered_at: todayStr(), nutrients });
  persist();
  closeModal();
  renderInventory();
  renderAlerts();
  renderStats();
  refreshNameDatalist();
}

// ====================================================
// SHOPPING LIST
// ====================================================
function renderShoppingList() {
  refreshNameDatalist();
  const el = document.getElementById('shopping-list');
  if (!STATE.shoppingList.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🛒</div>
      <div class="empty-text">買い物リストは空です</div>
    </div>`;
    updateShoppingBadge();
    updateShoppingBulkBar();
    return;
  }

  el.innerHTML = STATE.shoppingList.map(item => `
    <div class="shopping-item ${item.checked ? 'checked' : ''}">
      <input type="checkbox" ${item.checked ? 'checked' : ''}
        onchange="toggleShopping('${item.id}', this.checked)">
      <span class="shopping-name${item.struck ? ' struck' : ''}" onclick="strikeItem('${item.id}')">${escHtml(item.name)}</span>
      <div class="item-qty-wrap">
        <button class="qty-btn" onclick="adjustShoppingQty('${item.id}',-1)">−</button>
        <input class="qty-input" type="number" value="${item.quantity}" min="0" step="0.1"
          onchange="setShoppingQty('${item.id}',this.value)" onclick="this.select()">
        <span class="qty-unit">${escHtml(item.unit)}</span>
        <button class="qty-btn" onclick="adjustShoppingQty('${item.id}',1)">＋</button>
      </div>
    </div>
  `).join('');
  updateShoppingBadge();
  updateShoppingBulkBar();
}

function toggleShopping(id, checked) {
  const item = STATE.shoppingList.find(i => i.id === id);
  if (!item) return;
  item.checked = checked;
  persist();
  updateShoppingBulkBar();
}

function updateShoppingBulkBar() {
  const bar = document.getElementById('shopping-bulk-bar');
  const countEl = document.getElementById('shopping-select-count');
  if (!bar) return;
  const n = STATE.shoppingList.filter(i => i.checked).length;
  bar.style.display = n ? 'flex' : 'none';
  if (countEl) countEl.textContent = `${n}件選択中`;
}

function strikeItem(id) {
  const item = STATE.shoppingList.find(i => i.id === id);
  if (!item) return;
  item.struck = !item.struck;
  persist();
  renderShoppingList();
}

function adjustShoppingQty(id, delta) {
  const item = STATE.shoppingList.find(i => i.id === id);
  if (!item) return;
  item.quantity = Math.max(0, +(item.quantity + delta).toFixed(3));
  persist();
  renderShoppingList();
}

function setShoppingQty(id, val) {
  const item = STATE.shoppingList.find(i => i.id === id);
  if (!item) return;
  item.quantity = Math.max(0, parseFloat(val) || 0);
  persist();
}

function deleteBulkShopping() {
  const checked = STATE.shoppingList.filter(i => i.checked);
  if (!checked.length) { alert('削除する食材にチェックを入れてください'); return; }
  if (!confirm(`${checked.length}件を削除しますか？`)) return;
  STATE.shoppingList = STATE.shoppingList.filter(i => !i.checked);
  persist();
  renderShoppingList();
}

function modalAdjustQty(delta) {
  const el = document.getElementById('sh-qty');
  if (!el) return;
  const val = Math.max(0, (parseFloat(el.value) || 0) + delta);
  el.value = Number.isInteger(val) ? val : val.toFixed(1);
}

function updateShoppingBadge() {
  const badge = document.getElementById('shopping-badge');
  const n = STATE.shoppingList.length;
  badge.style.display = n ? 'flex' : 'none';
  badge.textContent = n;
}

function openAddShoppingModal() {
  refreshNameDatalist();
  showModal('買い物リストに追加', `
    <div class="form-group">
      <label class="form-label">食材名 *</label>
      <input id="sh-name" class="form-input" type="text" placeholder="例: 卵" list="all-item-names"
        oninput="autoFillShoppingHistory(this.value)">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">数量</label>
        <div class="item-qty-wrap" style="margin-top:2px">
          <button type="button" class="qty-btn" onclick="modalAdjustQty(-1)">−</button>
          <input id="sh-qty" class="qty-input" type="number" value="1" min="0" step="0.1">
          <button type="button" class="qty-btn" onclick="modalAdjustQty(1)">＋</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">単位</label>
        <input id="sh-unit" class="form-input" type="text" placeholder="個/g/ml" list="unit-list">
      </div>
    </div>
    <button class="btn btn-primary btn-full" onclick="addShoppingItem()">追加する</button>
  `);
}

function autoFillShoppingHistory(name) {
  const matches = STATE.inventory.filter(i => i.name === name);
  if (!matches.length) return;
  const latest = matches.sort((a,b) => new Date(b.registered_at)-new Date(a.registered_at))[0];
  if (latest.unit)     document.getElementById('sh-unit').value = latest.unit;
  if (latest.quantity) document.getElementById('sh-qty').value  = latest.quantity;
}

function addShoppingItem() {
  const name = document.getElementById('sh-name').value.trim();
  const qty  = parseFloat(document.getElementById('sh-qty').value) || 1;
  const unit = document.getElementById('sh-unit').value.trim();
  if (!name) { alert('食材名を入力してください'); return; }

  const existing = STATE.shoppingList.find(i => i.name === name && i.unit === unit);
  if (existing) {
    existing.quantity = +(existing.quantity + qty).toFixed(3);
  } else {
    STATE.shoppingList.push({ id: uid(), name, quantity: qty, unit, checked: false, struck: false });
  }
  persist();
  closeModal();
  renderShoppingList();
  refreshNameDatalist();
}

function openAmazonSearch() {
  if (!STATE.shoppingList.length) { alert('買い物リストが空です'); return; }
  const targets = STATE.shoppingList.filter(i => i.checked);
  if (!targets.length) { alert('チェックした食材をAmazonで検索します。\nリストの食材にチェックを入れてください。'); return; }
  window.open(affiliateAmazon(targets.map(i => i.name).join(' ')), '_blank');
}

function openCheckoutModal() {
  if (!STATE.shoppingList.length) { alert('買い物リストが空です'); return; }
  const targets = STATE.shoppingList.filter(i => i.checked);
  if (!targets.length) { alert('食材へ追加する食材にチェックを入れてください'); return; }

  const rows = targets.map(item => {
    const suggested = inferExpiryDate(item.name);
    return `<div class="checkout-row">
      <div class="checkout-left">
        <span class="checkout-name">${escHtml(item.name)}</span>
        <span class="checkout-qty">${item.quantity}${escHtml(item.unit)}</span>
      </div>
      <div class="checkout-date">
        <button type="button" class="qty-btn" onclick="adjustDate('co-${item.id}',-1)">−</button>
        <input type="date" id="co-${item.id}" value="${suggested}" min="${todayStr()}">
        <button type="button" class="qty-btn" onclick="adjustDate('co-${item.id}',1)">＋</button>
      </div>
    </div>`;
  }).join('');

  showModal('食材へ追加', `
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
      チェックした ${targets.length} 件の賞味期限を確認して在庫へ追加します
    </p>
    ${rows}
    <div style="margin-top:14px">
      <button class="btn btn-primary btn-full" onclick="checkoutAll()">✅ 食材へ追加する</button>
    </div>
  `);
}

function adjustDate(inputId, delta) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const d = new Date((el.value || todayStr()) + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const today = new Date(); today.setHours(0,0,0,0);
  if (d < today) d.setTime(today.getTime());
  el.value = d.toISOString().split('T')[0];
}

function inferExpiryDate(name) {
  const matches = STATE.inventory.filter(i => i.name === name && i.registered_at && i.expiryDate);
  const days = matches.length
    ? matches.reduce((s,i) =>
        s + (new Date(i.expiryDate) - new Date(i.registered_at)) / 86400000, 0
      ) / matches.length
    : 7;
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, Math.round(days)));
  return d.toISOString().split('T')[0];
}

function checkoutAll() {
  const targets = STATE.shoppingList.filter(i => i.checked);
  targets.forEach(item => {
    const input    = document.getElementById(`co-${item.id}`);
    const expiry   = input ? input.value : inferExpiryDate(item.name);
    const prevItem = STATE.inventory.find(i => i.name === item.name);
    const nutrients = prevItem?.nutrients || { protein:0, fat:0, carbs:0, vitamins:0, minerals:0 };

    STATE.inventory.push({
      id: uid(), name: item.name, quantity: item.quantity,
      unit: item.unit, expiryDate: expiry,
      registered_at: todayStr(), nutrients
    });
  });

  STATE.shoppingList = STATE.shoppingList.filter(i => !i.checked);
  persist();
  closeModal();
  renderShoppingList();
  renderStats();
  renderAlerts();
  refreshNameDatalist();
}

// ====================================================
// RECIPES
// ====================================================

// 食材の期限情報をレシピ単位で集計
function getRecipeUrgency(recipe) {
  const items = [];
  let minDays = Infinity;
  recipe.ingredients.forEach(ing => {
    const nearest = STATE.inventory
      .filter(i => i.name === ing.name && i.quantity > 0)
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0];
    if (!nearest) return;
    const d = daysLeft(nearest.expiryDate);
    if (d <= 5) {
      items.push({ name: ing.name, days: d, date: nearest.expiryDate });
      if (d < minDays) minDays = d;
    }
  });
  return { items, minDays };
}

function renderRecipes() {
  const el = document.getElementById('recipe-list');
  const q = (document.getElementById('recipe-search')?.value || '').toLowerCase();

  const filtered = STATE.customRecipes.filter(r =>
    !q || r.name.toLowerCase().includes(q) ||
    r.ingredients.some(i => i.name.toLowerCase().includes(q))
  );

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🍳</div>
      <div class="empty-text">${q ? '見つかりません' : 'レシピを追加してください'}</div>
    </div>`;
    return;
  }

  const sorted = filtered
    .map(r => ({ r, u: getRecipeUrgency(r) }))
    .sort((a, b) => a.u.minDays - b.u.minDays);

  el.innerHTML = sorted.map(({ r: recipe, u: urgency }) => {
    const cardMod = urgency.items.length
      ? (urgency.minDays < 0 ? ' recipe-expired' : urgency.minDays <= 3 ? ' recipe-urgent' : ' recipe-warn')
      : '';

    const alertHtml = urgency.items.length
      ? `<div class="recipe-expiry-alert">⚠️ 期限間近：${
          urgency.items.map(i =>
            `<strong>${escHtml(i.name)}</strong>（${daysLabel(i.date)}）`
          ).join('　')
        }</div>`
      : '';

    const chipHtml = recipe.ingredients.map(i => {
      const ui = urgency.items.find(u => u.name === i.name);
      return ui
        ? `<span class="ingredient-chip chip-urgent">${escHtml(i.name)} ${i.quantity}${escHtml(i.unit)}<span class="chip-expiry">${daysLabel(ui.date)}</span></span>`
        : `<span class="ingredient-chip">${escHtml(i.name)} ${i.quantity}${escHtml(i.unit)}</span>`;
    }).join('');

    const descHtml = recipe.description
      ? recipe.description.length > 60
        ? `<div class="recipe-desc-wrap">
            <div class="recipe-desc collapsed" id="desc-${recipe.id}">${escHtml(recipe.description)}</div>
            <button class="desc-toggle" onclick="toggleDesc('${recipe.id}')">もっと見る</button>
          </div>`
        : `<div class="recipe-desc">${escHtml(recipe.description)}</div>`
      : '';

    return `
    <div class="recipe-card${cardMod}">
      ${alertHtml}
      <div class="recipe-name">${escHtml(recipe.name)}</div>
      ${descHtml}
      <div class="ingredient-chips">${chipHtml}</div>
      <div class="recipe-actions">
        <button class="btn btn-success btn-sm" onclick="cookRecipe('${recipe.id}')">🍽️ 作って消費</button>
        <button class="btn btn-secondary btn-sm" onclick="openEditRecipeModal('${recipe.id}')">✏️ 編集</button>
        <button class="btn btn-secondary btn-sm" data-recipe="${escHtml(recipe.name)}"
          onclick="searchRecipe(this)">🔍 検索</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRecipe('${recipe.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function searchRecipe(btn) {
  const name = btn.dataset.recipe || '';
  window.open(`https://www.google.com/search?udm=5&q=${encodeURIComponent(name + '+レシピ')}`, '_blank');
}

function deleteRecipe(id) {
  if (!confirm('このレシピを削除しますか？')) return;
  STATE.customRecipes = STATE.customRecipes.filter(r => r.id !== id);
  persist();
  renderRecipes();
}

function cookRecipe(id) {
  const recipe = STATE.customRecipes.find(r => r.id === id);
  if (!recipe) return;

  // Check stock — unit-aware
  const missing = recipe.ingredients
    .map(ing => {
      const sameUnit = STATE.inventory.filter(i => i.name === ing.name && i.quantity > 0 && i.unit === ing.unit);
      const diffUnit = STATE.inventory.filter(i => i.name === ing.name && i.quantity > 0 && i.unit !== ing.unit);
      if (!sameUnit.length && !diffUnit.length) {
        return `${ing.name}（在庫なし）`;
      }
      if (!sameUnit.length) {
        const units = [...new Set(diffUnit.map(i => i.unit))].join('/');
        return `${ing.name}（在庫の単位が違います: ${units} → レシピは ${ing.unit}）`;
      }
      const available = sameUnit.reduce((s, i) => s + i.quantity, 0);
      return available < ing.quantity
        ? `${ing.name}（必要: ${ing.quantity}${ing.unit}、在庫: ${available.toFixed(1)}${ing.unit}）`
        : null;
    })
    .filter(Boolean);

  if (missing.length && !confirm(`以下の食材を確認してください:\n${missing.join('\n')}\n\n続けますか？`)) return;

  const nutrientsConsumed = { protein:0, fat:0, carbs:0, vitamins:0, minerals:0 };

  recipe.ingredients.forEach(ing => {
    let remaining = ing.quantity;
    const stocks = STATE.inventory
      .filter(i => i.name === ing.name && i.quantity > 0 && i.unit === ing.unit)
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate)); // FIFO: oldest first

    stocks.forEach(stock => {
      if (remaining <= 0) return;
      const consume = Math.min(stock.quantity, remaining);
      if (stock.nutrients) {
        const ratio = stock.quantity > 0 ? consume / stock.quantity : 0;
        Object.keys(nutrientsConsumed).forEach(k => {
          nutrientsConsumed[k] += (stock.nutrients[k] || 0) * ratio;
        });
      }
      stock.quantity = +(stock.quantity - consume).toFixed(3);
      remaining = +(remaining - consume).toFixed(3);
    });
  });

  STATE.consumptionHistory.push({
    id: uid(), date: todayStr(), recipeName: recipe.name, nutrients: nutrientsConsumed
  });

  persist();
  renderRecipes();
  renderStats();
  renderAlerts();
  if (document.getElementById('tab-dashboard').classList.contains('active')) {
    renderNutritionChart();
  }
  alert(`「${recipe.name}」を作りました！`);
}

function openAddRecipeModal() {
  refreshNameDatalist();
  ingRowCounter = 0;
  showModal('レシピを追加', `
    <div class="form-group">
      <label class="form-label">レシピ名 *</label>
      <input id="rcp-name" class="form-input" type="text" placeholder="例: 肉じゃが">
    </div>
    <div class="form-group">
      <label class="form-label">説明（任意）</label>
      <textarea id="rcp-desc" class="form-input" rows="2" placeholder="作り方のメモ…"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">材料</label>
      <div id="ing-container">${buildIngRow()}</div>
      <button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="addIngRow()">
        ＋ 材料を追加
      </button>
    </div>
    <button class="btn btn-primary btn-full" onclick="saveRecipe()">保存する</button>
  `);
}

function buildIngRow() {
  const idx = ingRowCounter++;
  return `<div class="ing-row" id="ing-${idx}">
    <input type="text"   class="ing-name" placeholder="食材名" list="all-item-names">
    <input type="number" class="ing-qty"  placeholder="数量" value="1" min="0" step="0.1">
    <input type="text"   class="ing-unit" placeholder="単位" list="unit-list">
    <button class="ing-remove" onclick="removeIngRow(${idx})">✕</button>
  </div>`;
}

function addIngRow() {
  const c = document.getElementById('ing-container');
  if (!c) return;
  const div = document.createElement('div');
  div.innerHTML = buildIngRow();
  c.appendChild(div.firstElementChild);
}

function removeIngRow(idx) {
  const row = document.getElementById(`ing-${idx}`);
  if (row) row.remove();
}

function saveRecipe() {
  const name = document.getElementById('rcp-name').value.trim();
  const desc = document.getElementById('rcp-desc').value.trim();
  if (!name) { alert('レシピ名を入力してください'); return; }

  const ingredients = [];
  document.querySelectorAll('#ing-container .ing-row').forEach(row => {
    const n = row.querySelector('.ing-name').value.trim();
    const q = parseFloat(row.querySelector('.ing-qty').value) || 0;
    const u = row.querySelector('.ing-unit').value.trim();
    if (n) ingredients.push({ name: n, quantity: q, unit: u });
  });

  STATE.customRecipes.push({ id: uid(), name, description: desc, ingredients });
  persist();
  closeModal();
  renderRecipes();
}

function toggleDesc(id) {
  const el = document.getElementById('desc-' + id);
  const btn = el ? el.nextElementSibling : null;
  if (!el || !btn) return;
  const collapsed = el.classList.toggle('collapsed');
  btn.textContent = collapsed ? 'もっと見る' : '閉じる';
}

function buildIngRowWithValues(ing) {
  const idx = ingRowCounter++;
  return `<div class="ing-row" id="ing-${idx}">
    <input type="text"   class="ing-name" placeholder="食材名" list="all-item-names" value="${escHtml(ing.name)}">
    <input type="number" class="ing-qty"  placeholder="数量" value="${ing.quantity}" min="0" step="0.1">
    <input type="text"   class="ing-unit" placeholder="単位" list="unit-list" value="${escHtml(ing.unit)}">
    <button class="ing-remove" onclick="removeIngRow(${idx})">✕</button>
  </div>`;
}

function openEditRecipeModal(id) {
  const recipe = STATE.customRecipes.find(r => r.id === id);
  if (!recipe) return;
  refreshNameDatalist();
  ingRowCounter = 0;
  showModal('レシピを編集', `
    <div class="form-group">
      <label class="form-label">レシピ名 *</label>
      <input id="rcp-name" class="form-input" type="text" value="${escHtml(recipe.name)}" placeholder="例: 肉じゃが">
    </div>
    <div class="form-group">
      <label class="form-label">説明（任意）</label>
      <textarea id="rcp-desc" class="form-input" rows="2" placeholder="作り方のメモ…">${escHtml(recipe.description || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">材料</label>
      <div id="ing-container">${recipe.ingredients.map(i => buildIngRowWithValues(i)).join('')}</div>
      <button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="addIngRow()">＋ 材料を追加</button>
    </div>
    <button class="btn btn-primary btn-full" onclick="saveEditRecipe('${id}')">保存する</button>
  `);
}

function saveEditRecipe(id) {
  const name = document.getElementById('rcp-name').value.trim();
  const desc = document.getElementById('rcp-desc').value.trim();
  if (!name) { alert('レシピ名を入力してください'); return; }
  const ingredients = [];
  document.querySelectorAll('#ing-container .ing-row').forEach(row => {
    const n = row.querySelector('.ing-name').value.trim();
    const q = parseFloat(row.querySelector('.ing-qty').value) || 0;
    const u = row.querySelector('.ing-unit').value.trim();
    if (n) ingredients.push({ name: n, quantity: q, unit: u });
  });
  const idx = STATE.customRecipes.findIndex(r => r.id === id);
  if (idx !== -1) {
    STATE.customRecipes[idx] = { ...STATE.customRecipes[idx], name, description: desc, ingredients };
  }
  persist();
  closeModal();
  renderRecipes();
}

function loadPresetRecipes() {
  const existing = new Set(STATE.customRecipes.map(r => r.name));
  const toAdd = PRESET_RECIPES.filter(r => !existing.has(r.name));
  if (!toAdd.length) { alert('すべてのプリセットレシピはすでに追加されています'); return; }
  STATE.customRecipes.push(...toAdd.map(r => ({ ...r, id: uid() })));
  persist();
  renderRecipes();
  alert(`${toAdd.length}件のプリセットレシピを追加しました`);
}

// ====================================================
// MODAL
// ====================================================
function showModal(title, bodyHTML) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  ingRowCounter = 0;
}

// ====================================================
// SETTINGS
// ====================================================
function exportData() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    inventory: STATE.inventory,
    shoppingList: STATE.shoppingList,
    customRecipes: STATE.customRecipes,
    consumptionHistory: STATE.consumptionHistory
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `food-stock-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (typeof data !== 'object' || data === null) throw new Error('invalid');
      if (!confirm('現在のデータを上書きしますか？')) return;
      STATE.inventory          = Array.isArray(data.inventory)          ? data.inventory          : [];
      STATE.shoppingList       = Array.isArray(data.shoppingList)       ? data.shoppingList       : [];
      STATE.customRecipes      = Array.isArray(data.customRecipes)      ? data.customRecipes      : [];
      STATE.consumptionHistory = Array.isArray(data.consumptionHistory) ? data.consumptionHistory : [];
      inventorySelected.clear();
      persist();
      renderDashboard();
      updateShoppingBadge();
      updateShoppingBulkBar();
      updateInventoryBulkBar();
      alert('インポート完了しました');
    } catch {
      alert('JSONファイルの読み込みに失敗しました');
    }
  };
  reader.readAsText(file);
}

function clearAllData() {
  if (!confirm('全データを削除します。元に戻せません。本当によろしいですか？')) return;
  ['fsm_inventory','fsm_shopping','fsm_recipes','fsm_history'].forEach(k =>
    localStorage.removeItem(k)
  );
  STATE = { inventory:[], shoppingList:[], customRecipes:[], consumptionHistory:[] };
  inventorySelected.clear();
  renderDashboard();
  updateShoppingBadge();
  updateShoppingBulkBar();
  updateInventoryBulkBar();
  alert('データを削除しました');
}

// ====================================================
// HELPERS
// ====================================================
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function affiliateAmazon(query) {
  const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(query)}`;
  return AFFILIATE.amazonTag ? `${url}&tag=${AFFILIATE.amazonTag}` : url;
}

// ====================================================
// INGREDIENT DATABASE
// ====================================================
const INGREDIENT_DB = {
  // 肉類
  '牛肉':          { unit:'g',    nutrients:{protein:4,fat:3,carbs:0,vitamins:1,minerals:2} },
  '牛バラ肉':      { unit:'g',    nutrients:{protein:3,fat:4,carbs:0,vitamins:1,minerals:2} },
  '豚肉':          { unit:'g',    nutrients:{protein:4,fat:3,carbs:0,vitamins:2,minerals:2} },
  '豚バラ肉':      { unit:'g',    nutrients:{protein:3,fat:5,carbs:0,vitamins:2,minerals:2} },
  '豚ロース':      { unit:'g',    nutrients:{protein:4,fat:2,carbs:0,vitamins:2,minerals:2} },
  '豚ひき肉':      { unit:'g',    nutrients:{protein:3,fat:4,carbs:0,vitamins:2,minerals:2} },
  '鶏もも肉':      { unit:'g',    nutrients:{protein:4,fat:2,carbs:0,vitamins:2,minerals:2} },
  '鶏むね肉':      { unit:'g',    nutrients:{protein:5,fat:1,carbs:0,vitamins:2,minerals:2} },
  '合い挽き肉':    { unit:'g',    nutrients:{protein:3,fat:3,carbs:0,vitamins:1,minerals:2} },
  '豚ロースカツ':  { unit:'枚',   nutrients:{protein:4,fat:3,carbs:2,vitamins:1,minerals:2} },
  'チャーシュー':  { unit:'g',    nutrients:{protein:3,fat:3,carbs:1,vitamins:1,minerals:2} },
  'ウインナー':    { unit:'本',   nutrients:{protein:2,fat:4,carbs:1,vitamins:1,minerals:2} },
  'ベーコン':      { unit:'枚',   nutrients:{protein:2,fat:5,carbs:0,vitamins:2,minerals:2} },
  // 魚介類
  '鮭':            { unit:'切れ', nutrients:{protein:4,fat:3,carbs:0,vitamins:3,minerals:3} },
  'さば':          { unit:'切れ', nutrients:{protein:4,fat:4,carbs:0,vitamins:3,minerals:3} },
  'ぶり':          { unit:'切れ', nutrients:{protein:4,fat:4,carbs:0,vitamins:3,minerals:3} },
  'アジ':          { unit:'尾',   nutrients:{protein:4,fat:2,carbs:0,vitamins:3,minerals:3} },
  'えび':          { unit:'尾',   nutrients:{protein:5,fat:1,carbs:0,vitamins:2,minerals:3} },
  'ちくわ':        { unit:'本',   nutrients:{protein:2,fat:1,carbs:3,vitamins:1,minerals:2} },
  // 豆腐・大豆製品
  '豆腐':          { unit:'丁',   nutrients:{protein:2,fat:1,carbs:1,vitamins:1,minerals:3} },
  '厚揚げ':        { unit:'枚',   nutrients:{protein:3,fat:3,carbs:1,vitamins:1,minerals:3} },
  '油揚げ':        { unit:'枚',   nutrients:{protein:2,fat:4,carbs:1,vitamins:1,minerals:2} },
  '大豆':          { unit:'g',    nutrients:{protein:3,fat:2,carbs:2,vitamins:2,minerals:3} },
  // 卵・乳製品
  '卵':            { unit:'個',   nutrients:{protein:4,fat:3,carbs:0,vitamins:3,minerals:2} },
  'ゆで卵':        { unit:'個',   nutrients:{protein:4,fat:3,carbs:0,vitamins:3,minerals:2} },
  'バター':        { unit:'g',    nutrients:{protein:0,fat:5,carbs:0,vitamins:2,minerals:0} },
  '牛乳':          { unit:'ml',   nutrients:{protein:2,fat:2,carbs:1,vitamins:2,minerals:3} },
  // 野菜類
  'じゃがいも':    { unit:'個',   nutrients:{protein:1,fat:0,carbs:4,vitamins:3,minerals:2} },
  'さつまいも':    { unit:'本',   nutrients:{protein:1,fat:0,carbs:4,vitamins:3,minerals:2} },
  'たまねぎ':      { unit:'個',   nutrients:{protein:0,fat:0,carbs:2,vitamins:2,minerals:1} },
  'にんじん':      { unit:'本',   nutrients:{protein:0,fat:0,carbs:2,vitamins:5,minerals:1} },
  'キャベツ':      { unit:'個',   nutrients:{protein:1,fat:0,carbs:1,vitamins:3,minerals:1} },
  'もやし':        { unit:'袋',   nutrients:{protein:1,fat:0,carbs:1,vitamins:2,minerals:1} },
  'ほうれん草':    { unit:'袋',   nutrients:{protein:2,fat:0,carbs:1,vitamins:5,minerals:4} },
  '小松菜':        { unit:'袋',   nutrients:{protein:1,fat:0,carbs:1,vitamins:5,minerals:4} },
  'ごぼう':        { unit:'本',   nutrients:{protein:1,fat:0,carbs:3,vitamins:1,minerals:2} },
  'れんこん':      { unit:'節',   nutrients:{protein:1,fat:0,carbs:3,vitamins:3,minerals:2} },
  'なす':          { unit:'本',   nutrients:{protein:0,fat:0,carbs:1,vitamins:2,minerals:1} },
  'ピーマン':      { unit:'個',   nutrients:{protein:1,fat:0,carbs:1,vitamins:5,minerals:1} },
  'かぼちゃ':      { unit:'個',   nutrients:{protein:1,fat:0,carbs:3,vitamins:5,minerals:2} },
  'だいこん':      { unit:'本',   nutrients:{protein:0,fat:0,carbs:1,vitamins:2,minerals:1} },
  'しいたけ':      { unit:'枚',   nutrients:{protein:1,fat:0,carbs:1,vitamins:3,minerals:2} },
  'しめじ':        { unit:'袋',   nutrients:{protein:1,fat:0,carbs:1,vitamins:3,minerals:2} },
  'にら':          { unit:'束',   nutrients:{protein:1,fat:0,carbs:1,vitamins:4,minerals:2} },
  'ねぎ':          { unit:'本',   nutrients:{protein:0,fat:0,carbs:1,vitamins:3,minerals:1} },
  'きゅうり':      { unit:'本',   nutrients:{protein:0,fat:0,carbs:1,vitamins:2,minerals:1} },
  '山芋':          { unit:'g',    nutrients:{protein:1,fat:0,carbs:3,vitamins:2,minerals:2} },
  'さやいんげん':  { unit:'g',    nutrients:{protein:1,fat:0,carbs:1,vitamins:3,minerals:1} },
  'しょうが':      { unit:'片',   nutrients:{protein:0,fat:0,carbs:1,vitamins:1,minerals:1} },
  'にんにく':      { unit:'片',   nutrients:{protein:1,fat:0,carbs:2,vitamins:1,minerals:1} },
  // 穀物・麺類
  '米':            { unit:'合',   nutrients:{protein:1,fat:0,carbs:5,vitamins:1,minerals:1} },
  'ご飯':          { unit:'杯',   nutrients:{protein:1,fat:0,carbs:5,vitamins:1,minerals:1} },
  'スパゲッティ':  { unit:'g',    nutrients:{protein:2,fat:1,carbs:5,vitamins:1,minerals:1} },
  '中華麺':        { unit:'玉',   nutrients:{protein:2,fat:1,carbs:5,vitamins:1,minerals:1} },
  '薄力粉':        { unit:'g',    nutrients:{protein:1,fat:0,carbs:5,vitamins:1,minerals:1} },
  '餃子の皮':      { unit:'枚',   nutrients:{protein:1,fat:0,carbs:4,vitamins:0,minerals:0} },
  '春巻きの皮':    { unit:'枚',   nutrients:{protein:1,fat:0,carbs:4,vitamins:0,minerals:0} },
  '春雨':          { unit:'g',    nutrients:{protein:0,fat:0,carbs:4,vitamins:0,minerals:0} },
  'パン粉':        { unit:'g',    nutrients:{protein:1,fat:1,carbs:4,vitamins:0,minerals:1} },
  // その他
  'こんにゃく':    { unit:'枚',   nutrients:{protein:0,fat:0,carbs:0,vitamins:0,minerals:1} },
  'しらたき':      { unit:'袋',   nutrients:{protein:0,fat:0,carbs:0,vitamins:0,minerals:1} },
  'ひじき':        { unit:'g',    nutrients:{protein:1,fat:0,carbs:1,vitamins:3,minerals:5} },
  '切り干し大根':  { unit:'g',    nutrients:{protein:1,fat:0,carbs:3,vitamins:3,minerals:4} },
  'わかめ':        { unit:'g',    nutrients:{protein:1,fat:0,carbs:1,vitamins:2,minerals:5} },
  'マッシュルーム':{ unit:'個',   nutrients:{protein:1,fat:0,carbs:1,vitamins:3,minerals:2} },
  '天かす':        { unit:'g',    nutrients:{protein:1,fat:3,carbs:3,vitamins:0,minerals:0} },
};

// ====================================================
// PRESET RECIPES
// ====================================================
const PRESET_RECIPES = [
  { name:'肉じゃが', description:'牛肉とじゃがいもの定番煮物',
    ingredients:[{name:'牛肉',quantity:200,unit:'g'},{name:'じゃがいも',quantity:3,unit:'個'},
      {name:'たまねぎ',quantity:1,unit:'個'},{name:'にんじん',quantity:1,unit:'本'},
      {name:'しらたき',quantity:1,unit:'袋'}]},
  { name:'親子丼', description:'鶏肉と卵のとじ丼',
    ingredients:[{name:'鶏もも肉',quantity:200,unit:'g'},{name:'卵',quantity:3,unit:'個'},
      {name:'たまねぎ',quantity:0.5,unit:'個'},{name:'ご飯',quantity:2,unit:'杯'}]},
  { name:'カレーライス', description:'野菜たっぷりの定番カレー',
    ingredients:[{name:'牛肉',quantity:200,unit:'g'},{name:'じゃがいも',quantity:2,unit:'個'},
      {name:'にんじん',quantity:1,unit:'本'},{name:'たまねぎ',quantity:1,unit:'個'},
      {name:'ご飯',quantity:2,unit:'杯'}]},
  { name:'豚の生姜焼き', description:'甘辛いタレが食欲をそそる定番おかず',
    ingredients:[{name:'豚ロース',quantity:300,unit:'g'},{name:'たまねぎ',quantity:0.5,unit:'個'},
      {name:'しょうが',quantity:1,unit:'片'}]},
  { name:'鶏のから揚げ', description:'サクサクジューシーな揚げ物',
    ingredients:[{name:'鶏もも肉',quantity:400,unit:'g'},{name:'しょうが',quantity:1,unit:'片'},
      {name:'にんにく',quantity:1,unit:'片'},{name:'薄力粉',quantity:30,unit:'g'}]},
  { name:'麻婆豆腐', description:'ピリ辛でご飯が進む中華料理',
    ingredients:[{name:'豆腐',quantity:1,unit:'丁'},{name:'豚ひき肉',quantity:150,unit:'g'},
      {name:'にんにく',quantity:2,unit:'片'},{name:'しょうが',quantity:1,unit:'片'},
      {name:'ねぎ',quantity:1,unit:'本'}]},
  { name:'野菜炒め', description:'冷蔵庫の野菜で手軽に一品',
    ingredients:[{name:'キャベツ',quantity:0.25,unit:'個'},{name:'もやし',quantity:1,unit:'袋'},
      {name:'にんじん',quantity:0.5,unit:'本'},{name:'豚肉',quantity:150,unit:'g'}]},
  { name:'卵焼き', description:'甘めの出汁巻き卵',
    ingredients:[{name:'卵',quantity:3,unit:'個'}]},
  { name:'豚汁', description:'具だくさんの味噌汁',
    ingredients:[{name:'豚バラ肉',quantity:150,unit:'g'},{name:'だいこん',quantity:0.25,unit:'本'},
      {name:'にんじん',quantity:0.5,unit:'本'},{name:'じゃがいも',quantity:1,unit:'個'},
      {name:'ねぎ',quantity:1,unit:'本'},{name:'豆腐',quantity:0.5,unit:'丁'}]},
  { name:'炊き込みご飯', description:'具材の旨味が染み込んだご飯',
    ingredients:[{name:'米',quantity:2,unit:'合'},{name:'にんじん',quantity:1,unit:'本'},
      {name:'しいたけ',quantity:4,unit:'枚'},{name:'こんにゃく',quantity:0.5,unit:'枚'},
      {name:'鶏もも肉',quantity:100,unit:'g'},{name:'ごぼう',quantity:0.5,unit:'本'}]},
  { name:'ハンバーグ', description:'ふっくらジューシーな洋食の定番',
    ingredients:[{name:'合い挽き肉',quantity:300,unit:'g'},{name:'たまねぎ',quantity:0.5,unit:'個'},
      {name:'卵',quantity:1,unit:'個'},{name:'パン粉',quantity:30,unit:'g'},
      {name:'牛乳',quantity:30,unit:'ml'}]},
  { name:'焼き鮭', description:'シンプルで栄養満点の主菜',
    ingredients:[{name:'鮭',quantity:2,unit:'切れ'}]},
  { name:'サバの味噌煮', description:'こっくり甘辛く煮た青魚料理',
    ingredients:[{name:'さば',quantity:2,unit:'切れ'},{name:'しょうが',quantity:1,unit:'片'}]},
  { name:'チャーハン', description:'パラパラに仕上げる炒めご飯',
    ingredients:[{name:'ご飯',quantity:2,unit:'杯'},{name:'卵',quantity:2,unit:'個'},
      {name:'ねぎ',quantity:1,unit:'本'},{name:'チャーシュー',quantity:80,unit:'g'}]},
  { name:'ポテトサラダ', description:'マヨネーズとじゃがいもの定番サラダ',
    ingredients:[{name:'じゃがいも',quantity:3,unit:'個'},{name:'にんじん',quantity:0.5,unit:'本'},
      {name:'きゅうり',quantity:1,unit:'本'},{name:'たまねぎ',quantity:0.25,unit:'個'}]},
  { name:'きんぴらごぼう', description:'シャキシャキ食感の和風常備菜',
    ingredients:[{name:'ごぼう',quantity:1,unit:'本'},{name:'にんじん',quantity:0.5,unit:'本'}]},
  { name:'ほうれん草のお浸し', description:'定番の和の副菜',
    ingredients:[{name:'ほうれん草',quantity:1,unit:'袋'}]},
  { name:'かぼちゃの煮物', description:'ほっくり甘い秋の煮物',
    ingredients:[{name:'かぼちゃ',quantity:0.25,unit:'個'}]},
  { name:'回鍋肉', description:'キャベツと豚バラのピリ辛炒め',
    ingredients:[{name:'豚バラ肉',quantity:200,unit:'g'},{name:'キャベツ',quantity:0.25,unit:'個'},
      {name:'ピーマン',quantity:2,unit:'個'},{name:'ねぎ',quantity:1,unit:'本'},
      {name:'にんにく',quantity:2,unit:'片'}]},
  { name:'酢豚', description:'甘酢あんかけの中華料理',
    ingredients:[{name:'豚ロース',quantity:250,unit:'g'},{name:'たまねぎ',quantity:0.5,unit:'個'},
      {name:'にんじん',quantity:0.5,unit:'本'},{name:'ピーマン',quantity:2,unit:'個'}]},
  { name:'鶏の照り焼き', description:'甘辛タレでご飯が進む定番おかず',
    ingredients:[{name:'鶏もも肉',quantity:300,unit:'g'}]},
  { name:'ナポリタン', description:'ケチャップベースの懐かしい洋食',
    ingredients:[{name:'スパゲッティ',quantity:200,unit:'g'},{name:'ウインナー',quantity:4,unit:'本'},
      {name:'たまねぎ',quantity:0.5,unit:'個'},{name:'ピーマン',quantity:2,unit:'個'},
      {name:'マッシュルーム',quantity:4,unit:'個'}]},
  { name:'焼きそば', description:'ソースの香ばしい炒め麺',
    ingredients:[{name:'中華麺',quantity:2,unit:'玉'},{name:'豚肉',quantity:150,unit:'g'},
      {name:'キャベツ',quantity:0.25,unit:'個'},{name:'もやし',quantity:1,unit:'袋'},
      {name:'にんじん',quantity:0.3,unit:'本'}]},
  { name:'お好み焼き', description:'具だくさんの関西風お好み焼き',
    ingredients:[{name:'薄力粉',quantity:150,unit:'g'},{name:'卵',quantity:2,unit:'個'},
      {name:'キャベツ',quantity:0.25,unit:'個'},{name:'豚バラ肉',quantity:150,unit:'g'},
      {name:'山芋',quantity:50,unit:'g'},{name:'天かす',quantity:20,unit:'g'}]},
  { name:'餃子', description:'手作りのジューシー焼き餃子',
    ingredients:[{name:'豚ひき肉',quantity:200,unit:'g'},{name:'キャベツ',quantity:0.25,unit:'個'},
      {name:'ねぎ',quantity:1,unit:'本'},{name:'にんにく',quantity:2,unit:'片'},
      {name:'しょうが',quantity:1,unit:'片'},{name:'餃子の皮',quantity:30,unit:'枚'}]},
  { name:'牛丼', description:'甘辛い牛肉とたまねぎのどんぶり',
    ingredients:[{name:'牛バラ肉',quantity:300,unit:'g'},{name:'たまねぎ',quantity:1,unit:'個'},
      {name:'ご飯',quantity:2,unit:'杯'}]},
  { name:'かつ丼', description:'サクサクのカツを卵でとじたどんぶり',
    ingredients:[{name:'豚ロースカツ',quantity:2,unit:'枚'},{name:'卵',quantity:3,unit:'個'},
      {name:'たまねぎ',quantity:0.5,unit:'個'},{name:'ご飯',quantity:2,unit:'杯'}]},
  { name:'天ぷら', description:'サクサクの揚げ物盛り合わせ',
    ingredients:[{name:'えび',quantity:8,unit:'尾'},{name:'さつまいも',quantity:1,unit:'本'},
      {name:'なす',quantity:1,unit:'本'},{name:'ピーマン',quantity:2,unit:'個'},
      {name:'薄力粉',quantity:150,unit:'g'},{name:'卵',quantity:1,unit:'個'}]},
  { name:'コロッケ', description:'サクサクのじゃがいもコロッケ',
    ingredients:[{name:'じゃがいも',quantity:4,unit:'個'},{name:'合い挽き肉',quantity:100,unit:'g'},
      {name:'たまねぎ',quantity:0.5,unit:'個'},{name:'卵',quantity:2,unit:'個'},
      {name:'パン粉',quantity:60,unit:'g'}]},
  { name:'筑前煮', description:'根菜と鶏肉の彩り豊かな煮物',
    ingredients:[{name:'鶏もも肉',quantity:250,unit:'g'},{name:'れんこん',quantity:1,unit:'節'},
      {name:'にんじん',quantity:1,unit:'本'},{name:'ごぼう',quantity:0.5,unit:'本'},
      {name:'こんにゃく',quantity:1,unit:'枚'},{name:'しいたけ',quantity:4,unit:'枚'},
      {name:'さやいんげん',quantity:50,unit:'g'}]},
  { name:'茄子の味噌炒め', description:'ご飯に合う甘辛茄子炒め',
    ingredients:[{name:'なす',quantity:3,unit:'本'},{name:'ピーマン',quantity:2,unit:'個'},
      {name:'豚ひき肉',quantity:100,unit:'g'}]},
  { name:'ひじきの煮物', description:'ミネラル豊富な和の常備菜',
    ingredients:[{name:'ひじき',quantity:30,unit:'g'},{name:'油揚げ',quantity:1,unit:'枚'},
      {name:'にんじん',quantity:0.5,unit:'本'},{name:'大豆',quantity:50,unit:'g'}]},
  { name:'切り干し大根の煮物', description:'食物繊維たっぷりの常備菜',
    ingredients:[{name:'切り干し大根',quantity:40,unit:'g'},{name:'にんじん',quantity:0.5,unit:'本'},
      {name:'油揚げ',quantity:1,unit:'枚'}]},
  { name:'冷奴', description:'夏にぴったりのさっぱり豆腐料理',
    ingredients:[{name:'豆腐',quantity:1,unit:'丁'},{name:'ねぎ',quantity:0.5,unit:'本'},
      {name:'しょうが',quantity:1,unit:'片'}]},
  { name:'厚揚げの煮物', description:'だしを吸った厚揚げの煮物',
    ingredients:[{name:'厚揚げ',quantity:2,unit:'枚'},{name:'ほうれん草',quantity:0.5,unit:'袋'}]},
  { name:'春巻き', description:'パリパリの皮が美味しい揚げ物',
    ingredients:[{name:'豚ひき肉',quantity:150,unit:'g'},{name:'にら',quantity:1,unit:'束'},
      {name:'もやし',quantity:1,unit:'袋'},{name:'春雨',quantity:30,unit:'g'},
      {name:'春巻きの皮',quantity:10,unit:'枚'}]},
  { name:'豚の角煮', description:'柔らかくとろける豚バラの煮込み',
    ingredients:[{name:'豚バラ肉',quantity:500,unit:'g'},{name:'ゆで卵',quantity:4,unit:'個'},
      {name:'しょうが',quantity:2,unit:'片'}]},
  { name:'豆腐の味噌汁', description:'定番の豆腐とわかめの味噌汁',
    ingredients:[{name:'豆腐',quantity:0.5,unit:'丁'},{name:'ねぎ',quantity:1,unit:'本'},
      {name:'わかめ',quantity:5,unit:'g'}]},
  { name:'なすの煮浸し', description:'出汁を含んだジューシーな副菜',
    ingredients:[{name:'なす',quantity:4,unit:'本'},{name:'しょうが',quantity:1,unit:'片'}]},
  { name:'白和え', description:'豆腐ベースのクリーミーな和え物',
    ingredients:[{name:'豆腐',quantity:1,unit:'丁'},{name:'ほうれん草',quantity:1,unit:'袋'},
      {name:'にんじん',quantity:0.5,unit:'本'},{name:'こんにゃく',quantity:0.5,unit:'枚'}]},
  { name:'鶏のみそ焼き', description:'みそだれで焼いた風味豊かなチキン',
    ingredients:[{name:'鶏もも肉',quantity:300,unit:'g'}]},
  { name:'ぶり大根', description:'ぶりの旨味が大根に染み込んだ煮物',
    ingredients:[{name:'ぶり',quantity:3,unit:'切れ'},{name:'だいこん',quantity:0.5,unit:'本'},
      {name:'しょうが',quantity:2,unit:'片'}]},
  { name:'鮭のホイル焼き', description:'ホイルで蒸し焼きにした野菜たっぷりの一品',
    ingredients:[{name:'鮭',quantity:2,unit:'切れ'},{name:'たまねぎ',quantity:0.5,unit:'個'},
      {name:'にんじん',quantity:0.5,unit:'本'},{name:'しめじ',quantity:1,unit:'袋'},
      {name:'バター',quantity:20,unit:'g'}]},
  { name:'豚バラ大根', description:'豚バラと大根のシンプル煮物',
    ingredients:[{name:'豚バラ肉',quantity:200,unit:'g'},{name:'だいこん',quantity:0.5,unit:'本'},
      {name:'ねぎ',quantity:1,unit:'本'},{name:'しょうが',quantity:1,unit:'片'}]},
  { name:'小松菜の炒め物', description:'油揚げと合わせた栄養豊富な炒め物',
    ingredients:[{name:'小松菜',quantity:1,unit:'袋'},{name:'油揚げ',quantity:1,unit:'枚'},
      {name:'しょうが',quantity:1,unit:'片'}]},
  { name:'キャベツの味噌炒め', description:'ベーコンとキャベツのボリューム炒め',
    ingredients:[{name:'キャベツ',quantity:0.5,unit:'個'},{name:'ベーコン',quantity:4,unit:'枚'},
      {name:'にんにく',quantity:2,unit:'片'}]},
  { name:'もやし炒め', description:'シャキシャキもやしとにらのスピード炒め',
    ingredients:[{name:'もやし',quantity:2,unit:'袋'},{name:'にら',quantity:0.5,unit:'束'},
      {name:'豚肉',quantity:100,unit:'g'}]},
  { name:'アジの塩焼き', description:'シンプルに塩で焼いた青魚',
    ingredients:[{name:'アジ',quantity:2,unit:'尾'}]},
  { name:'おでん', description:'寒い日に温まる具だくさんの鍋料理',
    ingredients:[{name:'だいこん',quantity:0.5,unit:'本'},{name:'こんにゃく',quantity:1,unit:'枚'},
      {name:'卵',quantity:4,unit:'個'},{name:'ちくわ',quantity:4,unit:'本'},
      {name:'厚揚げ',quantity:2,unit:'枚'}]},
  { name:'豆腐ステーキ', description:'こんがり焼いた豆腐のきのこあんかけ',
    ingredients:[{name:'豆腐',quantity:1,unit:'丁'},{name:'しいたけ',quantity:2,unit:'枚'},
      {name:'ねぎ',quantity:1,unit:'本'},{name:'にんにく',quantity:1,unit:'片'}]},
];

// ====================================================
// INIT
// ====================================================
function init() {
  loadState();
  if (!STATE.customRecipes.length) {
    STATE.customRecipes = PRESET_RECIPES.map(r => ({ ...r, id: uid() }));
    persist();
  }
  renderDashboard();
  updateShoppingBadge();
  refreshNameDatalist();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
