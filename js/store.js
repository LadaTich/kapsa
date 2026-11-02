'use strict';

const Store = (() => {
  const TABLES = ['categories', 'transactions', 'rules', 'recurring', 'goals'];
  const LOCAL_KEY = 'kapsa-local-v1';
  const CACHE_KEY = 'kapsa-cache-v1';
  const data = { categories: [], transactions: [], rules: [], recurring: [], goals: [], settings: null };
  let sb = null;
  let mode = 'local'; // 'local' | 'remote' | 'offline'
  let user = null;

  const cfg = () => window.KAPSA_CONFIG || {};
  const hasConfig = () => !!(cfg().supabaseUrl && cfg().supabaseKey && !/TVUJ|YOUR/i.test(cfg().supabaseUrl));

  const DEFAULT_ALLOCATION = [
    { id: 'save', name: 'Krátkodobé úspory', pct: 20, type: 'save', color: '#3B6EA8' },
    { id: 'invest', name: 'Dlouhodobé investice', pct: 30, type: 'save', color: '#8E4F9E' },
    { id: 'spend', name: 'Spotřeba', pct: 50, type: 'spend', color: '#2F7D5B' },
  ];
  // [název, typ, barva, pevný výdaj]
  const DEFAULT_CATEGORIES = [
    ['Potraviny', 'expense', '#2F7D5B', false],
    ['Restaurace a kavárny', 'expense', '#C27C0E', false],
    ['Doprava', 'expense', '#3B6EA8', false],
    ['Drogerie a zdraví', 'expense', '#4E9A9A', false],
    ['Oblečení', 'expense', '#A23B72', false],
    ['Zábava a volný čas', 'expense', '#C9A227', false],
    ['Domácnost a nákupy', 'expense', '#9A7B4F', false],
    ['Dárky', 'expense', '#B5473A', false],
    ['Ostatní', 'expense', '#6B7F2A', false],
    ['Bydlení a energie', 'expense', '#5C6B7A', true],
    ['Předplatné a telefon', 'expense', '#8E4F9E', true],
    ['Výplata', 'income', '#2E7D57', false],
    ['Ostatní příjmy', 'income', '#4E9A9A', false],
  ];
  const DEFAULT_RULES = {
    'Potraviny': ['albert', 'lidl', 'kaufland', 'billa', 'tesco', 'penny', 'globus', 'rohlik', 'kosik', 'coop', 'norma', 'flop', 'hruska'],
    'Restaurace a kavárny': ['wolt', 'foodora', 'mcdonald', 'kfc', 'starbucks', 'costa', 'burger', 'bageterie', 'ugo', 'paul'],
    'Doprava': ['bolt', 'uber', 'liftago', 'regiojet', 'dpp', 'litacka', 'shell', 'omv', 'mol', 'orlen', 'benzina', 'eurooil'],
    'Předplatné a telefon': ['netflix', 'spotify', 'hbo', 'disney', 'youtube', 'apple com', 'icloud'],
    'Drogerie a zdraví': ['dm', 'rossmann', 'teta', 'lekarna', 'dr max', 'benu', 'notino'],
    'Domácnost a nákupy': ['ikea', 'alza', 'datart', 'hornbach', 'obi', 'bauhaus', 'tescoma', 'pepco', 'action'],
    'Zábava a volný čas': ['cinema', 'kino', 'steam', 'ticketportal', 'goout'],
  };

  // ---------- inicializace ----------
  async function init() {
    if (hasConfig()) {
      if (!window.supabase || !window.supabase.createClient) {
        mode = 'offline';
        loadCache();
        return { mode, signedIn: !!data.settings };
      }
      mode = 'remote';
      sb = window.supabase.createClient(cfg().supabaseUrl, cfg().supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kapsa-auth' },
      });
      const { data: s } = await sb.auth.getSession();
      user = s.session ? s.session.user : null;
      if (user) loadCache();
      return { mode, signedIn: !!user };
    }
    mode = 'local';
    return { mode, signedIn: true };
  }

  async function signIn(email, password) {
    const { data: d, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    user = d.user;
  }
  async function signOut() {
    if (sb) await sb.auth.signOut();
    user = null;
    localStorage.removeItem(CACHE_KEY);
  }

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c) Object.assign(data, c);
    } catch (e) { /* poškozená cache se ignoruje */ }
  }
  function persist() {
    try {
      localStorage.setItem(mode === 'local' ? LOCAL_KEY : CACHE_KEY, JSON.stringify(data));
    } catch (e) { /* plné úložiště nevadí, data jsou v databázi */ }
  }

  async function fetchAll(table) {
    const out = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data: rows, error } = await sb.from(table).select('*').order('id').range(from, from + size - 1);
      if (error) throw error;
      out.push(...rows);
      if (rows.length < size) break;
    }
    return out;
  }

  async function load() {
    if (mode === 'offline') return;
    if (mode === 'local') {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch (e) { saved = null; }
      if (saved && saved.settings) { Object.assign(data, saved); normalize(); return; }
      data.settings = { period_start_day: 1, alert_threshold: 80, capture_token: null, allocation: DEFAULT_ALLOCATION.map(b => ({ ...b })) };
      await seedDefaults();
      if (window.KAPSA_DEMO || /[?&]demo\b/.test(location.search)) seedDemo();
      normalize();
      persist();
      return;
    }
    const results = await Promise.all(TABLES.map(fetchAll));
    TABLES.forEach((t, i) => { data[t] = results[i]; });
    const { data: s, error } = await sb.from('settings').select('*').maybeSingle();
    if (error) throw error;
    if (s) data.settings = s;
    else {
      const { data: created, error: e2 } = await sb.from('settings').insert({ period_start_day: 1 }).select().single();
      if (e2) throw e2;
      data.settings = created;
      if (!data.categories.length) await seedDefaults();
    }
    normalize();
    persist();
  }

  function normalize() {
    for (const t of ['transactions', 'recurring', 'goals']) {
      for (const r of data[t]) {
        if (r.amount != null) r.amount = Number(r.amount);
        if (r.target != null) r.target = Number(r.target);
        if (r.saved != null) r.saved = Number(r.saved);
      }
    }
    for (const c of data.categories) {
      if (c.budget != null) c.budget = Number(c.budget);
      if (c.budget_pct != null) c.budget_pct = Number(c.budget_pct);
      if (c.fixed == null) c.fixed = false;
    }
    if (data.settings && (!Array.isArray(data.settings.allocation) || !data.settings.allocation.length)) {
      data.settings.allocation = DEFAULT_ALLOCATION.map(b => ({ ...b }));
    }
  }

  // ---------- zápis ----------
  function guardWrite() {
    if (mode === 'offline') throw new Error('Jsi offline. Změny ulož, až budeš připojený.');
  }

  async function insert(table, row) {
    guardWrite();
    let r = { id: U.uuid(), ...row };
    if (mode === 'remote') {
      const { data: d, error } = await sb.from(table).insert(r).select().single();
      if (error) throw error;
      r = d;
    } else r.created_at = new Date().toISOString();
    data[table].push(r);
    normalize();
    persist();
    return r;
  }

  async function insertMany(table, rows) {
    guardWrite();
    let list = rows.map(r => ({ id: U.uuid(), ...r }));
    if (mode === 'remote') {
      const out = [];
      for (let i = 0; i < list.length; i += 400) {
        const { data: d, error } = await sb.from(table).insert(list.slice(i, i + 400)).select();
        if (error) throw error;
        out.push(...d);
      }
      list = out;
    } else list.forEach(r => { r.created_at = new Date().toISOString(); });
    data[table].push(...list);
    normalize();
    persist();
    return list;
  }

  async function update(table, id, patch) {
    guardWrite();
    let p = patch;
    if (mode === 'remote') {
      const { data: d, error } = await sb.from(table).update(patch).eq('id', id).select().single();
      if (error) throw error;
      p = d;
    }
    const i = data[table].findIndex(x => x.id === id);
    if (i > -1) data[table][i] = { ...data[table][i], ...p };
    normalize();
    persist();
    return data[table][i];
  }

  async function remove(table, id) {
    guardWrite();
    if (mode === 'remote') {
      const { error } = await sb.from(table).delete().eq('id', id);
      if (error) throw error;
    }
    data[table] = data[table].filter(x => x.id !== id);
    if (table === 'categories') {
      data.transactions.forEach(t => { if (t.category_id === id) t.category_id = null; });
      data.recurring.forEach(t => { if (t.category_id === id) t.category_id = null; });
      data.rules = data.rules.filter(r => r.category_id !== id);
    }
    persist();
  }

  // Posune datum pravidelné platby jen tehdy, když ho mezitím neposunulo jiné zařízení
  async function advanceRecurring(id, oldDate, newDate) {
    guardWrite();
    if (mode === 'remote') {
      const { data: d, error } = await sb.from('recurring').update({ next_date: newDate })
        .eq('id', id).eq('next_date', oldDate).select();
      if (error) throw error;
      if (!d.length) return false;
    }
    const r = data.recurring.find(x => x.id === id);
    if (r) r.next_date = newDate;
    persist();
    return true;
  }

  async function saveSettings(patch) {
    guardWrite();
    if (mode === 'remote') {
      const { data: d, error } = await sb.from('settings').update(patch).eq('user_id', data.settings.user_id).select().single();
      if (error) throw error;
      data.settings = d;
    } else data.settings = { ...data.settings, ...patch };
    persist();
  }

  // ---------- výchozí data ----------
  async function seedDefaults() {
    const cats = DEFAULT_CATEGORIES.map(([name, kind, color, fixed], i) => ({ id: U.uuid(), name, kind, color, fixed, sort: i, budget: null, budget_pct: null, archived: false }));
    if (mode === 'remote') await insertMany('categories', cats);
    else data.categories = cats.map(c => ({ ...c, created_at: new Date().toISOString() }));
    const byName = Object.fromEntries(data.categories.map(c => [c.name, c.id]));
    const rules = [];
    for (const [cat, patterns] of Object.entries(DEFAULT_RULES)) {
      for (const p of patterns) rules.push({ id: U.uuid(), pattern: p, category_id: byName[cat] });
    }
    if (mode === 'remote') await insertMany('rules', rules);
    else data.rules = rules;
  }

  function seedDemo() {
    const c = Object.fromEntries(data.categories.map(x => [x.name, x]));
    const pct = { 'Potraviny': 38, 'Restaurace a kavárny': 14, 'Doprava': 12, 'Drogerie a zdraví': 6, 'Oblečení': 7, 'Zábava a volný čas': 8, 'Domácnost a nákupy': 7, 'Ostatní': 3 };
    for (const [k, v] of Object.entries(pct)) c[k].budget_pct = v;
    data.settings.period_start_day = 10;

    const today = U.startOfDay(new Date());
    const tx = [];
    const push = (d, merchant, amount, cat, extra = {}) => tx.push({ id: U.uuid(), occurred_at: d.toISOString(), amount, kind: 'expense', category_id: cat ? c[cat].id : null, merchant, note: null, source: 'applepay', status: 'confirmed', external_id: null, created_at: d.toISOString(), ...extra });
    let seed = 11;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const shops = [['Albert', 'Potraviny', 160, 640], ['Lidl', 'Potraviny', 280, 950], ['Billa', 'Potraviny', 90, 340], ['Rohlik.cz', 'Potraviny', 700, 1500],
      ['Bageterie Boulevard', 'Restaurace a kavárny', 159, 239], ['Wolt', 'Restaurace a kavárny', 260, 480], ['Lokál', 'Restaurace a kavárny', 320, 690],
      ['Bolt', 'Doprava', 119, 289], ['Shell', 'Doprava', 900, 1400], ['dm drogerie', 'Drogerie a zdraví', 120, 420], ['Dr.Max lékárna', 'Drogerie a zdraví', 140, 390],
      ['Kino Světozor', 'Zábava a volný čas', 180, 360], ['IKEA', 'Domácnost a nákupy', 300, 1100], ['Zara', 'Oblečení', 590, 1290]];
    for (let d = 110; d >= 0; d--) {
      const day = U.addDays(today, -d);
      const r = rnd();
      const n = d === 0 ? 0 : r < 0.55 ? 0 : r < 0.95 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const s = shops[Math.floor(rnd() * shops.length)];
        const t = new Date(day); t.setHours(10 + Math.floor(rnd() * 10), Math.floor(rnd() * 60));
        push(t, s[0], Math.round(s[2] + rnd() * (s[3] - s[2])), s[1]);
      }
      if (rnd() < 0.45 || day.getDay() === 1) { // ranní káva skoro každý den
        const t = new Date(day); t.setHours(8, 10 + Math.floor(rnd() * 40));
        push(t, 'Costa Coffee', 89 + Math.round(rnd() * 40), 'Restaurace a kavárny');
      }
      if (day.getDate() === 22) { const t = new Date(day); t.setHours(6); push(t, 'Disney Plus', 199, 'Předplatné a telefon'); }
    }
    const recurringDefs = [
      ['Nájem', 14500, 'Bydlení a energie', 15], ['Elektřina a plyn', 2100, 'Bydlení a energie', 20],
      ['Netflix', 259, 'Předplatné a telefon', 8], ['Spotify', 189, 'Předplatné a telefon', 15], ['Telefon', 450, 'Předplatné a telefon', 18],
    ];
    const recurring = [];
    for (const [name, amount, cat, day] of recurringDefs) {
      const id = U.uuid();
      for (let back = 4; back >= 0; back--) {
        const d = new Date(today.getFullYear(), today.getMonth() - back, day, 8);
        if (d <= today && U.daysBetween(d, today) <= 110) {
          tx.push({ id: U.uuid(), occurred_at: d.toISOString(), amount, kind: 'expense', category_id: c[cat].id, merchant: name, note: null, source: 'recurring', status: 'confirmed', external_id: null, recurring_id: id, created_at: d.toISOString() });
        }
      }
      let next = new Date(today.getFullYear(), today.getMonth(), day);
      if (next <= today) next = new Date(today.getFullYear(), today.getMonth() + 1, day);
      recurring.push({ id, name, amount, kind: 'expense', category_id: c[cat].id, every: 'month', next_date: U.isoDate(next), active: true });
    }
    // proměnlivé výplaty vždy 10. a odložené peníze
    const salaries = [43800, 38900, 46200, 41250];
    salaries.forEach((amount, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (salaries.length - 1 - i) + (today.getDate() >= 10 ? 0 : -1) + 0, 10, 9);
      if (d > today) return;
      tx.push({ id: U.uuid(), occurred_at: d.toISOString(), amount, kind: 'income', category_id: c['Výplata'].id, merchant: 'Výplata', note: null, source: 'manual', status: 'confirmed', external_id: null, created_at: d.toISOString() });
      const fixed = 14500 + 2100 + 259 + 189 + 450 + 199;
      const rest = amount - fixed;
      const t = new Date(d); t.setHours(19);
      tx.push({ id: U.uuid(), occurred_at: t.toISOString(), amount: Math.round(rest * 0.2), kind: 'transfer', bucket: 'save', category_id: null, merchant: 'Krátkodobé úspory', note: null, source: 'manual', status: 'confirmed', external_id: null, created_at: t.toISOString() });
      if (i < salaries.length - 1) tx.push({ id: U.uuid(), occurred_at: t.toISOString(), amount: Math.round(rest * 0.3), kind: 'transfer', bucket: 'invest', category_id: null, merchant: 'Dlouhodobé investice', note: null, source: 'manual', status: 'confirmed', external_id: null, created_at: t.toISOString() });
    });
    // platby čekající na kontrolu
    const now = new Date();
    push(new Date(now.getTime() - 40 * 60000), 'BILLA 1043 PRAHA', 214, 'Potraviny', { status: 'pending' });
    const yEve = U.addDays(today, -1); yEve.setHours(19, 24); push(yEve, 'SUMUP *PEKARNA KABINET', 96, null, { status: 'pending' });
    data.transactions = tx;
    data.recurring = recurring;
    data.goals = [
      { id: U.uuid(), name: 'Dovolená v Chorvatsku', target: 30000, saved: 12400, deadline: U.isoDate(new Date(today.getFullYear() + 1, 5, 30)), color: '#3B6EA8' },
      { id: U.uuid(), name: 'Rezerva na tři měsíce', target: 90000, saved: 41000, deadline: null, color: '#2F7D5B' },
    ];
  }

  return {
    data, init, load, signIn, signOut, insert, insertMany, update, remove, advanceRecurring, saveSettings,
    get mode() { return mode; },
    get user() { return user; },
    captureUrl: () => hasConfig() ? `${cfg().supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/capture_payment` : '',
    apiKey: () => cfg().supabaseKey || '',
    resetLocal: () => { localStorage.removeItem(LOCAL_KEY); },
    DEFAULT_ALLOCATION,
  };
})();
