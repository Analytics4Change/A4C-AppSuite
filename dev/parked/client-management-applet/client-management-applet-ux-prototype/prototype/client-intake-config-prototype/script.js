/* ============================================================
   A4C-AppSuite — Client Intake Configuration Prototype
   Tab switching, toggle state, custom field management
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initTabScrollArrows();
  initDualToggles();
  initToggles();
  initCustomFields();
  initCategories();
  initFundingSources();
  initUnsavedIndicator();
});

// --- Tab Navigation ---
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(target).classList.add('active');

      // Scroll tab into view if off-screen
      tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });

    // Keyboard: Enter/Space activates tab
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        tab.click();
      }
    });
  });
}

// --- Tab Scroll Arrows (Option 1: CSS mask hides overlapping text) ---
function initTabScrollArrows() {
  const wrapper = document.querySelector('.tab-bar-wrapper');
  const tabBar = document.querySelector('.tab-bar');
  const leftArrow = document.querySelector('.tab-scroll-left');
  const rightArrow = document.querySelector('.tab-scroll-right');

  if (!tabBar || !leftArrow || !rightArrow) return;

  function updateArrows() {
    const { scrollLeft, scrollWidth, clientWidth } = tabBar;
    const showLeft = scrollLeft > 0;
    const showRight = scrollLeft < scrollWidth - clientWidth - 1;

    leftArrow.classList.toggle('visible', showLeft);
    rightArrow.classList.toggle('visible', showRight);
    wrapper.classList.toggle('left-active', showLeft);
    wrapper.classList.toggle('right-active', showRight);
  }

  tabBar.addEventListener('scroll', updateArrows);
  window.addEventListener('resize', updateArrows);
  updateArrows();

  leftArrow.addEventListener('click', () => tabBar.scrollBy({ left: -160, behavior: 'smooth' }));
  rightArrow.addEventListener('click', () => tabBar.scrollBy({ left: 160, behavior: 'smooth' }));
}

// --- Dual Toggle Controls (Show + Required) ---
function initDualToggles() {
  document.querySelectorAll('.toggle-row').forEach(row => {
    const existingSwitch = row.querySelector(':scope > label.switch');
    if (!existingSwitch) return;

    // Build the controls wrapper
    const controls = document.createElement('div');
    controls.className = 'toggle-controls';

    // "Show" row — move existing switch into it
    const showItem = document.createElement('div');
    showItem.className = 'toggle-control-item';
    const showLabel = document.createElement('span');
    showLabel.className = 'toggle-control-label';
    showLabel.textContent = 'Show';
    showItem.appendChild(showLabel);
    existingSwitch.parentNode.insertBefore(controls, existingSwitch);
    showItem.appendChild(existingSwitch);
    controls.appendChild(showItem);

    // "Required" row — new toggle
    const reqItem = document.createElement('div');
    reqItem.className = 'toggle-control-item';
    const reqLabel = document.createElement('span');
    reqLabel.className = 'toggle-control-label';
    reqLabel.textContent = 'Required';
    const reqSwitch = document.createElement('label');
    reqSwitch.className = 'switch';
    const reqInput = document.createElement('input');
    reqInput.type = 'checkbox';
    reqInput.checked = true;
    const reqTrack = document.createElement('span');
    reqTrack.className = 'switch-track';
    reqSwitch.appendChild(reqInput);
    reqSwitch.appendChild(reqTrack);
    reqItem.appendChild(reqLabel);
    reqItem.appendChild(reqSwitch);
    controls.appendChild(reqItem);

    // Show/hide required row based on show toggle
    const showInput = existingSwitch.querySelector('input');
    function syncRequired() {
      const isShown = showInput.checked;
      reqItem.style.display = isShown ? 'flex' : 'none';
      if (!isShown) reqInput.checked = false;
    }
    syncRequired();
    showInput.addEventListener('change', () => { syncRequired(); markUnsaved(); });
    reqInput.addEventListener('change', markUnsaved);
  });
}

// --- Toggle Switches ---
function initToggles() {
  document.querySelectorAll('.switch input').forEach(toggle => {
    toggle.addEventListener('change', () => {
      markUnsaved();
    });
  });

  // Label rename inputs
  document.querySelectorAll('.label-rename input').forEach(input => {
    input.addEventListener('input', () => {
      markUnsaved();
    });
  });

  // Language checkboxes
  document.querySelectorAll('.language-check input').forEach(cb => {
    cb.addEventListener('change', () => {
      markUnsaved();
    });
  });
}

// --- Custom Fields Management ---
let customFieldIdCounter = 0;

function initCustomFields() {
  const addBtn = document.getElementById('add-custom-field-btn');
  const form = document.getElementById('add-custom-field-form');
  const cancelBtn = document.getElementById('cancel-custom-field');
  const saveBtn = document.getElementById('save-custom-field');

  if (!addBtn) return;

  const nameInput = document.getElementById('cf-name');
  const keyInput = document.getElementById('cf-key');
  const typeSelect = document.getElementById('cf-type');
  const optionsGroup = document.getElementById('cf-options-group');
  const optionsList = document.getElementById('cf-options-list');
  const optionInput = document.getElementById('cf-option-input');
  const optionAddBtn = document.getElementById('cf-option-add-btn');

  nameInput.addEventListener('input', () => {
    keyInput.value = nameInput.value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_');
  });

  typeSelect.addEventListener('change', () => {
    const show = typeSelect.value === 'enum' || typeSelect.value === 'multi_enum';
    optionsGroup.style.display = show ? 'block' : 'none';
  });

  function addOption() {
    const val = optionInput.value.trim();
    if (!val) return;
    const tag = document.createElement('div');
    tag.className = 'cf-option-tag';
    tag.innerHTML = `<span>${escapeHtml(val)}</span><button type="button" class="cf-option-remove" aria-label="Remove">×</button>`;
    tag.querySelector('.cf-option-remove').addEventListener('click', () => tag.remove());
    optionsList.appendChild(tag);
    optionInput.value = '';
    optionInput.focus();
  }

  optionAddBtn.addEventListener('click', addOption);
  optionInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } });

  addBtn.addEventListener('click', () => {
    form.style.display = 'block';
    addBtn.style.display = 'none';
    nameInput.focus();
  });

  cancelBtn.addEventListener('click', () => {
    form.style.display = 'none';
    addBtn.style.display = 'inline-flex';
    clearCustomFieldForm();
  });

  saveBtn.addEventListener('click', () => {
    const key = document.getElementById('cf-key').value.trim();
    const name = document.getElementById('cf-name').value.trim();
    const type = document.getElementById('cf-type').value;
    const category = document.getElementById('cf-category').value;
    const isRequired = document.getElementById('cf-required').checked;

    if (!key || !name) return;

    const options = Array.from(optionsList.querySelectorAll('.cf-option-tag span')).map(s => s.textContent);
    addCustomFieldRow(key, name, type, category, isRequired, options);
    form.style.display = 'none';
    addBtn.style.display = 'inline-flex';
    clearCustomFieldForm();
    markUnsaved();
  });
}

function addCustomFieldRow(key, name, type, category, isRequired, options = []) {
  const tbody = document.getElementById('custom-fields-tbody');
  const id = 'cf-row-' + (++customFieldIdCounter);

  const typeLabels = {
    text: 'Text',
    number: 'Number',
    date: 'Date',
    enum: 'Single Select',
    multi_enum: 'Multi-Select',
    boolean: 'True/False'
  };

  const tr = document.createElement('tr');
  tr.id = id;
  tr.innerHTML = `
    <td><span class="field-key">${escapeHtml(key)}</span></td>
    <td>${escapeHtml(name)}</td>
    <td>${typeLabels[type] || type}${(type === 'enum' || type === 'multi_enum') && options.length ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.125rem;">${options.length} option${options.length !== 1 ? 's' : ''}</div>` : ''}</td>
    <td>${escapeHtml(category)}</td>
    <td>
      ${isRequired ? '<span class="badge-dimension" style="background:rgba(255,149,0,0.1);color:#c2410c;">Required</span>' : ''}
    </td>
    <td class="actions">
      <button class="btn btn-ghost btn-icon" title="Edit" onclick="alert('Edit field: ${escapeHtml(key)}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      </button>
      <button class="btn btn-danger-ghost btn-icon" title="Delete" onclick="deleteCustomField('${id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </button>
    </td>
  `;
  tbody.appendChild(tr);
}

function deleteCustomField(id) {
  const row = document.getElementById(id);
  if (row) {
    row.remove();
    markUnsaved();
  }
}

function clearCustomFieldForm() {
  document.getElementById('cf-key').value = '';
  document.getElementById('cf-name').value = '';
  document.getElementById('cf-type').value = 'text';
  document.getElementById('cf-category').value = 'administrative';
  document.getElementById('cf-required').checked = false;
  document.getElementById('cf-options-list').innerHTML = '';
  document.getElementById('cf-option-input').value = '';
  document.getElementById('cf-options-group').style.display = 'none';
}

// --- Categories Management ---
function initCategories() {
  const addBtn = document.getElementById('add-category-btn');
  const form = document.getElementById('add-category-form');
  const cancelBtn = document.getElementById('cancel-category');
  const saveBtn = document.getElementById('save-category');

  if (!addBtn) return;

  addBtn.addEventListener('click', () => {
    form.style.display = 'block';
    addBtn.style.display = 'none';
    form.querySelector('input')?.focus();
  });

  cancelBtn.addEventListener('click', () => {
    form.style.display = 'none';
    addBtn.style.display = 'inline-flex';
  });

  saveBtn.addEventListener('click', () => {
    const name = document.getElementById('cat-name').value.trim();
    const slug = document.getElementById('cat-slug').value.trim();
    if (!name || !slug) return;

    addCategoryRow(name, slug);
    form.style.display = 'none';
    addBtn.style.display = 'inline-flex';
    document.getElementById('cat-name').value = '';
    document.getElementById('cat-slug').value = '';
    markUnsaved();
  });
}

function addCategoryRow(name, slug) {
  const list = document.getElementById('categories-list');
  const div = document.createElement('div');
  div.className = 'category-item';
  div.innerHTML = `
    <div>
      <div class="category-name">${escapeHtml(name)}</div>
      <div class="category-slug">${escapeHtml(slug)}</div>
    </div>
    <div style="display:flex;gap:0.5rem;">
      <button class="btn btn-ghost btn-icon" title="Edit" onclick="alert('Edit category')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      </button>
      <button class="btn btn-danger-ghost btn-icon" title="Delete" onclick="this.closest('.category-item').remove(); markUnsaved();">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </button>
    </div>
  `;
  list.appendChild(div);
}

// --- Unsaved Changes Indicator ---
let hasUnsavedChanges = false;

function markUnsaved() {
  hasUnsavedChanges = true;
  const indicator = document.getElementById('unsaved-indicator');
  if (indicator) indicator.style.display = 'flex';
}

function initUnsavedIndicator() {
  const saveBtn = document.getElementById('save-config-btn');
  const resetBtn = document.getElementById('reset-config-btn');

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      hasUnsavedChanges = false;
      const indicator = document.getElementById('unsaved-indicator');
      if (indicator) indicator.style.display = 'none';
      showToast('Configuration saved successfully');
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset all settings to defaults? This cannot be undone.')) {
        location.reload();
      }
    });
  }
}

// --- Toast Notification ---
function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 2rem; right: 2rem; z-index: 1000;
    background: #1a1a2e; color: white; padding: 0.75rem 1.25rem;
    border-radius: 0.75rem; font-size: 0.875rem; font-weight: 500;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    display: flex; align-items: center; gap: 0.5rem;
    animation: slideIn 0.3s ease;
  `;
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>
    ${message}
  `;

  const style = document.createElement('style');
  style.textContent = '@keyframes slideIn { from { transform: translateY(1rem); opacity: 0; } to { transform: translateY(0); opacity: 1; } }';
  document.head.appendChild(style);

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(1rem)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// --- External Funding Sources ---
function initFundingSources() {
  const btn = document.getElementById('add-funding-source-btn');
  if (!btn) return;

  const payerToggles = btn.closest('.glass-card').querySelector('.payer-toggles');
  let count = 1;

  btn.addEventListener('click', () => {
    count++;
    const defaultLabel = `External Funding Source ${count}`;

    const div = document.createElement('div');
    div.className = 'payer-toggle payer-toggle-configurable';
    div.innerHTML = `
      <label class="switch"><input type="checkbox" checked><span class="switch-track"></span></label>
      <div class="payer-toggle-info">
        <div class="payer-toggle-info-header">
          <span class="payer-toggle-label">${escapeHtml(defaultLabel)}</span>
          <button class="funding-source-remove-btn" title="Remove funding source" aria-label="Remove ${escapeHtml(defaultLabel)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="label-rename">
          <span class="label-rename-label">Display label:</span>
          <input type="text" placeholder="${escapeHtml(defaultLabel)}" value="${escapeHtml(defaultLabel)}">
        </div>
      </div>
    `;

    div.querySelector('.funding-source-remove-btn').addEventListener('click', () => {
      div.remove();
      markUnsaved();
    });

    div.querySelector('input[type="checkbox"]').addEventListener('change', markUnsaved);
    div.querySelector('input[type="text"]').addEventListener('input', markUnsaved);

    payerToggles.appendChild(div);
    div.querySelector('input[type="text"]').focus();
    markUnsaved();
  });
}

// --- Utility ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
