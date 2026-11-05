// Sanity checks for the model. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { Economy, TwinEconomy } = require('../src/engine.js');

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('same seed gives the same economy (deterministic)', () => {
  const a = new Economy({ seed: 11 }); a.run(24);
  const b = new Economy({ seed: 11 }); b.run(24);
  assert.deepEqual(a.history, b.history);
});

test('linked regions start as exact copies', () => {
  const e = new Economy({ seed: 5 });
  const N = e.p.householdsPerRegion;
  for (let i = 0; i < N; i++) {
    assert.equal(e.households[i].wealth, e.households[N + i].wealth);
    assert.equal(e.households[i].skill, e.households[N + i].skill);
  }
});

test('twins stay identical while policies are equal', () => {
  const t = new TwinEconomy({ seed: 3 });
  t.run(60);
  assert.deepEqual(t.history[0], t.history[1]);
});

test('twins diverge once a policy differs', () => {
  const t = new TwinEconomy({ seed: 3 });
  t.run(12);
  t.setPolicy(0, 'wealthTax', 0.03);
  t.run(36);
  assert.notDeepEqual(t.latest(0), t.latest(1));
});

test('single-country mode runs and keeps everyone in one region', () => {
  const e = new Economy({ seed: 3, regions: 1 });
  e.run(60);
  assert.equal(e.history[1].length, 0);
  assert.equal(e.latest(0).pop, e.p.householdsPerRegion);
});

test('baseline economy is stable (unemployment stays in a sane band)', () => {
  const e = new Economy({ seed: 3 });
  e.run(240);
  for (const r of [0, 1]) {
    const u = mean(e.history[r].map((h) => h.unemployment));
    assert.ok(u > 0.01 && u < 0.12, `region ${r} mean unemployment ${u}`);
    const cpi = e.latest(r).cpi;
    assert.ok(cpi > 70 && cpi < 140, `region ${r} price level ${cpi}`);
  }
});

test('a wealth tax with migration pushes millionaires to the other region', () => {
  const e = new Economy({ seed: 3 });
  e.run(12);
  e.setPolicy(0, 'wealthTax', 0.03);
  e.run(96);
  assert.ok(e.latest(0).millionaires < e.latest(1).millionaires);
  assert.ok(e.latest(0).top1 < e.latest(1).top1);
});

test('a high minimum wage raises unemployment', () => {
  const t = new TwinEconomy({ seed: 3 });
  t.run(12);
  t.setPolicy(0, 'minWage', 3000);
  t.run(60);
  const uA = mean(t.history[0].slice(-24).map((h) => h.unemployment));
  const uB = mean(t.history[1].slice(-24).map((h) => h.unemployment));
  assert.ok(uA > uB + 0.03, `with min wage ${uA}, without ${uB}`);
});

test('money is conserved when the budget is balanced and nobody borrows', () => {
  const e = new Economy({ seed: 3, regions: 1 });
  const total = () =>
    e.households.reduce((s, h) => s + h.wealth, 0) +
    e.firms.reduce((s, f) => s + f.cash, 0) +
    e.divPool - e.govDebt[0];
  const before = total();
  e.run(36);
  const after = total();
  assert.ok(Math.abs(after - before) / before < 1e-6, `drift ${(after - before) / before}`);
});
