// Deterministic demo household so Butterfly runs without any credentials.
// Produces the same normalized shape as server/actual.mjs.

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACCOUNTS = [
  ['chk', 'Joint Checking', false, 8000],
  ['sav', 'High-Yield Savings', false, 30000],
  ['cc1', 'Sapphire Preferred', false, 0],
  ['cc2', 'Blue Cash Card', false, 0],
  ['brk', 'Brokerage', true, 60000],
  ['k401', '401(k)', true, 140000],
  ['ira', 'Roth IRA', true, 45000],
  ['home', '905 Birch Ln (Home value)', true, 520000],
  ['rental', '27 Harbor Rd (Property value)', true, 310000],
  ['mort1', '905 Birch Ln Mortgage', true, -398000],
  ['mort2', '27 Harbor Rd Mortgage', true, -215000],
  ['auto', 'Auto Loan', true, -24000],
  ['stu', 'Student Loan', true, -31000],
];

const GROUPS = {
  Income: ['Paychecks', 'Other income', 'Interest', '27 Harbor Rd Rent'],
  '905 Birch Ln': ['Mortgage', 'Utilities', 'Maintenance', 'Lawn & garden'],
  '27 Harbor Rd': ['Rental mortgage', 'Property tax', 'Landlord insurance', 'Repairs', 'Property management'],
  'Food & Dining': ['Groceries', 'Restaurants', 'Coffee'],
  Bills: ['Phone', 'Internet', 'Insurance', 'Student loan', 'Subscriptions'],
  Transportation: ['Gas', 'Auto loan', 'Parking'],
  Shopping: ['Household', 'Clothing'],
  Kids: ['Childcare', 'Activities'],
  Health: ['Medical', 'Pharmacy', 'Gym'],
  Travel: ['Flights', 'Lodging'],
  Lifestyle: ['Entertainment', 'Gifts'],
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function buildDemoData(now = new Date()) {
  const r = rng(42);
  const between = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 100) / 100;
  const pick = (arr) => arr[Math.floor(r() * arr.length)];

  const categoryGroups = [];
  const categories = [];
  for (const [g, cats] of Object.entries(GROUPS)) {
    const gid = 'g-' + slug(g);
    categoryGroups.push({ id: gid, name: g, isIncome: g === 'Income', hidden: false });
    for (const c of cats) categories.push({ id: slug(c), name: c, groupId: gid, isIncome: g === 'Income', hidden: false });
  }

  const txs = [];
  let n = 0;
  const add = (date, accountId, amount, payee, categoryId = null, extra = {}) => {
    const t = {
      id: 'demo-' + ++n,
      date,
      accountId,
      amount: Math.round(amount * 100) / 100,
      payee,
      categoryId,
      notes: '',
      transferAccountId: null,
      startingBalance: false,
      cleared: true,
      ...extra,
    };
    txs.push(t);
    return t;
  };
  const transfer = (date, from, to, amount, categoryId = null, payeeFrom, payeeTo) => {
    add(date, from, -amount, payeeFrom, categoryId, { transferAccountId: to });
    add(date, to, amount, payeeTo, null, { transferAccountId: from });
  };

  const start = new Date(Date.UTC(2025, 0, 1));
  const todayStr = now.toISOString().slice(0, 10);
  const accName = Object.fromEntries(ACCOUNTS.map((a) => [a[0], a[1]]));
  const bal = {};
  for (const [id, , , opening] of ACCOUNTS) {
    add('2025-01-01', id, opening, 'Starting balance', null, { startingBalance: true });
    bal[id] = opening;
  }
  const track = (t) => (bal[t.accountId] += t.amount);

  const loans = [
    { id: 'mort1', pay: 2950, rate: 0.061, cat: 'mortgage', payee: 'Rocket Mortgage', day: 1 },
    { id: 'mort2', pay: 1480, rate: 0.054, cat: 'rental-mortgage', payee: 'Chase Home Lending', day: 3 },
    { id: 'auto', pay: 485, rate: 0.049, cat: 'auto-loan', payee: 'Toyota Financial', day: 12 },
    { id: 'stu', pay: 500, rate: 0.055, cat: 'student-loan', payee: 'Nelnet', day: 18 },
  ];

  const pad = (x) => String(x).padStart(2, '0');
  for (let d = new Date(start); d.toISOString().slice(0, 10) <= todayStr; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const on = (day) => {
      const ds = `${y}-${pad(m)}-${pad(Math.min(day, dim))}`;
      return ds <= todayStr ? ds : null;
    };
    const ccMonth = { cc1: 0, cc2: 0 };
    const spend = (day, acct, lo, hi, payee, cat, extra) => {
      const ds = on(day);
      if (!ds) return;
      const t = add(ds, acct, -between(lo, hi), payee, cat, extra);
      if (acct in ccMonth) ccMonth[acct] += t.amount;
      track(t);
      return t;
    };
    const earn = (day, acct, amt, payee, cat) => {
      const ds = on(day);
      if (ds) track(add(ds, acct, amt, payee, cat));
    };

    // Income
    earn(1, 'chk', 4650, 'Acme Corp Payroll', 'paychecks');
    earn(15, 'chk', 4650, 'Acme Corp Payroll', 'paychecks');
    earn(15, 'chk', 2300, 'Northwind Health Payroll', 'paychecks');
    earn(dim, 'chk', 2300, 'Northwind Health Payroll', 'paychecks');
    earn(5, 'chk', 2650, 'Harbor Rd Tenant', '27-harbor-rd-rent');
    earn(28, 'sav', Math.round(bal.sav * 0.042 / 12 * 100) / 100, 'Interest paid', 'interest');
    if (m === 4) earn(22, 'chk', 2140, 'IRS Treasury Tax Refund', 'other-income');
    if (r() < 0.5) earn(Math.ceil(r() * 27), 'chk', between(40, 400), pick(['Venmo', 'eBay', 'Zelle from Mom']), 'other-income');

    // Loans: payment from checking, interest accrues on the loan account
    for (const l of loans) {
      const ds = on(l.day);
      if (!ds) continue;
      const interest = Math.round(-bal[l.id] * l.rate / 12 * 100) / 100;
      track(add(ds, l.id, -interest, 'Interest charge', null));
      track(add(ds, 'chk', -l.pay, l.payee, l.cat, { transferAccountId: l.id }));
      track(add(ds, l.id, l.pay, 'Payment from ' + accName.chk, null, { transferAccountId: 'chk' }));
    }

    // Home + rental
    spend(8, 'chk', 110, 260, 'Duke Energy', 'utilities');
    spend(10, 'chk', 55, 95, 'City Water & Sewer', 'utilities');
    if (r() < 0.6) spend(Math.ceil(r() * 27), 'cc1', 25, 480, pick(['Home Depot', "Lowe's"]), 'maintenance');
    if (m >= 4 && m <= 10) spend(14, 'chk', 120, 120, 'GreenLeaf Lawn Care', 'lawn-garden');
    spend(6, 'chk', 212, 212, 'Keystone Property Mgmt', 'property-management');
    if (m === 4 || m === 10) spend(20, 'chk', 1890, 1890, 'County Treasurer', 'property-tax');
    if (m === 3) spend(9, 'chk', 1350, 1350, 'Allstate Landlord Policy', 'landlord-insurance');
    if (r() < 0.35) spend(Math.ceil(r() * 27), 'chk', 150, 950, pick(['Mr. Handyman', 'Roto-Rooter', 'ABC Appliance Repair']), 'repairs');

    // Food
    for (let w = 0; w < 4; w++) {
      spend(3 + w * 7, 'cc2', 60, 210, pick(["Trader Joe's", 'Whole Foods', 'Kroger']), 'groceries');
    }
    if (r() < 0.8) {
      const ds = on(Math.ceil(r() * 27));
      if (ds) {
        const g = between(90, 220);
        const h = between(40, 160);
        const t = add(ds, 'cc2', -(g + h), 'Costco', null, {
          splits: [
            { categoryId: 'groceries', amount: -g, notes: '' },
            { categoryId: 'household', amount: -h, notes: '' },
          ],
        });
        ccMonth.cc2 += t.amount;
        track(t);
      }
    }
    for (let i = 0; i < 8; i++) spend(Math.ceil(r() * dim), 'cc1', 14, 115, pick(['Chipotle', 'Sweetgreen', "Luigi's Pizza", 'Olive Garden', 'Panera Bread', 'Thai Basil']), 'restaurants');
    for (let i = 0; i < 6; i++) spend(Math.ceil(r() * dim), 'cc1', 4.5, 9.5, pick(['Starbucks', 'Blue Bottle Coffee']), 'coffee');

    // Bills
    spend(4, 'cc2', 142.18, 142.18, 'Verizon', 'phone');
    spend(7, 'cc2', 79.99, 79.99, 'Xfinity', 'internet');
    spend(11, 'chk', 168.4, 168.4, 'State Farm', 'insurance');
    spend(2, 'cc2', 15.49, 15.49, 'Netflix', 'subscriptions');
    spend(9, 'cc2', 11.99, 11.99, 'Spotify', 'subscriptions');
    spend(16, 'cc2', 2.99, 2.99, 'Apple iCloud', 'subscriptions');

    // Transportation
    for (let i = 0; i < 3; i++) spend(Math.ceil(r() * dim), 'cc1', 35, 72, pick(['Shell', 'Exxon', 'Costco Gas']), 'gas');
    if (r() < 0.5) spend(Math.ceil(r() * 27), 'cc1', 8, 32, 'ParkMobile', 'parking');

    // Shopping
    for (let i = 0; i < 4; i++) spend(Math.ceil(r() * dim), 'cc1', 12, 160, 'Amazon', 'household');
    for (let i = 0; i < 2; i++) spend(Math.ceil(r() * dim), 'cc1', 25, 140, 'Target', 'household');
    if (r() < 0.7) spend(Math.ceil(r() * 27), 'cc1', 30, 180, pick(['Old Navy', 'Nike', 'Uniqlo']), 'clothing');

    // Kids
    spend(1, 'chk', 1450, 1450, 'Bright Horizons', 'childcare');
    if (r() < 0.8) spend(Math.ceil(r() * 27), 'cc2', 40, 180, pick(['Little Kickers Soccer', 'AquaTots Swim School', 'Kids Art Studio']), 'activities');

    // Health
    if (r() < 0.5) spend(Math.ceil(r() * 27), 'cc1', 25, 180, 'Midtown Family Medicine', 'medical');
    if (r() < 0.6) spend(Math.ceil(r() * 27), 'cc2', 9, 45, 'CVS Pharmacy', 'pharmacy');
    spend(17, 'cc2', 24.99, 24.99, 'Planet Fitness', 'gym');

    // Travel
    if (m === 3 || m === 7 || m === 11) {
      spend(4, 'cc1', 380, 1100, pick(['Delta Air Lines', 'United Airlines', 'Southwest Airlines']), 'flights');
      spend(19, 'cc1', 450, 1400, pick(['Marriott', 'Airbnb', 'Hilton']), 'lodging');
    }

    // Lifestyle
    if (r() < 0.6) spend(Math.ceil(r() * 27), 'cc1', 24, 90, pick(['AMC Theatres', 'Ticketmaster', 'Topgolf']), 'entertainment');
    if (m === 12 || r() < 0.25) spend(Math.ceil(r() * 20), 'cc1', 30, m === 12 ? 600 : 120, pick(['Etsy', 'Amazon', 'Nordstrom']), 'gifts');

    // Savings and investing (transfers are excluded from cash flow)
    let ds = on(2);
    if (ds) {
      transfer(ds, 'chk', 'sav', 2200, null, 'Transfer to High-Yield Savings', 'Transfer from Joint Checking');
      bal.chk -= 2200; bal.sav += 2200;
      transfer(ds, 'chk', 'brk', 1500, null, 'Transfer to Brokerage', 'Transfer from Joint Checking');
      bal.chk -= 1500; bal.brk += 1500;
    }
    if (m === 1 && (ds = on(10))) {
      transfer(ds, 'sav', 'ira', 7000, null, 'Transfer to Roth IRA', 'Transfer from High-Yield Savings');
      bal.sav -= 7000; bal.ira += 7000;
    }
    if ((ds = on(15))) track(add(ds, 'k401', 1800, 'Payroll contribution', null));

    // Market and property value updates at month end
    if ((ds = on(dim))) {
      for (const [id, mu, sd] of [['brk', 0.007, 0.03], ['k401', 0.006, 0.025], ['ira', 0.007, 0.03], ['home', 0.003, 0.002], ['rental', 0.0025, 0.002]]) {
        const change = Math.round(bal[id] * (mu + (r() - 0.45) * sd) * 100) / 100;
        track(add(ds, id, change, id === 'home' || id === 'rental' ? 'Value update' : 'Market change', null));
      }
    }

    // Pay off last month's credit card spend
    if ((ds = on(22))) {
      for (const cc of ['cc1', 'cc2']) {
        const owed = -Math.round(bal[cc] * 100) / 100;
        if (owed > 0) {
          transfer(ds, 'chk', cc, owed, null, 'Payment to ' + accName[cc], 'Payment from Joint Checking');
          bal.chk -= owed; bal[cc] += owed;
        }
      }
    }
    void ccMonth;
  }

  // A handful of recent, uncategorized imports to review
  const recent = (daysAgo) => new Date(now.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
  for (const [ago, acct, amt, payee] of [
    [1, 'cc1', -38.4, 'SQ *RIVERSIDE FARMERS MKT'],
    [3, 'chk', -120, 'Venmo'],
    [5, 'cc2', -64.12, 'PAYPAL *EBAYINC'],
    [9, 'cc1', -18.75, 'TST* CORNER BAKERY'],
  ]) {
    track(add(recent(ago), acct, amt, payee, null, { cleared: false }));
  }

  txs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const accounts = ACCOUNTS.map(([id, name, offBudget]) => ({
    id,
    name,
    offBudget,
    closed: false,
    balance: Math.round(txs.filter((t) => t.accountId === id).reduce((s, t) => s + t.amount, 0) * 100) / 100,
  }));

  return {
    meta: { source: 'demo', syncedAt: now.toISOString() },
    accounts,
    categoryGroups,
    categories,
    transactions: txs,
  };
}
