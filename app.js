(() => {
  const STATUS = ['Aguardando separação', 'Em separação', 'Pronta para sair', 'Em rota', 'Entregue'];
  const STATUS_CLASS = {
    'Aguardando separação': 'queued',
    'Em separação': 'preparing',
    'Pronta para sair': 'ready',
    'Em rota': 'route',
    'Entregue': 'done'
  };
  const STATUS_ICON = { 'Aguardando separação': '◷', 'Em separação': '▤', 'Pronta para sair': '✓', 'Em rota': '↗', 'Entregue': '✓' };
  const ROLE_NAMES = { admin: 'Administrativo', management: 'Gestão', driver: 'Motorista' };
  const PAGE_NAMES = { overview: 'Visão geral', schedule: 'Programação', invoices: 'Arquivo de notas', 'add-invoice': 'Adicionar notas', windows: 'Janelas de entrega', users: 'Acessos da equipe' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { user: null, invoices: [], windows: [], drivers: [], users: [], supplierInvoices: [] };
  let weekOffset = 0;
  let selectedFile = null;
  let supplierSelectedFile = null;
  let addSection = 'delivery';
  let deleteTarget = null;
  let toastTimer;

  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const todayKey = () => dateKey(new Date());
  const parseDate = value => { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day, 12); };
  const startOfWeek = date => { const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12); const day = result.getDay(); result.setDate(result.getDate() - (day === 0 ? 6 : day - 1)); return result; };
  const weekDates = offset => { const monday = startOfWeek(new Date()); monday.setDate(monday.getDate() + offset * 7); return Array.from({ length: 6 }, (_, index) => { const date = new Date(monday); date.setDate(monday.getDate() + index); return date; }); };
  const ptDate = (date, options = { day: '2-digit', month: 'short' }) => new Intl.DateTimeFormat('pt-BR', options).format(date).replace('.', '');
  const formatLongDate = date => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(date);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const isAdmin = () => state.user?.role === 'admin';
  const isDriver = () => state.user?.role === 'driver';

  async function api(path, options = {}) {
    const headers = { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const result = contentType.includes('application/json') ? await response.json() : {};
    if (!response.ok) {
      if (response.status === 401 && state.user && !['/api/login', '/api/setup'].includes(path)) {
        state.user = null;
        showAuth(false);
      }
      throw new Error(result.error || 'Não foi possível concluir a solicitação.');
    }
    return result;
  }

  function showAuth(needsSetup) {
    $('#appRoot').classList.add('hidden');
    $('#authGate').classList.remove('hidden');
    $('#setupPanel').classList.toggle('hidden', !needsSetup);
    $('#loginPanel').classList.toggle('hidden', needsSetup);
  }

  async function loadApp(initialView) {
    const data = await api('/api/bootstrap');
    state.user = data.user;
    state.invoices = data.invoices;
    state.windows = data.windows;
    state.drivers = data.drivers;
    state.users = data.users || [];
    state.supplierInvoices = data.supplierInvoices || [];
    $('#authGate').classList.add('hidden');
    $('#appRoot').classList.remove('hidden');
    render();
    const view = initialView || (isAdmin() ? 'add-invoice' : 'overview');
    setView(view);
    return data;
  }

  async function initialize() {
    try {
      const setup = await api('/api/setup-status');
      if (setup.needsSetup) {
        showAuth(true);
        return;
      }
      try {
        await loadApp();
      } catch (error) {
        if (error.message) showAuth(false);
      }
    } catch (error) {
      showAuth(false);
      showToast('Inicie o servidor local para abrir a aplicação. Veja o README.');
    }
  }

  function roleGreeting() {
    if (isDriver()) return `Olá, ${state.user.name.split(' ')[0]}`;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    return `${greeting}, ${state.user.name.split(' ')[0]}`;
  }

  function renderRole() {
    const user = state.user;
    const initials = user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    $('#sidebarName').textContent = user.name;
    $('#sidebarRole').textContent = ROLE_NAMES[user.role];
    $('#sidebarAvatar').textContent = initials;
    $('#topName').textContent = user.name;
    $('#topRole').textContent = ROLE_NAMES[user.role];
    $('#topRole').className = `role-pill role-${user.role}`;
    document.body.classList.toggle('admin-mode', isAdmin());
    document.body.classList.toggle('driver-mode', isDriver());
    $('#pageTitle').textContent = roleGreeting();
    $('#pageSubtitle').textContent = isAdmin()
      ? 'Cadastre notas fiscais, organize entregas e gerencie os acessos.'
      : isDriver()
        ? 'Confira suas entregas e atualize o andamento da rota.'
        : 'Acompanhe o fluxo de notas e as entregas da semana.';
    $('#welcomeLine').textContent = formatLongDate(new Date()).toLocaleUpperCase('pt-BR');
  }

  function windowById(id) { return state.windows.find(window => window.id === id) || null; }
  function formatWindow(window) { if (!window) return 'Horário a definir'; return window.end ? `${window.start}–${window.end}` : `A partir das ${window.start}`; }

  function renderStats() {
    const invoices = state.invoices;
    const cards = [
      ['Notas em aberto', invoices.filter(item => !['Entregue', 'Em rota'].includes(item.status)).length, 'Aguardando preparo ou saída', '▤', 'orange'],
      ['Entregas para hoje', invoices.filter(item => item.date === todayKey() && item.status !== 'Entregue').length, 'Pedidos previstos para hoje', '◷', 'green'],
      ['Em rota', invoices.filter(item => item.status === 'Em rota').length, 'Motoristas em deslocamento', '↗', 'blue'],
      ['Entregues na semana', invoices.filter(item => item.status === 'Entregue' && weekDates(0).some(date => dateKey(date) === item.date)).length, 'Concluídas de segunda a sábado', '✓', 'gray']
    ];
    $('#statsGrid').innerHTML = cards.map(([label, value, caption, icon, color]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-caption">${caption}</div></article>`).join('');
  }

  function renderWeekLabels() {
    const dates = weekDates(weekOffset);
    const range = `${ptDate(dates[0])} – ${ptDate(dates[5], { day: '2-digit', month: 'long', year: 'numeric' })}`;
    $('#weekRangeLabel').textContent = range;
    $('#scheduleWeekRange').textContent = range;
  }

  function renderOverviewBoard() {
    const dates = weekDates(weekOffset);
    const weekdays = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    $('#overviewBoard').innerHTML = dates.map((date, index) => {
      const key = dateKey(date);
      const dayInvoices = state.invoices.filter(invoice => invoice.date === key).sort((a, b) => a.slot.localeCompare(b.slot));
      const cards = dayInvoices.slice(0, 3).map(invoice => {
        const window = windowById(invoice.slot);
        const kind = invoice.status === 'Entregue' ? 'done' : invoice.status === 'Em rota' ? 'route' : '';
        return `<div class="booking-mini ${kind}" title="NF ${escapeHtml(invoice.number)} · ${escapeHtml(invoice.customer)} · ${formatWindow(window)}"><strong>${escapeHtml(invoice.customer)}</strong><small>${formatWindow(window)} · NF ${escapeHtml(invoice.number)}</small></div>`;
      }).join('');
      const extra = dayInvoices.length > 3 ? `<div class="more-bookings">+${dayInvoices.length - 3} entrega(s)</div>` : '';
      return `<div class="week-day ${key === todayKey() ? 'today' : ''}"><div class="week-day-head">${weekdays[index]}<strong>${String(date.getDate()).padStart(2, '0')}</strong></div><div class="day-bookings">${cards || '<div class="empty-day">Livre</div>'}${extra}</div></div>`;
    }).join('');
  }

  function renderFlow() {
    const total = Math.max(state.invoices.length, 1);
    $('#flowList').innerHTML = STATUS.map(status => {
      const count = state.invoices.filter(invoice => invoice.status === status).length;
      const width = Math.round(count / total * 100);
      const kind = STATUS_CLASS[status];
      return `<div class="flow-row"><div class="flow-icon ${kind}">${STATUS_ICON[status]}</div><div class="flow-label"><strong>${status}</strong><small>${count === 1 ? '1 nota fiscal' : `${count} notas fiscais`}</small></div><div class="flow-count">${count}</div><div class="flow-progress"><i style="width:${width}%"></i></div></div>`;
    }).join('');
  }

  function badge(status) { return `<span class="status-badge ${STATUS_CLASS[status] || ''}">${escapeHtml(status)}</span>`; }

  function statusAction(invoice) {
    if (isAdmin()) return '<span class="cell-sub">Gerenciado pela Administração</span>';
    let options = STATUS;
    let disabled = false;
    if (isDriver()) {
      if (invoice.status === 'Em rota') options = ['Em rota', 'Entregue'];
      else if (invoice.status === 'Pronta para sair') options = ['Pronta para sair', 'Em rota'];
      else { options = [invoice.status]; disabled = true; }
    }
    return `<select class="action-select" data-status-id="${invoice.id}" aria-label="Atualizar status da nota ${escapeHtml(invoice.number)}" ${disabled ? 'disabled title="A entrega ficará disponível após a separação do pedido."' : ''}>${options.map(status => `<option value="${escapeHtml(status)}" ${status === invoice.status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}</select>`;
  }

  function invoiceActions(invoice) {
    if (!isAdmin()) return statusAction(invoice);
    return `<div class="row-actions"><button class="row-action" data-action="detail" data-id="${invoice.id}" title="Visualizar nota" aria-label="Visualizar nota">◉</button><button class="row-action" data-action="edit" data-id="${invoice.id}" title="Editar nota" aria-label="Editar nota">✎</button><button class="row-action danger-text" data-action="delete" data-id="${invoice.id}" title="Excluir nota" aria-label="Excluir nota">×</button></div>`;
  }

  function invoiceRow(invoice, compact = false) {
    const window = windowById(invoice.slot);
    const date = parseDate(invoice.date);
    if (compact) return `<tr><td><span class="invoice-id">NF ${escapeHtml(invoice.number)}</span><span class="cell-sub">${escapeHtml(invoice.customer)}</span></td><td class="date-cell">${ptDate(date, { day: '2-digit', month: 'short' })}<span class="cell-sub">${formatWindow(window)}</span></td><td>${escapeHtml(invoice.driver)}</td><td>${badge(invoice.status)}</td><td>${invoiceActions(invoice)}</td></tr>`;
    return `<tr><td><span class="invoice-id">NF ${escapeHtml(invoice.number)}</span><span class="cell-sub">${escapeHtml(invoice.customer)}${invoice.fileName ? ' · 📎' : ''}</span></td><td><span class="cell-sub address-cell">${escapeHtml(invoice.address)}</span></td><td class="date-cell">${ptDate(date, { day: '2-digit', month: 'short' })}<span class="cell-sub">${formatWindow(window)}</span></td><td>${escapeHtml(invoice.driver)}</td><td>${badge(invoice.status)}</td><td>${invoiceActions(invoice)}</td></tr>`;
  }

  function renderTables() {
    const upcoming = state.invoices.filter(invoice => invoice.date >= todayKey() && invoice.status !== 'Entregue').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
    $('#upcomingRows').innerHTML = upcoming.length ? upcoming.map(invoice => invoiceRow(invoice, true)).join('') : '<tr><td colspan="5" class="cell-sub">Nenhuma entrega próxima programada.</td></tr>';
    const search = ($('#invoiceSearch')?.value || '').trim().toLowerCase();
    const filter = $('#statusFilter')?.value || 'all';
    const found = state.invoices.filter(invoice => {
      const matchesSearch = !search || [invoice.number, invoice.customer, invoice.address, invoice.driver].some(value => String(value).toLowerCase().includes(search));
      return matchesSearch && (filter === 'all' || invoice.status === filter);
    }).sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
    $('#invoiceRows').innerHTML = found.map(invoice => invoiceRow(invoice)).join('');
    $('#invoiceEmpty').classList.toggle('hidden', found.length > 0);
    $('#sidebarInvoiceCount').textContent = state.invoices.length;
  }

  function renderSchedule() {
    const dates = weekDates(weekOffset);
    const dayNames = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    $('#scheduleBoard').innerHTML = dates.map((date, index) => {
      const key = dateKey(date);
      const invoices = state.invoices.filter(invoice => invoice.date === key);
      const groups = state.windows.map(window => {
        const list = invoices.filter(invoice => invoice.slot === window.id);
        const cards = list.map(invoice => `<article class="schedule-card"><span class="invoice-id">NF ${escapeHtml(invoice.number)}</span><span class="customer-name">${escapeHtml(invoice.customer)}</span><span class="card-location">⌖ ${escapeHtml(invoice.address)}</span><div class="card-bottom"><span class="mini-driver">${escapeHtml(invoice.driver)}</span>${badge(invoice.status)}</div></article>`).join('');
        return `<section class="slot-group"><div class="slot-group-head"><span>${formatWindow(window)}</span><span class="slot-count">${list.length} ${list.length === 1 ? 'nota' : 'notas'}</span></div>${cards || '<div class="slot-empty">Sem entregas</div>'}</section>`;
      }).join('');
      return `<div class="schedule-day ${key === todayKey() ? 'today' : ''}"><div class="schedule-day-head"><div><strong>${dayNames[index]}</strong><small>${ptDate(date, { day: '2-digit', month: 'short' })}</small></div><span class="day-count">${invoices.length}</span></div>${groups}</div>`;
    }).join('');
  }

  function renderWindows() {
    $('#windowGrid').innerHTML = state.windows.map((window, index) => `<article class="window-card"><div class="window-card-top"><span class="window-number">JANELA 0${index + 1}</span><button class="window-edit" data-edit-window="${escapeHtml(window.id)}" aria-label="Editar janela 0${index + 1}">✎</button></div><div class="window-time">${formatWindow(window)}</div><div class="window-desc">${index === 2 ? 'Atendimento estendido' : 'Período de entrega'}</div><div class="window-card-bottom"><span>Segunda a sábado</span><span class="window-enabled"><i></i> Disponível</span></div></article>`).join('');
  }

  function fillSelects() {
    const slotOptions = state.windows.map((window, index) => `<option value="${escapeHtml(window.id)}">Janela 0${index + 1} · ${formatWindow(window)}</option>`).join('');
    const driverOptions = `<option value="">A definir</option>${state.drivers.map(driver => `<option value="${driver.id}">${escapeHtml(driver.name)}</option>`).join('')}`;
    ['#invoiceForm select[name="slot"]', '#editInvoiceForm select[name="slot"]'].forEach(selector => { if ($(selector)) $(selector).innerHTML = slotOptions; });
    ['#invoiceForm select[name="driverId"]', '#editInvoiceForm select[name="driverId"]'].forEach(selector => { if ($(selector)) $(selector).innerHTML = driverOptions; });
  }

  function renderUsers() {
    if (!$('#userRows')) return;
    $('#userRows').innerHTML = state.users.map(user => `<tr><td><strong class="user-row-name">${escapeHtml(user.name)}${user.id === state.user.id ? ' <small>(você)</small>' : ''}</strong></td><td>${escapeHtml(user.username)}</td><td><span class="user-role-label">${ROLE_NAMES[user.role]}</span></td><td>${user.id === state.user.id ? '' : `<button class="row-action danger-text" data-delete-user="${user.id}" title="Excluir acesso" aria-label="Excluir acesso de ${escapeHtml(user.name)}">×</button>`}</td></tr>`).join('') || '<tr><td colspan="4" class="cell-sub">Nenhuma conta cadastrada.</td></tr>';
  }

  function formatNumber(value, digits = 2) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(Number(value) || 0);
  }

  function renderSupplierInvoices() {
    const rows = $('#supplierInvoiceRows');
    if (!rows) return;
    const invoices = state.supplierInvoices || [];
    $('#supplierArchiveCount').textContent = invoices.length === 1 ? '1 nota' : `${invoices.length} notas`;
    $('#supplierInvoiceEmpty').classList.toggle('hidden', invoices.length > 0);
    rows.innerHTML = invoices.map(invoice => `<tr>
      <td><strong class="user-row-name">NF ${escapeHtml(invoice.number)}</strong><br><span class="cell-sub">${escapeHtml(invoice.supplier)}</span></td>
      <td>${ptDate(parseDate(invoice.receivedDate), { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td>${invoice.items.length} ${invoice.items.length === 1 ? 'produto' : 'produtos'}</td>
      <td>${formatNumber(invoice.volumeM3, 3)} m³</td>
      <td>${formatNumber(invoice.weightKg)} kg</td>
      <td><div class="row-actions"><button class="row-action" data-supplier-action="detail" data-id="${invoice.id}" title="Ver nota" aria-label="Ver nota ${escapeHtml(invoice.number)}">⌕</button><button class="row-action" data-supplier-action="edit" data-id="${invoice.id}" title="Editar nota" aria-label="Editar nota ${escapeHtml(invoice.number)}">✎</button><button class="row-action danger-text" data-supplier-action="delete" data-id="${invoice.id}" title="Excluir nota" aria-label="Excluir nota ${escapeHtml(invoice.number)}">×</button></div></td>
    </tr>`).join('');
  }

  function render() {
    renderRole();
    renderStats();
    renderWeekLabels();
    renderOverviewBoard();
    renderFlow();
    renderTables();
    renderSchedule();
    renderWindows();
    fillSelects();
    renderUsers();
    renderSupplierInvoices();
  }

  function setView(view) {
    if (['add-invoice', 'windows', 'users'].includes(view) && !isAdmin()) view = 'overview';
    $$('.view-panel').forEach(panel => panel.classList.toggle('active', panel.id === `view-${view}`));
    $$('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    $('#breadcrumbCurrent').textContent = PAGE_NAMES[view] || PAGE_NAMES.overview;
    $('#sidebar').classList.remove('open');
    if (view === 'add-invoice') resetAddForm();
    if (view === 'add-invoice') setAddSection(addSection);
  }

  function setAddSection(section) {
    if (section === 'supplier' && !isAdmin()) section = 'delivery';
    addSection = section;
    $$('[data-add-section]').forEach(button => {
      const active = button.dataset.addSection === section;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $('#add-delivery-section').classList.toggle('hidden', section !== 'delivery');
    $('#add-supplier-section').classList.toggle('hidden', section !== 'supplier');
  }

  function changeWeek(delta) { weekOffset += delta; renderWeekLabels(); renderOverviewBoard(); renderSchedule(); }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function showFormError(selector, message) {
    const element = $(selector);
    element.textContent = message;
    element.classList.remove('hidden');
  }

  function nextBusinessDay() {
    const date = new Date();
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    return dateKey(date);
  }

  function resetAddForm() {
    const form = $('#invoiceForm');
    if (!form) return;
    form.reset();
    form.elements.date.value = nextBusinessDay();
    form.elements.date.min = todayKey();
    selectedFile = null;
    $('#importFile').value = '';
    $('#importButton').disabled = true;
    $('#importSummary').classList.add('hidden');
    $('#selectedFileName').textContent = 'Nenhum arquivo anexado';
    $('#clearFileButton').classList.add('hidden');
    $('#invoiceError').classList.add('hidden');
    fillSelects();
  }

  function addSupplierItemRow(item = {}) {
    const row = document.createElement('div');
    row.className = 'supplier-item-row';
    row.innerHTML = `<label class="form-field"><span class="mobile-item-label">Produto</span><input name="product" required maxlength="200" placeholder="Ex.: Cimento CP II" value="${escapeHtml(item.product || '')}"></label>
      <label class="form-field"><span class="mobile-item-label">Quantidade</span><input name="quantity" type="number" min="0.0001" step="any" required placeholder="0" value="${item.quantity ? escapeHtml(item.quantity) : ''}"></label>
      <label class="form-field"><span class="mobile-item-label">Unidade</span><input name="unit" required maxlength="20" placeholder="un, saco, kg" value="${escapeHtml(item.unit || '')}"></label>
      <label class="form-field"><span class="mobile-item-label">Volume (m³)</span><input name="volumeM3" type="number" min="0" step="any" placeholder="0" value="${item.volumeM3 ? escapeHtml(item.volumeM3) : ''}"></label>
      <label class="form-field"><span class="mobile-item-label">Peso (kg)</span><input name="weightKg" type="number" min="0" step="any" placeholder="0" value="${item.weightKg ? escapeHtml(item.weightKg) : ''}"></label>
      <button class="row-action danger-text supplier-remove-item" type="button" data-remove-supplier-item aria-label="Remover produto">×</button>`;
    $('#supplierItems').append(row);
    updateSupplierTotals();
  }

  function updateSupplierTotals() {
    const rows = $$('.supplier-item-row', $('#supplierItems'));
    const volume = rows.reduce((sum, row) => sum + (Number(row.querySelector('[name="volumeM3"]').value) || 0), 0);
    const weight = rows.reduce((sum, row) => sum + (Number(row.querySelector('[name="weightKg"]').value) || 0), 0);
    const filledLines = rows.filter(row => row.querySelector('[name="product"]').value.trim() || row.querySelector('[name="quantity"]').value).length;
    $('#supplierLineCount').textContent = String(filledLines);
    $('#supplierTotalVolume').textContent = formatNumber(volume, 3);
    $('#supplierTotalWeight').textContent = formatNumber(weight);
    rows.forEach(row => {
      const remove = row.querySelector('[data-remove-supplier-item]');
      remove.disabled = rows.length === 1;
      remove.classList.toggle('hidden', rows.length === 1);
    });
  }

  function setSupplierFile(file, archivedName = '') {
    supplierSelectedFile = file || null;
    const label = supplierSelectedFile ? `${supplierSelectedFile.name} · ${(supplierSelectedFile.size / 1024 / 1024).toFixed(2)} MB` : (archivedName || 'Nenhum arquivo selecionado');
    $('#supplierSelectedFileName').textContent = label;
    $('#clearSupplierFile').classList.toggle('hidden', !supplierSelectedFile);
  }

  function resetSupplierForm() {
    const form = $('#supplierInvoiceForm');
    form.reset();
    form.elements.id.value = '';
    form.elements.receivedDate.value = todayKey();
    $('#supplierItems').innerHTML = '';
    addSupplierItemRow();
    $('#supplierFile').value = '';
    $('#supplierImportFile').value = '';
    $('#supplierImportButton').disabled = true;
    $('#supplierImportSummary').classList.add('hidden');
    $('#supplierInvoiceError').classList.add('hidden');
    $('#cancelSupplierEdit').classList.add('hidden');
    $('#saveSupplierInvoice').innerHTML = 'Salvar entrada no arquivo <span>→</span>';
    setSupplierFile(null);
  }

  function showSupplierDetails(invoice) {
    $('#supplierDetailTitle').textContent = `NF ${invoice.number} · ${invoice.supplier}`;
    const dateLabel = ptDate(parseDate(invoice.receivedDate), { day: '2-digit', month: 'long', year: 'numeric' });
    const items = invoice.items.map(item => `<tr><td>${escapeHtml(item.product)}</td><td>${formatNumber(item.quantity, 3)} ${escapeHtml(item.unit)}</td><td>${formatNumber(item.volumeM3, 3)} m³</td><td>${formatNumber(item.weightKg)} kg</td></tr>`).join('');
    const supplierFileUrl = invoice.fileUrl || `/api/supplier-invoices/${invoice.id}/file`;
    const file = invoice.fileName ? `<div class="file-viewer"><div class="file-viewer-head"><strong>${escapeHtml(invoice.fileName)}</strong><a class="text-link" href="${escapeHtml(supplierFileUrl)}" target="_blank" rel="noopener">Abrir arquivo ↗</a></div><iframe title="Arquivo da nota de fornecedor" src="${escapeHtml(supplierFileUrl)}"></iframe></div>` : '<div class="file-placeholder">Esta nota não tem um PDF ou XML anexado.</div>';
    const notes = invoice.notes ? `<div class="supplier-detail-notes"><small>OBSERVAÇÕES</small><p>${escapeHtml(invoice.notes)}</p></div>` : '';
    $('#supplierDetailContent').innerHTML = `<div class="detail-grid"><div class="detail-item"><small>Fornecedor</small><strong>${escapeHtml(invoice.supplier)}</strong></div><div class="detail-item"><small>Data do recebimento</small><strong>${dateLabel}</strong></div><div class="detail-item"><small>Volume total</small><strong>${formatNumber(invoice.volumeM3, 3)} m³</strong></div><div class="detail-item"><small>Peso total</small><strong>${formatNumber(invoice.weightKg)} kg</strong></div></div><div class="table-wrap supplier-detail-table"><table><thead><tr><th>PRODUTO</th><th>QUANTIDADE</th><th>VOLUME</th><th>PESO</th></tr></thead><tbody>${items}</tbody></table></div>${notes}${file}`;
    $('#supplierDetailDialog').showModal();
  }

  function editSupplierInvoice(invoice) {
    setAddSection('supplier');
    const form = $('#supplierInvoiceForm');
    form.elements.id.value = invoice.id;
    form.elements.number.value = invoice.number;
    form.elements.supplier.value = invoice.supplier;
    form.elements.receivedDate.value = invoice.receivedDate;
    form.elements.notes.value = invoice.notes || '';
    $('#supplierItems').innerHTML = '';
    invoice.items.forEach(item => addSupplierItemRow(item));
    $('#supplierFile').value = '';
    $('#supplierImportFile').value = '';
    $('#supplierImportButton').disabled = true;
    $('#supplierImportSummary').classList.add('hidden');
    $('#supplierInvoiceError').classList.add('hidden');
    $('#cancelSupplierEdit').classList.remove('hidden');
    $('#saveSupplierInvoice').innerHTML = 'Salvar alterações <span>→</span>';
    setSupplierFile(null, invoice.fileName ? `Arquivo atual: ${invoice.fileName}` : 'Nenhum arquivo anexado');
    $('#supplierInvoiceForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateSelectedFile(file) {
    selectedFile = file || null;
    $('#selectedFileName').textContent = selectedFile ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(2)} MB` : 'Nenhum arquivo anexado';
    $('#clearFileButton').classList.toggle('hidden', !selectedFile);
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
      reader.onerror = () => reject(new Error('Não foi possível abrir o arquivo selecionado.'));
      reader.readAsDataURL(file);
    });
  }

  async function payloadForFile(file) {
    if (!file) return null;
    if (file.size > 12 * 1024 * 1024) throw new Error('O arquivo deve ter no máximo 12 MB.');
    const extension = file.name.toLowerCase().split('.').pop();
    if (!['pdf', 'xml'].includes(extension)) throw new Error('Escolha um arquivo PDF ou XML.');
    return { name: file.name, data: await readFile(file) };
  }

  function showImportedSummary(message, isError = false) {
    const box = $('#importSummary');
    box.textContent = message;
    box.classList.toggle('import-error', isError);
    box.classList.remove('hidden');
  }

  async function importFile() {
    const file = $('#importFile').files[0];
    if (!file) return;
    $('#importButton').disabled = true;
    $('#importButton').textContent = 'Lendo arquivo…';
    try {
      const preview = await api('/api/invoices/import-preview', { method: 'POST', body: JSON.stringify(await payloadForFile(file)) });
      const form = $('#invoiceForm');
      if (preview.number) form.elements.number.value = preview.number;
      if (preview.customer) form.elements.customer.value = preview.customer;
      if (preview.address) form.elements.address.value = preview.address;
      updateSelectedFile(file);
      showImportedSummary(preview.summary || preview.text || 'Arquivo lido. Confira os campos antes de salvar.');
      if (!preview.number || !preview.customer) showToast('Revise os campos que não foram reconhecidos.');
    } catch (error) {
      showImportedSummary(error.message, true);
    } finally {
      $('#importButton').textContent = 'Importar e preencher';
      $('#importButton').disabled = !$('#importFile').files.length;
    }
  }

  async function importSupplierFile() {
    const file = $('#supplierImportFile').files[0];
    if (!file) return;
    const button = $('#supplierImportButton');
    button.disabled = true;
    button.textContent = 'Lendo arquivo…';
    try {
      const preview = await api('/api/supplier-invoices/import-preview', { method: 'POST', body: JSON.stringify(await payloadForFile(file)) });
      const form = $('#supplierInvoiceForm');
      if (preview.number) form.elements.number.value = preview.number;
      if (preview.supplier) form.elements.supplier.value = preview.supplier;
      if (Array.isArray(preview.items) && preview.items.length) {
        $('#supplierItems').innerHTML = '';
        preview.items.forEach(item => addSupplierItemRow(item));
      }
      setSupplierFile(file);
      const summary = $('#supplierImportSummary');
      summary.textContent = preview.summary || 'Confira os dados importados e complete os campos que faltam.';
      summary.classList.remove('hidden', 'import-error');
      if (!preview.number || !preview.supplier) showToast('Confira o número e o fornecedor reconhecidos no arquivo.');
    } catch (error) {
      setSupplierFile(file);
      const summary = $('#supplierImportSummary');
      summary.textContent = error.message;
      summary.classList.remove('hidden');
      summary.classList.add('import-error');
    } finally {
      button.textContent = 'Importar para o cadastro';
      button.disabled = !$('#supplierImportFile').files.length;
    }
  }

  function populateEdit(invoice) {
    const form = $('#editInvoiceForm');
    fillSelects();
    form.elements.id.value = invoice.id;
    form.elements.number.value = invoice.number;
    form.elements.customer.value = invoice.customer;
    form.elements.address.value = invoice.address;
    form.elements.date.value = invoice.date;
    form.elements.slot.value = invoice.slot;
    form.elements.driverId.value = invoice.driverId || '';
    form.elements.status.value = invoice.status;
    form.elements.file.value = '';
    $('#editError').classList.add('hidden');
    $('#editDialog').showModal();
  }

  function showInvoiceDetails(invoice) {
    const window = windowById(invoice.slot);
    $('#detailTitle').textContent = `NF ${invoice.number}`;
    const detailContent = $('#detailContent');
    const rows = [
      ['Cliente', invoice.customer], ['Endereço de entrega', invoice.address],
      ['Data', ptDate(parseDate(invoice.date), { day: '2-digit', month: 'long', year: 'numeric' })],
      ['Janela', formatWindow(window)], ['Motorista', invoice.driver], ['Status', invoice.status],
      ['Arquivo', invoice.fileName || 'Nenhum arquivo anexado']
    ];
    const invoiceFileUrl = invoice.fileUrl || `/api/invoices/${invoice.id}/file`;
    const fileViewer = invoice.fileName ? `<div class="file-viewer"><div class="file-viewer-head"><strong>${escapeHtml(invoice.fileName)}</strong><a class="text-link" href="${escapeHtml(invoiceFileUrl)}" target="_blank" rel="noopener">Abrir em nova aba ↗</a></div><iframe title="Arquivo da nota fiscal" src="${escapeHtml(invoiceFileUrl)}"></iframe></div>` : '<div class="file-placeholder">Esta nota não tem um PDF ou XML anexado.</div>';
    detailContent.innerHTML = `<div class="detail-grid">${rows.map(([label, value]) => `<div class="detail-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>${fileViewer}`;
    $('#detailDialog').showModal();
  }

  function askDelete(type, item) {
    deleteTarget = { type, id: item.id };
    if (type === 'invoice') {
      $('#deleteDescription').textContent = `A nota fiscal ${item.number} (${item.customer}) e o arquivo anexado serão excluídos permanentemente.`;
    } else if (type === 'supplier') {
      $('#deleteDescription').textContent = `A nota ${item.number} do fornecedor ${item.supplier}, seus produtos e o arquivo anexado serão excluídos permanentemente.`;
    } else {
      $('#deleteDescription').textContent = `O acesso de ${item.name} (${ROLE_NAMES[item.role]}) será removido. As notas existentes permanecerão arquivadas.`;
    }
    $('#confirmDeleteButton').textContent = type === 'user' ? 'Excluir acesso' : 'Excluir nota';
    $('#deleteDialog').showModal();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      const resource = target.type === 'invoice' ? 'invoices' : target.type === 'supplier' ? 'supplier-invoices' : 'users';
      await api(`/api/${resource}/${target.id}`, { method: 'DELETE' });
      $('#deleteDialog').close();
      deleteTarget = null;
      if (target.type === 'supplier') {
        addSection = 'supplier';
        await loadApp('add-invoice');
        resetSupplierForm();
        setAddSection('supplier');
      } else {
        await loadApp('invoices');
        if (target.type === 'user') setView('users');
      }
      showToast(target.type === 'user' ? 'Acesso removido.' : 'Nota excluída do arquivo.');
    } catch (error) { showToast(error.message); }
  }

  async function submitLogin(event, setup = false) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const errorSelector = setup ? '#setupError' : '#loginError';
    $(errorSelector).classList.add('hidden');
    try {
      await api(setup ? '/api/setup' : '/api/login', { method: 'POST', body: JSON.stringify(values) });
      form.reset();
      await loadApp(setup ? 'add-invoice' : undefined);
    } catch (error) { showFormError(errorSelector, error.message); }
  }

  async function submitAddInvoice(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    $('#invoiceError').classList.add('hidden');
    try {
      const file = await payloadForFile(selectedFile);
      const result = await api('/api/invoices', { method: 'POST', body: JSON.stringify({ ...values, file }) });
      await loadApp('invoices');
      showToast(`Nota ${result.invoice.number} salva no arquivo.`);
    } catch (error) { showFormError('#invoiceError', error.message); }
  }

  async function submitSupplierInvoice(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    values.items = $$('.supplier-item-row', $('#supplierItems')).map(row => ({
      product: row.querySelector('[name="product"]').value,
      quantity: row.querySelector('[name="quantity"]').value,
      unit: row.querySelector('[name="unit"]').value,
      volumeM3: row.querySelector('[name="volumeM3"]').value || 0,
      weightKg: row.querySelector('[name="weightKg"]').value || 0
    }));
    $('#supplierInvoiceError').classList.add('hidden');
    try {
      values.file = await payloadForFile(supplierSelectedFile || $('#supplierFile').files[0]);
      const id = values.id;
      const result = await api(id ? `/api/supplier-invoices/${id}` : '/api/supplier-invoices', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(values)
      });
      addSection = 'supplier';
      await loadApp('add-invoice');
      resetSupplierForm();
      setAddSection('supplier');
      const saved = result.supplierInvoice;
      showToast(`Nota ${saved.number} salva no arquivo de fornecedores.`);
    } catch (error) { showFormError('#supplierInvoiceError', error.message); }
  }

  async function submitEditInvoice(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const id = values.id;
    const fileInput = form.elements.file;
    $('#editError').classList.add('hidden');
    try {
      const file = await payloadForFile(fileInput.files[0]);
      delete values.id;
      values.file = file;
      const result = await api(`/api/invoices/${id}`, { method: 'PUT', body: JSON.stringify(values) });
      $('#editDialog').close();
      await loadApp('invoices');
      showToast(`Nota ${result.invoice.number} atualizada.`);
    } catch (error) { showFormError('#editError', error.message); }
  }

  async function submitUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    $('#userError').classList.add('hidden');
    try {
      const result = await api('/api/users', { method: 'POST', body: JSON.stringify(values) });
      form.reset();
      await loadApp('users');
      showToast(`Acesso de ${result.user.name} criado.`);
    } catch (error) { showFormError('#userError', error.message); }
  }

  async function updateStatus(id, status, select) {
    try {
      const result = await api(`/api/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      const index = state.invoices.findIndex(invoice => invoice.id === Number(id));
      if (index >= 0) state.invoices[index] = result.invoice;
      render();
      showToast(`NF ${result.invoice.number}: ${status.toLowerCase()}.`);
    } catch (error) {
      const invoice = state.invoices.find(item => item.id === Number(id));
      if (select && invoice) select.value = invoice.status;
      showToast(error.message);
    }
  }

  async function updateWindow(id, values) {
    try {
      const result = await api(`/api/windows/${id}`, { method: 'PUT', body: JSON.stringify(values) });
      state.windows = result.windows;
      $('#windowDialog').close();
      render();
      showToast('Janela de entrega atualizada.');
    } catch (error) { showFormError('#windowError', error.message); }
  }

  async function logout() {
    try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch { /* expirada: o formulário de acesso será exibido */ }
    state.user = null;
    state.invoices = [];
    state.supplierInvoices = [];
    showAuth(false);
  }

  function initEvents() {
    $('#setupForm').addEventListener('submit', event => submitLogin(event, true));
    $('#loginForm').addEventListener('submit', event => submitLogin(event));
    $$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    $$('[data-go]').forEach(button => button.addEventListener('click', () => setView(button.dataset.go)));
    $('#logoutButton').addEventListener('click', logout);
    $('#logoutTop').addEventListener('click', logout);
    $('#todayButton').addEventListener('click', () => { weekOffset = 0; renderWeekLabels(); renderOverviewBoard(); renderSchedule(); });
    $('#weekToday').addEventListener('click', () => { weekOffset = 0; renderWeekLabels(); renderOverviewBoard(); renderSchedule(); });
    $('#prevWeek').addEventListener('click', () => changeWeek(-1));
    $('#nextWeek').addEventListener('click', () => changeWeek(1));
    $('#schedulePrevWeek').addEventListener('click', () => changeWeek(-1));
    $('#scheduleNextWeek').addEventListener('click', () => changeWeek(1));
    $('#invoiceSearch').addEventListener('input', renderTables);
    $('#statusFilter').addEventListener('change', renderTables);
    $('#invoiceForm').addEventListener('submit', submitAddInvoice);
    $('#clearInvoiceButton').addEventListener('click', resetAddForm);
    $$('[data-add-section]').forEach(button => button.addEventListener('click', () => setAddSection(button.dataset.addSection)));
    $('#supplierInvoiceForm').addEventListener('submit', submitSupplierInvoice);
    $('#addSupplierItem').addEventListener('click', () => addSupplierItemRow());
    $('#supplierItems').addEventListener('input', updateSupplierTotals);
    $('#supplierItems').addEventListener('click', event => {
      if (!event.target.closest('[data-remove-supplier-item]')) return;
      const row = event.target.closest('.supplier-item-row');
      if (row && $$('.supplier-item-row', $('#supplierItems')).length > 1) row.remove();
      updateSupplierTotals();
    });
    $('#clearSupplierForm').addEventListener('click', resetSupplierForm);
    $('#cancelSupplierEdit').addEventListener('click', resetSupplierForm);
    $('#supplierFile').addEventListener('change', event => {
      const file = event.target.files[0] || null;
      if (file) {
        $('#supplierImportFile').value = '';
        $('#supplierImportButton').disabled = true;
        setSupplierFile(file);
      }
    });
    $('#supplierImportFile').addEventListener('change', event => {
      $('#supplierImportButton').disabled = !event.target.files.length;
      $('#supplierImportSummary').classList.add('hidden');
      if (event.target.files.length) {
        $('#supplierFile').value = '';
        setSupplierFile(null);
      }
    });
    $('#supplierImportButton').addEventListener('click', importSupplierFile);
    $('#clearSupplierFile').addEventListener('click', () => {
      setSupplierFile(null);
      $('#supplierFile').value = '';
      $('#supplierImportFile').value = '';
      $('#supplierImportButton').disabled = true;
    });
    $('#supplierInvoiceRows').addEventListener('click', event => {
      const button = event.target.closest('[data-supplier-action]');
      if (!button) return;
      const invoice = state.supplierInvoices.find(item => item.id === Number(button.dataset.id));
      if (!invoice) return;
      if (button.dataset.supplierAction === 'detail') showSupplierDetails(invoice);
      if (button.dataset.supplierAction === 'edit') editSupplierInvoice(invoice);
      if (button.dataset.supplierAction === 'delete') askDelete('supplier', invoice);
    });
    $('#importFile').addEventListener('change', event => {
      const file = event.target.files[0] || null;
      updateSelectedFile(file);
      $('#importButton').disabled = !file;
      $('#importSummary').classList.add('hidden');
    });
    $('#importButton').addEventListener('click', importFile);
    $('#clearFileButton').addEventListener('click', () => {
      updateSelectedFile(null);
      $('#importFile').value = '';
      $('#importButton').disabled = true;
      $('#importSummary').classList.add('hidden');
    });
    $('#invoiceRows').addEventListener('click', event => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      const invoice = state.invoices.find(item => item.id === Number(action.dataset.id));
      if (!invoice) return;
      if (action.dataset.action === 'detail') showInvoiceDetails(invoice);
      if (action.dataset.action === 'edit') populateEdit(invoice);
      if (action.dataset.action === 'delete') askDelete('invoice', invoice);
    });
    $('#upcomingRows').addEventListener('click', event => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      const invoice = state.invoices.find(item => item.id === Number(action.dataset.id));
      if (!invoice) return;
      if (action.dataset.action === 'detail') showInvoiceDetails(invoice);
      if (action.dataset.action === 'edit') populateEdit(invoice);
      if (action.dataset.action === 'delete') askDelete('invoice', invoice);
    });
    $('#invoiceRows').addEventListener('change', event => {
      const select = event.target.closest('[data-status-id]');
      if (select) updateStatus(select.dataset.statusId, select.value, select);
    });
    $('#upcomingRows').addEventListener('change', event => {
      const select = event.target.closest('[data-status-id]');
      if (select) updateStatus(select.dataset.statusId, select.value, select);
    });
    $('#editInvoiceForm').addEventListener('submit', submitEditInvoice);
    $('#userForm').addEventListener('submit', submitUser);
    $('#userRows').addEventListener('click', event => {
      const button = event.target.closest('[data-delete-user]');
      if (!button) return;
      const user = state.users.find(item => item.id === Number(button.dataset.deleteUser));
      if (user) askDelete('user', user);
    });
    $('#confirmDeleteButton').addEventListener('click', confirmDelete);
    $('#windowGrid').addEventListener('click', event => {
      const button = event.target.closest('[data-edit-window]');
      if (!button || !isAdmin()) return;
      const window = windowById(button.dataset.editWindow);
      const form = $('#windowForm');
      form.reset();
      form.elements.slotId.value = window.id;
      form.elements.start.value = window.start;
      form.elements.end.value = window.end || '';
      form.elements.openEnded.checked = !window.end;
      $('#windowDialogTitle').textContent = `Editar janela ${String(state.windows.indexOf(window) + 1).padStart(2, '0')}`;
      $('#windowError').classList.add('hidden');
      updateWindowEndField();
      $('#windowDialog').showModal();
    });
    $('#windowForm').elements.openEnded.addEventListener('change', updateWindowEndField);
    $('#windowForm').addEventListener('submit', event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      if (!values.openEnded && values.end <= values.start) {
        showFormError('#windowError', 'O horário final precisa ser posterior ao horário inicial.');
        return;
      }
      updateWindow(values.slotId, { start: values.start, end: values.openEnded ? '' : values.end });
    });
    $$('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
    $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    if (!$('#supplierItems').children.length) addSupplierItemRow();
  }

  function updateWindowEndField() {
    const openEnded = $('#windowForm').elements.openEnded.checked;
    const end = $('#windowForm').elements.end;
    $('#windowEndField').classList.toggle('hidden', openEnded);
    end.required = !openEnded;
    if (openEnded) end.value = '';
  }

  initEvents();
  initialize();
})();
