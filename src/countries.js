// Starting-policy presets for the 10 largest economies, picked in the dashboard's Region/Country menus.
// Rough approximations of real policy, scaled to the model (average pay starts near $5k/month),
// so minimum wage and UBI are relative levels, not exact local figures. Keys match DEFAULT_POLICY in engine.js;
// anything left out falls back to the model default.
window.COUNTRIES = {
  "USA": {
    incomeTax: 0.15,
    topTax: 0.37,
    wealthTax: 0.00,
    corpTax: 0.21,
    ubi: 0,
    minWage: 1200, // Roughly $7.25 * 160 hours
    interestRate: 0.05 // Federal funds rate
  },
  "China": {
    incomeTax: 0.10,
    topTax: 0.45,
    wealthTax: 0.00,
    corpTax: 0.25,
    ubi: 0,
    minWage: 400,
    interestRate: 0.03
  },
  "Germany": {
    incomeTax: 0.25,
    topTax: 0.42,
    wealthTax: 0.00,
    corpTax: 0.30,
    ubi: 0,
    minWage: 2000,
    interestRate: 0.04
  },
  "Japan": {
    incomeTax: 0.20,
    topTax: 0.45,
    wealthTax: 0.00,
    corpTax: 0.30,
    ubi: 0,
    minWage: 1200,
    interestRate: 0.00
  },
  "India": {
    incomeTax: 0.10,
    topTax: 0.30,
    wealthTax: 0.00,
    corpTax: 0.25,
    ubi: 100,
    minWage: 200,
    interestRate: 0.06
  },
  "UK": {
    incomeTax: 0.20,
    topTax: 0.45,
    wealthTax: 0.00,
    corpTax: 0.25,
    ubi: 0,
    minWage: 1800,
    interestRate: 0.05
  },
  "France": {
    incomeTax: 0.25,
    topTax: 0.45,
    wealthTax: 0.01,
    corpTax: 0.25,
    ubi: 0,
    minWage: 1700,
    interestRate: 0.04
  },
  "Brazil": {
    incomeTax: 0.15,
    topTax: 0.275,
    wealthTax: 0.00,
    corpTax: 0.34,
    ubi: 50,
    minWage: 300,
    interestRate: 0.10
  },
  "Italy": {
    incomeTax: 0.23,
    topTax: 0.43,
    wealthTax: 0.00,
    corpTax: 0.24,
    ubi: 0,
    minWage: 1400,
    interestRate: 0.04
  },
  "Canada": {
    incomeTax: 0.20,
    topTax: 0.33,
    wealthTax: 0.00,
    corpTax: 0.26,
    ubi: 0,
    minWage: 1500,
    interestRate: 0.05
  }
};
