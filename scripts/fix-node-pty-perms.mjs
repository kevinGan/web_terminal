#!/usr/bin/env node
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PNPM_DIR = join(ROOT, 'node_modules', '.pnpm');

if (!existsSync(PNPM_DIR)) process.exit(0);

let fixed = 0;
for (const dir of readdirSync(PNPM_DIR)) {
  if (!dir.startsWith('node-pty@')) continue;
  const prebuilds = join(PNPM_DIR, dir, 'node_modules', 'node-pty', 'prebuilds');
  if (!existsSync(prebuilds)) continue;
  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, 'spawn-helper');
    if (!existsSync(helper)) continue;
    const mode = statSync(helper).mode;
    if ((mode & 0o111) === 0) {
      chmodSync(helper, mode | 0o755);
      fixed++;
    }
  }
}
if (fixed > 0) console.log(`[fix-node-pty-perms] chmod +x on ${fixed} spawn-helper binar${fixed === 1 ? 'y' : 'ies'}`);
