/*
 * Adapter for the GitHub Pages build. It keeps the app's existing /api contract
 * but stores data in this browser's IndexedDB instead of contacting server.py.
 * This is convenience-level access control, not a secure multi-user backend.
 */
(() => {
  'use strict';

  const DB_NAME = 'rota-certa-pages';
  const DB_VERSION = 1;
  const SESSION_KEY = 'rota-certa-pages-user';
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const STATUSES = ['Aguardando separação', 'Em separação', 'Pronta para sair', 'Em rota', 'Entregue'];
  const WINDOWS = [
    { id: 'w1', start: '08:00', end: '10:00' },
    { id: 'w2', start: '09:00', end: '11:00' },
    { id: 'w3', start: '14:00', end: '' }
  ];
  const fileUrls = new Map();
  const realFetch = window.fetch.bind(window);

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('invoices')) db.createObjectStore('invoices', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('supplierInvoices')) db.createObjectStore('supplierInvoices', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('windows')) db.createObjectStore('windows', { keyPath: 'id' });
        const windowStore = request.transaction.objectStore('windows');
        WINDOWS.forEach(item => windowStore.put(item));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o banco de dados deste navegador.'));
    });
  }

  async function readAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function readOne(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function writeOne(storeName, value, insert = false) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
      const request = insert ? store.add(value) : store.put(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function removeOne(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function fail(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  function parseBody(options) {
    if (!options.body) return {};
    try { return JSON.parse(options.body); }
    catch { fail('Não foi possível ler os dados enviados.'); }
  }

  function publicUser(user) {
    return { id: user.id, username: user.username, name: user.name, role: user.role, createdAt: user.createdAt };
  }

  async function currentUser() {
    const id = Number(localStorage.getItem(SESSION_KEY));
    if (!Number.isInteger(id) || id < 1) return null;
    const user = await readOne('users', id);
    if (!user) localStorage.removeItem(SESSION_KEY);
    return user;
  }

  async function requireUser(roles = []) {
    const user = await currentUser();
    if (!user) fail('Sua sessão terminou. Entre novamente.', 401);
    if (roles.length && !roles.includes(user.role)) fail('Esta ação exige acesso administrativo.', 403);
    return user;
  }

  async function listUsers() {
    return (await readAll('users')).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name, 'pt-BR'));
  }

  async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, key, 256);
    return [...new Uint8Array(bits)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function bytesFromBase64(encoded) {
    const content = String(encoded || '').replace(/^data:[^,]*,/, '');
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function fileMime(file) {
    if (file?.mime) return file.mime;
    return String(file?.name || '').toLowerCase().endsWith('.xml') ? 'application/xml' : 'application/pdf';
  }

  function createFileUrl(kind, id, file) {
    if (!file?.data) return null;
    const cacheKey = `${kind}:${id}:${file.name}:${file.data.length}`;
    if (!fileUrls.has(cacheKey)) {
      const blob = new Blob([bytesFromBase64(file.data)], { type: fileMime(file) });
      fileUrls.set(cacheKey, URL.createObjectURL(blob));
    }
    return fileUrls.get(cacheKey);
  }

  function clearFileUrls(kind, id) {
    const prefix = `${kind}:${id}:`;
    for (const [key, url] of fileUrls) {
      if (key.startsWith(prefix)) {
        URL.revokeObjectURL(url);
        fileUrls.delete(key);
      }
    }
  }

  function fileFields(kind, row) {
    const file = row.file || null;
    return {
      fileName: file?.name || null,
      fileMime: file ? fileMime(file) : null,
      fileSize: file?.size || null,
      fileUrl: file ? createFileUrl(kind, row.id, file) : null
    };
  }

  function userName(users, id) {
    return users.find(user => user.id === Number(id))?.name || 'A definir';
  }

  function invoiceView(row, users) {
    return {
      id: row.id, number: row.number, customer: row.customer, address: row.address,
      date: row.date, slot: row.slot, driverId: row.driverId || null,
      driver: row.driverId ? userName(users, row.driverId) : 'A definir', status: row.status,
      ...fileFields('invoice', row), createdAt: row.createdAt, updatedAt: row.updatedAt
    };
  }

  function supplierInvoiceView(row) {
    const items = row.items || [];
    return {
      id: row.id, number: row.number, supplier: row.supplier, receivedDate: row.receivedDate,
      notes: row.notes || '', ...fileFields('supplier', row),
      createdBy: row.createdBy || 'Administração', createdAt: row.createdAt, updatedAt: row.updatedAt,
      items, volumeM3: items.reduce((sum, item) => sum + Number(item.volumeM3 || 0), 0),
      weightKg: items.reduce((sum, item) => sum + Number(item.weightKg || 0), 0)
    };
  }

  async function bootstrap() {
    const user = await requireUser();
    const users = await listUsers();
    const allInvoices = await readAll('invoices');
    const invoices = allInvoices
      .filter(row => user.role !== 'driver' || Number(row.driverId) === user.id)
      .sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot) || b.id - a.id)
      .map(row => invoiceView(row, users));
    const windows = (await readAll('windows')).sort((a, b) => a.id.localeCompare(b.id));
    const response = {
      user: publicUser(user), invoices, windows,
      drivers: users.filter(item => item.role === 'driver').map(publicUser)
    };
    if (user.role === 'admin') {
      response.users = users.map(publicUser);
      response.supplierInvoices = (await readAll('supplierInvoices'))
        .sort((a, b) => b.receivedDate.localeCompare(a.receivedDate) || b.id - a.id)
        .map(supplierInvoiceView);
    }
    return response;
  }

  function setSession(user) {
    localStorage.setItem(SESSION_KEY, String(user.id));
    return { user: publicUser(user) };
  }

  function validateUser(name, username, password) {
    if (name.length < 2 || name.length > 120) fail('Informe o nome completo (de 2 a 120 caracteres).');
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) fail('O usuário deve ter de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.');
    if (password.length < 10 || password.length > 256) fail('A senha deve ter de 10 a 256 caracteres.');
  }

  async function setupAdmin(payload) {
    if ((await listUsers()).some(user => user.role === 'admin')) fail('A Administração já está configurada. Faça login.', 409);
    const name = String(payload.name || '').trim();
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    validateUser(name, username, password);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const user = {
      name, username, role: 'admin', passwordSalt: [...salt],
      passwordHash: await hashPassword(password, salt), createdAt: new Date().toISOString()
    };
    user.id = await writeOne('users', user, true);
    return setSession(user);
  }

  async function login(payload) {
    const username = String(payload.username || '').trim().toLocaleLowerCase('pt-BR');
    const password = String(payload.password || '');
    const user = (await listUsers()).find(item => item.username.toLocaleLowerCase('pt-BR') === username);
    if (!user) fail('Usuário ou senha incorretos.', 401);
    const salt = new Uint8Array(user.passwordSalt || []);
    const digest = await hashPassword(password, salt);
    if (digest !== user.passwordHash) fail('Usuário ou senha incorretos.', 401);
    return setSession(user);
  }

  function cleanFile(file) {
    if (!file) return null;
    if (!['.pdf', '.xml'].includes(String(file.name || '').slice(String(file.name || '').lastIndexOf('.')).toLowerCase())) fail('Escolha um arquivo PDF ou XML.');
    if (typeof file.data !== 'string' || file.data.length > (MAX_FILE_BYTES * 4 / 3 + 64)) fail('O arquivo excede o limite de 12 MB.');
    const bytes = bytesFromBase64(file.data);
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) fail('O arquivo está vazio ou excede o limite de 12 MB.');
    if (String(file.name).toLowerCase().endsWith('.pdf') && !(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d)) fail('O arquivo selecionado não parece ser um PDF válido.');
    if (String(file.name).toLowerCase().endsWith('.xml')) parseXml(bytes);
    return { name: String(file.name).slice(0, 255), data: file.data, size: bytes.length, mime: fileMime(file) };
  }

  function parseXml(bytes) {
    const text = new TextDecoder('utf-8').decode(bytes);
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) fail('O XML não é válido ou está incompleto.');
    return doc;
  }

  function findNode(root, localName) {
    if (!root) return null;
    if (root.localName === localName) return root;
    return [...root.getElementsByTagName('*')].find(element => element.localName === localName) || null;
  }

  function findNodes(root, localName) {
    if (!root) return [];
    return [...root.getElementsByTagName('*')].filter(element => element.localName === localName);
  }

  function textAt(root, names) {
    for (const name of names) {
      const element = findNode(root, name);
      if (element?.textContent?.trim()) return element.textContent.trim();
    }
    return '';
  }

  async function pdfText(encoded) {
    const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.mjs';
    const pdf = await pdfjs.getDocument({ data: bytesFromBase64(encoded) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 20); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    const result = pages.join('\n').slice(0, 150000);
    if (!result.trim()) fail('O PDF não contém texto selecionável. Anexe o arquivo e preencha os dados manualmente.');
    return result;
  }

  function labelValue(text, labels) {
    const match = text.match(new RegExp(`(?:${labels})\\s*[:#\\-]?\\s*([^\\r\\n|;]{2,100})`, 'i'));
    return match ? match[1].trim().replace(/^[\s:.-]+|[\s:.-]+$/g, '') : '';
  }

  async function importInvoicePreview(payload) {
    const file = cleanFile(payload);
    let number = '';
    let customer = '';
    let address = '';
    let summary = '';
    if (file.name.toLowerCase().endsWith('.xml')) {
      const doc = parseXml(bytesFromBase64(file.data));
      const info = findNode(doc, 'infNFe') || doc;
      const destination = findNode(info, 'dest');
      const addressNode = findNode(destination, 'enderDest');
      number = textAt(info, ['nNF']);
      if (!number) number = (info.getAttribute('Id') || '').replace(/^NFe/, '').slice(-9);
      customer = textAt(destination, ['xNome']) || textAt(info, ['xNome']);
      if (addressNode) {
        const street = textAt(addressNode, ['xLgr']);
        const numberPart = textAt(addressNode, ['nro']);
        const district = textAt(addressNode, ['xBairro']);
        const cityState = [textAt(addressNode, ['xMun']), textAt(addressNode, ['UF'])].filter(Boolean).join('/');
        address = [[street, numberPart].filter(Boolean).join(' '), district, cityState, textAt(addressNode, ['CEP'])].filter(Boolean).join(', ');
      }
      summary = 'Dados fiscais lidos do XML. Confira os campos antes de salvar.';
    } else {
      const text = await pdfText(file.data);
      number = labelValue(text, '(?:n[uú]mero\\s*(?:da\\s*)?(?:nota\\s*fiscal|nf(?:-e)?|documento)|nota\\s*fiscal\\s*(?:n[º°.]?\\s*)?|nf-e\\s*(?:n[º°.]?\\s*)?)');
      if (!number) number = text.match(/\b(?:NF-e|NFe|Nota\s+Fiscal)\b[^\d\n]{0,24}(\d{3,})/i)?.[1] || '';
      customer = labelValue(text, '(?:destinat[aá]rio|cliente|raz[aã]o\\s+social|nome\\s*\\/?\\s*raz[aã]o\\s+social)');
      address = labelValue(text, '(?:endere[cç]o\\s+de\\s+entrega|endere[cç]o\\s+do\\s+destinat[aá]rio|endere[cç]o)');
      summary = 'Texto do PDF extraído; confira os dados reconhecidos antes de salvar.';
      if (!number || !customer) summary = 'PDF lido, mas alguns campos precisam ser preenchidos manualmente.';
    }
    return { number, customer, address, summary, fileName: file.name };
  }

  async function importSupplierPreview(payload) {
    const file = cleanFile(payload);
    if (!file.name.toLowerCase().endsWith('.xml')) {
      const text = await pdfText(file.data);
      const number = labelValue(text, '(?:n[uú]mero\\s*(?:da\\s*)?(?:nota\\s*fiscal|nf(?:-e)?|documento)|nota\\s*fiscal\\s*(?:n[º°.]?\\s*)?|nf-e\\s*(?:n[º°.]?\\s*)?)') || text.match(/\b(?:NF-e|NFe|Nota\s+Fiscal)\b[^\d\n]{0,24}(\d{3,})/i)?.[1] || '';
      const supplier = labelValue(text, '(?:emitente|fornecedor|nome\\s*\\/?\\s*raz[aã]o\\s+social|raz[aã]o\\s+social)');
      return { number, supplier, items: [], summary: 'PDF lido. Complete os produtos, quantidades, volumes e pesos manualmente.', fileName: file.name };
    }
    const doc = parseXml(bytesFromBase64(file.data));
    const info = findNode(doc, 'infNFe') || doc;
    const issuer = findNode(info, 'emit');
    const number = textAt(info, ['nNF']) || (info.getAttribute('Id') || '').replace(/^NFe/, '').slice(-9);
    const supplier = textAt(issuer, ['xNome']);
    const items = findNodes(info, 'det').map(detail => {
      const product = findNode(detail, 'prod');
      return {
        product: textAt(product, ['xProd']),
        quantity: Number(String(textAt(product, ['qCom'])).replace(',', '.')) || 0,
        unit: textAt(product, ['uCom']) || 'unidade', volumeM3: 0, weightKg: 0
      };
    }).filter(item => item.product);
    return {
      number, supplier, items,
      summary: 'Dados do emitente e dos produtos lidos do XML. Informe o volume e o peso de cada item antes de salvar.',
      fileName: file.name
    };
  }

  function now() { return new Date().toISOString(); }

  async function saveInvoice(payload, id = null) {
    const user = await requireUser(['admin']);
    const number = String(payload.number || '').trim();
    const customer = String(payload.customer || '').trim();
    const address = String(payload.address || '').trim();
    const deliveryDate = String(payload.date || '').trim();
    const slot = String(payload.slot || '').trim();
    const driverId = payload.driverId ? Number(payload.driverId) : null;
    const status = String(payload.status || 'Aguardando separação');
    if (!number || number.length > 80) fail('Informe o número da nota fiscal (até 80 caracteres).');
    if (!customer || customer.length > 200) fail('Informe o nome do cliente (até 200 caracteres).');
    if (!address || address.length > 500) fail('Informe o endereço de entrega (até 500 caracteres).');
    const parsedDate = new Date(`${deliveryDate}T12:00:00`);
    if (!deliveryDate || Number.isNaN(parsedDate.getTime())) fail('Informe uma data válida para a entrega.');
    if (parsedDate.getDay() === 0) fail('A agenda atende de segunda a sábado. Escolha outro dia.');
    if (!(await readOne('windows', slot))) fail('Selecione uma janela de entrega válida.');
    if (!STATUSES.includes(status)) fail('Selecione um status válido.');
    const users = await listUsers();
    if (driverId !== null && !users.some(item => item.id === driverId && item.role === 'driver')) fail('Selecione uma conta de Motorista válida.');
    const rows = await readAll('invoices');
    if (rows.some(row => row.id !== id && row.number.toLocaleLowerCase('pt-BR') === number.toLocaleLowerCase('pt-BR'))) fail('Já existe uma nota com esse número.');
    const existing = id ? await readOne('invoices', id) : null;
    if (id && !existing) fail('Nota fiscal não encontrada.', 404);
    const file = payload.file ? cleanFile(payload.file) : existing?.file || null;
    const record = {
      ...(existing || {}), number, customer, address, date: deliveryDate, slot, driverId, status, file,
      createdAt: existing?.createdAt || now(), updatedAt: now()
    };
    if (id) {
      await writeOne('invoices', { ...record, id });
      if (payload.file) clearFileUrls('invoice', id);
    } else {
      const newId = await writeOne('invoices', record, true);
      record.id = newId;
    }
    return invoiceView(record, users);
  }

  async function saveSupplierInvoice(payload, id = null) {
    await requireUser(['admin']);
    const number = String(payload.number || '').trim();
    const supplier = String(payload.supplier || '').trim();
    const receivedDate = String(payload.receivedDate || '').trim();
    const notes = String(payload.notes || '').trim();
    if (!number || number.length > 80) fail('Informe o número da nota fiscal do fornecedor (até 80 caracteres).');
    if (!supplier || supplier.length > 200) fail('Informe o nome do fornecedor (até 200 caracteres).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedDate) || Number.isNaN(new Date(`${receivedDate}T12:00:00`).getTime())) fail('Informe uma data válida de recebimento.');
    if (notes.length > 5000) fail('As observações devem ter até 5.000 caracteres.');
    if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 200) fail('Adicione entre 1 e 200 produtos à nota.');
    const items = payload.items.map((item, index) => {
      const product = String(item.product || '').trim();
      const unit = String(item.unit || '').trim();
      const quantity = Number(String(item.quantity || '').replace(',', '.'));
      const volumeM3 = Number(String(item.volumeM3 || 0).replace(',', '.'));
      const weightKg = Number(String(item.weightKg || 0).replace(',', '.'));
      if (!product || product.length > 200) fail(`Informe o nome do produto ${index + 1} (até 200 caracteres).`);
      if (!unit || unit.length > 20) fail(`Informe uma unidade válida para o produto ${index + 1}.`);
      if (!Number.isFinite(quantity) || quantity <= 0) fail(`A quantidade do produto ${index + 1} precisa ser maior que zero.`);
      if (!Number.isFinite(volumeM3) || volumeM3 < 0 || !Number.isFinite(weightKg) || weightKg < 0) fail(`O volume e o peso do produto ${index + 1} não podem ser negativos.`);
      return { product, quantity, unit, volumeM3, weightKg };
    });
    const rows = await readAll('supplierInvoices');
    if (rows.some(row => row.id !== id && row.number.toLocaleLowerCase('pt-BR') === number.toLocaleLowerCase('pt-BR') && row.supplier.toLocaleLowerCase('pt-BR') === supplier.toLocaleLowerCase('pt-BR'))) fail('Já existe uma nota com esse número para este fornecedor.', 409);
    const existing = id ? await readOne('supplierInvoices', id) : null;
    if (id && !existing) fail('Nota de fornecedor não encontrada.', 404);
    const file = payload.file ? cleanFile(payload.file) : existing?.file || null;
    const record = {
      ...(existing || {}), number, supplier, receivedDate, notes, items, file,
      createdBy: existing?.createdBy || 'Administração', createdAt: existing?.createdAt || now(), updatedAt: now()
    };
    if (id) {
      await writeOne('supplierInvoices', { ...record, id });
      if (payload.file) clearFileUrls('supplier', id);
    } else {
      const newId = await writeOne('supplierInvoices', record, true);
      record.id = newId;
    }
    return supplierInvoiceView(record);
  }

  async function apiRoute(path, options) {
    const method = String(options.method || 'GET').toUpperCase();
    const payload = method === 'GET' ? {} : parseBody(options);
    const user = () => requireUser();
    if (method === 'GET' && path === '/api/setup-status') {
      return { needsSetup: !(await listUsers()).some(item => item.role === 'admin') };
    }
    if (method === 'GET' && path === '/api/me') {
      const active = await user();
      return { user: publicUser(active) };
    }
    if (method === 'GET' && path === '/api/bootstrap') return bootstrap();
    if (method === 'GET' && path === '/api/users') {
      await requireUser(['admin']);
      return { users: (await listUsers()).map(publicUser) };
    }
    if (method === 'POST' && path === '/api/setup') return setupAdmin(payload);
    if (method === 'POST' && path === '/api/login') return login(payload);
    if (method === 'POST' && path === '/api/logout') {
      localStorage.removeItem(SESSION_KEY);
      return { ok: true };
    }
    if (method === 'POST' && path === '/api/invoices/import-preview') return importInvoicePreview(payload);
    if (method === 'POST' && path === '/api/supplier-invoices/import-preview') return importSupplierPreview(payload);
    if (method === 'POST' && path === '/api/invoices') return { invoice: await saveInvoice(payload) };
    if (method === 'POST' && path === '/api/supplier-invoices') return { supplierInvoice: await saveSupplierInvoice(payload) };
    if (method === 'POST' && path === '/api/users') {
      await requireUser(['admin']);
      const name = String(payload.name || '').trim();
      const username = String(payload.username || '').trim();
      const password = String(payload.password || '');
      const role = String(payload.role || '');
      if (!['admin', 'management', 'driver'].includes(role)) fail('Selecione um perfil válido.');
      validateUser(name, username, password);
      if ((await listUsers()).some(item => item.username.toLowerCase() === username.toLowerCase())) fail('Já existe uma conta com esse usuário.', 409);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const created = { name, username, role, passwordSalt: [...salt], passwordHash: await hashPassword(password, salt), createdAt: now() };
      created.id = await writeOne('users', created, true);
      return { user: publicUser(created) };
    }
    let match = path.match(/^\/api\/invoices\/(\d+)$/);
    if (method === 'PUT' && match) return { invoice: await saveInvoice(payload, Number(match[1])) };
    match = path.match(/^\/api\/supplier-invoices\/(\d+)$/);
    if (method === 'PUT' && match) return { supplierInvoice: await saveSupplierInvoice(payload, Number(match[1])) };
    match = path.match(/^\/api\/windows\/(w[1-3])$/);
    if (method === 'PUT' && match) {
      await requireUser(['admin']);
      const start = String(payload.start || '');
      const end = String(payload.end || '');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) fail('Informe um horário inicial válido.');
      if (end && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start)) fail('O horário final deve ser posterior ao inicial.');
      await writeOne('windows', { id: match[1], start, end });
      return { windows: (await readAll('windows')).sort((a, b) => a.id.localeCompare(b.id)) };
    }
    match = path.match(/^\/api\/invoices\/(\d+)\/status$/);
    if (method === 'PATCH' && match) {
      const active = await requireUser(['admin', 'management', 'driver']);
      const id = Number(match[1]);
      const record = await readOne('invoices', id);
      const status = String(payload.status || '');
      if (!record) fail('Nota fiscal não encontrada.', 404);
      if (!STATUSES.includes(status)) fail('Selecione um status válido.');
      if (active.role === 'driver') {
        const allowed = Number(record.driverId) === active.id && ((record.status === 'Pronta para sair' && status === 'Em rota') || (record.status === 'Em rota' && status === 'Entregue'));
        if (!allowed) fail('Esta alteração não está disponível para esta conta.', 403);
      }
      const updated = { ...record, status, updatedAt: now() };
      await writeOne('invoices', updated);
      return { invoice: invoiceView(updated, await listUsers()) };
    }
    match = path.match(/^\/api\/(invoices|supplier-invoices|users)\/(\d+)$/);
    if (method === 'DELETE' && match) {
      const id = Number(match[2]);
      const storeName = match[1] === 'invoices' ? 'invoices' : match[1] === 'supplier-invoices' ? 'supplierInvoices' : 'users';
      const active = await requireUser(match[1] === 'users' || match[1] === 'supplier-invoices' ? ['admin'] : ['admin']);
      const row = await readOne(storeName, id);
      if (!row) fail('Registro não encontrado.', 404);
      if (storeName === 'users') {
        if (active.id === id) fail('Não é possível excluir o acesso em uso.');
        if (row.role === 'admin' && (await listUsers()).filter(item => item.role === 'admin').length <= 1) fail('Mantenha pelo menos uma conta de Administração.');
      }
      await removeOne(storeName, id);
      if (storeName === 'invoices') clearFileUrls('invoice', id);
      if (storeName === 'supplierInvoices') clearFileUrls('supplier', id);
      return { ok: true };
    }
    fail('Ação não encontrada.', 404);
  }

  window.fetch = async (input, options = {}) => {
    const requestUrl = typeof input === 'string' ? input : input.url;
    const url = new URL(requestUrl, window.location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, options);
    try {
      return jsonResponse(await apiRoute(url.pathname, options));
    } catch (error) {
      console.error('GitHub Pages local database:', error);
      return jsonResponse({ error: error.message || 'Não foi possível concluir a solicitação.' }, error.status || 500);
    }
  };
})();
