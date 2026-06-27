import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const failures = [];

function requirePath(label, relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    failures.push(`${label} must be a non-empty path`);
    return;
  }

  const normalized = relativePath.replace(/^\.\//, '');
  const fullPath = path.join(root, normalized);
  if (!fs.existsSync(fullPath)) {
    failures.push(`${label} points at a missing path: ${relativePath}`);
  }
}

function requireAllowlistEntry(entry) {
  if (!Array.isArray(packageJson.files) || !packageJson.files.includes(entry)) {
    failures.push(`files allowlist must include ${entry}`);
  }
}

for (const [name, binPath] of Object.entries(packageJson.bin ?? {})) {
  requirePath(`bin.${name}`, binPath);
}

for (const entry of [
  'dist',
  'dist-cli',
  'fixtures',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'SECURITY.md',
  'CONTRIBUTING.md'
]) {
  requireAllowlistEntry(entry);
}

requirePath('fixtures/contributors.json', 'fixtures/contributors.json');
requirePath('fixtures/projects.json', 'fixtures/projects.json');

if (!packageJson.repository?.url) {
  failures.push('package.json must include repository.url');
}

if (failures.length > 0) {
  console.error('Package manifest validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Package manifest validation passed.');
