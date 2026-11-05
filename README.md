# Policy Lab

An agent-based simulation of national economies. Thousands of simulated households and firms work, trade, pay taxes and migrate, and a live dashboard lets you change policies (taxes, UBI, minimum wage, tariffs, public spending, interest rates) and watch jobs, prices, inequality and migration respond.

Three modes:

- **Two linked regions**: two economies that trade goods and swap residents. Both start as exact copies.
- **Identical twins**: two separate copies of one country built from the same random draws. With equal policies they stay identical month for month, so any gap is caused by the policy you change.
- **Single country**: one closed economy.

No dependencies: plain JavaScript, runs in any browser, tested with Node 18+.

## Quick start

```bash
# open the dashboard directly (no build needed)
open src/app.html          # macOS
start src/app.html         # Windows
xdg-open src/app.html      # Linux

npm test                   # run the model's sanity checks
npm run scenarios          # print before/after results for every policy scenario
npm run scenarios -- wealth   # just one (baseline, wealth, minwage, tariff, tradewar, ubi, ubidebt)
npm run build              # write dist/index.html, a single self-contained file to share
```

## Project structure

```
src/
  engine.js        the whole model (works in the browser and in Node)
  app.html         the dashboard: sliders, charts, scenarios; loads engine.js from the same folder
scripts/
  build.js         inlines engine.js into app.html -> dist/index.html
  scenarios.js     headless policy experiments
test/
  engine.test.js   determinism, identical starts, stability, policy effects, money conservation, interest rates
dist/              build output (not committed)
```

## How the model works

One tick = one month. Each region has 1,000 households and 40 firms. Each month, in order:

1. **Labor market.** Firms estimate demand, work out how much labor they need, hire unemployed people whose output covers their pay (`productivity × skill × price ≥ wage`), and lay off the least profitable workers when overstaffed. Unfilled jobs push wages up; long slack with high unemployment pushes them down slowly. The minimum wage is a pay floor per worker.
2. **Production and wages.** Output = firm productivity × total worker skill. Firms that can't cover payroll first draw on a credit line (up to 3 months of payroll) and lay people off only if that runs out.
3. **Dividends.** Spare firm cash is paid to all households in proportion to their wealth. Ownership is global, so rich people can move without taking the firms with them. Households also earn the central bank's policy rate on their savings (taxed as income).
4. **Taxes and transfers.** Income tax (a flat rate plus a top rate above $20k/month), wealth tax above $1M, UBI. Taxes are paid where you live.
5. **Consumption.** Spending = a share of smoothed income + a share of wealth; both shares are smaller for richer households. Spending splits between home and foreign goods based on relative prices (Armington-style); tariffs raise import prices and go to the importing government.
6. **Government purchases.** With a balanced budget the government spends revenue minus UBI. Otherwise it spends a set % of GDP and borrows the difference (borrowing creates money).
7. **Firms.** Interest on loans (policy rate + 2% spread, paid to the central bank), loan repayment from spare cash, corporate tax on profit, price changes based on inventory (never below unit cost), dividends, bankruptcy and replacement by a new firm.
8. **Migration.** About 3% of people each month compare their after-tax position in both regions, including a crowding penalty and a personal attachment cost, and move if it pays.
9. **Metrics.** Unemployment, inflation, real output per person, median real income, wealth Gini, top 1% wealth share, population, government debt/GDP, trade balance.

The first 60 months are a hidden warm-up so the dashboard starts from a settled economy.

The results follow from these behavioral assumptions. They show what happens *if* people and firms behave this way; they are not forecasts of a real economy.

## Roadmap

- [x] Central bank with an interest rate (deposit rate, firm borrowing)
- [ ] Make rate hikes contractionary: deposit interest is currently new money and outweighs the tiny firm-loan channel
- [ ] Housing market so migration raises rents
- [ ] Firm investment and productivity growth, so policy affects long-run growth
- [ ] Batch experiments: each scenario across 50 seeds, average effect with confidence bands
- [ ] Calibrate parameters to U.S. data
- [ ] Reinforcement-learning government that searches for the welfare-maximizing tax policy
