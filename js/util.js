'use strict';

const U = (() => {
  const nf0 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = n => String(n).padStart(2, '0');
  const DAY = 86400000;

  const U = {};

  U.money = (v, exact = false) => {
    const n = Number(v) || 0;
    const s = exact && Math.round(n * 100) % 100 !== 0 ? nf2.format(n) : nf0.format(Math.round(n));
    return s + '\u00a0Kč';
  };
  U.num = v => nf0.format(Math.round(Number(v) || 0));

  U.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  U.uuid = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  U.token = () => [...crypto.getRandomValues(new Uint8Array(18))].map(x => x.toString(16).padStart(2, '0')).join('');

  U.plural = (n, one, few, many) => {
    const a = Math.abs(n);
    return a === 1 ? one : a >= 2 && a <= 4 ? few : many;
  };

  // ---------- data a čas ----------
  U.DAY = DAY;
  U.startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  U.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  U.daysBetween = (a, b) => Math.round((U.startOfDay(b) - U.startOfDay(a)) / DAY);
  U.isoDate = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  U.parseISODate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  U.toLocalInput = d => { const x = new Date(d); return `${U.isoDate(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
  U.time = d => { const x = new Date(d); return `${x.getHours()}:${pad(x.getMinutes())}`; };
  U.short = d => { const x = new Date(d); return `${x.getDate()}.\u00a0${x.getMonth() + 1}.`; };
  U.shortY = d => { const x = new Date(d); return `${x.getDate()}.\u00a0${x.getMonth() + 1}.\u00a0${x.getFullYear()}`; };

  const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const WEEKDAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  const WD_SHORT = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
  U.monthName = i => MONTHS[i];
  U.weekday = d => WEEKDAYS[new Date(d).getDay()];
  U.wdShort = d => WD_SHORT[new Date(d).getDay()];
  U.cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  U.dayLabel = d => {
    const diff = U.daysBetween(d, new Date());
    if (diff === 0) return 'Dnes';
    if (diff === 1) return 'Včera';
    return `${U.cap(U.weekday(d))} ${U.short(d)}`;
  };

  // Rozpočtové období začínající daným dnem v měsíci
  U.period = (ref, startDay = 1) => {
    const r = U.startOfDay(ref);
    let y = r.getFullYear(), m = r.getMonth();
    if (r.getDate() < startDay) m -= 1;
    const start = new Date(y, m, startDay);
    const end = new Date(y, m + 1, startDay);
    return { start, end, days: U.daysBetween(start, end) };
  };
  U.periodLabel = (p, startDay = 1) => {
    if (startDay === 1) return `${U.cap(U.monthName(p.start.getMonth()))} ${p.start.getFullYear()}`;
    return `${U.short(p.start)} – ${U.short(U.addDays(p.end, -1))}`;
  };
  U.weekStart = d => { const x = U.startOfDay(d); const wd = (x.getDay() + 6) % 7; return U.addDays(x, -wd); };

  U.advance = (d, every) => {
    const x = new Date(d);
    if (every === 'week') return U.addDays(x, 7);
    const months = every === 'quarter' ? 3 : every === 'year' ? 12 : 1;
    const day = x.getDate();
    const target = new Date(x.getFullYear(), x.getMonth() + months, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, last));
    return target;
  };
  U.everyLabel = e => ({ week: 'týdně', month: 'měsíčně', quarter: 'čtvrtletně', year: 'ročně' }[e] || e);
  U.monthlyFactor = e => ({ week: 52 / 12, month: 1, quarter: 1 / 3, year: 1 / 12 }[e] || 1);

  // ---------- text ----------
  U.norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  const GENERIC = new Set(['paypal', 'sumup', 'gopay', 'comgate', 'google', 'apple', 'pay', 'www', 'the', 'cz', 'sp', 'zz', 'platba', 'karta', 'nakup']);
  U.patternFor = merchant => {
    const words = U.norm(merchant).replace(/\d+/g, ' ').split(/\s+/).filter(w => w.length > 1);
    if (!words.length) return '';
    if (GENERIC.has(words[0]) && words[1]) return `${words[0]} ${words[1]}`;
    return words[0];
  };

  U.parseAmount = s => {
    if (typeof s === 'number') return s;
    let t = String(s || '').replace(/[^\d,.\-]/g, '');
    const neg = t.includes('-');
    t = t.replace(/-/g, '');
    const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
    if (lc > -1 && ld > -1) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else t = t.replace(',', '.');
    const n = parseFloat(t);
    return isNaN(n) ? null : neg ? -n : n;
  };

  U.parseDate = s => {
    s = String(s || '').trim();
    let m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], 12);
    return null;
  };

  // ---------- CSV ----------
  U.decodeFile = async file => {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('\uFFFD')) text = new TextDecoder('windows-1250').decode(buf);
    return text.replace(/^\uFEFF/, '');
  };

  U.parseCSV = text => {
    const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
    const count = ch => sample.split(ch).length;
    const delim = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== '')).map(r => r.map(c => c.trim()));
  };

  U.download = (name, text, type = 'application/json') => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return U;
})();
