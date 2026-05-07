const fs = require('node:fs');
const path = 'dist-cli/cli.js';
let text = fs.readFileSync(path, 'utf8');
if (!text.startsWith('#!/usr/bin/env node')) text = '#!/usr/bin/env node\n' + text;
fs.writeFileSync(path, text);
fs.chmodSync(path, 0o755);
