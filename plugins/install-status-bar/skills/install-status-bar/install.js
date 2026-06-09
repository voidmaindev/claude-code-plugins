#!/usr/bin/env node
// Installs the bundled statusline.js into the user's ~/.claude directory and wires it up
// via the statusLine key in ~/.claude/settings.json. Safe and idempotent: backs up any
// existing files it replaces, preserves every other settings key, and aborts (rather than
// clobbering) if settings.json contains invalid JSON.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const srcScript    = path.join(__dirname, 'statusline.js');
const claudeDir    = path.join(os.homedir(), '.claude');
const destScript   = path.join(claudeDir, 'statusline.js');
const settingsPath = path.join(claudeDir, 'settings.json');

fs.mkdirSync(claudeDir, { recursive: true });

// back up an existing, different statusline.js before overwriting
if (
  fs.existsSync(destScript) &&
  fs.readFileSync(destScript, 'utf8') !== fs.readFileSync(srcScript, 'utf8')
) {
  fs.copyFileSync(destScript, destScript + '.bak');
}
fs.copyFileSync(srcScript, destScript);

// merge statusLine into settings.json, preserving every other key
let settings = {};
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf8');
  if (raw.trim()) {
    try {
      settings = JSON.parse(raw);
    } catch {
      console.error(
        'settings.json is not valid JSON — aborting to avoid clobbering it: ' + settingsPath
      );
      process.exit(1);
    }
  }
  fs.copyFileSync(settingsPath, settingsPath + '.bak');
}

const cmdPath = destScript.replace(/\\/g, '/'); // forward slashes, matches the current config
settings.statusLine = { type: 'command', command: 'node "' + cmdPath + '"', padding: 0 };
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

console.log('Status line installed:');
console.log('  script:   ' + destScript);
console.log('  settings: ' + settingsPath);
console.log('  command:  node "' + cmdPath + '"');
