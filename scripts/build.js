// Builds dist/index.html: the dashboard with the engine inlined, as one self-contained file.
// Usage: npm run build
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
// every local script the dashboard loads, inlined in place
let out = app;
for (const file of ['countries.js', 'engine.js']) {
  const tag = `<script src="${file}"></script>`;
  if (!out.includes(tag)) {
    console.error(`Build failed: src/app.html must contain ${tag}`);
    process.exit(1);
  }
  const code = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  out = out.replace(tag, () => `<script>\n${code}\n</script>`);
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), out);
console.log(`Built dist/index.html (${(out.length / 1024).toFixed(0)} KB)`);
