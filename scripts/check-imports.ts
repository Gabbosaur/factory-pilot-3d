/**
 * Guard: client-side code (modules/**, shared/**, app components) must never import server/**,
 * so API keys can't leak into the browser bundle. Only app/api/** and scripts/** may import server/**.
 * Run with: npm run check:imports
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const CHECKED_DIRS = ['modules', 'shared', 'app'];
const ALLOWED_PREFIXES = ['app/api/'];
const SERVER_IMPORT = /from\s+['"](@\/server\/|(\.\.\/)+server\/)/;

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const violations: string[] = [];
for (const d of CHECKED_DIRS) {
  for (const file of walk(join(ROOT, d))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (SERVER_IMPORT.test(line)) violations.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
  }
}

if (violations.length) {
  console.error('Forbidden server/** imports from client code:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('check:imports OK');
