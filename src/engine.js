/*
 * Two-region agent-based economy.
 * One tick = one month. Households work, earn, pay tax, consume, save and migrate.
 * Firms hire, produce, price, pay dividends and go bankrupt. Governments tax, transfer and spend.
 * Money is conserved except for government deficits (which create money).
 */
(function (global) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DEFAULT_POLICY = {
    incomeTax: 0.20,      // flat rate on monthly income up to the top threshold
    topTax: 0.37,         // rate on income above $20k/month ($240k/yr)
    wealthTax: 0.00,      // annual rate on wealth above $1M
    corpTax: 0.21,        // tax on firm profits
    ubi: 0,               // monthly payment to every resident
    minWage: 0,           // monthly minimum pay per worker
    tariff: 0.00,         // tax on imports from the other region
    publicSpending: 0.12, // government purchases, share of GDP (ignored when balancedBudget)
    balancedBudget: true, // spend whatever revenue is left after UBI
  };

  const PARAMS = {
    householdsPerRegion: 1000,
    firmsPerRegion: 40,
    baseProductivity: 100,    // goods per skill-unit per month
    startPrice: 70,
    laborShare: 0.62,
    topThreshold: 20000,      // monthly income where the top rate starts
    wealthThreshold: 1e6,     // wealth tax exemption
    consumeIncome: 0.9,       // MPC out of smoothed net income
    consumeWealth: 0.007,     // monthly MPC out of wealth (~8%/yr, lower for the rich)
    homeBias: 0.72,           // share of spending on home goods at equal prices
    tradeElasticity: 4,
    inventoryDecay: 0.03,
    migrationCheck: 0.03,     // share of households that consider moving each month
    congestion: 0.8,          // utility penalty per unit of population share above 50%
    allowMigration: true,
    allowTrade: true,
  };

  const POLICY_LABELS = {
    incomeTax: 'income tax', topTax: 'top income tax', wealthTax: 'wealth tax', corpTax: 'corporate tax',
    ubi: 'UBI', minWage: 'minimum wage', tariff: 'tariff', publicSpending: 'public spending',
    balancedBudget: 'balanced budget',
  };

  function gini(sortedVals) {
    const n = sortedVals.length;
    if (n === 0) return 0;
    let cum = 0, total = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, sortedVals[i]);
      cum += (i + 1) * v; total += v;
    }
    if (total <= 0) return 0;
    return (2 * cum) / (n * total) - (n + 1) / n;
  }

  class Economy {
    constructor(opts = {}) {
      this.seed = opts.seed ?? 7;
      this.R = opts.regions === 1 ? 1 : 2;        // 1 = a single closed economy
      this.regs = this.R === 2 ? [0, 1] : [0];
      this.rng = mulberry32(this.seed);
      this.p = Object.assign({}, PARAMS, opts.params || {});
      this.policies = [Object.assign({}, DEFAULT_POLICY, (opts.policies || [])[0] || {}),
                       Object.assign({}, DEFAULT_POLICY, (opts.policies || [])[1] || {})];
      this.month = 0;
      this.history = [[], []];
      this.events = [];
      this.govDebt = [0, 0];
      this.divPool = 0;
      this.lastRevenue = [0, 0];
      this.lastUBI = [0, 0];
      this.lastGDP = [0, 0];
      this.cpiHist = [[], []];
      this.migrants = [0, 0]; // arrivals this month
      this.init();
      // let the economy settle before the user sees it, then rebase the clock and price index
      // (regions are kept apart during warm-up, then B is made an exact copy of A)
      const burn = opts.burnIn ?? 60;
      const keep = [this.p.allowMigration, this.p.allowTrade];
      this.p.allowMigration = false; this.p.allowTrade = false;
      for (let i = 0; i < burn; i++) this.step();
      [this.p.allowMigration, this.p.allowTrade] = keep;
      if (this.R === 2) this.mirrorRegion();
      this.month = 0; this.history = [[], []]; this.events = [];
      this.govDebt = [0, 0];
      this.cpiBase = this.regs.map(r => this.priceIndex(r));
      this.cpiHist = [this.cpiHist[0].slice(-13), this.cpiHist[1].slice(-13)];
    }

    // Overwrite region B with an exact copy of region A (households, firms, prices, wages, cash).
    mirrorRegion() {
      const N = this.p.householdsPerRegion, nF = this.p.firmsPerRegion;
      for (let j = 0; j < nF; j++) {
        const f = this.firms[j];
        this.firms[nF + j] = Object.assign({}, f, { id: nF + j, region: 1, workers: f.workers.map(id => id + N) });
      }
      for (let i = 0; i < N; i++) {
        const h = this.households[i];
        this.households[N + i] = Object.assign({}, h, { id: N + i, region: 1, employer: h.employer >= 0 ? h.employer + nF : -1 });
      }
      this.cpiHist[1] = this.cpiHist[0].slice();
      this.lastRevenue[1] = this.lastRevenue[0];
      this.lastGDP[1] = this.lastGDP[0];
      this.updateUnemployed();
    }

    normal() {
      let u = 0, v = 0;
      while (u === 0) u = this.rng();
      while (v === 0) v = this.rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    lognormal(sigma) { return Math.exp(sigma * this.normal() - sigma * sigma / 2); }
    randInt(n) { return Math.floor(this.rng() * n); }

    init() {
      const p = this.p;
      this.households = [];
      this.firms = [];
      // identical starting regions, so differences come from policy, not luck of the draw
      for (let i = 0; i < p.firmsPerRegion; i++) this.firms.push(this.newFirm(0, null));
      if (this.R === 2) for (let i = 0; i < p.firmsPerRegion; i++) {
        const f = this.newFirm(1, null); f.A = this.firms[i].A; this.firms.push(f);
      }
      const monthlyRevPerSkill = p.baseProductivity * p.startPrice;
      const proto = [];
      for (let i = 0; i < p.householdsPerRegion; i++) {
        const skill = this.lognormal(0.55);
        const baseIncome = skill * monthlyRevPerSkill;
        // heavy-tailed wealth: a few years of income on average, with a fat top tail
        proto.push({ skill, wealth: baseIncome * 30 * this.lognormal(1.45), baseIncome,
          attachment: -Math.log(1 - this.rng()) * 0.12, job: this.rng() < 0.95 ? this.randInt(p.firmsPerRegion) : -1 });
      }
      for (const r of this.regs) {
        for (const q of proto) {
          const h = {
            id: this.households.length, region: r, skill: q.skill, wealth: q.wealth,
            employer: -1, wage: 0, gross: 0, net: q.baseIncome * 0.8, netSmooth: q.baseIncome * 0.8,
            div: 0, attachment: q.attachment, lastMove: -999,
          };
          this.households.push(h);
          if (q.job >= 0) this.employ(this.firms[r * p.firmsPerRegion + q.job], h);
        }
      }
      for (const f of this.firms) {
        const skillSum = this.firmSkill(f);
        f.expSales = f.A * skillSum;
        f.inventory = f.expSales * 0.3;
        f.cash = this.wageBill(f) * 3;
      }
      this.updateUnemployed();
    }

    newFirm(region, template) {
      const p = this.p;
      const A = p.baseProductivity * this.lognormal(0.25);
      const price = template ? template.price : p.startPrice;
      const wageRate = template ? template.wageRate : p.laborShare * p.baseProductivity * p.startPrice;
      return {
        id: this.firms ? this.firms.length : 0, region, A, price, wageRate,
        inventory: 0, cash: 0, workers: [], expSales: 0, salesQty: 0, salesRev: 0,
        output: 0, vac: 0, noVac: 0, idle: 0, age: 0, lastWageBill: 0, profit: 0,
      };
    }

    firmSkill(f) { let s = 0; for (const id of f.workers) s += this.households[id].skill; return s; }
    wageFor(f, h) { return Math.max(f.wageRate * h.skill, this.policies[f.region].minWage); }
    wageBill(f) { let s = 0; for (const id of f.workers) s += this.households[id].wage; return s; }

    employ(f, h) {
      h.employer = f.id; h.wage = this.wageFor(f, h); f.workers.push(h.id);
    }
    fire(f, h) {
      const i = f.workers.indexOf(h.id);
      if (i >= 0) { f.workers[i] = f.workers[f.workers.length - 1]; f.workers.pop(); }
      h.employer = -1; h.wage = 0;
    }

    updateUnemployed() {
      this.unemployed = [[], []];
      for (const h of this.households) if (h.employer < 0) this.unemployed[h.region].push(h.id);
    }

    regionStat(r) {
      // average wage rate and unemployment, used by migration and wage setting
      let wr = 0, n = 0;
      for (const f of this.firms) if (f.region === r && f.workers.length) { wr += f.wageRate * f.workers.length; n += f.workers.length; }
      let pop = 0;
      for (const h of this.households) if (h.region === r) pop++;
      return { avgWageRate: n ? wr / n : this.p.laborShare * this.p.baseProductivity * this.p.startPrice, pop, u: pop ? 1 - n / pop : 0 };
    }

    setPolicy(r, key, value, quiet) {
      const old = this.policies[r][key];
      if (old === value) return;
      this.policies[r][key] = value;
      if (!quiet) this.events.push({ month: this.month, region: r, key, from: old, to: value, label: POLICY_LABELS[key] || key });
    }

    incomeTax(r, y) {
      const pol = this.policies[r], thr = this.p.topThreshold;
      if (y <= 0) return 0;
      return pol.incomeTax * Math.min(y, thr) + pol.topTax * Math.max(0, y - thr);
    }
    wealthTax(r, w) { return this.policies[r].wealthTax / 12 * Math.max(0, w - this.p.wealthThreshold); }

    priceIndex(r) {
      let rev = 0, q = 0, ps = 0, n = 0;
      for (const f of this.firms) if (f.region === r) { rev += f.salesRev; q += f.salesQty; ps += f.price; n++; }
      return q > 0 ? rev / q : ps / n;
    }

    // ---------------------------------------------------------------- tick
    step() {
      const p = this.p, H = this.households, F = this.firms, rng = this.rng;
      const stats = this.regs.map(r => this.regionStat(r));
      this.migrants = [0, 0];

      // 1. Labor market
      for (const f of F) {
        const pol = this.policies[f.region];
        // refresh wages (min wage changes apply immediately)
        for (const id of f.workers) H[id].wage = this.wageFor(f, H[id]);
        // drop workers who no longer cover their cost
        for (let k = f.workers.length - 1; k >= 0; k--) {
          const h = H[f.workers[k]];
          if (f.A * h.skill * f.price < h.wage * 0.92 && rng() < 0.25) this.fire(f, h);
        }
        const needed = Math.max(0, f.expSales * 1.1 - f.inventory * 0.5) / f.A;
        let cur = this.firmSkill(f);
        let bill = this.wageBill(f);
        if (cur < needed * 0.97) {
          const pool = this.unemployed[f.region];
          const cands = [];
          for (let k = 0; k < 14 && pool.length; k++) {
            const idx = this.randInt(pool.length);
            const h = H[pool[idx]];
            if (h.employer < 0 && h.region === f.region) cands.push(h);
          }
          cands.sort((a, b) => (b.skill / this.wageFor(f, b)) - (a.skill / this.wageFor(f, a)));
          for (const h of cands) {
            if (cur >= needed * 0.97 || h.employer >= 0) continue;
            const w = this.wageFor(f, h);
            if (f.A * h.skill * f.price < w * 1.05) continue;           // not profitable
            if (f.cash < (bill + w) * 0.6) continue;                    // can't afford
            this.employ(f, h); cur += h.skill; bill += w;
          }
          if (cur < needed * 0.97) { f.vac++; f.noVac = 0; } else { f.vac = 0; }
        } else {
          f.vac = 0; f.noVac++;
          if (cur > needed * 1.12 && f.workers.length > 1) {
            // fire least profitable, at most ~6% of staff per month
            const ws = f.workers.map(id => H[id]).sort((a, b) => (a.skill / a.wage) - (b.skill / b.wage));
            let maxFire = Math.max(1, Math.ceil(ws.length * 0.06));
            for (const h of ws) {
              if (maxFire-- <= 0 || cur <= needed * 1.05) break;
              cur -= h.skill; this.fire(f, h);
            }
          }
        }
        // wage setting
        if (f.vac > 0) f.wageRate *= 1 + 0.02 * rng();
        else if (f.noVac > 4 && stats[f.region].u > 0.06) f.wageRate *= 1 - 0.008 * rng();
        if (pol.minWage > 0) { /* nothing: floor applied per worker */ }
      }
      this.updateUnemployed();

      // 2. Production and wages
      const gross = new Float64Array(H.length);
      for (const f of F) {
        let bill = this.wageBill(f);
        if (bill > f.cash && f.workers.length) {
          const ws = f.workers.map(id => H[id]).sort((a, b) => (a.skill / a.wage) - (b.skill / b.wage));
          for (const h of ws) { if (bill <= f.cash) break; bill -= h.wage; this.fire(f, h); }
        }
        let skill = 0;
        for (const id of f.workers) { const h = H[id]; skill += h.skill; gross[id] += h.wage; }
        f.cash -= bill;
        f.lastWageBill = bill;
        f.output = f.A * skill;
        f.inventory = f.inventory * (1 - p.inventoryDecay) + f.output;
        f.salesQty = 0; f.salesRev = 0;
      }
      this.updateUnemployed();

      // 3. Dividends (from last month's retained excess), owned globally pro rata wealth
      let W = 0;
      for (const h of H) W += Math.max(0, h.wealth);
      for (const h of H) { h.div = W > 0 ? this.divPool * Math.max(0, h.wealth) / W : 0; gross[h.id] += h.div; }
      this.divPool = 0;

      // 4. Taxes and transfers
      const rev = [0, 0], revInc = [0, 0], revWealth = [0, 0], revCorp = [0, 0], revTariff = [0, 0], ubiPaid = [0, 0];
      for (const h of H) {
        const r = h.region, pol = this.policies[r];
        const y = gross[h.id];
        const ti = this.incomeTax(r, y);
        const tw = Math.min(this.wealthTax(r, h.wealth), Math.max(0, h.wealth));
        const net = y - ti - tw + pol.ubi;
        revInc[r] += ti; revWealth[r] += tw; ubiPaid[r] += pol.ubi;
        h.gross = y; h.net = net;
        h.netSmooth = 0.8 * h.netSmooth + 0.2 * net;
        h.wealth += net;
      }

      // 5. Consumption with home/foreign split
      const P = this.regs.map(r => this.priceIndex(r));
      const regionFirms = [F.filter(f => f.region === 0), F.filter(f => f.region === 1)];
      const foreignShare = [0, 0];
      for (const r of this.regs) {
        if (!p.allowTrade || this.R === 1) { foreignShare[r] = 0; continue; }
        const rel = (P[1 - r] * (1 + this.policies[r].tariff)) / P[r];
        const b = 1 - p.homeBias;
        const wf = b * Math.pow(rel, -p.tradeElasticity);
        foreignShare[r] = wf / (wf + (1 - b));
      }
      const exports = [0, 0];
      const buy = (buyerRegion, budget, sellerRegion, isGov) => {
        const tariff = (buyerRegion !== sellerRegion) ? this.policies[buyerRegion].tariff : 0;
        const list = regionFirms[sellerRegion];
        let spent = 0;
        for (let attempt = 0; attempt < 3 && budget - spent > 1; attempt++) {
          let best = null;
          for (let k = 0; k < 3; k++) {
            const f = list[this.randInt(list.length)];
            if (f.inventory < 1e-6) continue;
            if (!best || f.price < best.price) best = f;
          }
          if (!best) continue;
          const ep = best.price * (1 + tariff);
          const q = Math.min((budget - spent) / ep, best.inventory);
          best.inventory -= q;
          best.salesQty += q; best.salesRev += q * best.price; best.cash += q * best.price;
          if (tariff > 0) revTariff[buyerRegion] += q * best.price * tariff;
          if (buyerRegion !== sellerRegion) exports[sellerRegion] += q * best.price;
          spent += q * ep;
        }
        return spent;
      };
      const order = H.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = this.randInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
      for (const idx of order) {
        const h = H[idx];
        if (h.wealth <= 0) continue;
        // richer households spend a smaller share of their wealth each month
        const cw = p.consumeWealth / Math.sqrt(1 + h.wealth / 1e6);
        // and a smaller share of a high income
        const cy = p.consumeIncome / Math.pow(1 + Math.max(0, h.netSmooth) / 15000, 0.3);
        let budget = Math.min(h.wealth, Math.max(0, cy * h.netSmooth) + cw * h.wealth);
        const r = h.region;
        const bf = budget * foreignShare[r];
        let spent = buy(r, budget - bf, r, false);
        if (bf > 0) spent += buy(r, bf, 1 - r, false);
        h.wealth -= spent;
      }

      // 6. Government purchases (domestic)
      const govSpent = [0, 0];
      for (const r of this.regs) {
        const pol = this.policies[r];
        let G;
        if (pol.balancedBudget) G = Math.max(0, this.lastRevenue[r] - ubiPaid[r]);
        else G = pol.publicSpending * this.lastGDP[r];
        const chunks = 20;
        for (let c = 0; c < chunks; c++) govSpent[r] += buy(r, G / chunks, r, true);
      }

      // 7. Firms: corporate tax, pricing, expectations, dividends, exit/entry
      for (const f of F) {
        const pol = this.policies[f.region];
        const profit = f.salesRev - f.lastWageBill;
        f.profit = profit;
        if (profit > 0) { const t = profit * pol.corpTax; f.cash -= t; revCorp[f.region] += t; }
        f.expSales = 0.75 * f.expSales + 0.25 * f.salesQty;
        const invRatio = f.inventory / Math.max(1e-9, f.expSales);
        if (invRatio < 0.25) f.price *= 1 + 0.025 * rng();
        else if (invRatio > 0.8) f.price *= 1 - 0.025 * rng();
        if (f.output > 0) {
          const unitCost = f.lastWageBill / f.output;
          if (f.price < unitCost * 1.02) f.price = 0.7 * f.price + 0.3 * unitCost * 1.02;
        }
        const buffer = 3 * Math.max(f.lastWageBill, f.wageRate * 2);
        if (f.cash > buffer) { const d = 0.3 * (f.cash - buffer); f.cash -= d; this.divPool += d; }
        f.idle = (f.salesQty < 1e-6 && f.workers.length === 0) ? f.idle + 1 : 0;
        f.age++;
      }
      // exit and entry: replace dead firms; startup capital comes from the dividend pool
      for (let i = 0; i < F.length; i++) {
        const f = F[i];
        if (f.idle >= 6 || f.cash < 0) {
          for (const id of f.workers.slice()) this.fire(f, H[id]);
          const peers = F.filter(g => g.region === f.region && g !== f && g.workers.length);
          const tmpl = peers.length ? peers[this.randInt(peers.length)] : f;
          const nf = this.newFirm(f.region, tmpl);
          nf.id = f.id;
          this.divPool += Math.max(0, f.inventory * 0) + f.cash; // leftover cash (may be negative)
          const seed = tmpl.wageRate * 6;
          nf.cash = seed; this.divPool -= seed;
          nf.expSales = Math.max(1, tmpl.expSales * 0.3);
          F[i] = nf;
          this.events.push({ month: this.month, region: f.region, kind: 'bankruptcy' });
        }
      }
      // if the pool went negative, recapitalise from wealth pro rata (keeps money conserved)
      if (this.divPool < 0) {
        const need = -this.divPool; let Wp = 0;
        for (const h of H) Wp += Math.max(0, h.wealth);
        for (const h of H) h.wealth -= need * Math.max(0, h.wealth) / Wp;
        this.divPool = 0;
      }

      // Government accounts
      for (const r of this.regs) {
        rev[r] = revInc[r] + revWealth[r] + revCorp[r] + revTariff[r];
        this.govDebt[r] += govSpent[r] + ubiPaid[r] - rev[r];
        this.lastRevenue[r] = rev[r];
      }

      // 8. Migration
      if (p.allowMigration && this.R === 2) {
        const st = [this.regionStat(0), this.regionStat(1)];
        const total = st[0].pop + st[1].pop;
        for (const h of H) {
          if (rng() > p.migrationCheck || this.month - h.lastMove < 24) continue;
          const r = h.region, o = 1 - r;
          const expWage = (rr) => h.skill * st[rr].avgWageRate * (1 - st[rr].u);
          const valueIn = (rr, wage) => {
            const y = wage + h.div;
            return y - this.incomeTax(rr, y) + this.policies[rr].ubi - this.wealthTax(rr, h.wealth);
          };
          const ownWage = h.employer >= 0 ? h.wage : expWage(r);
          const share = (rr) => st[rr].pop / total;
          const uOwn = valueIn(r, ownWage) * (1 - p.congestion * (share(r) - 0.5));
          const uOth = valueIn(o, expWage(o)) * (1 - p.congestion * (share(o) - 0.5));
          const cost = Math.abs(uOwn) * (0.08 + h.attachment) + 400;
          if (uOth - uOwn > cost) {
            if (h.employer >= 0) this.fire(F[h.employer], h);
            h.region = o; h.lastMove = this.month; this.migrants[o]++;
            st[r].pop--; st[o].pop++;
          }
        }
        this.updateUnemployed();
      }

      // 9. Metrics
      this.month++;
      for (const r of this.regs) {
        const res = H.filter(h => h.region === r);
        const pop = res.length;
        const emp = res.filter(h => h.employer >= 0).length;
        const firms = F.filter(f => f.region === r);
        const gdp = firms.reduce((s, f) => s + f.salesRev, 0);
        const realOut = firms.reduce((s, f) => s + f.salesQty, 0);
        const cpi = this.priceIndex(r);
        this.cpiHist[r].push(cpi);
        const ch = this.cpiHist[r];
        const inflation = ch.length > 12 ? ch[ch.length - 1] / ch[ch.length - 13] - 1 : 0;
        const wealths = res.map(h => h.wealth).sort((a, b) => a - b);
        const nets = res.map(h => h.net).sort((a, b) => a - b);
        const totalW = wealths.reduce((s, v) => s + Math.max(0, v), 0);
        const top = Math.max(1, Math.floor(pop * 0.01));
        let topW = 0; for (let k = 0; k < top; k++) topW += Math.max(0, wealths[pop - 1 - k] || 0);
        this.lastGDP[r] = gdp;
        const cpi0 = this.cpiBase ? this.cpiBase[r] : this.cpiHist[r][0];
        this.history[r].push({
          month: this.month,
          pop,
          unemployment: pop ? 1 - emp / pop : 0,
          gdp,
          realGdpPerCapita: pop ? (realOut * this.p.startPrice) / pop * 12 : 0,
          cpi: cpi / cpi0 * 100,
          inflation,
          giniWealth: gini(wealths),
          giniIncome: gini(nets),
          top1: totalW > 0 ? topW / totalW : 0,
          medianRealIncome: pop ? nets[Math.floor(pop / 2)] / (cpi / cpi0) * 12 : 0,
          revenue: rev[r], revInc: revInc[r], revWealth: revWealth[r], revCorp: revCorp[r], revTariff: revTariff[r],
          ubiPaid: ubiPaid[r], govSpent: govSpent[r],
          debtToGdp: gdp > 0 ? this.govDebt[r] / (gdp * 12) : 0,
          exports: exports[r], imports: exports[1 - r],
          tradeBalance: gdp > 0 ? (exports[r] - exports[1 - r]) / gdp : 0,
          arrivals: this.migrants[r],
          millionaires: res.filter(h => h.wealth > this.p.wealthThreshold).length,
          avgWage: emp ? res.reduce((s, h) => s + h.wage, 0) / emp : 0,
        });
      }
    }

    run(n) { for (let i = 0; i < n; i++) this.step(); }
    latest(r) { const h = this.history[r]; return h[h.length - 1]; }
  }

  // Two completely separate copies of one closed economy, built from the same seed.
  // With equal policies they stay identical month for month; any gap comes from a policy change.
  class TwinEconomy {
    constructor(opts = {}) {
      this.twins = [new Economy(Object.assign({}, opts, { regions: 1 })), new Economy(Object.assign({}, opts, { regions: 1 }))];
      this.events = [];
      this.p = this.twins[0].p;
    }
    get month() { return this.twins[0].month; }
    get history() { return [this.twins[0].history[0], this.twins[1].history[0]]; }
    get policies() { return [this.twins[0].policies[0], this.twins[1].policies[0]]; }
    setPolicy(r, key, value, quiet) {
      const old = this.twins[r].policies[0][key];
      if (old === value) return;
      this.twins[r].setPolicy(0, key, value, true);
      if (!quiet) this.events.push({ month: this.month, region: r, key, from: old, to: value, label: POLICY_LABELS[key] || key });
    }
    step() { this.twins[0].step(); this.twins[1].step(); }
    run(n) { for (let i = 0; i < n; i++) this.step(); }
    latest(r) { const h = this.history[r]; return h[h.length - 1]; }
  }

  const api = { Economy, TwinEconomy, DEFAULT_POLICY, PARAMS, POLICY_LABELS, gini };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.EconSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
