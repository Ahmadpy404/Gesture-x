/**
 * @fileoverview Post-install script: copies @mediapipe/hands assets to
 * src/assets/mediapipe/ so they can be served from the extension's
 * local file system (required by MV3 CSP — no external CDN allowed).
 *
 * Run: node scripts/copy-mediapipe.js
 * Auto-run: triggered by npm postinstall hook.
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC  = path.join(ROOT, 'node_modules', '@mediapipe', 'hands');
const DST  = path.join(ROOT, 'src', 'assets', 'mediapipe');

// File extensions to copy (skip package.json, README, LICENSE etc.)
const ALLOWED_EXTENSIONS = new Set([
  '.js', '.wasm', '.data', '.binarypb', '.tflite',
]);

function run() {
  if (!fs.existsSync(SRC)) {
    console.error(
      '[copy-mediapipe] ERROR: @mediapipe/hands not found in node_modules.\n' +
      '  Run: npm install'
    );
    process.exit(1);
  }

  fs.mkdirSync(DST, { recursive: true });

  const files   = fs.readdirSync(SRC);
  let   copied  = 0;
  let   skipped = 0;

  for (const file of files) {
    const srcPath = path.join(SRC, file);
    const ext     = path.extname(file).toLowerCase();

    if (!fs.statSync(srcPath).isFile()) continue;
    if (!ALLOWED_EXTENSIONS.has(ext))  { skipped++; continue; }

    const dstPath = path.join(DST, file);
    fs.copyFileSync(srcPath, dstPath);
    const size = (fs.statSync(dstPath).size / 1024).toFixed(1);
    console.log(`  ✅ ${file.padEnd(55)} ${size} KB`);
    copied++;
  }

  // Copy tasks-vision
  const TV_SRC = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision');
  const TV_DST = path.join(DST, 'tasks-vision');
  const TV_WASM_DST = path.join(TV_DST, 'wasm');
  
  if (fs.existsSync(TV_SRC)) {
    fs.mkdirSync(TV_DST, { recursive: true });
    fs.mkdirSync(TV_WASM_DST, { recursive: true });

    const tvFiles = ['vision_bundle.mjs', 'vision_bundle.cjs'];
    for (const file of tvFiles) {
      if (fs.existsSync(path.join(TV_SRC, file))) {
        fs.copyFileSync(path.join(TV_SRC, file), path.join(TV_DST, file));
        console.log(`  ✅ ${file.padEnd(55)}`);
      }
    }

    const wasmFiles = fs.readdirSync(path.join(TV_SRC, 'wasm'));
    for (const file of wasmFiles) {
      if (!fs.statSync(path.join(TV_SRC, 'wasm', file)).isFile()) continue;
      fs.copyFileSync(path.join(TV_SRC, 'wasm', file), path.join(TV_WASM_DST, file));
      console.log(`  ✅ ${('wasm/' + file).padEnd(55)}`);
    }
  }

  console.log(`\n[copy-mediapipe] Done — ${copied} files copied, ${skipped} skipped.`);
  console.log(`[copy-mediapipe] Output: ${DST}`);
}

run();
