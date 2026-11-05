// Builds dist/index.html: the dashboard with the engine inlined, as one self-contained file.
// Usage: npm run build
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src', 'engine.js'), 'utf8');
const tag = '<script src="engine.js"></script>';

if (!app.includes(tag)) {
  console.error(`Build failed: src/app.html must contain ${tag}`);
  process.exit(1);
}

const out = app.replace(tag, () => `<script>\n${engine}\n</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), out);
console.log(`Built dist/index.html (${(out.length / 1024).toFixed(0)} KB)`);
