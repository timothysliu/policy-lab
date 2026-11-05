// Runs policy scenarios headlessly and prints before/after indicators for both regions.
// Usage: npm run scenarios            (all scenarios)
//        npm run scenarios -- wealth  (one scenario)
const { Economy } = require('../src/engine.js');

const pct = (x) => (x * 100).toFixed(1) + '%';
const k = (x) => '$' + Math.round(x / 1000) + 'k';

function summary(e, label) {
  console.log(`\n== ${label} (month ${e.month})`);
  for (const r of [0, 1]) {
    const h = e.latest(r);
    console.log(
      `${'AB'[r]}: pop ${h.pop}  unemp ${pct(h.unemployment)}  infl ${pct(h.inflation)}  ` +
      `output/person ${k(h.realGdpPerCapita)}  median income ${k(h.medianRealIncome)}  ` +
      `gini ${h.giniWealth.toFixed(2)}  top1 ${pct(h.top1)}  millionaires ${h.millionaires}  ` +
      `debt/GDP ${pct(h.debtToGdp)}  trade ${pct(h.tradeBalance)}`
    );
  }
}

const SCENARIOS = {
  baseline: () => {},
  wealth: (e) => e.setPolicy(0, 'wealthTax', 0.03),
  minwage: (e) => e.setPolicy(0, 'minWage', 3000),
  tariff: (e) => e.setPolicy(0, 'tariff', 0.25),
  tradewar: (e) => { e.setPolicy(0, 'tariff', 0.25); e.setPolicy(1, 'tariff', 0.25); },
  ubi: (e) => e.setPolicy(0, 'ubi', 1000),
  ubidebt: (e) => {
    e.setPolicy(0, 'balancedBudget', false);
    e.setPolicy(0, 'publicSpending', 0.14);
    e.setPolicy(0, 'ubi', 1000);
  },
};

const only = process.argv[2];
if (only && !SCENARIOS[only]) {
  console.error(`Unknown scenario "${only}". Options: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}
for (const [name, apply] of Object.entries(SCENARIOS)) {
  if (only && name !== only) continue;
  const e = new Economy({ seed: 3 });
  e.run(24);
  summary(e, `${name}: before (year 2)`);
  apply(e);
  e.run(120);
  summary(e, `${name}: after 10 more years`);
}
