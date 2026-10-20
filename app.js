(() => {
  const STORAGE_KEY = 'rota-certa-demo-v1';
  const STATUS = ['Aguardando separação', 'Em separação', 'Pronta para sair', 'Em rota', 'Entregue'];
  const STATUS_CLASS = {
    'Aguardando separação': 'queued',
    'Em separação': 'preparing',
    'Pronta para sair': 'ready',
    'Em rota': 'route',
    'Entregue': 'done'
  };
  const STATUS_ICON = {
    'Aguardando separação': '◷',
    'Em separação': '▤',
    'Pronta para sair': '✓',
    'Em rota': '↗',
    'Entregue': '✓'
  };
  const ROLE_NAMES = { management: 'Gestão', admin: 'Administrativo', driver: 'Motorista' };
  const PAGE_NAMES = { overview: 'Visão geral', schedule: 'Programação', invoices: 'Notas fiscais', windows: 'Janelas de entrega' };
  const DRIVERS = ['Carlos Silva', 'Marcos Oliveira', 'A definir'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const dateKey = date => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const parseDate = value => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  };
  const startOfWeek = date => {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    const day = result.getDay();
    result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
    return result;
  };
  const weekDates = offset => {
    const monday = startOfWeek(new Date());
    monday.setDate(monday.getDate() + offset * 7);
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return date;
    });
  };
  const ptDate = (date, options = { day: '2-digit', month: 'short' }) => new Intl.DateTimeFormat('pt-BR', options).format(date).replace('.', '');
  const formatLongDate = date => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(date);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const todayKey = () => dateKey(new Date());

  function initialData() {
    const monday = startOfWeek(new Date());
    const date = offset => {
      const value = new Date(monday);
      value.setDate(monday.getDate() + offset);
      return dateKey(value);
    };
    return {
      role: 'management',
      windows: [
        { id: 'w1', start: '08:00', end: '10:00' },
        { id: 'w2', start: '09:00', end: '11:00' },
        { id: 'w3', start: '14:00', end: '' }
      ],
      invoices: [
        { id: 'i1', number: '18452', customer: 'Casa do Pedreiro', address: 'Av. Brasil, 412 · Centro', date: date(0), slot: 'w1', driver: 'Carlos Silva', status: 'Entregue' },
        { id: 'i2', number: '18461', customer: 'Construtora Horizonte', address: 'Rua das Acácias, 88 · Jardim América', date: date(1), slot: 'w2', driver: 'Marcos Oliveira', status: 'Em separação' },
        { id: 'i3', number: '18473', customer: 'Obra Lima & Filhos', address: 'Al. dos Ipês, 120 · Vila Nova', date: date(2), slot: 'w1', driver: 'Carlos Silva', status: 'Pronta para sair' },
        { id: 'i4', number: '18488', customer: 'Depósito Santa Clara', address: 'Rua São Bento, 36 · São José', date: date(2), slot: 'w3', driver: 'Marcos Oliveira', status: 'Em rota' },
        { id: 'i5', number: '18504', customer: 'Madeireira Pinheiro', address: 'Rod. Municipal, km 4 · Distrito', date: date(3), slot: 'w2', driver: 'Carlos Silva', status: 'Aguardando separação' },
        { id: 'i6', number: '18510', customer: 'Reforma & Cia.', address: 'Rua do Comércio, 219 · Centro', date: date(4), slot: 'w1', driver: 'Marcos Oliveira', status: 'Em separação' },
        { id: 'i7', number: '18521', customer: 'Condomínio Vale Verde', address: 'Estr. das Palmeiras, 900 · Vale Verde', date: date(5), slot: 'w3', driver: 'Carlos Silva', status: 'Pronta para sair' }
      ]
    };
  }

  function loadData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.invoices) && Array.isArray(saved.windows)) {
        return { ...initialData(), ...saved };
      }
    } catch (error) {
      console.warn('Não foi possível carregar os dados locais.', error);
    }
    return initialData();
  }

  const state = loadData();
  let weekOffset = 0;
  let toastTimer;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ role: state.role, windows: state.windows, invoices: state.invoices }));
    } catch (error) {
      console.warn('Não foi possível salvar os dados locais.', error);
      showToast('Não foi possível salvar neste navegador.');
    }
  }

  function slotById(id) {
    return state.windows.find(window => window.id === id) || state.windows[0];
  }

  function formatWindow(window) {
    if (!window) return 'Horário a definir';
    if (!window.end) return `A partir das ${window.start}`;
    return `${window.start}–${window.end}`;
  }

  function visibleInvoices() {
    if (state.role === 'driver') return state.invoices.filter(invoice => invoice.driver === 'Carlos Silva');
    return state.invoices;
  }

  function renderRole() {
    const isDriver = state.role === 'driver';
    const name = isDriver ? 'Carlos Silva' : state.role === 'admin' ? 'Ana Martins' : 'Gestor';
    const initials = isDriver ? 'CS' : state.role === 'admin' ? 'AM' : 'GM';
    $('#roleSelect').value = state.role;
    $('#sidebarName').textContent = name;
    $('#sidebarRole').textContent = ROLE_NAMES[state.role];
    $('#sidebarAvatar').textContent = initials;
    $('#topAvatar').textContent = initials;
    document.body.classList.toggle('driver-mode', isDriver);
    document.body.classList.toggle('admin-mode', state.role === 'admin');
    if (isDriver) {
      $('#pageTitle').innerHTML = 'Olá, Carlos <span class="wave">✳</span>';
      $('#pageSubtitle').textContent = 'Confira suas entregas e atualize o andamento da rota.';
    } else if (state.role === 'admin') {
      $('#pageTitle').innerHTML = `${greeting()}, Ana <span class="wave">✳</span>`;
      $('#pageSubtitle').textContent = 'Cadastre notas fiscais e organize as janelas de entrega.';
    } else {
      $('#pageTitle').innerHTML = `${greeting()}, equipe <span class="wave">✳</span>`;
      $('#pageSubtitle').textContent = 'Acompanhe o fluxo de notas e as entregas da semana.';
    }
  }

  function greeting() {
    const hour = new Date().getHours();
    return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  }

  function updateHeadingDate() {
    const today = new Date();
    $('#welcomeLine').textContent = formatLongDate(today).toLocaleUpperCase('pt-BR');
  }

  function renderStats() {
    const invoices = visibleInvoices();
    const todayCount = invoices.filter(invoice => invoice.date === todayKey() && invoice.status !== 'Entregue').length;
    const pendingCount = invoices.filter(invoice => invoice.status !== 'Entregue' && invoice.status !== 'Em rota').length;
    const inRoute = invoices.filter(invoice => invoice.status === 'Em rota').length;
    const deliveredThisWeek = invoices.filter(invoice => invoice.status === 'Entregue' && weekDates(0).some(date => dateKey(date) === invoice.date)).length;
    const cards = [
      ['Notas em aberto', pendingCount, 'Aguardando preparo ou saída', '▤', 'orange'],
      ['Entregas para hoje', todayCount, 'Pedidos previstos para hoje', '◷', 'green'],
      ['Em rota', inRoute, 'Motoristas em deslocamento', '↗', 'blue'],
      ['Entregues na semana', deliveredThisWeek, 'Concluídas de segunda a sábado', '✓', 'gray']
    ];
    $('#statsGrid').innerHTML = cards.map(([label, value, caption, icon, color]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-caption">${caption}</div></article>`).join('');
  }

  function renderWeekLabels() {
    const dates = weekDates(weekOffset);
    const first = dates[0];
    const last = dates[5];
    const range = `${ptDate(first)} – ${ptDate(last, { day: '2-digit', month: 'long', year: 'numeric' })}`;
    $('#weekRangeLabel').textContent = range;
    $('#scheduleWeekRange').textContent = range;
  }

  function renderOverviewBoard() {
    const dates = weekDates(weekOffset);
    const weekdays = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    const invoices = visibleInvoices();
    $('#overviewBoard').innerHTML = dates.map((date, index) => {
      const key = dateKey(date);
      const dayInvoices = invoices.filter(invoice => invoice.date === key).sort((a, b) => a.slot.localeCompare(b.slot));
      const visible = dayInvoices.slice(0, 3);
      const cards = visible.map(invoice => {
        const kind = STATUS_CLASS[invoice.status] === 'done' ? 'done' : invoice.status === 'Em rota' ? 'route' : '';
        const window = slotById(invoice.slot);
        return `<div class="booking-mini ${kind}" title="NF ${escapeHtml(invoice.number)} · ${escapeHtml(invoice.customer)} · ${formatWindow(window)}"><strong>${escapeHtml(invoice.customer)}</strong><small>${formatWindow(window)} · NF ${escapeHtml(invoice.number)}</small></div>`;
      }).join('');
      const extra = dayInvoices.length > 3 ? `<div class="more-bookings">+${dayInvoices.length - 3} entrega${dayInvoices.length - 3 === 1 ? '' : 's'}</div>` : '';
      return `<div class="week-day ${key === todayKey() ? 'today' : ''}"><div class="week-day-head">${weekdays[index]}<strong>${String(date.getDate()).padStart(2, '0')}</strong></div><div class="day-bookings">${cards || '<div class="empty-day">Livre</div>'}${extra}</div></div>`;
    }).join('');
  }

  function renderFlow() {
    const invoices = visibleInvoices();
    const counts = STATUS.map(status => [status, invoices.filter(invoice => invoice.status === status).length]);
    const total = Math.max(invoices.length, 1);
    $('#flowList').innerHTML = counts.map(([status, count]) => {
      const kind = STATUS_CLASS[status];
      const width = Math.round(count / total * 100);
      return `<div class="flow-row"><div class="flow-icon ${kind}">${STATUS_ICON[status]}</div><div class="flow-label"><strong>${status}</strong><small>${count === 1 ? '1 nota fiscal' : `${count} notas fiscais`}</small></div><div class="flow-count">${count}</div><div class="flow-progress"><i style="width:${width}%"></i></div></div>`;
    }).join('');
  }

  function badge(status) {
    return `<span class="status-badge ${STATUS_CLASS[status] || ''}">${escapeHtml(status)}</span>`;
  }

  function invoiceRow(invoice, compact = false) {
    const window = slotById(invoice.slot);
    const date = parseDate(invoice.date);
    if (compact) {
      return `<tr><td><span class="invoice-id">NF ${escapeHtml(invoice.number)}</span><span class="cell-sub">${escapeHtml(invoice.customer)}</span></td><td class="date-cell">${ptDate(date, { day: '2-digit', month: 'short' })}<span class="cell-sub">${formatWindow(window)}</span></td><td>${escapeHtml(invoice.driver)}</td><td>${badge(invoice.status)}</td><td><button class="row-menu" aria-label="Abrir nota ${escapeHtml(invoice.number)}">···</button></td></tr>`;
    }
    return `<tr><td><span class="invoice-id">NF ${escapeHtml(invoice.number)}</span><span class="cell-sub">${escapeHtml(invoice.customer)}</span></td><td><span class="cell-sub address-cell">${escapeHtml(invoice.address)}</span></td><td class="date-cell">${ptDate(date, { day: '2-digit', month: 'short' })}<span class="cell-sub">${formatWindow(window)}</span></td><td>${escapeHtml(invoice.driver)}</td><td>${badge(invoice.status)}</td><td>${statusAction(invoice)}</td></tr>`;
  }

  function statusAction(invoice) {
    if (state.role === 'admin') return '<span class="cell-sub">Acompanhamento pela gestão</span>';
    let options = STATUS;
    let disabled = false;
    if (state.role === 'driver') {
      if (invoice.status === 'Em rota') options = ['Em rota', 'Entregue'];
      else if (invoice.status === 'Pronta para sair') options = ['Pronta para sair', 'Em rota'];
      else { options = [invoice.status]; disabled = true; }
    }
    return `<select class="action-select" data-status-id="${escapeHtml(invoice.id)}" aria-label="Atualizar status da nota ${escapeHtml(invoice.number)}" ${disabled ? 'disabled title="A entrega ficará disponível após a separação do pedido."' : ''}>${options.map(status => `<option value="${escapeHtml(status)}" ${status === invoice.status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}</select>`;
  }

  function renderTables() {
    const invoices = visibleInvoices();
    const future = invoices.filter(invoice => invoice.date >= todayKey() && invoice.status !== 'Entregue').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
    $('#upcomingRows').innerHTML = future.length ? future.map(invoice => invoiceRow(invoice, true)).join('') : '<tr><td colspan="5" class="cell-sub">Nenhuma entrega próxima programada.</td></tr>';

    const search = ($('#invoiceSearch')?.value || '').trim().toLowerCase();
    const filter = $('#statusFilter')?.value || 'all';
    const result = invoices.filter(invoice => {
      const searchMatches = !search || [invoice.number, invoice.customer, invoice.address, invoice.driver].some(value => value.toLowerCase().includes(search));
      const filterMatches = filter === 'all' || invoice.status === filter;
      return searchMatches && filterMatches;
    }).sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
    $('#invoiceRows').innerHTML = result.map(invoice => invoiceRow(invoice, false)).join('');
    $('#invoiceEmpty').classList.toggle('hidden', result.length > 0);
    $('#sidebarInvoiceCount').textContent = invoices.filter(invoice => invoice.status !== 'Entregue').length;
  }

  function renderScheduleBoard() {
    const dates = weekDates(weekOffset);
    const dayNames = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const invoices = visibleInvoices();
    $('#scheduleBoard').innerHTML = dates.map((date, index) => {
      const key = dateKey(date);
      const dayInvoices = invoices.filter(invoice => invoice.date === key);
      const groups = state.windows.map(window => {
        const group = dayInvoices.filter(invoice => invoice.slot === window.id);
        const cards = group.map(invoice => `<article class="schedule-card"><span class="invoice-id">NF ${escapeHtml(invoice.number)}</span><span class="customer-name">${escapeHtml(invoice.customer)}</span><span class="card-location">⌖ ${escapeHtml(invoice.address)}</span><div class="card-bottom"><span class="mini-driver">${escapeHtml(invoice.driver)}</span>${badge(invoice.status)}</div></article>`).join('');
        return `<section class="slot-group"><div class="slot-group-head"><span>${formatWindow(window)}</span><span class="slot-count">${group.length} ${group.length === 1 ? 'nota' : 'notas'}</span></div>${cards || '<div class="slot-empty">Sem entregas</div>'}</section>`;
      }).join('');
      return `<div class="schedule-day ${key === todayKey() ? 'today' : ''}"><div class="schedule-day-head"><div><strong>${dayNames[index]}</strong><small>${ptDate(date, { day: '2-digit', month: 'short' })}</small></div><span class="day-count">${dayInvoices.length}</span></div>${groups}</div>`;
    }).join('');
  }

  function renderWindows() {
    $('#windowGrid').innerHTML = state.windows.map((window, index) => `<article class="window-card"><div class="window-card-top"><span class="window-number">JANELA 0${index + 1}</span><button class="window-edit" data-edit-window="${escapeHtml(window.id)}" aria-label="Editar janela 0${index + 1}">✎</button></div><div class="window-time">${formatWindow(window)}</div><div class="window-desc">${index === 2 ? 'Atendimento estendido' : 'Período de entrega'}</div><div class="window-card-bottom"><span>Segunda a sábado</span><span class="window-enabled"><i></i> Disponível</span></div></article>`).join('');
    const slotSelect = $('#invoiceForm select[name="slot"]');
    if (slotSelect) {
      const previous = slotSelect.value;
      slotSelect.innerHTML = state.windows.map((window, index) => `<option value="${escapeHtml(window.id)}">Janela 0${index + 1} · ${formatWindow(window)}</option>`).join('');
      if (state.windows.some(window => window.id === previous)) slotSelect.value = previous;
    }
  }

  function render() {
    renderRole();
    updateHeadingDate();
    renderStats();
    renderWeekLabels();
    renderOverviewBoard();
    renderFlow();
    renderTables();
    renderScheduleBoard();
    renderWindows();
  }

  function setView(view) {
    if (view === 'windows' && state.role !== 'admin') view = 'overview';
    $$('.view-panel').forEach(panel => panel.classList.toggle('active', panel.id === `view-${view}`));
    $$('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    $('#breadcrumbCurrent').textContent = PAGE_NAMES[view] || PAGE_NAMES.overview;
    $('#sidebar').classList.remove('open');
  }

  function changeWeek(delta) {
    weekOffset += delta;
    renderWeekLabels();
    renderOverviewBoard();
    renderScheduleBoard();
    renderStats();
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function openInvoiceDialog() {
    const form = $('#invoiceForm');
    $('#invoiceError').classList.add('hidden');
    form.reset();
    form.elements.date.value = todayKey();
    form.elements.date.min = todayKey();
    renderWindows();
    $('#invoiceDialog').showModal();
  }

  function openWindowDialog(id) {
    const window = slotById(id);
    const form = $('#windowForm');
    form.reset();
    form.elements.slotId.value = id;
    form.elements.start.value = window.start;
    form.elements.end.value = window.end || '';
    form.elements.openEnded.checked = !window.end;
    $('#windowDialogTitle').textContent = `Editar janela ${String(state.windows.findIndex(item => item.id === id) + 1).padStart(2, '0')}`;
    $('#windowDialogDescription').textContent = 'Este período será usado em todos os dias de segunda a sábado.';
    $('#windowError').classList.add('hidden');
    updateWindowEndField();
    $('#windowDialog').showModal();
  }

  function updateWindowEndField() {
    const openEnded = $('#windowForm').elements.openEnded.checked;
    const endInput = $('#windowForm').elements.end;
    $('#windowEndField').classList.toggle('hidden', openEnded);
    endInput.required = !openEnded;
    if (openEnded) endInput.value = '';
  }

  function formError(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
  }

  function initEvents() {
    $$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    $$('[data-go]').forEach(button => button.addEventListener('click', () => setView(button.dataset.go)));
    $('#roleSelect').addEventListener('change', event => {
      state.role = event.target.value;
      save();
      render();
      setView('overview');
      showToast(`Perfil alterado para ${ROLE_NAMES[state.role]}.`);
    });
    $('#newInvoiceButton').addEventListener('click', openInvoiceDialog);
    $('#todayButton').addEventListener('click', () => { weekOffset = 0; render(); });
    $('#weekToday').addEventListener('click', () => { weekOffset = 0; render(); });
    $('#prevWeek').addEventListener('click', () => changeWeek(-1));
    $('#nextWeek').addEventListener('click', () => changeWeek(1));
    $('#schedulePrevWeek').addEventListener('click', () => changeWeek(-1));
    $('#scheduleNextWeek').addEventListener('click', () => changeWeek(1));
    $('#invoiceSearch').addEventListener('input', renderTables);
    $('#statusFilter').addEventListener('change', renderTables);
    $('#windowGrid').addEventListener('click', event => {
      const button = event.target.closest('[data-edit-window]');
      if (button && state.role === 'admin') openWindowDialog(button.dataset.editWindow);
    });
    $('#invoiceRows').addEventListener('change', event => {
      const select = event.target.closest('[data-status-id]');
      if (!select) return;
      const invoice = state.invoices.find(item => item.id === select.dataset.statusId);
      if (!invoice) return;
      const nextStatus = select.value;
      if (state.role === 'driver' && !((invoice.status === 'Pronta para sair' && nextStatus === 'Em rota') || (invoice.status === 'Em rota' && nextStatus === 'Entregue'))) {
        select.value = invoice.status;
        showToast('A atualização não está disponível para este pedido.');
        return;
      }
      invoice.status = nextStatus;
      save();
      render();
      showToast(`NF ${invoice.number}: ${nextStatus.toLowerCase()}.`);
    });
    $('#invoiceForm').addEventListener('submit', event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      const error = $('#invoiceError');
      error.classList.add('hidden');
      if (state.invoices.some(invoice => invoice.number.toLowerCase() === values.number.trim().toLowerCase())) {
        formError(error, 'Já existe uma nota fiscal com esse número.');
        return;
      }
      if (parseDate(values.date).getDay() === 0) {
        formError(error, 'A agenda atende de segunda a sábado. Escolha outro dia.');
        return;
      }
      const invoice = {
        id: `i${Date.now()}`,
        number: values.number.trim(),
        customer: values.customer.trim(),
        address: values.address.trim(),
        date: values.date,
        slot: values.slot,
        driver: values.driver,
        status: 'Aguardando separação'
      };
      state.invoices.push(invoice);
      save();
      $('#invoiceDialog').close();
      render();
      showToast(`Nota fiscal ${invoice.number} adicionada à programação.`);
    });
    $('#windowForm').elements.openEnded.addEventListener('change', updateWindowEndField);
    $('#windowForm').addEventListener('submit', event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      const error = $('#windowError');
      error.classList.add('hidden');
      if (!values.openEnded && values.end <= values.start) {
        formError(error, 'O horário final precisa ser posterior ao horário inicial.');
        return;
      }
      const window = state.windows.find(item => item.id === values.slotId);
      if (!window) return;
      window.start = values.start;
      window.end = values.openEnded ? '' : values.end;
      save();
      $('#windowDialog').close();
      render();
      showToast('Janela de entrega atualizada.');
    });
    $$('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
    $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  }

  initEvents();
  render();
})();
