'use strict';

(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const D = Store.data;
  const main = $('#main'), nav = $('#nav'), sheetRoot = $('#sheet-root'), toastRoot = $('#toast-root');

  const ui = {
    view: 'prehled', planTab: 'rozdeleni',
    txKind: 'all', txSearch: '', txCat: '', txAcc: '', txOffset: 0,
    repMode: 'tyden', repOffset: 0, inboxAll: false, allocDraft: null,
  };

  // ---------- ikony ----------
  const ICON = {
    home: '<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
    chart: '<path d="M5 20v-8M11 20V5M17 20v-5M3 20h18"/>',
    plan: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>',
    gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    left: '<path d="m14.5 6-6 6 6 6"/>',
    right: '<path d="m9.5 6 6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M3.5 10.5h17M15.5 15h2"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5 15.5V6a1 1 0 0 1 1-1h9.5"/>',
  };
  const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
  const LOGO = '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--logo-bg)"/><path d="M9 9.5h14v9.5a7 7 0 0 1-14 0z" fill="none" stroke="var(--logo-fg)" stroke-width="2.4" stroke-linejoin="round"/><path d="M9 14h14" stroke="var(--logo-fg)" stroke-width="2.4"/></svg>';

  const SWATCHES = ['#2F7D5B', '#C27C0E', '#3B6EA8', '#5C6B7A', '#8E4F9E', '#4E9A9A', '#A23B72', '#C9A227', '#9A7B4F', '#B5473A', '#6B7F2A', '#2E7D57'];

  // ---------- datové pomocníky ----------
  const settings = () => D.settings || { period_start_day: 1, alert_threshold: 80 };
  const startDay = () => Number(settings().period_start_day) || 1;
  const alloc = () => (Array.isArray(settings().allocation) && settings().allocation.length ? settings().allocation : Store.DEFAULT_ALLOCATION);
  const bucketById = id => alloc().find(b => b.id === id);
  const cats = kind => D.categories.filter(c => !c.archived && (!kind || c.kind === kind))
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'cs'));
  const varCats = () => cats('expense').filter(c => !c.fixed);
  const catById = id => D.categories.find(c => c.id === id);
  const catName = id => (catById(id) || {}).name || 'Bez kategorie';
  const catColor = id => (catById(id) || {}).color || 'var(--ink-3)';
  const txById = id => D.transactions.find(t => t.id === id);
  const when = t => new Date(t.occurred_at);
  const byDateDesc = (a, b) => when(b) - when(a);
  const inRange = (t, a, b) => { const d = when(t); return d >= a && d < b; };
  // ---------- účty ----------
  const accounts = () => (D.accounts || []).filter(a => !a.archived).sort((a, b) => (b.is_main - a.is_main) || (a.sort - b.sort));
  const mainAcc = () => (D.accounts || []).find(a => a.is_main) || null;
  const accById = id => (id ? (D.accounts || []).find(a => a.id === id) : mainAcc());
  const isMainId = id => !id || (mainAcc() && id === mainAcc().id);
  const ACC_TYPES = { checking: 'Běžný', savings: 'Spořicí', business: 'Podnikatelský', investment: 'Investiční', crypto: 'Kryptoměna' };
  const bucketAccount = b => (b && b.account_id ? accById(b.account_id) : null);
  const transferTo = t => (t.to_account_id ? accById(t.to_account_id) : bucketAccount(bucketById(t.bucket)));
  const fmtBtc = v => `${new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(Number(v) || 0)}\u00a0BTC`;
  const fmtAcc = (a, v) => (a && a.currency === 'BTC' ? fmtBtc(v) : U.money(v));
  const BTC_KEY = 'kapsa-btc-price';
  const btcPrice = () => { try { return JSON.parse(localStorage.getItem(BTC_KEY) || 'null'); } catch (e) { return null; } };
  const setBtcPrice = (price, source) => { try { localStorage.setItem(BTC_KEY, JSON.stringify({ price, source, at: new Date().toISOString() })); } catch (e) { /* nevadí */ } };

  // Zůstatek účtu: poslední srovnání plus pohyby od té doby (v měně účtu)
  function accBalance(a) {
    if (!a || a.anchor == null || !a.anchor_at) return null;
    const at = new Date(a.anchor_at);
    let b = Number(a.anchor);
    for (const t of D.transactions) {
      if (when(t) <= at) continue;
      const fromHere = a.is_main ? isMainId(t.account_id) : t.account_id === a.id;
      if (t.kind === 'transfer') {
        if (fromHere) b -= Number(t.amount);
        const to = transferTo(t);
        if (to && to.id === a.id) b += Number(t.amount_to != null ? t.amount_to : t.amount);
      } else if (fromHere) b += (t.kind === 'income' ? 1 : -1) * Number(t.amount);
    }
    return b;
  }
  // Kolik se do investice celkem vložilo: zadaná částka + převody dovnitř − převody ven od posledního srovnání
  function accInvested(a) {
    if (!a || !a.invested) return null;
    const at = a.anchor_at ? new Date(a.anchor_at) : new Date(0);
    let v = Number(a.invested);
    for (const t of D.transactions) {
      if (t.kind !== 'transfer' || when(t) <= at) continue;
      const to = transferTo(t);
      const from = accById(t.account_id);
      if (to && to.id === a.id) v += from && from.currency === 'BTC' ? 0 : Number(t.amount);
      if (t.account_id === a.id) v -= a.currency === 'BTC' ? Number(t.amount_to || 0) : Number(t.amount);
    }
    return Math.max(0, v);
  }
  const accCzk = a => {
    const b = accBalance(a);
    if (b == null) return null;
    if (a.currency !== 'BTC') return b;
    const p = btcPrice();
    return p ? b * p.price : null;
  };

  const inMain = t => (t.kind === 'transfer' ? isMainId(t.account_id) : isMainId(t.account_id));
  const txIn = (a, b, kind) => D.transactions.filter(t => (!kind || t.kind === kind) && inMain(t) && inRange(t, a, b));
  const txAny = (a, b) => D.transactions.filter(t => inRange(t, a, b));
  // Převod z jiného účtu na běžný, označený jako příjem do rozpočtu
  const incomeTransfersIn = (a, b) => D.transactions.filter(t => t.kind === 'transfer' && t.as_income && t.to_account_id && isMainId(t.to_account_id) && !isMainId(t.account_id) && inRange(t, a, b));
  const incomeIn = (a, b) => sum(txIn(a, b, 'income')) + incomeTransfersIn(a, b).reduce((s, t) => s + Number(t.amount_to != null ? t.amount_to : t.amount), 0);
  const sum = arr => arr.reduce((s, t) => s + Number(t.amount || 0), 0);
  const curPeriod = () => U.period(new Date(), startDay());
  const shiftPeriod = n => { const c = curPeriod(); return U.period(new Date(c.start.getFullYear(), c.start.getMonth() + n, startDay()), startDay()); };
  const round100 = v => Math.round(v / 100) * 100;

  // Pevný výdaj = pravidelná platba nebo kategorie označená jako pevná. Do spotřeby se nepočítá.
  function isFixedTx(t) {
    if (t.kind !== 'expense') return false;
    if (t.recurring_id) return true;
    const c = catById(t.category_id);
    return !!(c && c.fixed);
  }

  function occurrences(r, from, to) {
    const out = [];
    let d = U.parseISODate(r.next_date), guard = 0;
    while (d < to && guard++ < 400) { if (d >= from) out.push(new Date(d)); d = U.advance(d, r.every); }
    return out;
  }

  function matchRule(text) {
    if (!text) return null;
    const n = ` ${U.norm(text)} `;
    let best = null;
    for (const r of D.rules) {
      const c = catById(r.category_id);
      if (!c || c.archived) continue;
      if (n.includes(` ${r.pattern}`) && (!best || r.pattern.length > best.pattern.length)) best = r;
    }
    return best ? best.category_id : null;
  }

  function topCats(kind, n) {
    const since = U.addDays(new Date(), -90);
    const counts = {};
    D.transactions.forEach(t => { if (t.kind === kind && t.category_id && when(t) >= since) counts[t.category_id] = (counts[t.category_id] || 0) + 1; });
    return cats(kind).slice().sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.sort - b.sort).slice(0, n);
  }

  const statsCache = new Map();
  Store.onChange(() => statsCache.clear());
  const shiftFrom = (per, n) => U.period(new Date(per.start.getFullYear(), per.start.getMonth() + n, startDay()), startDay());
  const recPattern = r => (r.pattern ? U.norm(r.pattern) : U.patternFor(r.name));

  // Pravidelné výdaje v období. Bez data = závazek na každé období: dokud neodejde, počítá se dopředu.
  function obligations(per) {
    return D.recurring.filter(r => r.active && r.kind === 'expense' && (!r.created_at || new Date(r.created_at) < per.end)).map(r => {
      const paidTx = D.transactions.filter(t => t.recurring_id === r.id && inRange(t, per.start, per.end)).sort(byDateDesc);
      const paid = sum(paidTx);
      if (!r.next_date) {
        return { r, paidTx, paid, open: paidTx.length ? 0 : Number(r.amount), planned: paidTx.length ? paid : Number(r.amount), done: paidTx.length > 0, auto: false };
      }
      const occ = occurrences(r, per.start, per.end);
      const open = occ.length * Number(r.amount);
      return { r, paidTx, paid, open, planned: paid + open, done: !occ.length && paidTx.length > 0, auto: true, due: occ[0] || null };
    }).filter(o => o.planned > 0 || o.done);
  }

  // Základ období bez převodu z minula (výsledek se ukládá, dokud se data nezmění)
  function baseStats(per) {
    const key = U.isoDate(per.start);
    if (statsCache.has(key)) return statsCache.get(key);
    const incomeActual = incomeIn(per.start, per.end);
    // S výplatou se počítá až ve chvíli, kdy ji zapíšeš. Do té doby jen se zbytkem z minula.
    const income = incomeActual, estimated = false;
    const exp = txIn(per.start, per.end, 'expense');
    const fixedPaid = sum(exp.filter(isFixedTx));
    const obl = obligations(per);
    const fixedOpen = obl.reduce((s, o) => s + o.open, 0);
    const fixed = fixedPaid + fixedOpen;
    const remainder = Math.max(0, income - fixed);
    const transfers = txIn(per.start, per.end, 'transfer');
    const buckets = alloc().map(b => ({
      ...b,
      amount: remainder * (Number(b.pct) || 0) / 100,
      done: sum(transfers.filter(t => t.bucket === b.id)),
    }));
    const spendB = buckets.find(b => b.type === 'spend');
    const basePot = spendB ? spendB.amount : remainder;
    const variable = exp.filter(t => !isFixedTx(t));
    const res = { per, income, incomeActual, estimated, fixed, fixedPaid, fixedOpen, obl, remainder, buckets, basePot, variable, variableSpent: sum(variable), transfers };
    statsCache.set(key, res);
    return res;
  }

  // Nevyčerpaná spotřeba se převádí do dalšího období (počítá se nejvýš 12 období zpět)
  function carryInto(per) {
    let c = 0;
    for (let i = 12; i >= 1; i--) {
      const b = baseStats(shiftFrom(per, -i));
      c = Math.max(0, b.basePot + c - b.variableSpent);
    }
    return c;
  }

  function periodStats(per) {
    const b = baseStats(per);
    const carry = carryInto(per);
    return { ...b, carry, pot: b.basePot + carry };
  }

  function limitOf(c, st) {
    if (!c || c.kind !== 'expense' || c.fixed) return 0;
    if (c.budget_pct != null && c.budget_pct !== '') return st.pot * Number(c.budget_pct) / 100;
    return Number(c.budget) || 0;
  }

  function budgetState(c, st) {
    const spent = sum((c.fixed ? txIn(st.per.start, st.per.end, 'expense') : st.variable).filter(t => t.category_id === c.id));
    const limit = limitOf(c, st);
    return { spent, limit, pct: limit ? spent / limit * 100 : 0, left: limit - spent };
  }
  const stClass = pct => pct >= 100 ? 'bad' : pct >= settings().alert_threshold ? 'warn' : 'ok';

  function allowance(st) {
    if (!st.income && !st.carry) return null;
    const today = U.startOfDay(new Date());
    const tomorrow = U.addDays(today, 1);
    const spentToday = sum(st.variable.filter(t => inRange(t, today, tomorrow)));
    const daysLeft = Math.max(1, U.daysBetween(today, st.per.end));
    const remaining = st.pot - st.variableSpent;
    const perDay = (remaining + spentToday) / daysLeft;
    return { daysLeft, remaining, perDay, spentToday, leftToday: perDay - spentToday };
  }

  const balance = () => accBalance(mainAcc());

  // Patří platba k pravidelnému výdaji, který v období ještě neodešel?
  function matchObligation(text, amount, date, skip = new Set()) {
    const per = U.period(date, startDay());
    const open = obligations(per).filter(o => !o.done && !o.auto && !skip.has(`${o.r.id}@${U.isoDate(per.start)}`));
    const n = ` ${U.norm(text)} `;
    let m = open.find(o => { const p = recPattern(o.r); return p && p.length > 1 && n.includes(` ${p}`); });
    if (!m && amount) {
      const c = open.filter(o => Math.abs(o.planned - amount) <= o.planned * 0.01);
      if (c.length === 1) m = c[0];
    }
    return m ? m.r : null;
  }

  // ---------- tipy ----------
  const TIPS_KEY = 'kapsa-tips-off';
  const dismissed = () => { try { return JSON.parse(localStorage.getItem(TIPS_KEY) || '[]'); } catch (e) { return []; } };

  function computeTips() {
    const tips = [];
    const cur = curPeriod();
    const st = periodStats(cur);
    const today = U.startOfDay(new Date());
    const elapsed = U.daysBetween(cur.start, today) + 1;
    const frac = elapsed / cur.days;
    const daysLeft = Math.max(1, U.daysBetween(today, cur.end));
    const hist = [1, 2, 3].map(i => periodStats(shiftPeriod(-i))).filter(s => s.variable.length >= 5);

    // 1. peníze z výplaty, které ještě neodešly stranou
    if (st.incomeActual) {
      st.buckets.filter(b => b.type === 'save' && b.amount - b.done > 50).forEach(b => {
        const left = b.amount - b.done;
        tips.push({ id: `save-${b.id}`, p: elapsed >= 2 ? 100 : 85, tone: 'act',
          text: `Z výplaty ještě čeká ${U.money(left)} na ${b.name.toLowerCase()}. Pošli je stranou hned, dokud jsou na účtu.`,
          action: { label: 'Označit jako odložené', act: 'transfer', b: b.id } });
      });
    }

    // nezapsané pravidelné výdaje ke konci období
    if (frac >= 0.75) {
      st.obl.filter(o => !o.done && !o.auto).forEach(o => tips.push({ id: `unpaid-${o.r.id}`, p: 75, tone: 'act',
        text: `${o.r.name} (${U.money(o.planned)}) v tomto období ještě není zapsaný jako zaplacený. Pokud už odešel, označ ho, ať sedí zůstatek.`,
        action: { label: 'Zaplaceno', act: 'pay-rec', id: o.r.id } }));
    }

    // zůstatek účtu
    const s0 = settings();
    if (s0.balance_anchor == null) {
      tips.push({ id: 'balance-missing', p: 45, text: 'Opiš do Kapsy aktuální zůstatek z bankovnictví. Od té chvíle ho budu sám přepočítávat podle zapsaných pohybů.', action: { label: 'Zadat zůstatek', act: 'balance' } });
    } else if (U.daysBetween(new Date(s0.balance_anchor_at), today) > 35) {
      tips.push({ id: 'balance-old', p: 25, text: `Zůstatek se naposledy srovnával před ${U.daysBetween(new Date(s0.balance_anchor_at), today)} dny. Porovnej ho s bankou, ať víš, jestli nechybí nějaká platba.`, action: { label: 'Srovnat zůstatek', act: 'balance' } });
    }

    // převedený zbytek
    if (st.carry > 0 && elapsed <= 5) {
      tips.push({ id: 'carry', p: 22, tone: 'good', text: `Z minulého období zbylo ${U.money(st.carry)} a přičetlo se ke spotřebě.` });
    }

    // 2. hromada nezařazených plateb
    const pending = D.transactions.filter(t => t.status === 'pending').length;
    if (pending >= 5) tips.push({ id: 'pending', p: 80, text: `${pending} ${U.plural(pending, 'platba čeká', 'platby čekají', 'plateb čeká')} na zařazení. Bez kategorií nevím, kde ti peníze utíkají.` });

    // 3. limity dohromady přesahují peníze na spotřebu
    const vc = varCats();
    const sumLimits = vc.reduce((s, c) => s + limitOf(c, st), 0);
    if (st.pot > 0 && sumLimits > st.pot * 1.02) {
      tips.push({ id: 'limits-over-pot', p: 65, text: `Limity kategorií dávají dohromady ${U.money(sumLimits)}, ale na spotřebu je z této výplaty ${U.money(st.pot)}. Uber ${U.money(sumLimits - st.pot)}, jinak plán nevyjde.` });
    }

    // 4. tempo v tomto období
    if (frac >= 0.2) {
      vc.forEach(c => {
        const b = budgetState(c, st);
        if (!b.limit || b.spent < b.limit * 0.3 || b.spent >= b.limit) return;
        const projected = b.spent / frac;
        if (projected > b.limit * 1.15) {
          tips.push({ id: `pace-${c.id}`, p: 70, tone: 'warn',
            text: `${c.name}: tímhle tempem skončíš kolem ${U.money(round100(projected))}, limit je ${U.money(b.limit)}. Do konce období vychází ${U.money(b.left / daysLeft)} denně.` });
        }
      });
    }

    // 5. a 6. dlouhodobě nad nebo pod limitem
    if (hist.length >= 2) {
      vc.forEach(c => {
        const rows = hist.map(h => ({ spent: sum(h.variable.filter(t => t.category_id === c.id)), limit: limitOf(c, h), pot: h.pot }));
        if (!rows.every(r => r.limit > 0)) return;
        const avgSpent = rows.reduce((s, r) => s + r.spent, 0) / rows.length;
        const avgLimit = rows.reduce((s, r) => s + r.limit, 0) / rows.length;
        const avgPot = rows.reduce((s, r) => s + r.pot, 0) / rows.length;
        const over = rows.filter(r => r.spent > r.limit).length;
        const pctMode = c.budget_pct != null;
        const suggest = v => pctMode && avgPot
          ? { v: Math.max(1, Math.round(v / avgPot * 100)), label: `${Math.max(1, Math.round(v / avgPot * 100))} %`, mode: 'pct' }
          : { v: Math.max(100, round100(v)), label: U.money(Math.max(100, round100(v))), mode: 'kc' };
        const curLimit = limitOf(c, st) || avgLimit;
        const overAvg = rows.filter(r => r.spent > r.limit).reduce((s, r) => s + r.spent, 0) / Math.max(1, over);
        if (over >= 2 && overAvg > curLimit) {
          const s = suggest(overAvg * 1.05);
          tips.push({ id: `over-${c.id}`, p: 60,
            text: `Kategorie ${c.name} byla nad limitem ${over}× za poslední ${rows.length} období, v těch obdobích průměrně ${U.money(overAvg)}. Buď limit zvyš, nebo hledej úsporu právě tady.`,
            action: { label: `Zvýšit na ${s.label}`, act: 'tip-limit', id: c.id, v: s.v, mode: s.mode } });
        } else if (rows.every(r => r.spent < r.limit * 0.6) && avgSpent * 1.15 < curLimit) {
          const s = suggest(avgSpent * 1.15);
          tips.push({ id: `under-${c.id}`, p: 40,
            text: `Kategorie ${c.name} vychází průměrně na ${U.money(avgSpent)} z limitu ${U.money(avgLimit)}. Snížením uvolníš peníze pro kategorie, kde ti chybí.`,
            action: { label: `Snížit na ${s.label}`, act: 'tip-limit', id: c.id, v: s.v, mode: s.mode } });
        }
      });
    }

    // rezerva na spořicím účtu
    const sav = accounts().filter(a => a.type === 'savings').reduce((x, a) => x + (accCzk(a) || 0), 0);
    if (hist.length >= 2 && sav > 0) {
      const avgExp = hist.reduce((x, h) => x + h.fixedPaid + h.variableSpent, 0) / hist.length;
      const months = avgExp ? sav / avgExp : 0;
      if (months && months < 3) {
        tips.push({ id: 'reserve', p: 32, text: `Na spořicím účtu máš ${U.money(sav)}, to pokryje zhruba ${months.toFixed(1).replace('.', ',')} měsíce výdajů. Rezerva na 3 až 6 měsíců dává klid, kdyby přišel výpadek příjmu.` });
      }
    }

    // 7. časté drobné nákupy za posledních 30 dní
    const last30 = D.transactions.filter(t => t.kind === 'expense' && !isFixedTx(t) && when(t) >= U.addDays(today, -30));
    const groups = {};
    last30.forEach(t => {
      const k = U.patternFor(t.merchant);
      if (!k) return;
      (groups[k] = groups[k] || { name: t.merchant, n: 0, v: 0 });
      groups[k].n++; groups[k].v += Number(t.amount);
    });
    const freq = Object.values(groups).filter(g => g.n >= 8 && g.v >= 800).sort((a, b) => b.v - a.v)[0];
    if (freq) {
      tips.push({ id: `freq-${U.patternFor(freq.name)}`, p: 50,
        text: `${freq.name}: ${freq.n}× za posledních 30 dní, dohromady ${U.money(freq.v)}. O polovinu méně návštěv je ${U.money(round100(freq.v / 2))} měsíčně navíc.` });
    }

    // 8. opakované platby, které nejsou mezi pravidelnými
    const since = U.addDays(today, -125);
    const subs = {};
    D.transactions.filter(t => t.kind === 'expense' && !t.recurring_id && when(t) >= since).forEach(t => {
      const k = U.patternFor(t.merchant);
      if (!k) return;
      (subs[k] = subs[k] || []).push(t);
    });
    const known = new Set(D.recurring.map(r => U.patternFor(r.name)));
    Object.entries(subs).forEach(([k, list]) => {
      if (known.has(k)) return;
      const months = new Set(list.map(t => `${when(t).getFullYear()}-${when(t).getMonth()}`));
      if (months.size < 3 || list.length / months.size > 1.5) return;
      const amounts = list.map(t => Number(t.amount)).sort((a, b) => a - b);
      const med = amounts[Math.floor(amounts.length / 2)];
      if (!amounts.every(a => Math.abs(a - med) <= med * 0.1)) return;
      const last = list.sort(byDateDesc)[0];
      tips.push({ id: `sub-${k}`, p: 55,
        text: `${last.merchant} se strhává každý měsíc, zhruba ${U.money(med)}. Přidej to mezi pravidelné platby, ať s tím plán počítá dopředu.`,
        action: { label: 'Přidat mezi pravidelné', act: 'tip-sub', name: last.merchant, v: med, cat: last.category_id || '', date: U.isoDate(U.advance(when(last), 'month')) } });
    });

    // 9. kategorie, která minulé období nečekaně vyskočila
    if (hist.length >= 3) {
      vc.forEach(c => {
        const v = hist.map(h => sum(h.variable.filter(t => t.category_id === c.id)));
        const usual = (v[1] + v[2]) / 2;
        if (usual > 0 && v[0] > usual * 1.35 && v[0] - usual >= 600) {
          tips.push({ id: `jump-${c.id}`, p: 30, text: `Kategorie ${c.name}: minulé období ${U.money(v[0])}, obvykle kolem ${U.money(usual)}. Stojí za to projít, co tam přibylo.` });
        }
      });
    }

    // 10. kolísavá výplata a limity v korunách
    const incomes = [st, ...hist].map(h => h.incomeActual).filter(Boolean);
    if (incomes.length >= 3) {
      const mn = Math.min(...incomes), mx = Math.max(...incomes);
      const avg = incomes.reduce((s, x) => s + x, 0) / incomes.length;
      const fixedKc = vc.filter(c => c.budget_pct == null && c.budget > 0);
      if ((mx - mn) / avg >= 0.12 && fixedKc.length) {
        tips.push({ id: 'income-var', p: 35, text: `Výplata ti kolísá mezi ${U.money(mn)} a ${U.money(mx)}. Limity v korunách (${fixedKc.map(c => c.name).slice(0, 3).join(', ')}) se jí nepřizpůsobí. Přepni je na procenta ze spotřeby.` });
      }
    }

    // 11. pochvala za odložené peníze
    if (hist.length >= 2) {
      const a = sum(hist[0].transfers), b = sum(hist[1].transfers);
      if (a > 0 && a > b) tips.push({ id: 'saved-more', p: 20, tone: 'good', text: `Minulé období šlo stranou ${U.money(a)}, o ${U.money(a - b)} víc než předtím.` });
    }

    const off = new Set(dismissed());
    const key = U.isoDate(cur.start);
    return tips.filter(t => !off.has(`${t.id}@${key}`)).sort((a, b) => b.p - a.p);
  }

  function tipsHTML(limit) {
    const tips = computeTips();
    if (!tips.length) return limit ? '' : '<p class="empty">Zatím žádné tipy. Jakmile Kapsa nasbírá pár týdnů plateb, začne ti radit, kde ušetřit a které limity upravit.</p>';
    const shown = limit ? tips.slice(0, limit) : tips;
    const body = shown.map(t => {
      const a = t.action;
      const attrs = a ? Object.entries(a).filter(([k]) => k !== 'label' && k !== 'act').map(([k, v]) => `data-${k}="${U.esc(v)}"`).join(' ') : '';
      return `<li class="tip${t.tone ? ` t-${t.tone}` : ''}"><p>${U.esc(t.text)}</p>
        <div class="tip-act">${a ? `<button class="btn small" data-action="${a.act}" ${attrs}>${U.esc(a.label)}</button>` : ''}
        <button class="link muted-link" data-action="tip-dismiss" data-tip="${t.id}">Skrýt</button></div></li>`;
    }).join('');
    if (!limit) return `<ul class="tips">${body}</ul>`;
    return `<section class="block"><div class="bhead"><h2>Tipy</h2>${tips.length > limit ? `<a class="link" href="#reporty">Všechny (${tips.length})</a>` : ''}</div><ul class="tips">${body}</ul></section>`;
  }

  // ---------- UI pomocníky ----------
  function toast(text, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type ? 'alert' : 'status');
    el.textContent = text;
    toastRoot.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, type ? 5200 : 2600);
  }
  const fail = (e, what = 'Uložení') => { console.error(e); toast(`${what} se nepovedlo: ${e && e.message ? e.message : e}`, 'bad'); };

  let lastFocus = null;
  function openSheet(html, onMount) {
    lastFocus = document.activeElement;
    sheetRoot.innerHTML = `<div class="sheet-wrap"><div class="sheet-backdrop" data-close></div><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
    const wrap = sheetRoot.firstElementChild;
    const sheet = wrap.querySelector('.sheet');
    document.body.classList.add('noscroll');
    requestAnimationFrame(() => wrap.classList.add('open'));
    if (onMount) onMount(sheet);
    return sheet;
  }
  function closeSheet() {
    if (!sheetRoot.firstChild) return;
    sheetRoot.innerHTML = '';
    document.body.classList.remove('noscroll');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  const sheetHead = title => `<div class="sheet-head"><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Zavřít">${icon('close')}</button></div>`;

  const head = (title, sub = '') => `<header class="vhead"><div><h1>${title}</h1>${sub ? `<p class="vsub">${sub}</p>` : ''}</div><a href="#nastaveni" class="icon-btn mobile-only" aria-label="Nastavení">${icon('gear')}</a></header>`;

  const amt = (t, exact = true) => t.kind === 'transfer' ? U.money(t.amount, exact) : `${t.kind === 'income' ? '+' : '−'}${U.money(t.amount, exact)}`;

  function txRow(t, withDate = false, ctxAcc = null) {
    const multi = accounts().length > 1;
    let label, color, amountHtml, cls = '';
    if (t.kind === 'transfer') {
      const from = accById(t.account_id), to = transferTo(t);
      label = `${from ? from.name : 'Účet'} → ${to ? to.name : 'stranou'}`;
      color = to ? to.color : 'var(--ink-3)';
      const incoming = ctxAcc && to && to.id === ctxAcc.id;
      const v = incoming && t.amount_to != null ? t.amount_to : t.amount;
      const curAcc = incoming ? to : from;
      amountHtml = ctxAcc ? `${incoming ? '+' : '−'}${fmtAcc(curAcc, v)}` : fmtAcc(from, t.amount);
      cls = ctxAcc ? (incoming ? 'inc' : '') : 'tr';
    } else {
      const acc = accById(t.account_id);
      label = (t.category_id ? catName(t.category_id) : 'Bez kategorie') + (multi && acc && !acc.is_main ? `, ${acc.name}` : '');
      color = catColor(t.category_id);
      amountHtml = `${t.kind === 'income' ? '+' : '−'}${fmtAcc(acc, t.amount)}`;
      cls = t.kind === 'income' ? 'inc' : '';
    }
    const meta = [label, withDate ? `${U.short(t.occurred_at)} ${U.time(t.occurred_at)}` : U.time(t.occurred_at)];
    return `<li><button class="tx" data-action="edit-tx" data-id="${t.id}">
      <span class="dot${t.kind === 'transfer' ? ' ring' : ''}" style="--c:${color}"></span>
      <span class="tx-main"><span class="tx-title">${U.esc(t.merchant || label)}</span>
      <span class="tx-meta">${U.esc(meta.join(', '))}${t.status === 'pending' ? '<span class="tag">ke kontrole</span>' : ''}</span></span>
      <span class="tx-amt ${cls}">${amountHtml}</span></button></li>`;
  }

  function barChart(values, { avg = 0, todayIndex = -1, height = 120, cls = '' } = {}) {
    const n = values.length;
    const W = n * 10, H = 100;
    const peak = Math.max(...values, 1);
    // jednorázové velké platby (nájem) by zploštily ostatní dny, proto strop na trojnásobku průměru
    const max = avg ? Math.max(avg * 1.5, Math.min(peak, avg * 3)) : peak;
    const bars = values.map((v, i) => {
      const future = todayIndex > -1 && i > todayIndex;
      if (future || !v) return `<rect x="${i * 10 + 1.5}" y="${H - 1.5}" width="7" height="1.5" class="b-empty"/>`;
      const h = Math.min(H, Math.max(2, v / max * (H - 4)));
      const c = i === todayIndex ? 'b-today' : avg && v > avg ? 'b-over' : 'b-norm';
      return `<rect x="${i * 10 + 1.5}" y="${H - h}" width="7" height="${h}" rx="1" class="${c}"><title>${U.money(v)}</title></rect>`;
    }).join('');
    const line = avg ? `<line x1="0" x2="${W}" y1="${H - avg / max * (H - 4)}" y2="${H - avg / max * (H - 4)}" class="b-avg" vector-effect="non-scaling-stroke"/>` : '';
    return `<svg class="bars ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${height}px" role="img" aria-label="Výdaje po dnech">${bars}${line}</svg>`;
  }

  // ---------- navigace ----------
  const NAV = [['prehled', 'Přehled', 'home'], ['ucty', 'Účty', 'wallet'], ['pohyby', 'Pohyby', 'list'], ['add', 'Přidat', 'plus'], ['reporty', 'Reporty', 'chart'], ['plan', 'Plán', 'plan'], ['nastaveni', 'Nastavení', 'gear']];
  function renderNav() {
    const pending = D.transactions.filter(t => t.status === 'pending').length;
    nav.innerHTML = `<div class="brand">${LOGO}<span>Kapsa</span></div>` + NAV.map(([id, label, ic]) => id === 'add'
      ? `<button class="nav-add" data-action="add-tx" aria-label="Přidat pohyb">${icon('plus')}<span>Přidat</span></button>`
      : `<a href="#${id}" class="nav-item${ui.view === id ? ' on' : ''}${id === 'nastaveni' || id === 'ucty' ? ' desk-only' : ''}"${ui.view === id ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${id === 'prehled' && pending ? `<b class="badge" aria-label="${pending} ke kontrole">${pending}</b>` : ''}</a>`).join('');
  }

  function render() {
    renderNav();
    const v = ui.view;
    main.dataset.view = v;
    main.innerHTML = v === 'ucty' ? viewAccounts() : v === 'pohyby' ? viewTx() : v === 'reporty' ? viewReports() : v === 'plan' ? viewPlan() : v === 'nastaveni' ? viewSettings() : viewOverview();
    if (v === 'pohyby') bindTxSearch();
    if (v === 'plan' && ui.planTab === 'rozdeleni') bindAllocForm();
  }

  function route() {
    const h = location.hash.replace('#', '');
    ui.view = ['prehled', 'ucty', 'pohyby', 'reporty', 'plan', 'nastaveni'].includes(h) ? h : 'prehled';
    render();
    window.scrollTo(0, 0);
  }

  // ---------- Přehled ----------
  function viewOverview() {
    const st = periodStats(curPeriod());
    const a = allowance(st);
    const bal = balance();
    const s = settings();
    const days = n => `${n} ${U.plural(n, 'den', 'dny', 'dní')}`;

    let lead, num = '', sub = '', tone = '';
    if (!a) {
      lead = D.transactions.some(t => t.kind === 'income') ? 'Výplata za toto období ještě nepřišla. Až ji zapíšeš, spočítám, kolik můžeš každý den utratit.' : 'Jakmile zapíšeš první výplatu, spočítám, kolik můžeš každý den utratit.';
    } else if (a.remaining < 0 && !st.incomeActual) {
      lead = 'Zbytek z minula je vyčerpaný o'; num = U.money(-a.remaining); tone = 'warn';
      sub = 'Výplata za toto období ještě nepřišla. Až ji zapíšeš, všechno přepočítám.';
    } else if (a.remaining < 0) {
      lead = 'Spotřeba je přečerpaná o'; num = U.money(-a.remaining); tone = 'bad';
      sub = 'Další výdaje už jdou z peněz určených na úspory.';
    } else if (a.leftToday < 0) {
      lead = 'Dnes jsi nad plánem o'; num = U.money(-a.leftToday); tone = 'warn';
      sub = a.daysLeft > 1 ? `Na další dny vychází ${U.money(a.remaining / (a.daysLeft - 1))} denně.` : 'Zítra začíná nové období.';
    } else {
      lead = 'Dnes ještě můžeš utratit'; num = U.money(a.leftToday);
      sub = `Na den vychází ${U.money(a.perDay)}.${!st.incomeActual ? ' Výplata ještě nepřišla, počítám jen se zbytkem z minula.' : ''}`;
    }

    const balTile = `<button class="tile" data-action="balance"><span class="t-label">${U.esc(mainAcc() ? mainAcc().name : 'Na účtu')}</span>
      <span class="t-num">${bal == null ? 'Zadat' : U.money(bal)}</span>
      <span class="t-note">${bal == null ? 'opiš zůstatek z banky' : `srovnáno ${U.short(mainAcc().anchor_at)}, upravit`}</span></button>`;
    const potTile = `<div class="tile"><span class="t-label">Na spotřebu zbývá</span>
      <span class="t-num${a && a.remaining < 0 ? ' bad' : ''}">${a ? `${a.remaining < 0 ? '−' : ''}${U.money(Math.abs(a.remaining))}` : '—'}</span>
      <span class="t-note">${a ? `z ${U.money(st.pot)} na ${days(a.daysLeft)}` : 'čeká na výplatu'}</span></div>`;

    const notice = Store.mode === 'local'
      ? `<p class="notice">${window.KAPSA_DEMO ? 'Ukázka s vymyšlenými daty. Změny se ukládají jen v tomto prohlížeči.' : 'Data jsou zatím jen v tomto prohlížeči. Pro synchronizaci s mobilem propoj databázi podle návodu.'}</p>`
      : Store.mode === 'offline' ? '<p class="notice">Jsi offline, zobrazuji poslední uložená data.</p>' : '';

    return `${head('Přehled', U.periodLabel(st.per, startDay()))}${notice}
      <section class="hero2">
        <div class="hero-main"><p class="hero-lead">${lead}</p>${num ? `<p class="hero-num ${tone}">${num}</p>` : ''}${sub ? `<p class="hero-sub">${sub}</p>` : ''}</div>
        <div class="tiles">${balTile}${potTile}</div>
      </section>
      <div class="ov-grid">
        <div class="ov-main">
          ${accountsHTML()}
          ${a ? burnHTML(st) : ''}
          ${inboxHTML()}
          ${splitHTML(st)}
          ${obligationsHTML(st)}
          ${tipsHTML(2)}
          ${budgetsHTML(st)}
        </div>
        <div class="ov-side">
          ${donutHTML(st)}
          ${goalsMini()}
          ${recentHTML()}
        </div>
      </div>`;
  }

  // Zůstatky všech účtů
  function accountsHTML(full = false) {
    const list = accounts();
    if (!list.length) return '';
    const vals = list.map(a => ({ a, b: accBalance(a), czk: accCzk(a) }));
    const total = vals.reduce((s, v) => s + (v.czk || 0), 0);
    const missing = vals.filter(v => v.b == null).length;
    const p = btcPrice();
    const rows = vals.map(({ a, b, czk }) => {
      let note = ACC_TYPES[a.type] || '';
      if (a.is_main) note = 'rozpočet a denní limit';
      if (b == null) note = 'zadej zůstatek';
      else if ((a.type === 'investment' || a.type === 'crypto') && accInvested(a) && czk != null) {
        const inv = accInvested(a), g = czk - inv;
        note = `vloženo ${U.money(inv)}, ${g >= 0 ? '+' : '−'}${U.money(Math.abs(g))}`;
      }
      const main = b == null ? '<span class="muted">—</span>' : fmtAcc(a, b);
      const sub2 = a.currency === 'BTC' && b != null ? `<span class="acc-sub">${czk != null ? `≈ ${U.money(czk)}` : 'bez kurzu'}</span>` : '';
      return `<li><button class="arow2" data-action="acc" data-id="${a.id}"><span class="acc-mark" style="--c:${a.color}"></span>
        <span class="row-main"><span>${U.esc(a.name)}</span><span class="tx-meta">${U.esc(note)}</span></span>
        <span class="acc-val"><span class="pval">${main}</span>${sub2}</span></button></li>`;
    }).join('');
    return `<section class="block accounts"><div class="bhead"><h2>Účty</h2><span class="bsum">celkem ${U.money(total)}${missing ? '*' : ''}</span></div>
      <ul class="acclist">${rows}</ul>
      <div class="btnrow acc-actions"><button class="btn small" data-action="transfer-new">Převést mezi účty</button>${full ? '<button class="btn small ghost" data-action="acc-new">Přidat účet</button>' : '<a class="link" href="#ucty">Spravovat účty</a>'}</div>
      ${missing ? `<p class="hint small">* Bez ${missing} ${U.plural(missing, 'účtu', 'účtů', 'účtů')}, u ${U.plural(missing, 'kterého', 'kterých', 'kterých')} chybí zůstatek.</p>` : ''}
      ${list.some(a => a.currency === 'BTC') ? `<p class="hint small">${p ? `Kurz BTC ${U.money(p.price)}, ${p.source === 'manual' ? 'zadaný ručně' : p.source === 'demo' ? 'ukázkový' : 'z CoinGecko'} ${U.short(p.at)} ${U.time(p.at)}.` : 'Kurz BTC se nepodařilo načíst. Zadej ho u bitcoinového účtu.'}</p>` : ''}
    </section>`;
  }

  // Průběh období: kumulované utrácení proti plánu a odhad do konce
  function burnHTML(st) {
    const per = st.per, n = per.days;
    const ti = Math.min(n - 1, Math.max(0, U.daysBetween(per.start, new Date())));
    const cum = [];
    let acc = 0;
    for (let i = 0; i <= ti; i++) {
      acc += sum(st.variable.filter(t => inRange(t, U.addDays(per.start, i), U.addDays(per.start, i + 1))));
      cum.push(acc);
    }
    const proj = acc / (ti + 1) * n;
    const ymax = Math.max(st.pot, proj, acc, 1) * 1.08;
    const X = i => ((i + 1) / n * 100).toFixed(2);
    const Y = v => (100 - v / ymax * 100).toFixed(2);
    const line = `M0,100 ${cum.map((v, i) => `L${X(i)},${Y(v)}`).join(' ')}`;
    const over = proj > st.pot * 1.02;
    const vs = 'vector-effect="non-scaling-stroke"';
    return `<section class="block burn"><div class="bhead"><h2>Průběh období</h2><span class="bsum">${U.short(per.start)} – ${U.short(U.addDays(per.end, -1))}</span></div>
      <div class="burn-box">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="burn-svg" role="img" aria-label="Utraceno ${U.money(acc)} z plánu ${U.money(st.pot)}">
          <line x1="0" y1="${Y(st.pot)}" x2="100" y2="${Y(st.pot)}" class="bc-limit" ${vs}/>
          <line x1="0" y1="100" x2="100" y2="${Y(st.pot)}" class="bc-plan" ${vs}/>
          <path d="${line} L${X(ti)},100 Z" class="bc-area"/>
          <path d="${line}" class="bc-line" ${vs}/>
          ${ti < n - 1 ? `<line x1="${X(ti)}" y1="${Y(acc)}" x2="100" y2="${Y(proj)}" class="bc-proj${over ? ' over' : ''}" ${vs}/>` : ''}
        </svg>
        <span class="bc-dot" style="left:${X(ti)}%;top:${Y(acc)}%"></span>
      </div>
      <div class="burn-axis"><span>${U.short(per.start)}</span><span>dnes</span><span>${U.short(U.addDays(per.end, -1))}</span></div>
      <dl class="burn-legend">
        <div><dt><i class="lg-line"></i>Utraceno</dt><dd>${U.money(acc)}</dd></div>
        <div><dt><i class="lg-plan"></i>Plán na období</dt><dd>${U.money(st.pot)}</dd></div>
        <div><dt><i class="lg-proj${over ? ' over' : ''}"></i>Tímhle tempem</dt><dd class="${over ? 'warn' : ''}">${U.money(round100(proj))}</dd></div>
      </dl></section>`;
  }

  // Kam šly peníze v tomto období
  function donutHTML(st) {
    const ex = st.variable;
    const total = sum(ex);
    if (!total) return '';
    const by = {};
    ex.forEach(t => { const k = t.category_id || 'none'; by[k] = (by[k] || 0) + Number(t.amount); });
    let rows = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([id, v]) => {
      const c = catById(id);
      return { name: c ? c.name : 'Bez kategorie', color: c ? c.color : 'var(--ink-3)', v };
    });
    if (rows.length > 6) {
      const rest = rows.slice(5).reduce((s, r) => s + r.v, 0);
      rows = [...rows.slice(0, 5), { name: 'Ostatní kategorie', color: 'var(--fixed)', v: rest }];
    }
    let off = 0;
    const segs = rows.map(r => {
      const pct = r.v / total * 100;
      const seg = `<circle cx="21" cy="21" r="15.915" fill="none" stroke="${r.color}" stroke-width="5.5" stroke-dasharray="${Math.max(0.1, pct - 0.6).toFixed(2)} ${(100 - Math.max(0.1, pct - 0.6)).toFixed(2)}" stroke-dashoffset="${(25 - off).toFixed(2)}"/>`;
      off += pct;
      return seg;
    }).join('');
    return `<section class="block"><div class="bhead"><h2>Kam jde spotřeba</h2></div>
      <div class="donut-wrap">
        <div class="donut"><svg viewBox="0 0 42 42" aria-hidden="true">${segs}</svg><div class="donut-c"><b>${U.money(total)}</b><span>bez pevných</span></div></div>
        <ul class="donut-legend">${rows.map(r => `<li><span class="dot" style="--c:${r.color}"></span><span class="bname">${U.esc(r.name)}</span><span class="of">${Math.round(r.v / total * 100)} %</span></li>`).join('')}</ul>
      </div></section>`;
  }

  // Rozdělení výplaty: pevné výdaje, obálky na úspory, spotřeba
  function splitHTML(st, inPlan = false) {
    if (!st.income) {
      if (inPlan) return '';
      const fixedNote = st.fixed ? ` Z výplaty pak nejdřív odečtu pevné výdaje ${U.money(st.fixed)}, zbytek rozdělím podle obálek.` : ' Odečtu z ní pevné výdaje a zbytek rozdělím podle obálek.';
      return `<section class="block"><div class="bhead"><h2>Výplata</h2></div>
        <p class="lead-p">${st.carry ? `Výplata za toto období ještě nepřišla. Zatím pracuješ se zbytkem z minula, ${U.money(st.carry)}.` : 'Výplata za toto období ještě nepřišla.'}${fixedNote}</p>
        <button class="btn primary" data-action="salary">Výplata přišla</button></section>`;
    }
    const total = Math.max(st.income, st.fixed);
    const segs = [{ name: 'Pevné výdaje', amount: Math.min(st.fixed, total), color: 'var(--fixed)' }, ...st.buckets.map(b => ({ name: b.name, amount: b.amount, color: b.color }))];
    const bar = `<div class="split" role="img" aria-label="Rozdělení výplaty">${segs.filter(x => x.amount > 0).map(x => `<span style="flex:${x.amount.toFixed(0)} 1 0;--c:${x.color}" title="${U.esc(x.name)}: ${U.money(x.amount)}"></span>`).join('')}</div>`;
    const rows = [`<li class="srow"><span class="dot" style="--c:var(--fixed)"></span><span class="row-main"><span>Pevné výdaje</span><span class="tx-meta">zaplaceno ${U.money(st.fixedPaid)}${st.fixedOpen ? `, čeká ${U.money(st.fixedOpen)}` : ''}</span></span><span class="pval">${U.money(st.fixed)}</span></li>`]
      .concat(st.buckets.map(b => {
        let status;
        if (b.type === 'spend') status = `<span class="tx-meta">utraceno ${U.money(st.variableSpent)}${st.carry ? `, +${U.money(st.carry)} z minula` : ''}</span>`;
        else if (!st.incomeActual) status = `<span class="tx-meta">${b.pct} % ze zbytku</span>`;
        else if (b.done >= b.amount - 1) status = `<span class="tx-meta ok">${icon('check')}odloženo</span>`;
        else status = `<button class="link" data-action="transfer" data-b="${b.id}">Označit ${U.money(b.amount - b.done)} jako odložené</button>`;
        return `<li class="srow"><span class="dot" style="--c:${b.color}"></span><span class="row-main"><span>${U.esc(b.name)} <span class="muted">${b.pct} %</span></span>${status}</span><span class="pval">${U.money(b.amount)}</span></li>`;
      }));
    const wait = '';
    return `<section class="block split-block"><div class="bhead"><h2>${inPlan ? 'Toto období' : 'Rozdělení výplaty'}</h2><span class="bsum">${st.estimated ? `odhad ${U.money(st.income)}` : U.money(st.income)}</span></div>
      ${wait}
      ${st.fixed > st.income ? `<p class="hint bad">Pevné výdaje jsou vyšší než příjem o ${U.money(st.fixed - st.income)}.</p>` : ''}
      ${bar}<ul class="rows">${rows.join('')}</ul></section>`;
  }

  // Pevné výdaje v tomto období: co odešlo a co ještě čeká
  function obligationsHTML(st) {
    const obl = st.obl.slice().sort((a, b) => a.done - b.done || b.planned - a.planned);
    const extra = txIn(st.per.start, st.per.end, 'expense').filter(t => isFixedTx(t) && !t.recurring_id);
    if (!obl.length && !extra.length) {
      return `<section class="block"><div class="bhead"><h2>Pevné výdaje</h2></div>
        <p class="empty">Přidej nájem, energie nebo předplatné. Kapsa s nimi bude počítat dopředu, ještě než odejdou. <a href="#plan" data-action="plan-tab" data-tab="pravidelne">Přidat pravidelný výdaj</a></p></section>`;
    }
    const rows = obl.map(o => {
      let meta, act = '';
      if (o.done) meta = `<span class="tx-meta ok">${icon('check')}zaplaceno ${U.short(o.paidTx[0].occurred_at)}</span>`;
      else if (o.auto) meta = `<span class="tx-meta">strhne se ${U.short(o.due)}</span>`;
      else { meta = '<span class="tx-meta">čeká, počítám s ním</span>'; act = `<button class="btn small" data-action="pay-rec" data-id="${o.r.id}">Zaplaceno</button>`; }
      return `<li class="orow${o.done ? ' done' : ''}"><span class="dot" style="--c:${catColor(o.r.category_id)}"></span>
        <span class="row-main"><span>${U.esc(o.r.name)}</span>${meta}</span>${act}<span class="pval">${U.money(o.done ? o.paid : o.planned)}</span></li>`;
    });
    if (extra.length) rows.push(`<li class="orow done"><span class="dot" style="--c:var(--fixed)"></span><span class="row-main"><span>Další v pevných kategoriích</span><span class="tx-meta">${extra.length}× ${U.plural(extra.length, 'platba', 'platby', 'plateb')}</span></span><span class="pval">${U.money(sum(extra))}</span></li>`);
    return `<section class="block"><div class="bhead"><h2>Pevné výdaje</h2><span class="bsum">zaplaceno ${U.money(st.fixedPaid)} z ${U.money(st.fixed)}</span></div>
      <ul class="rows">${rows.join('')}</ul></section>`;
  }

  function inboxHTML() {
    const items = D.transactions.filter(t => t.status === 'pending').sort(byDateDesc);
    if (!items.length) return '';
    const shown = ui.inboxAll ? items : items.slice(0, 4);
    return `<section class="block inbox" aria-labelledby="inbox-h">
      <div class="bhead"><h2 id="inbox-h">Ke kontrole</h2><span class="count">${items.length}</span></div>
      <p class="hint">Ťukni na kategorii a je hotovo. Obchodníka si zapamatuju.</p>
      ${shown.map(inboxItem).join('')}
      ${items.length > shown.length ? `<button class="link" data-action="inbox-all">Zobrazit všech ${items.length}</button>` : ''}
    </section>`;
  }

  function inboxItem(t) {
    const sug = t.category_id && catById(t.category_id) ? t.category_id : matchRule(t.merchant);
    const chips = [];
    const rec = t.kind === 'expense' && isMainId(t.account_id) ? matchObligation(t.merchant, Number(t.amount), when(t)) : null;
    if (rec) chips.push(`<button class="chip sug" data-action="link-rec" data-id="${t.id}" data-rec="${rec.id}" style="--c:${catColor(rec.category_id)}">${icon('check')}To je ${U.esc(rec.name)}</button>`);
    if (sug) chips.push(`<button class="chip${rec ? '' : ' sug'}" data-action="confirm" data-id="${t.id}" data-cat="${sug}" style="--c:${catColor(sug)}">${icon('check')}${U.esc(catName(sug))}</button>`);
    topCats(t.kind, 5).filter(c => c.id !== sug).slice(0, sug ? 3 : 4).forEach(c => {
      chips.push(`<button class="chip" data-action="confirm" data-id="${t.id}" data-cat="${c.id}" style="--c:${c.color}"><span class="dot"></span>${U.esc(c.name)}</button>`);
    });
    chips.push(`<button class="chip more" data-action="edit-tx" data-id="${t.id}">Jiná…</button>`);
    const src = t.source === 'applepay' ? 'Apple Pay' : t.source === 'csv' ? 'z výpisu' : '';
    return `<article class="inbox-item">
      <div class="ii-top">
        <div><p class="tx-title">${U.esc(t.merchant || 'Platba')}</p>
        <p class="tx-meta">${U.dayLabel(t.occurred_at)} ${U.time(t.occurred_at)}${src ? `, ${src}` : ''}</p>
        ${t.note ? `<p class="ii-note">${U.esc(t.note)}</p>` : ''}</div>
        <p class="tx-amt ${t.kind === 'income' ? 'inc' : ''}">${amt(t)}</p>
      </div>
      <div class="chips">${chips.join('')}</div>
      <button class="ii-del" data-action="delete-tx" data-id="${t.id}">Platba neproběhla? Smazat</button>
    </article>`;
  }

  function budgetsHTML(st) {
    const per = st.per;
    const list = varCats().filter(c => limitOf(c, st) > 0);
    if (!list.length) {
      return `<section class="block"><div class="bhead"><h2>Limity kategorií</h2></div>
        <p class="empty">Rozděl peníze na spotřebu mezi kategorie a uvidíš, kolik ti v každé zbývá. <a href="#plan" data-action="plan-tab" data-tab="limity">Nastavit limity</a></p></section>`;
    }
    const elapsed = Math.min(100, (U.daysBetween(per.start, new Date()) + 1) / per.days * 100);
    const rows = list.map(c => ({ c, b: budgetState(c, st) })).sort((x, y) => y.b.pct - x.b.pct);
    const totalL = rows.reduce((s, r) => s + r.b.limit, 0);
    const totalS = rows.reduce((s, r) => s + r.b.spent, 0);
    return `<section class="block"><div class="bhead"><h2>Limity kategorií</h2><span class="bsum">${U.money(totalS)} z ${U.money(totalL)}</span></div>
      <ul class="budgets">${rows.map(({ c, b }) => {
        const cl = stClass(b.pct);
        const note = b.left >= 0 ? `zbývá ${U.money(b.left)}` : `přes limit o ${U.money(-b.left)}`;
        return `<li class="brow st-${cl}"><button class="brow-btn" data-action="cat-tx" data-id="${c.id}">
          <span class="brow-top"><span class="dot" style="--c:${c.color}"></span><span class="bname">${U.esc(c.name)}</span>
          <span class="bval">${U.money(b.spent)} <span class="of">z ${U.num(b.limit)}</span></span></span>
          <span class="bar"><i style="width:${Math.min(100, b.pct).toFixed(1)}%"></i><s style="left:${elapsed.toFixed(1)}%"></s></span>
          <span class="bnote">${note}${cl !== 'ok' ? `, ${Math.round(b.pct)} %` : ''}</span></button></li>`;
      }).join('')}</ul>
      <p class="hint small">Svislá čárka ukazuje, kolik z období už uběhlo.</p></section>`;
  }

  function goalsMini() {
    if (!D.goals.length) return '';
    return `<section class="block"><div class="bhead"><h2>Cíle</h2><a class="link" href="#plan" data-action="plan-tab" data-tab="cile">Všechny</a></div>
      <ul class="rows">${D.goals.map(g => {
        const p = Math.min(100, g.saved / g.target * 100);
        return `<li class="goal-mini"><button class="brow-btn" data-action="edit-goal" data-id="${g.id}"><span class="brow-top"><span class="bname">${U.esc(g.name)}</span><span class="bval">${Math.floor(p)} %</span></span>
          <span class="bar goal" style="--c:${g.color}"><i style="width:${p.toFixed(1)}%"></i></span>
          <span class="bnote">${U.money(g.saved)} z ${U.money(g.target)}</span></button></li>`;
      }).join('')}</ul></section>`;
  }

  function recentHTML() {
    const items = D.transactions.filter(t => t.status !== 'pending').sort(byDateDesc).slice(0, 5);
    if (!items.length) {
      return `<section class="block"><div class="bhead"><h2>Poslední pohyby</h2></div><p class="empty">Zatím tu nic není. Přidej první výdaj tlačítkem Přidat.</p></section>`;
    }
    return `<section class="block"><div class="bhead"><h2>Poslední pohyby</h2><a class="link" href="#pohyby">Vše</a></div>
      <ul class="txlist">${items.map(t => txRow(t, true)).join('')}</ul></section>`;
  }

  // ---------- Účty ----------
  function viewAccounts() {
    const transfers = D.transactions.filter(t => t.kind === 'transfer').sort(byDateDesc).slice(0, 15);
    return `${head('Účty', 'Zůstatky a převody')}
      ${accountsHTML(true)}
      <section class="block"><div class="bhead"><h2>Poslední převody</h2></div>
        ${transfers.length ? `<ul class="txlist">${transfers.map(t => txRow(t, true)).join('')}</ul>` : '<p class="empty">Zatím žádné převody. Peníze mezi účty přesuneš tlačítkem Převést mezi účty.</p>'}</section>
      <p class="hint">Rozpočet, denní limit a tipy počítají jen s účtem ${U.esc(mainAcc() ? mainAcc().name : 'Běžný účet')}. Převody mezi účty se nepočítají jako útrata.</p>`;
  }

  // ---------- Pohyby ----------
  function viewTx() {
    const per = shiftPeriod(ui.txOffset);
    const catOpts = cats().map(c => `<option value="${c.id}"${ui.txCat === c.id ? ' selected' : ''}>${U.esc(c.name)}</option>`).join('');
    const kinds = [['all', 'Vše'], ['expense', 'Výdaje'], ['income', 'Příjmy'], ['transfer', 'Převody'], ['pending', 'Ke kontrole']];
    return `${head('Pohyby')}
      <div class="toolbar">
        <div class="pnav"><button class="icon-btn" data-action="tx-prev" aria-label="Předchozí období">${icon('left')}</button>
          <span class="plabel">${U.periodLabel(per, startDay())}</span>
          <button class="icon-btn" data-action="tx-next" aria-label="Další období"${ui.txOffset >= 0 ? ' disabled' : ''}>${icon('right')}</button></div>
        <label class="search">${icon('search')}<input id="tx-search" type="search" placeholder="Hledat obchodníka nebo poznámku" value="${U.esc(ui.txSearch)}" autocomplete="off"></label>
        <div class="filters">
          <div class="seg small" role="group" aria-label="Typ pohybu">${kinds.map(([k, l]) => `<button data-action="tx-kind" data-k="${k}" class="${ui.txKind === k ? 'on' : ''}" aria-pressed="${ui.txKind === k}">${l}</button>`).join('')}</div>
          <select id="tx-cat" class="select small" aria-label="Kategorie"><option value="">Všechny kategorie</option>${catOpts}</select>
          ${accounts().length > 1 ? `<select id="tx-acc" class="select small" aria-label="Účet"><option value="">Všechny účty</option>${accounts().map(a => `<option value="${a.id}"${ui.txAcc === a.id ? ' selected' : ''}>${U.esc(a.name)}</option>`).join('')}</select>` : ''}
        </div>
      </div>
      <div id="txlist">${txListHTML()}</div>`;
  }

  function txListHTML() {
    const per = shiftPeriod(ui.txOffset);
    const q = U.norm(ui.txSearch);
    let list = q ? D.transactions.slice() : txAny(per.start, per.end);
    if (ui.txAcc) {
      const acc = accById(ui.txAcc);
      list = list.filter(t => (acc.is_main ? isMainId(t.account_id) : t.account_id === acc.id) || (t.kind === 'transfer' && transferTo(t) && transferTo(t).id === acc.id));
    }
    if (ui.txKind === 'pending') list = list.filter(t => t.status === 'pending');
    else if (ui.txKind !== 'all') list = list.filter(t => t.kind === ui.txKind);
    if (ui.txCat) list = list.filter(t => t.category_id === ui.txCat);
    if (q) list = list.filter(t => U.norm(`${t.merchant} ${t.note} ${catName(t.category_id)}`).includes(q));
    list.sort(byDateDesc);
    const czkOnly = t => (accById(t.account_id) || {}).currency !== 'BTC';
    const ex = sum(list.filter(t => t.kind === 'expense' && czkOnly(t))), inc = sum(list.filter(t => t.kind === 'income' && czkOnly(t))), tr = sum(list.filter(t => t.kind === 'transfer' && czkOnly(t)));
    if (!list.length) return `<p class="empty pad">${q ? 'Nic takového jsem nenašel. Zkus jiné slovo.' : 'V tomhle období tu nic není.'}</p>`;
    const groups = [];
    list.slice(0, 400).forEach(t => {
      const k = U.isoDate(when(t));
      if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, d: when(t), items: [] });
      groups[groups.length - 1].items.push(t);
    });
    return `<p class="totals">${q ? 'Ve všech obdobích: ' : ''}výdaje <b>${U.money(ex)}</b>, příjmy <b class="inc">${U.money(inc)}</b>${tr ? `, převody <b>${U.money(tr)}</b>` : ''}</p>
      ${groups.map(g => {
        const dayEx = sum(g.items.filter(t => t.kind === 'expense' && czkOnly(t)));
        return `<section class="day"><h3 class="dayhead"><span>${U.dayLabel(g.d)}${U.daysBetween(g.d, new Date()) > 1 ? '' : ` ${U.short(g.d)}`}</span>${dayEx ? `<span>−${U.money(dayEx)}</span>` : ''}</h3>
        <ul class="txlist">${g.items.map(t => txRow(t, false, ui.txAcc ? accById(ui.txAcc) : null)).join('')}</ul></section>`;
      }).join('')}`;
  }

  function bindTxSearch() {
    const s = $('#tx-search'), c = $('#tx-cat');
    s.addEventListener('input', () => { ui.txSearch = s.value; $('#txlist').innerHTML = txListHTML(); });
    c.addEventListener('change', () => { ui.txCat = c.value; $('#txlist').innerHTML = txListHTML(); });
    const ac = $('#tx-acc');
    if (ac) ac.addEventListener('change', () => { ui.txAcc = ac.value; $('#txlist').innerHTML = txListHTML(); });
  }

  // ---------- Reporty ----------
  function repRange() {
    const today = U.startOfDay(new Date());
    if (ui.repMode === 'den') {
      const s = U.addDays(today, ui.repOffset);
      return { start: s, end: U.addDays(s, 1), prev: [U.addDays(s, -1), s], label: `${U.dayLabel(s)}${Math.abs(U.daysBetween(s, today)) > 1 ? '' : ` ${U.short(s)}`}`, prevName: 'předchozí den' };
    }
    if (ui.repMode === 'tyden') {
      const s = U.addDays(U.weekStart(today), 7 * ui.repOffset);
      const e = U.addDays(s, 7);
      return { start: s, end: e, prev: [U.addDays(s, -7), s], label: `${U.short(s)} – ${U.short(U.addDays(e, -1))}`, prevName: 'předchozí týden' };
    }
    const p = shiftPeriod(ui.repOffset), pp = shiftPeriod(ui.repOffset - 1);
    return { start: p.start, end: p.end, prev: [pp.start, pp.end], label: U.periodLabel(p, startDay()), prevName: 'předchozí období', period: p };
  }

  function viewReports() {
    const r = repRange();
    const ex = txIn(r.start, r.end, 'expense'), inc = txIn(r.start, r.end, 'income'), trs = txIn(r.start, r.end, 'transfer');
    const exS = sum(ex), incS = sum(inc), trS = sum(trs), prevS = sum(txIn(r.prev[0], r.prev[1], 'expense'));
    const bal = incS - exS - trS;
    let cmp = '';
    if (prevS > 0) {
      const d = Math.round((exS - prevS) / prevS * 100);
      cmp = d === 0 ? `Stejně jako ${r.prevName}.` : `O ${Math.abs(d)} % ${d > 0 ? 'víc' : 'méně'} než ${r.prevName}.`;
    }
    const modes = [['den', 'Den'], ['tyden', 'Týden'], ['mesic', 'Měsíc']];
    const curSt = periodStats(curPeriod());

    let chart = '';
    if (ui.repMode !== 'den') {
      const n = U.daysBetween(r.start, r.end);
      const vals = Array.from({ length: n }, (_, i) => sum(ex.filter(t => !isFixedTx(t) && inRange(t, U.addDays(r.start, i), U.addDays(r.start, i + 1)))));
      const avg = curSt.pot ? curSt.pot / curSt.per.days : 0;
      const tIdx = U.daysBetween(r.start, new Date());
      const labels = Array.from({ length: n }, (_, i) => {
        const d = U.addDays(r.start, i);
        if (ui.repMode === 'tyden') return `<span>${U.wdShort(d)}</span>`;
        return `<span>${i % 5 === 0 ? d.getDate() : ''}</span>`;
      }).join('');
      chart = `<section class="block"><div class="bhead"><h2>Spotřeba po dnech</h2>${avg ? '<span class="legend"><i></i>denní plán</span>' : ''}</div>
        ${barChart(vals, { avg, todayIndex: tIdx < n ? tIdx : -1, height: 140 })}
        <div class="axis" style="grid-template-columns:repeat(${n},1fr)">${labels}</div>
        <p class="hint small">Bez pevných výdajů, ty jsou v přehledu kategorií.</p></section>`;
    }

    const byCat = {};
    ex.forEach(t => { const k = t.category_id || 'none'; byCat[k] = (byCat[k] || 0) + Number(t.amount); });
    const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const maxC = catRows.length ? catRows[0][1] : 1;
    const catBlock = catRows.length ? `<section class="block"><div class="bhead"><h2>Podle kategorií</h2></div>
      <ul class="catbars">${catRows.map(([id, v]) => {
        const c = catById(id);
        return `<li><span class="cb-top"><span class="dot" style="--c:${c ? c.color : 'var(--ink-3)'}"></span><span class="bname">${U.esc(c ? c.name : 'Bez kategorie')}${c && c.fixed ? ' <span class="muted">pevné</span>' : ''}</span><span class="bval">${U.money(v)} <span class="of">${Math.round(v / exS * 100)} %</span></span></span>
        <span class="bar plain" style="--c:${c ? c.color : 'var(--ink-3)'}"><i style="width:${(v / maxC * 100).toFixed(1)}%"></i></span></li>`;
      }).join('')}</ul></section>` : '';

    const merch = {};
    ex.filter(t => !isFixedTx(t)).forEach(t => {
      const k = U.patternFor(t.merchant) || U.norm(t.merchant) || '—';
      if (!merch[k]) merch[k] = { name: t.merchant || catName(t.category_id), v: 0, n: 0 };
      merch[k].v += Number(t.amount); merch[k].n++;
    });
    const top = Object.values(merch).sort((a, b) => b.v - a.v).slice(0, 5);
    const merchBlock = top.length && ui.repMode !== 'den' ? `<section class="block"><div class="bhead"><h2>Kde nejvíc utrácíš</h2></div>
      <ul class="rows">${top.map(m => `<li class="row"><span class="row-main"><span>${U.esc(m.name)}</span><span class="tx-meta">${m.n}× ${U.plural(m.n, 'platba', 'platby', 'plateb')}</span></span><span class="tx-amt">${U.money(m.v)}</span></li>`).join('')}</ul></section>` : '';

    let periodBlock = '';
    if (ui.repMode === 'mesic') {
      const st = periodStats(r.period);
      const bl = varCats().filter(c => limitOf(c, st) > 0);
      const over = bl.map(c => ({ c, b: budgetState(c, st) })).filter(x => x.b.spent > x.b.limit);
      const saves = st.buckets.filter(b => b.type === 'save');
      periodBlock = `<section class="block"><div class="bhead"><h2>Jak dopadl plán</h2></div>
        <p class="lead-p">${st.incomeActual ? `Z výplaty ${U.money(st.incomeActual)} šlo na pevné výdaje ${U.money(st.fixedPaid)} a na spotřebu ${U.money(st.variableSpent)} z plánovaných ${U.money(st.pot)}.` : 'V tomto období není zapsaná výplata.'}
        ${saves.length && st.incomeActual ? ` Odloženo ${U.money(saves.reduce((s, b) => s + b.done, 0))} z ${U.money(saves.reduce((s, b) => s + b.amount, 0))}.` : ''}
        ${bl.length ? ` V limitu ${bl.length - over.length} z ${bl.length} ${U.plural(bl.length, 'kategorie', 'kategorií', 'kategorií')}.` : ''}
        ${over.length ? ` Přes limit: ${over.map(x => `${U.esc(x.c.name)} (o ${U.money(x.b.spent - x.b.limit)})`).join(', ')}.` : ''}</p></section>`;
    }

    const dayList = ui.repMode === 'den' ? `<section class="block"><div class="bhead"><h2>Pohyby</h2></div>${ex.length + inc.length + trs.length ? `<ul class="txlist">${[...ex, ...inc, ...trs].sort(byDateDesc).map(t => txRow(t)).join('')}</ul>` : '<p class="empty">Tento den bez pohybů.</p>'}</section>` : '';

    return `${head('Reporty')}
      <section class="block tips-block" id="tipy"><div class="bhead"><h2>Tipy</h2></div>${tipsHTML(0)}</section>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Délka období">${modes.map(([k, l]) => `<button data-action="rep-mode" data-m="${k}" class="${ui.repMode === k ? 'on' : ''}" aria-pressed="${ui.repMode === k}">${l}</button>`).join('')}</div>
        <div class="pnav"><button class="icon-btn" data-action="rep-prev" aria-label="Předchozí">${icon('left')}</button>
          <span class="plabel">${r.label}</span>
          <button class="icon-btn" data-action="rep-next" aria-label="Další"${ui.repOffset >= 0 ? ' disabled' : ''}>${icon('right')}</button></div>
      </div>
      <section class="stats">
        <div><p class="st-label">Výdaje</p><p class="st-num">${U.money(exS)}</p>${cmp ? `<p class="st-note">${cmp}</p>` : ''}</div>
        <div><p class="st-label">Příjmy</p><p class="st-num inc">${U.money(incS)}</p></div>
        <div><p class="st-label">Odloženo</p><p class="st-num">${U.money(trS)}</p></div>
        <div><p class="st-label">Zůstalo</p><p class="st-num ${bal < 0 ? 'bad' : ''}">${bal < 0 ? '−' : '+'}${U.money(Math.abs(bal))}</p></div>
      </section>
      <div class="rep-grid">${chart}${periodBlock}${catBlock}${merchBlock}${dayList}</div>`;
  }

  // ---------- Plán ----------
  function viewPlan() {
    const tabs = [['rozdeleni', 'Rozdělení'], ['limity', 'Limity'], ['pravidelne', 'Pravidelné'], ['cile', 'Cíle']];
    const body = ui.planTab === 'pravidelne' ? planRecurring() : ui.planTab === 'cile' ? planGoals() : ui.planTab === 'limity' ? planLimits() : planSplit();
    return `${head('Plán')}
      <div class="toolbar"><div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-action="plan-tab" data-tab="${k}" class="${ui.planTab === k ? 'on' : ''}" aria-selected="${ui.planTab === k}">${l}</button>`).join('')}</div></div>
      ${body}`;
  }

  function planSplit() {
    const st = periodStats(curPeriod());
    const draft = ui.allocDraft || (ui.allocDraft = alloc().map(b => ({ ...b })));
    const total = draft.reduce((s, b) => s + (Number(b.pct) || 0), 0);
    const rows = draft.map((b, i) => `<li class="arow" data-i="${i}">
        <span class="dot" style="--c:${b.color}"></span>
        <input class="input" name="name" value="${U.esc(b.name)}" aria-label="Název obálky">
        <span class="with-unit pct"><input class="input" name="pct" inputmode="decimal" value="${b.pct}" aria-label="Procento pro ${U.esc(b.name)}"><span>%</span></span>
        <span class="a-kc pval">${U.money(st.remainder * (Number(b.pct) || 0) / 100)}</span>
        ${b.type === 'spend' ? '<span class="a-type">spotřeba</span>' : `<button type="button" class="icon-btn small" data-action="alloc-del" data-i="${i}" aria-label="Odebrat obálku ${U.esc(b.name)}">${icon('close')}</button>`}
        ${b.type === 'save' && accounts().length > 1 ? `<label class="a-acc"><span>Posílat na</span><select class="select small" name="acc"><option value="">Neurčeno</option>${accounts().filter(a => !a.is_main).map(a => `<option value="${a.id}"${a.id === b.account_id ? ' selected' : ''}>${U.esc(a.name)}</option>`).join('')}</select></label>` : ''}
      </li>`).join('');
    return `<p class="lead-p">Z každé výplaty nejdřív odečtu pravidelné a pevné výdaje. Zbytek rozdělím podle procent níže. Ze spotřeby se pak počítá denní limit a limity kategorií, ostatní obálky jsou peníze, které pošleš stranou.</p>
      ${st.income ? `<section class="block calc"><ul class="rows">
        <li class="row"><span class="row-main"><span>Příjem v tomto období${st.estimated ? ' (odhad podle minulého)' : ''}</span></span><span class="pval">${U.money(st.income)}</span></li>
        <li class="row"><span class="row-main"><span>Pevné a pravidelné výdaje</span></span><span class="pval">−${U.money(st.fixed)}</span></li>
        <li class="row total"><span class="row-main"><span>K rozdělení</span></span><span class="pval">${U.money(st.remainder)}</span></li></ul>
        ${st.carry ? `<p class="hint small">Ke spotřebě se navíc přičítá ${U.money(st.carry)}, které zbyly z minulého období.</p>` : ''}</section>` : ''}
      <section class="block"><div class="bhead"><h2>Obálky</h2><button class="link" data-action="alloc-add">Přidat obálku</button></div>
        <form id="alloc-form" novalidate><ul class="alloc">${rows}</ul>
        <p class="alloc-sum ${total === 100 ? 'ok' : 'bad'}" id="alloc-sum">${total === 100 ? 'Součet 100 %.' : `Součet je ${U.num(total)} %, ${total < 100 ? `chybí ${U.num(100 - total)} %` : `přebývá ${U.num(total - 100)} %`}.`}</p>
        <div class="btnrow"><button class="btn primary" type="submit"${total === 100 ? '' : ' disabled'}>Uložit rozdělení</button>
        <button class="btn ghost" type="button" data-action="alloc-reset">Vrátit</button></div></form>
      </section>
      ${splitHTML(st, true)}`;
  }

  function bindAllocForm() {
    const f = $('#alloc-form');
    if (!f) return;
    const st = periodStats(curPeriod());
    f.addEventListener('input', e => {
      const li = e.target.closest('.arow');
      if (!li) return;
      const b = ui.allocDraft[Number(li.dataset.i)];
      if (e.target.name === 'name') b.name = e.target.value;
      if (e.target.name === 'acc') b.account_id = e.target.value || null;
      if (e.target.name === 'pct') {
        b.pct = U.parseAmount(e.target.value) || 0;
        li.querySelector('.a-kc').textContent = U.money(st.remainder * b.pct / 100);
      }
      const total = Math.round(ui.allocDraft.reduce((s, x) => s + (Number(x.pct) || 0), 0) * 100) / 100;
      const sumEl = $('#alloc-sum');
      sumEl.className = `alloc-sum ${total === 100 ? 'ok' : 'bad'}`;
      sumEl.textContent = total === 100 ? 'Součet 100 %.' : `Součet je ${U.num(total)} %, ${total < 100 ? `chybí ${U.num(100 - total)} %` : `přebývá ${U.num(total - 100)} %`}.`;
      f.querySelector('[type=submit]').disabled = total !== 100;
    });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const clean = ui.allocDraft.map(b => ({ ...b, name: b.name.trim() || 'Obálka', pct: Number(b.pct) || 0 }));
      try { await Store.saveSettings({ allocation: clean }); ui.allocDraft = null; render(); toast('Rozdělení uloženo'); } catch (ex) { fail(ex); }
    });
  }

  function planLimits() {
    const st = periodStats(curPeriod());
    const vc = varCats(), fx = cats('expense').filter(c => c.fixed), inc = cats('income');
    const sumL = vc.reduce((s, c) => s + limitOf(c, st), 0);
    const spendB = st.buckets.find(b => b.type === 'spend');
    let summary;
    if (!st.income) summary = 'Až zapíšeš výplatu, uvidíš tu, kolik z ní jde na spotřebu. Limity v procentech se pak dopočítají samy.';
    else {
      summary = `Na spotřebu je v tomto období ${U.money(st.pot)}${spendB ? ` (${spendB.pct} % ze zbytku po pevných výdajích)` : ''}. V limitech je ${U.money(sumL)}`;
      summary += sumL <= st.pot ? `, volných zůstává ${U.money(st.pot - sumL)}.` : `, to je o ${U.money(sumL - st.pot)} víc, než máš.`;
    }
    const pctSum = vc.reduce((s, c) => s + (c.budget_pct || 0), 0);
    const row = c => {
      const b = budgetState(c, st);
      const meta = c.kind === 'income'
        ? `přišlo ${U.money(sum(txIn(st.per.start, st.per.end, 'income').filter(t => t.category_id === c.id)))}`
        : c.fixed ? `zaplaceno ${U.money(b.spent)}`
          : `${c.budget_pct != null ? `${U.num(c.budget_pct)} % ze spotřeby` : c.budget ? 'pevná částka' : 'bez limitu'}, utraceno ${U.money(b.spent)}`;
      const val = c.kind === 'expense' && !c.fixed ? (b.limit ? U.money(b.limit) : '<span class="muted">bez limitu</span>') : '';
      return `<li><button class="prow" data-action="edit-cat" data-id="${c.id}"><span class="dot" style="--c:${c.color}"></span>
        <span class="row-main"><span>${U.esc(c.name)}</span><span class="tx-meta">${meta}</span></span><span class="pval">${val}</span></button></li>`;
    };
    return `<p class="lead-p">${summary}</p>
      <section class="block"><div class="bhead"><h2>Spotřeba</h2><span class="bsum">${pctSum ? `${U.num(pctSum)} % rozděleno` : ''}</span></div><ul class="plist">${vc.map(row).join('')}</ul>
        <button class="link" data-action="add-cat" data-kind="expense">Přidat kategorii</button></section>
      <section class="block"><div class="bhead"><h2>Pevné výdaje</h2></div><p class="hint">Nájem, energie, předplatné. Odečítají se z výplaty ještě před rozdělením a do spotřeby se nepočítají.</p><ul class="plist">${fx.map(row).join('')}</ul>
        <button class="link" data-action="add-cat" data-kind="expense" data-fixed="1">Přidat pevnou kategorii</button></section>
      <section class="block"><div class="bhead"><h2>Příjmy</h2></div><ul class="plist">${inc.map(row).join('')}</ul>
        <button class="link" data-action="add-cat" data-kind="income">Přidat kategorii příjmů</button></section>`;
  }

  function planRecurring() {
    const obl = new Map(obligations(curPeriod()).map(o => [o.r.id, o]));
    const list = D.recurring.slice().sort((a, b) => (b.active - a.active) || (a.kind === b.kind ? 0 : a.kind === 'expense' ? -1 : 1) || b.amount - a.amount);
    const out = list.filter(r => r.active && r.kind === 'expense').reduce((s, r) => s + r.amount * U.monthlyFactor(r.every), 0);
    const row = r => {
      const o = obl.get(r.id);
      let status = r.active ? '' : 'pozastaveno';
      if (r.active && r.kind === 'expense' && o) status = o.done ? `zaplaceno ${U.short(o.paidTx[0].occurred_at)}` : o.auto ? `příště ${U.short(o.due)}` : 'v tomto období čeká';
      if (r.active && r.kind === 'income') status = r.next_date ? `příště ${U.short(U.parseISODate(r.next_date))}` : 'příjem';
      const when2 = r.next_date ? 'strhává se samo' : r.every === 'month' ? '' : U.everyLabel(r.every);
      const pay = r.active && r.kind === 'expense' && o && !o.done && !o.auto;
      return `<li class="prow-wrap"><button class="prow${r.active ? '' : ' off'}" data-action="edit-rec" data-id="${r.id}"><span class="dot" style="--c:${catColor(r.category_id)}"></span>
        <span class="row-main"><span>${U.esc(r.name)}</span><span class="tx-meta">${[status, when2].filter(Boolean).join(', ')}</span></span>
        <span class="pval tx-amt ${r.kind === 'income' ? 'inc' : ''}">${r.kind === 'income' ? '+' : '−'}${U.money(r.amount)}</span></button>
        ${pay ? `<button class="btn small" data-action="pay-rec" data-id="${r.id}">Zaplaceno</button>` : ''}</li>`;
    };
    return `<p class="lead-p">${list.length ? `S pravidelnými výdaji ${U.money(out)} měsíčně počítám dopředu, hned jak přijde výplata. Do pohybů se zapíšou, až skutečně odejdou: z Apple Pay, z výpisu, nebo když ťukneš na Zaplaceno.` : 'Přidej nájem, energie, předplatné nebo splátky. Nemusíš vědět, kdy je pošleš: Kapsa s nimi počítá dopředu a zapíše je, až odejdou.'}</p>
      <section class="block"><div class="bhead"><h2>Pravidelné výdaje</h2><button class="link" data-action="add-rec">Přidat</button></div>
      ${list.length ? `<ul class="plist">${list.map(row).join('')}</ul>` : ''}
      </section>`;
  }

  function goalInfo(g) {
    const left = Math.max(0, g.target - g.saved);
    if (!left) return 'Splněno.';
    if (!g.deadline) return `Zbývá odložit ${U.money(left)}.`;
    const dl = U.parseISODate(g.deadline);
    const now = new Date();
    const months = Math.max(1, (dl.getFullYear() - now.getFullYear()) * 12 + dl.getMonth() - now.getMonth());
    return `Do ${U.shortY(dl)} zbývá odložit ${U.money(left)}, tedy ${U.money(left / months)} měsíčně.`;
  }

  function planGoals() {
    return `<section class="block"><div class="bhead"><h2>Finanční cíle</h2><button class="link" data-action="add-goal">Přidat cíl</button></div>
      ${D.goals.length ? `<ul class="goals">${D.goals.map(g => {
        const p = Math.min(100, g.saved / g.target * 100);
        return `<li><button class="goal" data-action="edit-goal" data-id="${g.id}">
          <span class="brow-top"><span class="bname">${U.esc(g.name)}</span><span class="bval">${U.money(g.saved)} <span class="of">z ${U.num(g.target)}</span></span></span>
          <span class="bar goal" style="--c:${g.color}"><i style="width:${p.toFixed(1)}%"></i></span>
          <span class="bnote">${goalInfo(g)}</span></button></li>`;
      }).join('')}</ul>` : '<p class="empty">Na co šetříš? Přidej cíl a uvidíš, kolik měsíčně odkládat.</p>'}</section>`;
  }

  // ---------- Nastavení ----------
  function viewSettings() {
    const s = settings();
    const remote = Store.mode === 'remote';
    const dayOpts = Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}"${s.period_start_day === i + 1 ? ' selected' : ''}>${i + 1}.</option>`).join('');
    const thOpts = [70, 75, 80, 85, 90, 95].map(v => `<option value="${v}"${s.alert_threshold === v ? ' selected' : ''}>${v} %</option>`).join('');
    const rules = D.rules.slice().sort((a, b) => catName(a.category_id).localeCompare(catName(b.category_id), 'cs') || a.pattern.localeCompare(b.pattern));
    const copyRow = (label, value, secret) => `<div class="copyrow"><span class="cr-label">${label}</span><code class="cr-val${secret ? ' secret' : ''}">${U.esc(value)}</code><button class="icon-btn" data-action="copy" data-v="${U.esc(value)}" aria-label="Zkopírovat ${label}">${icon('copy')}</button></div>`;

    return `${head('Nastavení')}
      ${Store.mode === 'local' ? `<p class="notice">Běžíš v místním režimu: data jsou jen v tomto prohlížeči. Pro synchronizaci mezi mobilem a počítačem a pro zápis plateb z Apple Pay propoj databázi podle souboru NAVOD.md.</p>` : ''}
      <section class="block"><h2>Rozpočtové období</h2>
        <label class="field inline"><span>Období začíná dnem</span><select class="select" data-setting="period_start_day">${dayOpts}</select></label>
        <p class="hint">Nastav den, kdy ti obvykle chodí výplata. Když přijde o pár dní dřív nebo později, nevadí: rozdělení se počítá z výplaty zapsané v daném období.</p>
        <label class="field inline"><span>Upozornit při vyčerpání</span><select class="select" data-setting="alert_threshold">${thOpts}</select></label>
      </section>

      <section class="block"><h2>Platby z Apple Pay</h2>
        ${remote ? `<p class="lead-p">Zkratka v iPhonu po každé platbě telefonem nebo hodinkami pošle částku a obchodníka do Kapsy. Platba se objeví v sekci Ke kontrole a ty jen potvrdíš kategorii.</p>
        <ol class="steps">
          <li>Otevři Zkratky, záložku Automatizace, a přidej novou automatizaci <b>Transakce</b>. Vyber svou kartu, zvol <b>Spustit okamžitě</b>.</li>
          <li>Přidej akci <b>Získat obsah URL</b> s adresou níže, metodou POST a hlavičkou <code>apikey</code>.</li>
          <li>Do těla požadavku (JSON) přidej pole <code>p_token</code>, <code>p_amount</code> (proměnná Částka) a <code>p_merchant</code> (proměnná Obchodník) a <code>p_card</code> (proměnná Karta nebo propustka). Podle karty Kapsa pozná, na který účet platba patří.</li>
          <li>Volitelně přidej <b>Získat hodnotu slovníku</b> pro klíč <code>zprava</code> a <b>Zobrazit oznámení</b>. Uvidíš, kolik ti v kategorii zbývá.</li>
        </ol>
        ${copyRow('Adresa', Store.captureUrl())}
        ${copyRow('apikey', Store.apiKey())}
        ${copyRow('p_token', s.capture_token || '', true)}
        <button class="btn ghost small" data-action="regen-token">Vygenerovat nový osobní klíč</button>
        <p class="hint">Osobní klíč nikomu neposílej. Kdo ho zná, může ti do Kapsy zapisovat platby. Po vygenerování nového klíče ho přepiš i ve Zkratce.</p>`
        : '<p class="lead-p">Funguje po propojení s databází, protože Zkratka potřebuje adresu, kam platbu poslat.</p>'}
      </section>

      <section class="block"><h2>Import výpisu z banky</h2>
        <p class="lead-p">V internetovém bankovnictví Raiffeisenbank si stáhni pohyby jako CSV a nahraj je sem. Platby, které už Kapsa zná z Apple Pay, se spárují a nezdvojí.</p>
        <button class="btn" data-action="import">Nahrát CSV</button>
      </section>

      <section class="block"><h2>Automatické zařazování</h2>
        <p class="lead-p">Když obchodník obsahuje slovo vlevo, platba dostane kategorii vpravo. Pravidla přibývají sama, když zařadíš platbu.</p>
        <form class="rule-add" data-form="rule"><input class="input" name="pattern" placeholder="např. albert" required aria-label="Slovo v názvu obchodníka">
          <select class="select" name="cat" aria-label="Kategorie">${cats().map(c => `<option value="${c.id}">${U.esc(c.name)}</option>`).join('')}</select>
          <button class="btn" type="submit">Přidat</button></form>
        <details class="rules"><summary>Zobrazit pravidla (${rules.length})</summary>
          <ul>${rules.map(r => `<li><span class="rp">${U.esc(r.pattern)}</span><span class="rc"><span class="dot" style="--c:${catColor(r.category_id)}"></span>${U.esc(catName(r.category_id))}</span><button class="icon-btn small" data-action="del-rule" data-id="${r.id}" aria-label="Smazat pravidlo ${U.esc(r.pattern)}">${icon('close')}</button></li>`).join('')}</ul>
        </details>
      </section>

      <section class="block"><h2>Data</h2>
        <div class="btnrow"><button class="btn" data-action="export">Stáhnout zálohu</button>
        ${remote ? '<button class="btn ghost" data-action="signout">Odhlásit se</button>' : '<button class="btn ghost danger" data-action="reset-local">Smazat místní data</button>'}</div>
        ${remote && Store.user ? `<p class="hint">Přihlášen jako ${U.esc(Store.user.email)}.</p>` : ''}
      </section>`;
  }

  // ---------- formuláře ----------
  function chipsFor(kind, selected) {
    if (kind === 'transfer') {
      return alloc().filter(b => b.type === 'save').map(b => `<button type="button" class="chip pick${b.id === selected ? ' on' : ''}" data-pick="${b.id}" style="--c:${b.color}" aria-pressed="${b.id === selected}"><span class="dot"></span>${U.esc(b.name)}</button>`).join('');
    }
    return cats(kind).map(c => `<button type="button" class="chip pick${c.id === selected ? ' on' : ''}" data-pick="${c.id}" style="--c:${c.color}" aria-pressed="${c.id === selected}"><span class="dot"></span>${U.esc(c.name)}</button>`).join('');
  }

  function txSheet(tx, preset = {}) {
    const isNew = !tx;
    const t = tx || { kind: 'expense', amount: '', category_id: null, bucket: null, merchant: '', note: '', occurred_at: new Date().toISOString(), status: 'confirmed', source: 'manual', ...preset };
    let kind = t.kind;
    let pickId = kind === 'transfer' ? t.bucket : t.category_id;
    let userPicked = !!pickId;
    const amountVal = t.amount === '' ? '' : String(t.amount).replace('.', ',');
    const title = isNew ? (preset.merchant === 'Výplata' ? 'Výplata' : kind === 'income' ? 'Nový příjem' : 'Nový pohyb') : t.status === 'pending' ? 'Zařadit platbu' : 'Upravit pohyb';
    openSheet(`<form class="form" novalidate>
      ${sheetHead(title)}
      <div class="seg full" role="group" aria-label="Typ"><button type="button" data-k="expense">Výdaj</button><button type="button" data-k="income">Příjem</button><button type="button" data-k="transfer">Převod</button></div>
      <label class="amount-field"><span class="sr">Částka v korunách</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${U.esc(amountVal)}"><span class="cur">Kč</span></label>
      <p class="hint kind-hint"></p>
      <div class="chips wrap" id="pick"></div>
      ${accounts().length > 1 ? `<label class="field acc-field"><span>Účet</span><select class="select" name="acc">${accounts().map(a => `<option value="${a.id}"${(t.account_id ? t.account_id === a.id : a.is_main) ? ' selected' : ''}>${U.esc(a.name)}</option>`).join('')}</select></label>` : ''}
      ${D.recurring.some(r => r.kind === 'expense') ? `<label class="field rec-field"><span>Pravidelný výdaj</span><select class="select" name="rec"><option value="">Ne, běžná platba</option>${D.recurring.filter(r => r.kind === 'expense').map(r => `<option value="${r.id}"${r.id === t.recurring_id ? ' selected' : ''}>${U.esc(r.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Obchodník nebo popis</span><input class="input" name="merchant" value="${U.esc(t.merchant || '')}" autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>Kdy</span><input class="input" type="datetime-local" name="when" value="${U.toLocalInput(t.occurred_at)}"></label>
        <label class="field"><span>Poznámka</span><input class="input" name="note" value="${U.esc(t.note || '')}" autocomplete="off"></label>
      </div>
      <p class="form-err" role="alert"></p>
      <div class="sheet-actions">${isNew ? '' : '<button type="button" class="btn ghost danger" data-del>Smazat</button>'}<button class="btn primary" type="submit">${isNew ? 'Uložit' : t.status === 'pending' ? 'Potvrdit' : 'Uložit změny'}</button></div>
    </form>`, sheet => {
      const form = sheet.querySelector('form');
      const pick = sheet.querySelector('#pick');
      const hint = sheet.querySelector('.kind-hint');
      const segBtns = sheet.querySelectorAll('.seg button');
      const paint = () => {
        segBtns.forEach(b => { b.classList.toggle('on', b.dataset.k === kind); b.setAttribute('aria-pressed', b.dataset.k === kind); });
        pick.innerHTML = chipsFor(kind, pickId);
        hint.textContent = kind === 'transfer' ? 'Peníze poslané stranou na spořicí účet nebo do investic. Nepočítají se jako útrata.'
          : kind === 'income' ? 'Výplata se hned rozdělí podle tvých procent.' : '';
        hint.hidden = !hint.textContent;
        const rf = sheet.querySelector('.rec-field');
        if (rf) rf.hidden = kind !== 'expense';
      };
      paint();
      segBtns.forEach(b => b.addEventListener('click', () => {
        if (b.dataset.k === 'transfer' && isNew) { transferSheet(null, { amount: U.parseAmount(form.amount.value) || '' }); return; }
        kind = b.dataset.k;
        const valid = kind === 'transfer' ? !!bucketById(pickId) && bucketById(pickId).type === 'save' : catById(pickId) && catById(pickId).kind === kind;
        if (!valid) { pickId = kind === 'transfer' ? (alloc().find(x => x.type === 'save') || {}).id : null; userPicked = false; }
        paint();
      }));
      pick.addEventListener('click', e => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        pickId = pickId === b.dataset.pick ? null : b.dataset.pick;
        userPicked = !!pickId;
        paint();
      });
      form.merchant.addEventListener('input', () => {
        if (userPicked || kind === 'transfer') return;
        const m = matchRule(form.merchant.value);
        if (m && catById(m).kind === kind) { pickId = m; paint(); }
      });
      const del = sheet.querySelector('[data-del]');
      if (del) del.addEventListener('click', () => deleteTx(t.id));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const amount = U.parseAmount(form.amount.value);
        const err = sheet.querySelector('.form-err');
        if (!amount || amount <= 0) { err.textContent = 'Zadej částku větší než nula.'; form.amount.focus(); return; }
        if (kind === 'transfer' && !pickId) { err.textContent = 'Vyber, kam peníze odkládáš.'; return; }
        const row = {
          kind, amount: Math.abs(amount),
          category_id: kind === 'transfer' ? null : pickId,
          bucket: kind === 'transfer' ? pickId : null,
          merchant: form.merchant.value.trim() || (kind === 'transfer' ? bucketById(pickId).name : null),
          note: form.note.value.trim() || null,
          occurred_at: form.when.value ? new Date(form.when.value).toISOString() : new Date().toISOString(),
          status: 'confirmed',
        };
        const accSel = form.acc ? accById(form.acc.value) : mainAcc();
        row.account_id = accSel && !accSel.is_main ? accSel.id : null;
        const recSel = kind === 'expense' && form.rec && !row.account_id ? D.recurring.find(r => r.id === form.rec.value) : null;
        row.recurring_id = recSel ? recSel.id : null;
        if (recSel && !row.category_id) row.category_id = recSel.category_id;
        const st0 = periodStats(curPeriod());
        const c = kind === 'expense' ? catById(pickId) : null;
        const prev = c ? budgetState(c, st0).spent : 0;
        try {
          if (isNew) await Store.insert('transactions', { ...row, source: 'manual' });
          else await Store.update('transactions', t.id, row);
          if (kind !== 'transfer' && row.merchant && pickId && (isNew || pickId !== tx.category_id || tx.status === 'pending')) await learnRule(row.merchant, pickId);
          if (recSel && !recSel.pattern && row.merchant) await Store.update('recurring', recSel.id, { pattern: U.patternFor(row.merchant) });
          closeSheet();
          render();
          if (kind === 'income' && isNew) {
            const st = periodStats(curPeriod());
            const save = st.buckets.filter(b => b.type === 'save').reduce((s, b) => s + b.amount - b.done, 0);
            toast(`Příjem zapsán. Na spotřebu je ${U.money(st.pot)}${save > 0 ? `, stranou pošli ${U.money(save)}` : ''}.`);
          } else announce(pickId, prev, isNew ? 'Uloženo' : 'Změny uloženy');
        } catch (ex) { fail(ex); }
      });
      if (isNew) form.amount.focus();
    });
  }

  function transferSheet(tx, preset = {}) {
    const isNew = !tx;
    const list = accounts();
    if (list.length < 2) { toast('Pro převod potřebuješ aspoň dva účty. Přidej je v Účtech.', 'warn'); return; }
    const main = mainAcc();
    const t = tx || { amount: '', amount_to: null, account_id: null, to_account_id: null, as_income: false, merchant: '', note: '', occurred_at: new Date().toISOString(), ...preset };
    const fromId = t.account_id || (main ? main.id : list[0].id);
    const toAcc = tx ? transferTo(tx) : (preset.to ? accById(preset.to) : list.find(a => a.id !== fromId));
    const opts = sel => list.map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${U.esc(a.name)}</option>`).join('');
    closeSheet();
    openSheet(`<form class="form" novalidate>
      ${sheetHead(isNew ? 'Převod mezi účty' : 'Upravit převod')}
      <div class="field-row">
        <label class="field"><span>Z účtu</span><select class="select" name="from">${opts(fromId)}</select></label>
        <label class="field"><span>Na účet</span><select class="select" name="to">${opts(toAcc ? toAcc.id : '')}</select></label>
      </div>
      <label class="amount-field"><span class="sr">Částka</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${t.amount === '' ? '' : U.esc(String(t.amount).replace('.', ','))}"><span class="cur" id="cur-from">Kč</span></label>
      <label class="field to-field"><span id="to-label">Připsáno</span><span class="with-unit"><input class="input" name="amount_to" inputmode="decimal" value="${t.amount_to != null ? U.esc(String(t.amount_to).replace('.', ',')) : ''}"><span id="cur-to">BTC</span></span></label>
      <p class="hint to-hint"></p>
      <label class="check income-check"><input type="checkbox" name="as_income"${t.as_income ? ' checked' : ''}><span>Započítat do rozpočtu jako příjem</span></label>
      <p class="hint income-hint">Třeba výběr z podnikání pro sebe. Rozdělí se jako výplata: pevné výdaje, obálky, spotřeba.</p>
      <div class="field-row">
        <label class="field"><span>Kdy</span><input class="input" type="datetime-local" name="when" value="${U.toLocalInput(t.occurred_at)}"></label>
        <label class="field"><span>Poznámka</span><input class="input" name="note" value="${U.esc(t.note || t.merchant || '')}" autocomplete="off"></label>
      </div>
      <p class="form-err" role="alert"></p>
      <div class="sheet-actions">${isNew ? '' : '<button type="button" class="btn ghost danger" data-del>Smazat</button>'}<button class="btn primary" type="submit">${isNew ? 'Převést' : 'Uložit změny'}</button></div>
    </form>`, sheet => {
      const form = sheet.querySelector('form');
      let incomeTouched = !isNew;
      const paint = () => {
        const f = accById(form.from.value), to = accById(form.to.value);
        const cross = f && to && f.currency !== to.currency;
        sheet.querySelector('#cur-from').textContent = f && f.currency === 'BTC' ? 'BTC' : 'Kč';
        sheet.querySelector('.to-field').hidden = !cross;
        sheet.querySelector('#cur-to').textContent = to && to.currency === 'BTC' ? 'BTC' : 'Kč';
        sheet.querySelector('#to-label').textContent = to && to.currency === 'BTC' ? 'Koupeno bitcoinu' : 'Připsáno v korunách';
        const p = btcPrice();
        const hint = sheet.querySelector('.to-hint');
        hint.hidden = !cross;
        hint.textContent = cross ? (p ? `Podle kurzu ${U.money(p.price)} za 1 BTC by to bylo kolem ${to.currency === 'BTC' ? fmtBtc((U.parseAmount(form.amount.value) || 0) / p.price) : U.money((U.parseAmount(form.amount.value) || 0) * p.price)}. Zadej, kolik skutečně přišlo.` : 'Zadej, kolik skutečně přišlo.') : '';
        const toMain = to && to.is_main && f && !f.is_main;
        sheet.querySelector('.income-check').hidden = !toMain;
        sheet.querySelector('.income-hint').hidden = !toMain;
        if (toMain && !incomeTouched) form.as_income.checked = f.type === 'business';
      };
      paint();
      form.addEventListener('change', e => { if (e.target.name === 'as_income') incomeTouched = true; paint(); });
      form.amount.addEventListener('input', paint);
      const del = sheet.querySelector('[data-del]');
      if (del) del.addEventListener('click', () => deleteTx(t.id));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const err = sheet.querySelector('.form-err');
        const f = accById(form.from.value), to = accById(form.to.value);
        if (!f || !to || f.id === to.id) { err.textContent = 'Vyber dva různé účty.'; return; }
        const amount = U.parseAmount(form.amount.value);
        if (!amount || amount <= 0) { err.textContent = 'Zadej částku větší než nula.'; form.amount.focus(); return; }
        const cross = f.currency !== to.currency;
        const amountTo = cross ? U.parseAmount(form.amount_to.value) : null;
        if (cross && (!amountTo || amountTo <= 0)) { err.textContent = 'Zadej, kolik na cílový účet přišlo.'; return; }
        const bucket = f.is_main ? alloc().find(b => b.type === 'save' && b.account_id === to.id) : null;
        const row = {
          kind: 'transfer', amount, amount_to: amountTo, account_id: f.is_main ? null : f.id, to_account_id: to.id,
          as_income: !!(to.is_main && !f.is_main && form.as_income.checked), bucket: bucket ? bucket.id : null, category_id: null,
          merchant: form.note.value.trim() || `${f.name} → ${to.name}`, note: null,
          occurred_at: form.when.value ? new Date(form.when.value).toISOString() : new Date().toISOString(), status: 'confirmed',
        };
        try {
          if (isNew) await Store.insert('transactions', { ...row, source: 'manual' });
          else await Store.update('transactions', t.id, row);
          closeSheet(); render();
          toast(`${isNew ? 'Převedeno' : 'Uloženo'} ${fmtAcc(f, amount)}: ${f.name} → ${to.name}${row.as_income ? '. Započteno jako příjem.' : ''}`);
        } catch (ex) { fail(ex); }
      });
      if (isNew) form.amount.focus();
    });
  }

  // Detail účtu: zůstatek, pohyby, srovnání s bankou, úpravy
  function accountSheet(a) {
    if (!a) return;
    const isNew = !a.id;
    const bal = isNew ? null : accBalance(a);
    const czk = isNew ? null : accCzk(a);
    const recent = isNew ? [] : D.transactions.filter(t => (a.is_main ? (t.kind === 'transfer' ? isMainId(t.account_id) : isMainId(t.account_id)) : t.account_id === a.id) || (t.kind === 'transfer' && transferTo(t) && transferTo(t).id === a.id)).sort(byDateDesc).slice(0, 12);
    const p = btcPrice();
    const market = a.type === 'investment' || a.type === 'crypto';
    openSheet(`<form class="form" novalidate>
      ${sheetHead(isNew ? 'Nový účet' : U.esc(a.name))}
      ${isNew ? '' : `<div class="acc-head"><p class="acc-big">${bal == null ? 'Zůstatek zatím nezadaný' : fmtAcc(a, bal)}</p>
        ${a.currency === 'BTC' && czk != null ? `<p class="vsub">≈ ${U.money(czk)}</p>` : ''}
        ${market && accInvested(a) && czk != null ? (() => { const inv = accInvested(a), g = czk - inv; return `<p class="vsub">Vloženo ${U.money(inv)}, ${g >= 0 ? 'zisk' : 'ztráta'} ${U.money(Math.abs(g))} (${g >= 0 ? '+' : '−'}${Math.abs(Math.round(g / inv * 100))} %)</p>`; })() : ''}
        <div class="btnrow"><button type="button" class="btn small primary" data-act="transfer">Převést</button></div></div>`}
      <label class="field"><span>${market ? (a.currency === 'BTC' ? 'Kolik bitcoinu teď máš' : 'Aktuální hodnota') : 'Aktuální zůstatek z banky'}</span>
        <span class="with-unit"><input class="input" name="anchor" inputmode="decimal" value="${bal != null ? U.esc(String(Math.round(bal * (a.currency === 'BTC' ? 1e8 : 100)) / (a.currency === 'BTC' ? 1e8 : 100)).replace('.', ',')) : ''}" placeholder="${a.currency === 'BTC' ? '0,0000' : '0'}"><span class="unit">${a.currency === 'BTC' ? 'BTC' : 'Kč'}</span></span></label>
      <p class="hint">${market ? 'Hodnota investic se mění s trhem. Občas ji sem opiš a Kapsa spočítá zisk.' : 'Opiš zůstatek z bankovnictví. Kapsa k němu pak přičítá a odečítá pohyby.'}</p>
      ${a.currency === 'BTC' || (isNew && false) ? `<label class="field"><span>Kurz 1 BTC</span><span class="with-unit"><input class="input" name="price" inputmode="decimal" value="${p ? U.num(p.price) : ''}"><span>Kč</span></span></label>` : ''}
      <details class="acc-edit"${isNew ? ' open' : ''}><summary>Nastavení účtu</summary>
        <div class="form inner">
        <label class="field"><span>Název</span><input class="input" name="name" value="${U.esc(a.name || '')}" autocomplete="off"></label>
        ${a.is_main ? '' : `<div class="field-row">
          <label class="field"><span>Druh</span><select class="select" name="type">${Object.entries(ACC_TYPES).filter(([k]) => k !== 'checking' || !a.is_main).map(([k, l]) => `<option value="${k}"${a.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Měna</span><select class="select" name="currency"${isNew ? '' : ' disabled'}><option value="CZK"${a.currency !== 'BTC' ? ' selected' : ''}>Koruny</option><option value="BTC"${a.currency === 'BTC' ? ' selected' : ''}>Bitcoin</option></select></label></div>`}
        ${market || isNew ? `<label class="field invested-field"><span>Kolik jsi do toho celkem vložil</span><span class="with-unit"><input class="input" name="invested" inputmode="decimal" value="${!isNew && accInvested(a) ? U.num(accInvested(a)) : ''}" placeholder="nepovinné"><span>Kč</span></span></label>` : ''}
        ${a.currency === 'BTC' || a.is_main ? '' : `<label class="field"><span>Karta v Peněžence (nepovinné)</span><input class="input" name="card" value="${U.esc(a.card_name || '')}" placeholder="např. Firemní Visa" autocomplete="off"></label>
        <p class="hint">Platby touto kartou přes Apple Pay se zapíšou na tento účet, ne do osobního rozpočtu.</p>`}
        <fieldset class="field"><legend>Barva</legend><div class="swatches">${SWATCHES.map(c => `<button type="button" class="sw${c === a.color ? ' on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Barva ${c}" aria-pressed="${c === a.color}"></button>`).join('')}</div></fieldset>
        </div>
      </details>
      ${recent.length ? `<div><h3 class="dayhead"><span>Poslední pohyby</span></h3><ul class="txlist">${recent.map(t => txRow(t, true, a)).join('')}</ul></div>` : ''}
      <p class="form-err" role="alert"></p>
      <div class="sheet-actions">${isNew || a.is_main ? '' : '<button type="button" class="btn ghost danger" data-del>Skrýt účet</button>'}<button class="btn primary" type="submit">${isNew ? 'Přidat účet' : 'Uložit'}</button></div>
    </form>`, sheet => {
      const form = sheet.querySelector('form');
      let color = a.color || SWATCHES[2];
      sheet.querySelector('.swatches').addEventListener('click', e => {
        const b = e.target.closest('.sw'); if (!b) return;
        color = b.dataset.c;
        sheet.querySelectorAll('.sw').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      });
      const tr = sheet.querySelector('[data-act=transfer]');
      if (tr) tr.addEventListener('click', () => transferSheet(null, a.is_main ? {} : { account_id: a.id }));
      const del = sheet.querySelector('[data-del]');
      if (del) del.addEventListener('click', async () => {
        if (!confirm('Skrýt účet? Pohyby zůstanou zachované.')) return;
        try { await Store.update('accounts', a.id, { archived: true }); closeSheet(); render(); toast('Účet skrytý'); } catch (e) { fail(e); }
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const err = sheet.querySelector('.form-err');
        const name = form.name.value.trim();
        if (!name) { err.textContent = 'Účet potřebuje název.'; sheet.querySelector('.acc-edit').open = true; return; }
        const currency = form.currency ? form.currency.value : (a.currency || 'CZK');
        const row = { name, color, card_name: form.card ? (form.card.value.trim() || null) : null };
        if (form.type) row.type = currency === 'BTC' ? 'crypto' : form.type.value;
        if (isNew) row.currency = currency;
        const invNow = isNew ? null : accInvested(a);
        const invField = form.invested ? (U.parseAmount(form.invested.value) || null) : undefined;
        const av = form.anchor.value.trim() === '' ? null : U.parseAmount(form.anchor.value);
        const changed = av != null && (bal == null || Math.abs(av - bal) > (currency === 'BTC' ? 1e-9 : 0.004));
        if (changed) { row.anchor = av; row.anchor_at = new Date().toISOString(); }
        // vložená částka se ukládá k okamžiku posledního srovnání hodnoty
        if (invField !== undefined) {
          if (isNew || changed) row.invested = invField;
          else if (invField == null) row.invested = null;
          else if (invNow == null || Math.abs(invField - invNow) >= 0.5) row.invested = (a.invested || 0) + (invField - (invNow || 0));
        } else if (changed && invNow != null) row.invested = invNow;
        try {
          if (form.price) { const pv = U.parseAmount(form.price.value); if (pv > 0 && (!p || Math.abs(pv - p.price) >= 1)) setBtcPrice(pv, 'manual'); }
          if (isNew) await Store.insert('accounts', { ...row, sort: (D.accounts || []).length, is_main: false, archived: false });
          else await Store.update('accounts', a.id, row);
          closeSheet(); render();
          if (changed && bal != null && !market) {
            const diff = av - bal;
            toast(`Srovnáno. Kapsa se lišila o ${fmtAcc(a, Math.abs(diff))}, ${diff < 0 ? 'nejspíš chybí zapsaný výdaj' : 'nejspíš chybí zapsaný příjem'}.`, 'warn');
          } else toast(isNew ? 'Účet přidán' : 'Uloženo');
        } catch (ex) { fail(ex); }
      });
      const typeSel = form.type, curSel = form.currency;
      if (curSel && isNew) curSel.addEventListener('change', () => { if (curSel.value === 'BTC') typeSel.value = 'crypto'; });
    });
  }

  function announce(catId, prevSpent, fallback) {
    const c = catById(catId);
    if (c && c.kind === 'expense' && !c.fixed) {
      const st = periodStats(curPeriod());
      const b = budgetState(c, st);
      if (b.limit) {
        const prevPct = prevSpent / b.limit * 100;
        const th = settings().alert_threshold;
        if (b.pct >= 100 && prevPct < 100) return toast(`${c.name}: limit je překročený o ${U.money(-b.left)}.`, 'bad');
        if (b.pct >= th && prevPct < th) return toast(`${c.name}: vyčerpáno ${Math.round(b.pct)} % limitu, zbývá ${U.money(b.left)}.`, 'warn');
      }
    }
    if (fallback) toast(fallback);
  }

  async function learnRule(merchant, catId) {
    try {
      const p = U.patternFor(merchant);
      if (!p || p.length < 2 || !catId) return;
      const ex = D.rules.find(r => r.pattern === p);
      if (ex) { if (ex.category_id !== catId) await Store.update('rules', ex.id, { category_id: catId }); }
      else await Store.insert('rules', { pattern: p, category_id: catId });
    } catch (e) { console.warn('Pravidlo se neuložilo', e); }
  }

  async function confirmTx(id, catId) {
    const t = txById(id);
    if (!t) return;
    const c = catById(catId);
    const prev = c ? budgetState(c, periodStats(curPeriod())).spent - (t.category_id === catId ? Number(t.amount) : 0) : 0;
    try {
      await Store.update('transactions', id, { category_id: catId, status: 'confirmed' });
      await learnRule(t.merchant, catId);
      render();
      announce(catId, prev, `Zařazeno do kategorie ${catName(catId)}`);
    } catch (e) { fail(e); }
  }

  async function deleteTx(id) {
    if (!confirm('Smazat tento pohyb?')) return;
    try { await Store.remove('transactions', id); closeSheet(); render(); toast('Pohyb smazán'); } catch (e) { fail(e, 'Smazání'); }
  }

  function catSheet(cat, kindForNew, fixedForNew = false) {
    const isNew = !cat;
    const c = cat || { name: '', kind: kindForNew || 'expense', color: SWATCHES[D.categories.length % SWATCHES.length], budget: null, budget_pct: null, fixed: fixedForNew };
    let color = c.color, fixed = !!c.fixed, mode = c.budget_pct != null ? 'pct' : c.budget ? 'kc' : 'pct';
    const st = periodStats(curPeriod());
    const used = D.transactions.filter(t => t.category_id === c.id).length;
    const limitVal = () => mode === 'pct' ? (c.budget_pct != null ? U.num(c.budget_pct) : '') : (c.budget ? U.num(c.budget) : '');
    openSheet(`<form class="form" novalidate>
      ${sheetHead(isNew ? 'Nová kategorie' : 'Upravit kategorii')}
      <label class="field"><span>Název</span><input class="input" name="name" value="${U.esc(c.name)}" required autocomplete="off"></label>
      ${c.kind === 'expense' ? `<div class="field"><span>Druh výdaje</span><div class="seg full" data-g="fixed"><button type="button" data-v="0">Proměnlivý</button><button type="button" data-v="1">Pevný</button></div></div>
      <div class="limit-box">
        <div class="field"><span>Limit</span><div class="seg full" data-g="mode"><button type="button" data-v="pct">Procento ze spotřeby</button><button type="button" data-v="kc">Pevná částka</button></div></div>
        <span class="with-unit"><input class="input" name="limit" inputmode="decimal" placeholder="bez limitu" value="${limitVal()}" aria-label="Výše limitu"><span class="unit"></span></span>
        <p class="hint limit-hint"></p>
      </div>
      <p class="hint fixed-hint">Pevné výdaje se odečtou z výplaty před rozdělením a nemají limit.</p>` : ''}
      <fieldset class="field"><legend>Barva</legend><div class="swatches">${SWATCHES.map(s => `<button type="button" class="sw${s === color ? ' on' : ''}" data-c="${s}" style="--c:${s}" aria-label="Barva ${s}" aria-pressed="${s === color}"></button>`).join('')}</div></fieldset>
      <p class="form-err" role="alert"></p>
      <div class="sheet-actions">${isNew ? '' : '<button type="button" class="btn ghost danger" data-del>Smazat</button>'}<button class="btn primary" type="submit">${isNew ? 'Přidat kategorii' : 'Uložit změny'}</button></div>
    </form>`, sheet => {
      const form = sheet.querySelector('form');
      const paint = () => {
        sheet.querySelectorAll('[data-g] button').forEach(b => {
          const on = b.closest('[data-g]').dataset.g === 'fixed' ? b.dataset.v === (fixed ? '1' : '0') : b.dataset.v === mode;
          b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
        });
        const box = sheet.querySelector('.limit-box');
        if (!box) return;
        box.hidden = fixed;
        sheet.querySelector('.fixed-hint').hidden = !fixed;
        box.querySelector('.unit').textContent = mode === 'pct' ? '%' : 'Kč';
        const v = U.parseAmount(form.limit.value);
        box.querySelector('.limit-hint').textContent = mode === 'pct'
          ? (st.pot ? `${v ? `${U.num(v)} % = ${U.money(st.pot * v / 100)} z této výplaty. ` : ''}Mění se s výší výplaty.` : 'Částka se dopočítá, až zapíšeš výplatu.')
          : 'Stejná částka každé období, ať přijde jakákoli výplata.';
      };
      paint();
      sheet.querySelectorAll('[data-g] button').forEach(b => b.addEventListener('click', () => {
        if (b.closest('[data-g]').dataset.g === 'fixed') fixed = b.dataset.v === '1';
        else {
          const v = U.parseAmount(form.limit.value);
          if (v && st.pot) form.limit.value = b.dataset.v === 'pct' && mode === 'kc' ? U.num(v / st.pot * 100) : b.dataset.v === 'kc' && mode === 'pct' ? U.num(round100(st.pot * v / 100)) : form.limit.value;
          mode = b.dataset.v;
        }
        paint();
      }));
      if (form.limit) form.limit.addEventListener('input', paint);
      sheet.querySelector('.swatches').addEventListener('click', e => {
        const b = e.target.closest('.sw'); if (!b) return;
        color = b.dataset.c;
        sheet.querySelectorAll('.sw').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      });
      const del = sheet.querySelector('[data-del]');
      if (del) del.addEventListener('click', async () => {
        if (!confirm(used ? `Kategorie má ${used} ${U.plural(used, 'pohyb', 'pohyby', 'pohybů')}. Zůstanou bez kategorie. Smazat?` : 'Smazat kategorii?')) return;
        try { await Store.remove('categories', c.id); closeSheet(); render(); toast('Kategorie smazána'); } catch (e) { fail(e, 'Smazání'); }
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const name = form.name.value.trim();
        const err = sheet.querySelector('.form-err');
        if (!name) { err.textContent = 'Kategorie potřebuje název.'; return; }
        const v = form.limit ? U.parseAmount(form.limit.value) : null;
        if (mode === 'pct' && v > 100) { err.textContent = 'Procento může být nejvýš 100.'; return; }
        const row = { name, color };
        if (c.kind === 'expense') {
          row.fixed = fixed;
          row.budget_pct = !fixed && mode === 'pct' && v > 0 ? v : null;
          row.budget = !fixed && mode === 'kc' && v > 0 ? v : null;
        }
        try {
          if (isNew) await Store.insert('categories', { ...row, kind: c.kind, sort: D.categories.length });
          else await Store.update('categories', c.id, row);
          closeSheet(); render(); toast(isNew ? 'Kategorie přidána' : 'Změny uloženy');
        } catch (ex) { fail(ex); }
      });
      if (isNew) form.name.focus();
    });
  }

  function recSheet(rec, preset = {}) {
    const isNew = !rec;
    const r = rec || { name: '', amount: '', kind: 'expense', category_id: null, every: 'month', next_date: null, pattern: '', active: true, ...preset };
    let kind = r.kind;
    const catOptions = k => `<option value="">Bez kategorie</option>` + cats(k).map(c => `<option value="${c.id}"${c.id === r.category_id ? ' selected' : ''}>${U.esc(c.name)}</option>`).join('');
    openSheet(`<form class="form" novalidate>
      ${sheetHead(isNew ? 'Nový pravidelný výdaj' : 'Upravit pravidelný výdaj')}
      <div class="seg full" role="group" aria-label="Typ"><button type="button" data-k="expense">Výdaj</button><button type="button" data-k="income">Příjem</button></div>
      <label class="field"><span>Název</span><input class="input" name="name" value="${U.esc(r.name)}" placeholder="např. Nájem" autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>Částka</span><span class="with-unit"><input class="input" name="amount" inputmode="decimal" value="${r.amount ? U.num(r.amount) : ''}"><span>Kč</span></span></label>
        <label class="field"><span>Kategorie</span><select class="select" name="cat">${catOptions(kind)}</select></label>
      </div>
      <p class="hint">Když se částka mění, třeba u energií, zadej odhad. Do pohybů se zapíše skutečná.</p>
      <div class="field-row">
        <label class="field"><span>Opakování</span><select class="select" name="every">${[['month', 'Každé období'], ['quarter', 'Čtvrtletně'], ['year', 'Ročně']].map(([v, l]) => `<option value="${v}"${r.every === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Pozná podle</span><input class="input" name="pattern" value="${U.esc(r.pattern || '')}" placeholder="${U.esc(U.patternFor(r.name) || 'slovo z popisu')}" autocomplete="off"></label>
      </div>
      <label class="check"><input type="checkbox" name="auto"${r.next_date ? ' checked' : ''}><span>Strhává se samo v určitý den</span></label>
      <label class="field date-field"><span>Příští platba</span><input class="input" type="date" name="next" value="${r.next_date || ''}"></label>
      <p class="hint date-hint"></p>
      ${isNew ? '' : `<label class="check"><input type="checkbox" name="active"${r.active ? ' checked' : ''}><span>Aktivní</span></label>`}
      <p class="form-err" role="alert"></p>
      <div class="sheet-actions">${isNew ? '' : '<button type="button" class="btn ghost danger" data-del>Smazat</button>'}<button class="btn primary" type="submit">${isNew ? 'Přidat' : 'Uložit změny'}</button></div>
    </form>`, sheet => {
      const form = sheet.querySelector('form');
      const segBtns = sheet.querySelectorAll('.seg button');
      const paint = () => {
        segBtns.forEach(b => { b.classList.toggle('on', b.dataset.k === kind); b.setAttribute('aria-pressed', b.dataset.k === kind); });
        const needDate = form.every.value !== 'month';
        if (needDate) form.auto.checked = true;
        form.auto.disabled = needDate;
        sheet.querySelector('.date-field').hidden = !form.auto.checked;
        sheet.querySelector('.date-hint').textContent = form.auto.checked
          ? 'V tento den se platba zapíše sama, třeba u předplatného strhávaného z karty.'
          : 'Kapsa s platbou počítá od začátku období. Zapíše se, až ji pozná v Apple Pay nebo ve výpisu, nebo když ťukneš na Zaplaceno.';
        form.pattern.placeholder = U.patternFor(form.name.value) || 'slovo z popisu';
      };
      paint();
      form.addEventListener('change', paint);
      form.name.addEventListener('input', paint);
      segBtns.forEach(b => b.addEventListener('click', () => { kind = b.dataset.k; paint(); form.cat.innerHTML = catOptions(kind); }));
      const del = sheet.querySelector('[data-del]');
      if (del) del.addEventListener('click', async () => {
        if (!confirm('Smazat pravidelný výdaj? Už zapsané pohyby zůstanou.')) return;
        try { await Store.remove('recurring', r.id); closeSheet(); render(); toast('Smazáno'); } catch (e) { fail(e, 'Smazání'); }
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const err = sheet.querySelector('.form-err');
        const amount = U.parseAmount(form.amount.value);
        if (!form.name.value.trim()) { err.textContent = 'Vyplň název.'; return; }
        if (!amount || amount <= 0) { err.textContent = 'Zadej částku nebo odhad.'; return; }
        if (form.auto.checked && !form.next.value) { err.textContent = form.every.value === 'month' ? 'Vyber den, kdy se platba strhává, nebo zruš zaškrtnutí.' : 'U čtvrtletních a ročních plateb vyplň datum příští platby.'; return; }
        const row = {
          name: form.name.value.trim(), amount, kind, every: form.every.value,
          next_date: form.auto.checked ? form.next.value : null,
          pattern: U.norm(form.pattern.value) || U.patternFor(form.name.value) || null,
          category_id: form.cat.value || null, active: form.active ? form.active.checked : true,
        };
        try {
          if (isNew) await Store.insert('recurring', row);
          else await Store.update('recurring', r.id, row);
          await processRecurring();
          closeSheet(); render(); toast(isNew ? 'Přidáno, počítám s tím dopředu' : 'Změny uloženy');
        } catch (ex) { fail(ex); }
      });
    });
  }

  function payRecSheet(r) {
    if (!r) return;
    openSheet(`<form class="form" novalidate>
      ${sheetHead(`${U.esc(r.name)}: zaplaceno`)}
      <label class="amount-field"><span class="sr">Částka v korunách</span><input name="amount" inputmode="decimal" autocomplete="off" value="${U.esc(String(r.amount).replace('.', ','))}"><span class="cur">Kč</span></label>
      <p class="hint">Zapíšu platbu do pohybů. Když se částka liší od plánu, oprav ji.</p>
      <label class="field"><span>Kdy odešla</span><input class="input" type="datetime-local" name="when" value="${U.toLocalInput(new Date())}"></label>
      <p class="form-err" role="alert"></p>
      <div class="sheet-actions"><button class="btn primary" type="submit">Zapsat platbu</button></div>
    </form>`, sheet => {
      const form = sheet.querySelector('form');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const amount = U.parseAmount(form.amount.value);
        if (!amount || amount <= 0) { sheet.querySelector('.form-err').textContent = 'Zadej částku větší než nula.'; return; }
        try {
          await Store.insert('transactions', { kind: 'expense', amount, category_id: r.category_id, merchant: r.name, recurring_id: r.id, occurred_at: new Date(form.when.value || Date.now()).toISOString(), status: 'confirmed', source: 'manual' });
          closeSheet(); render(); toast(`${r.name}: zapsáno ${U.money(amount)}`);
        } catch (ex) { fail(ex); }
      });
    });
  }

  function balanceSheet() {
    const cur = balance();
    openSheet(`<form class="form" novalidate>
      ${sheetHead('Zůstatek na účtu')}
      <label class="amount-field"><span class="sr">Zůstatek v korunách</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${cur == null ? '' : U.esc(String(Math.round(cur * 100) / 100).replace('.', ','))}"><span class="cur">Kč</span></label>
      <p class="hint">Opiš zůstatek z bankovnictví. Od teď k němu budu přičítat a odečítat všechno, co se v Kapse zapíše. Když se bude lišit, nejspíš chybí nějaká platba.</p>
      <p class="form-err" role="alert"></p>
      <div class="sheet-actions"><button class="btn primary" type="submit">Uložit zůstatek</button></div>
    </form>`, sheet => {
      const form = sheet.querySelector('form');
      form.amount.focus();
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const v = U.parseAmount(form.amount.value);
        if (v == null) { sheet.querySelector('.form-err').textContent = 'Zadej částku.'; return; }
        try {
          await Store.saveSettings({ balance_anchor: v, balance_anchor_at: new Date().toISOString() });
          closeSheet(); render();
          const diff = cur == null ? 0 : v - cur;
          toast(Math.abs(diff) >= 1 ? `Srovnáno. Kapsa se lišila o ${U.money(Math.abs(diff))}, ${diff < 0 ? 'nejspíš chybí zapsaný výdaj' : 'nejspíš chybí zapsaný příjem'}.` : 'Zůstatek uložen', Math.abs(diff) >= 1 ? 'warn' : '');
        } catch (ex) { fail(ex); }
      });
    });
  }

  async function linkRec(txId, recId) {
    const t = txById(txId), r = D.recurring.find(x => x.id === recId);
    if (!t || !r) return;
    try {
      await Store.update('transactions', txId, { recurring_id: r.id, category_id: r.category_id || t.category_id, status: 'confirmed' });
      if (!r.pattern && t.merchant) await Store.update('recurring', r.id, { pattern: U.patternFor(t.merchant) });
      render();
      toast(`${r.name}: zapsáno jako zaplacené`);
    } catch (e) { fail(e); }
  }

  function goalSheet(goal) {
    const isNew = !goal;
    const g = goal || { name: '', target: '', saved: 0, deadline: '', color: SWATCHES[(D.goals.length * 2 + 2) % SWATCHES.length] };
    openSheet(`<form class="form" novalidate>
      ${sheetHead(isNew ? 'Nový cíl' : U.esc(g.name))}
      ${isNew ? '' : `<div class="deposit"><p class="lead-p">${goalInfo(g)}</p>
        <div class="field-row tight"><span class="with-unit"><input class="input" name="dep" inputmode="decimal" placeholder="Částka" aria-label="Částka vkladu"><span>Kč</span></span>
        <button type="button" class="btn primary" data-dep="1">Přidat</button><button type="button" class="btn ghost" data-dep="-1">Odebrat</button></div></div>`}
      <label class="field"><span>Na co šetříš</span><input class="input" name="name" value="${U.esc(g.name)}" placeholder="např. Nový notebook" autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>Cílová částka</span><span class="with-unit"><input class="input" name="target" inputmode="decimal" value="${g.target ? U.num(g.target) : ''}"><span>Kč</span></span></label>
        <label class="field"><span>Už mám</span><span class="with-unit"><input class="input" name="saved" inputmode="decimal" value="${U.num(g.saved)}"><span>Kč</span></span></label>
      </div>
      <label class="field"><span>Do kdy (nepovinné)</span><input class="input" type="date" name="deadline" value="${g.deadline || ''}"></label>
      <p class="form-err" role="alert"></p>
      <div class="sheet-actions">${isNew ? '' : '<button type="button" class="btn ghost danger" data-del>Smazat</button>'}<button class="btn primary" type="submit">${isNew ? 'Přidat cíl' : 'Uložit změny'}</button></div>
    </form>`, sheet => {
      const form = sheet.querySelector('form');
      sheet.querySelectorAll('[data-dep]').forEach(b => b.addEventListener('click', async () => {
        const v = U.parseAmount(form.dep.value);
        if (!v || v <= 0) { sheet.querySelector('.form-err').textContent = 'Zadej částku vkladu.'; return; }
        const saved = Math.max(0, g.saved + v * Number(b.dataset.dep));
        try {
          await Store.update('goals', g.id, { saved });
          closeSheet(); render();
          toast(saved >= g.target ? `${g.name}: cíl splněn.` : `${b.dataset.dep === '1' ? 'Přidáno' : 'Odebráno'} ${U.money(v)}. Zbývá ${U.money(g.target - saved)}.`);
        } catch (e) { fail(e); }
      }));
      const del = sheet.querySelector('[data-del]');
      if (del) del.addEventListener('click', async () => {
        if (!confirm('Smazat cíl?')) return;
        try { await Store.remove('goals', g.id); closeSheet(); render(); toast('Cíl smazán'); } catch (e) { fail(e, 'Smazání'); }
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const err = sheet.querySelector('.form-err');
        const target = U.parseAmount(form.target.value);
        if (!form.name.value.trim()) { err.textContent = 'Pojmenuj cíl.'; return; }
        if (!target || target <= 0) { err.textContent = 'Zadej cílovou částku.'; return; }
        const row = { name: form.name.value.trim(), target, saved: Math.max(0, U.parseAmount(form.saved.value) || 0), deadline: form.deadline.value || null, color: g.color };
        try {
          if (isNew) await Store.insert('goals', row); else await Store.update('goals', g.id, row);
          closeSheet(); render(); toast(isNew ? 'Cíl přidán' : 'Změny uloženy');
        } catch (ex) { fail(ex); }
      });
    });
  }

  // ---------- import CSV ----------
  function importSheet() {
    openSheet(`<div class="form">${sheetHead('Import výpisu')}
      <label class="drop"><input type="file" accept=".csv,text/csv,text/plain" id="csvfile" class="sr"><span class="btn">Vybrat soubor CSV</span><span class="drop-name">Export pohybů z internetového bankovnictví</span></label>
      <div id="csvstep"></div></div>`, sheet => {
      sheet.querySelector('#csvfile').addEventListener('change', async e => {
        const f = e.target.files[0];
        if (!f) return;
        sheet.querySelector('.drop-name').textContent = f.name;
        try {
          const rows = U.parseCSV(await U.decodeFile(f));
          csvMapping(sheet, rows);
        } catch (ex) { fail(ex, 'Načtení souboru'); }
      });
    });
  }

  function csvMapping(sheet, rows) {
    const step = sheet.querySelector('#csvstep');
    const hi = rows.findIndex(r => r.length >= 3 && r.some(c => U.norm(c).startsWith('datum')));
    if (hi < 0) { step.innerHTML = '<p class="form-err">V souboru jsem nenašel sloupec s datem. Je to export pohybů ve formátu CSV?</p>'; return; }
    const header = rows[hi];
    const body = rows.slice(hi + 1).filter(r => r.length >= Math.min(3, header.length));
    const h = header.map(U.norm);
    const find = (...keys) => {
      for (const k of keys) { const i = h.indexOf(k); if (i > -1) return i; }
      for (const k of keys) { const i = h.findIndex(x => x.includes(k)); if (i > -1) return i; }
      return -1;
    };
    const map = {
      date: find('datum provedeni', 'datum transakce', 'datum zauctovani', 'datum'),
      amount: find('zauctovana castka', 'castka v mene uctu', 'castka', 'objem', 'amount'),
      desc: find('nazev obchodnika', 'obchodnik', 'nazev protiuctu', 'protiucet', 'popis', 'zprava'),
      desc2: -1,
      id: find('id transakce', 'id pohybu', 'identifikace transakce'),
    };
    map.desc2 = [find('nazev protiuctu'), find('zprava'), find('poznamka'), find('typ transakce')].find(i => i > -1 && i !== map.desc) ?? -1;
    const opts = sel => `<option value="-1">—</option>` + header.map((c, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${U.esc(c || `Sloupec ${i + 1}`)}</option>`).join('');
    const fields = [['date', 'Datum'], ['amount', 'Částka'], ['desc', 'Obchodník / protistrana'], ['desc2', 'Náhradní popis'], ['id', 'ID transakce']];
    const preview = () => {
      const m = Object.fromEntries(fields.map(([k]) => [k, Number(step.querySelector(`[name=${k}]`).value)]));
      const parsed = body.map(r => ({ d: U.parseDate(r[m.date]), a: U.parseAmount(r[m.amount]), t: (m.desc > -1 && r[m.desc]) || (m.desc2 > -1 && r[m.desc2]) || '', id: m.id > -1 ? r[m.id] : '' }))
        .filter(x => x.d && x.a);
      step.querySelector('.pv').innerHTML = parsed.length
        ? `<table><tbody>${parsed.slice(0, 5).map(x => `<tr><td>${U.short(x.d)}</td><td>${U.esc(x.t).slice(0, 40)}</td><td class="num ${x.a > 0 ? 'inc' : ''}">${x.a > 0 ? '+' : '−'}${U.money(Math.abs(x.a), true)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="form-err">S tímto nastavením nevidím žádné platné řádky. Zkontroluj sloupce datum a částka.</p>';
      const btn = step.querySelector('[data-go]');
      btn.disabled = !parsed.length;
      btn.textContent = `Importovat ${parsed.length} ${U.plural(parsed.length, 'pohyb', 'pohyby', 'pohybů')}`;
      btn.onclick = () => runImport(parsed, btn, step.querySelector('[name=acc]') ? step.querySelector('[name=acc]').value : null);
    };
    step.innerHTML = `<p class="lead-p">Zkontroluj, že sloupce sedí. Ukázka prvních řádků je dole.</p>
      <div class="mapgrid">${fields.map(([k, l]) => `<label class="field"><span>${l}</span><select class="select" name="${k}">${opts(map[k])}</select></label>`).join('')}</div>
      ${accounts().filter(a => a.currency !== 'BTC').length > 1 ? `<label class="field"><span>Výpis z účtu</span><select class="select" name="acc">${accounts().filter(a => a.currency !== 'BTC').map(a => `<option value="${a.id}"${a.is_main ? ' selected' : ''}>${U.esc(a.name)}</option>`).join('')}</select></label>` : ''}
      <div class="pv"></div>
      <div class="sheet-actions"><button class="btn primary" data-go type="button">Importovat</button></div>`;
    step.querySelectorAll('select').forEach(s => s.addEventListener('change', preview));
    preview();
  }

  async function runImport(parsed, btn, accId = null) {
    const acc = accById(accId);
    const toMain = !acc || acc.is_main;
    const accField = toMain ? null : acc.id;
    const sameAcc = t => (toMain ? isMainId(t.account_id) : t.account_id === acc.id) || (t.kind === 'transfer' && t.to_account_id && (toMain ? isMainId(t.to_account_id) : t.to_account_id === acc.id));
    btn.disabled = true; btn.textContent = 'Importuji…';
    const existing = new Set(D.transactions.map(t => t.external_id).filter(Boolean));
    const used = new Set();
    const usedRec = new Set();
    const seen = {};
    const inserts = [], links = [];
    let dup = 0;
    for (const x of parsed) {
      const kind = x.a < 0 ? 'expense' : 'income';
      const amount = Math.abs(x.a);
      let ext = x.id ? `csv:${x.id}` : `csv:${U.isoDate(x.d)}:${x.a}:${U.norm(x.t).slice(0, 30)}`;
      if (!x.id) { seen[ext] = (seen[ext] || 0) + 1; if (seen[ext] > 1) ext += `#${seen[ext]}`; }
      if (existing.has(ext)) { dup++; continue; }
      const sameDir = t => kind === 'expense' ? (t.kind === 'expense' || t.kind === 'transfer') : t.kind === 'income';
      const match = D.transactions.find(t => !t.external_id && !used.has(t.id) && sameAcc(t) && sameDir(t) && Math.abs(Number(t.amount) - amount) < 0.01 && Math.abs(when(t) - x.d) <= 3.5 * U.DAY);
      if (match) { used.add(match.id); links.push([match.id, ext]); continue; }
      const rec = kind === 'expense' && toMain ? matchObligation(x.t, amount, x.d, usedRec) : null;
      if (rec) {
        usedRec.add(`${rec.id}@${U.isoDate(U.period(x.d, startDay()).start)}`);
        inserts.push({ occurred_at: x.d.toISOString(), amount, kind, merchant: x.t.slice(0, 140) || rec.name, category_id: rec.category_id, recurring_id: rec.id, status: 'confirmed', source: 'csv', external_id: ext, account_id: accField });
        continue;
      }
      const cat = matchRule(x.t);
      inserts.push({ occurred_at: x.d.toISOString(), amount, kind, merchant: x.t.slice(0, 140) || null, category_id: cat, status: cat ? 'confirmed' : 'pending', source: 'csv', external_id: ext, account_id: accField });
    }
    try {
      for (const [id, ext] of links) await Store.update('transactions', id, { external_id: ext });
      if (inserts.length) await Store.insertMany('transactions', inserts);
      closeSheet(); render();
      const pend = inserts.filter(i => i.status === 'pending').length;
      toast(`Přidáno ${inserts.length}, spárováno ${links.length}, přeskočeno ${dup}.${pend ? ` ${pend} čeká na zařazení.` : ''}`, pend ? 'warn' : '');
    } catch (e) { fail(e, 'Import'); btn.disabled = false; btn.textContent = 'Zkusit znovu'; }
  }

  // ---------- pravidelné platby ----------
  async function processRecurring() {
    if (Store.mode === 'offline') return;
    const today = U.startOfDay(new Date());
    for (const r of D.recurring.filter(x => x.active && x.next_date)) {
      let guard = 0;
      while (U.parseISODate(r.next_date) <= today && guard++ < 36) {
        const due = U.parseISODate(r.next_date);
        const ok = await Store.advanceRecurring(r.id, r.next_date, U.isoDate(U.advance(due, r.every)));
        if (!ok) break;
        due.setHours(8);
        await Store.insert('transactions', { occurred_at: due.toISOString(), amount: r.amount, kind: r.kind, category_id: r.category_id, merchant: r.name, source: 'recurring', status: 'confirmed', recurring_id: r.id });
      }
    }
  }

  async function markTransfer(bucketId) {
    const st = periodStats(curPeriod());
    const b = st.buckets.find(x => x.id === bucketId);
    if (!b) return;
    const amount = Math.round((b.amount - b.done) * 100) / 100;
    if (amount <= 0) return;
    try {
      const to = bucketAccount(b);
      await Store.insert('transactions', { kind: 'transfer', bucket: b.id, amount, merchant: to ? `Běžný účet → ${to.name}` : b.name, to_account_id: to ? to.id : null, occurred_at: new Date().toISOString(), status: 'confirmed', source: 'manual', category_id: null });
      render();
      toast(`Odloženo ${U.money(amount)}${bucketAccount(b) ? ` na ${bucketAccount(b).name}` : `: ${b.name}`}. Nezapomeň peníze převést i v bance.`);
    } catch (e) { fail(e); }
  }

  function incomePreset() {
    const c = cats('income').find(x => U.norm(x.name).includes('vyplat')) || cats('income')[0];
    return { kind: 'income', category_id: c ? c.id : null, merchant: 'Výplata', amount: '' };
  }

  // ---------- události ----------
  document.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action, id = el.dataset.id;
    switch (a) {
      case 'add-tx': txSheet(); break;
      case 'add-income':
      case 'salary': txSheet(null, incomePreset()); break;
      case 'balance': accountSheet(mainAcc()); break;
      case 'pay-rec': payRecSheet(D.recurring.find(r => r.id === id)); break;
      case 'link-rec': await linkRec(id, el.dataset.rec); break;
      case 'edit-tx': { const t = txById(id); if (t && t.kind === 'transfer') transferSheet(t); else txSheet(t); break; }
      case 'transfer-new': transferSheet(); break;
      case 'acc': accountSheet(accById(id)); break;
      case 'acc-new': accountSheet({ name: '', type: 'savings', currency: 'CZK', color: SWATCHES[(D.accounts || []).length % SWATCHES.length] }); break;
      case 'confirm': await confirmTx(id, el.dataset.cat); break;
      case 'delete-tx': await deleteTx(id); break;
      case 'transfer': await markTransfer(el.dataset.b); break;
      case 'inbox-all': ui.inboxAll = true; render(); break;
      case 'cat-tx': ui.txCat = id; ui.txKind = 'all'; ui.txOffset = 0; ui.txSearch = ''; location.hash = 'pohyby'; break;
      case 'tx-prev': ui.txOffset--; render(); break;
      case 'tx-next': if (ui.txOffset < 0) { ui.txOffset++; render(); } break;
      case 'tx-kind': ui.txKind = el.dataset.k; render(); break;
      case 'rep-mode': ui.repMode = el.dataset.m; ui.repOffset = 0; render(); break;
      case 'rep-prev': ui.repOffset--; render(); break;
      case 'rep-next': if (ui.repOffset < 0) { ui.repOffset++; render(); } break;
      case 'plan-tab': ui.planTab = el.dataset.tab; if (ui.view === 'plan') render(); break;
      case 'alloc-add': {
        const used = new Set((ui.allocDraft || []).map(b => b.color));
        ui.allocDraft.splice(ui.allocDraft.length - 1, 0, { id: `b${Date.now().toString(36)}`, name: 'Nová obálka', pct: 0, type: 'save', color: SWATCHES.find(s => !used.has(s)) || SWATCHES[0] });
        render();
        const inputs = document.querySelectorAll('.arow input[name=name]');
        if (inputs.length > 1) { const inp = inputs[inputs.length - 2]; inp.focus(); inp.select(); }
        break;
      }
      case 'alloc-del': ui.allocDraft.splice(Number(el.dataset.i), 1); render(); break;
      case 'alloc-reset': ui.allocDraft = null; render(); break;
      case 'edit-cat': catSheet(catById(id)); break;
      case 'add-cat': catSheet(null, el.dataset.kind, el.dataset.fixed === '1'); break;
      case 'add-rec': recSheet(); break;
      case 'edit-rec': recSheet(D.recurring.find(r => r.id === id)); break;
      case 'add-goal': goalSheet(); break;
      case 'edit-goal': goalSheet(D.goals.find(g => g.id === id)); break;
      case 'import': importSheet(); break;
      case 'tip-dismiss': {
        const off = dismissed();
        off.push(`${el.dataset.tip}@${U.isoDate(curPeriod().start)}`);
        try { localStorage.setItem(TIPS_KEY, JSON.stringify(off.slice(-200))); } catch (ex) { /* nevadí */ }
        render();
        break;
      }
      case 'tip-limit': {
        const v = Number(el.dataset.v);
        const patch = el.dataset.mode === 'pct' ? { budget_pct: v, budget: null } : { budget: v, budget_pct: null };
        try { await Store.update('categories', id, patch); render(); toast(`Limit pro ${catName(id)} upraven`); } catch (ex) { fail(ex); }
        break;
      }
      case 'tip-sub':
        recSheet(null, { name: el.dataset.name, amount: Number(el.dataset.v), category_id: el.dataset.cat || null, next_date: el.dataset.date });
        break;
      case 'del-rule':
        try { await Store.remove('rules', id); render(); const d = $('details.rules'); if (d) d.open = true; } catch (ex) { fail(ex, 'Smazání'); }
        break;
      case 'copy':
        try { await navigator.clipboard.writeText(el.dataset.v); toast('Zkopírováno'); } catch (ex) { toast('Kopírování nejde, označ text ručně.', 'warn'); }
        break;
      case 'regen-token':
        if (!confirm('Vygenerovat nový klíč? Starý přestane fungovat a ve Zkratce ho bude potřeba přepsat.')) break;
        try { await Store.saveSettings({ capture_token: U.token() }); render(); toast('Nový klíč je připravený'); } catch (ex) { fail(ex); }
        break;
      case 'export':
        U.download(`kapsa-zaloha-${U.isoDate(new Date())}.json`, JSON.stringify({ exported_at: new Date().toISOString(), ...D }, null, 2));
        break;
      case 'signout': await Store.signOut(); location.reload(); break;
      case 'reset-local':
        if (confirm('Smazat všechna data v tomto prohlížeči?')) { Store.resetLocal(); location.reload(); }
        break;
      default: break;
    }
  });

  document.addEventListener('change', async e => {
    const s = e.target.closest('[data-setting]');
    if (!s) return;
    try { await Store.saveSettings({ [s.dataset.setting]: Number(s.value) }); toast('Uloženo'); } catch (ex) { fail(ex); }
  });

  document.addEventListener('submit', async e => {
    const f = e.target.closest('[data-form="rule"]');
    if (!f) return;
    e.preventDefault();
    const p = U.norm(f.pattern.value);
    if (!p) return;
    try {
      const ex = D.rules.find(r => r.pattern === p);
      if (ex) await Store.update('rules', ex.id, { category_id: f.cat.value });
      else await Store.insert('rules', { pattern: p, category_id: f.cat.value });
      render(); toast(`Pravidlo „${p}“ uloženo`);
    } catch (ex) { fail(ex); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sheetRoot.firstChild) closeSheet();
    if (e.key === 'n' && !sheetRoot.firstChild && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); txSheet(); }
  });

  let lastSync = Date.now();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || Store.mode !== 'remote' || Date.now() - lastSync < 15000) return;
    lastSync = Date.now();
    try {
      await Store.load();
      await processRecurring();
      if (!sheetRoot.firstChild) render(); else renderNav();
    } catch (e) { console.warn('Obnova dat selhala', e); }
  });

  window.addEventListener('hashchange', route);

  // ---------- přihlášení a start ----------
  function renderLogin(msg = '') {
    document.body.classList.add('login-mode');
    nav.innerHTML = '';
    main.innerHTML = `<section class="login">${LOGO}<h1>Kapsa</h1><p class="vsub">Přihlas se účtem, který jsi vytvořil v Supabase.</p>
      <form class="form" id="login" novalidate>
        <label class="field"><span>E-mail</span><input class="input" type="email" name="email" autocomplete="username" required></label>
        <label class="field"><span>Heslo</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
        <p class="form-err" role="alert">${U.esc(msg)}</p>
        <button class="btn primary full" type="submit">Přihlásit se</button>
      </form></section>`;
    $('#login').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, b = f.querySelector('button');
      b.disabled = true; b.textContent = 'Přihlašuji…';
      try {
        await Store.signIn(f.email.value.trim(), f.password.value);
        document.body.classList.remove('login-mode');
        await boot();
      } catch (ex) {
        b.disabled = false; b.textContent = 'Přihlásit se';
        f.querySelector('.form-err').textContent = /invalid/i.test(ex.message) ? 'Špatný e-mail nebo heslo.' : `Přihlášení se nepovedlo: ${ex.message}`;
      }
    });
  }

  async function fetchBtc() {
    if (!accounts().some(a => a.currency === 'BTC')) return;
    const p = btcPrice();
    const age = p ? Date.now() - new Date(p.at).getTime() : Infinity;
    if (p && (age < 15 * 60000 || (p.source === 'manual' && age < 6 * 3600000))) return;
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=czk', { cache: 'no-store' });
      const j = await r.json();
      const v = j && j.bitcoin && j.bitcoin.czk;
      if (!v) throw new Error('bez kurzu');
      setBtcPrice(v, 'coingecko');
    } catch (e) {
      if ((window.KAPSA_DEMO || /[?&]demo\b/.test(location.search)) && !p) setBtcPrice(1950000, 'demo');
    }
    if (!sheetRoot.firstChild) render();
  }

  async function boot() {
    if (D.settings) route();
    else main.innerHTML = '<p class="loading">Načítám…</p>';
    try {
      await Store.load();
      await processRecurring();
    } catch (e) {
      console.error(e);
      if (!D.settings) {
        main.innerHTML = `<section class="login"><h1>Data se nenačetla</h1><p class="vsub">${U.esc(e.message || e)}</p><p class="vsub">Zkontroluj připojení a nastavení v souboru js/config.js.</p><button class="btn primary" onclick="location.reload()">Zkusit znovu</button></section>`;
        return;
      }
      toast('Nepodařilo se načíst nejnovější data, zobrazuji uložená.', 'warn');
    }
    route();
    fetchBtc();
  }

  async function start() {
    const r = await Store.init();
    document.getElementById('app').classList.remove('booting');
    if (Store.mode === 'remote' && !r.signedIn) return renderLogin();
    if (Store.mode === 'offline' && !D.settings) {
      main.innerHTML = '<section class="login"><h1>Jsi offline</h1><p class="vsub">Připoj se k internetu a otevři Kapsu znovu.</p></section>';
      return;
    }
    await boot();
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.KAPSA_DEMO) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  start();
})();
