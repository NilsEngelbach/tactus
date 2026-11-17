// Builds the Rust pitch detector to WebAssembly and copies it next to the worklet.
// The .wasm is committed, so a normal build needs no Rust toolchain.
//   npm run build:wasm      (needs: rustup target add wasm32-unknown-unknown)
import { execFileSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const crate = join(root, 'wasm', 'pitch');
execFileSync('cargo', ['test', '--release', '--quiet'], { cwd: crate, stdio: 'inherit' });
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: crate, stdio: 'inherit' });
const out = join(crate, 'target', 'wasm32-unknown-unknown', 'release', 'tactus_pitch.wasm');
const dest = join(root, 'src', 'audio', 'pitch.wasm');
copyFileSync(out, dest);
console.log(`pitch.wasm: ${statSync(dest).size} bytes`);
