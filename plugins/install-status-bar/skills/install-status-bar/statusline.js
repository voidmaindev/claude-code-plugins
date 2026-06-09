#!/usr/bin/env node
// Claude Code global status line.
// Renders: <folder>  <branch>  <model> [<effort>]  ctx[<bar>]  5h[<bar>]<reset>  7d[<bar>]<reset>
// Input: Claude Code statusLine JSON on stdin.
//
// Theme: the usage bars use a light or dark palette. The active theme is NOT available on
// stdin, so it is resolved (in order) from: the CLAUDE_STATUSLINE_THEME env var, the
// ~/.claude/statusline.theme marker file written by the installer, else 'dark'.

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// --- config ---
const BAR_WIDTH = 13;       // context-usage bar width (odd, so a 3-digit pct centers)
const QUOTA_BAR_WIDTH = 11; // subscription-window bar width (odd, so a 3-digit pct centers)
const FILLED = '█';
const EMPTY = '░';
const WARM_GREEN = '78;145;40'; // RGB for the green fill + chip — a warm, lime-leaning green
const SEP = '  '; // two spaces between leading segments

// --- theme detection ---
function detectTheme() {
  const env = (process.env.CLAUDE_STATUSLINE_THEME || '').trim().toLowerCase();
  if (env === 'light' || env === 'dark') return env;
  try {
    const marker = fs
      .readFileSync(path.join(os.homedir(), '.claude', 'statusline.theme'), 'utf8')
      .trim()
      .toLowerCase();
    if (marker === 'light' || marker === 'dark') return marker;
  } catch { /* no marker file — fall through */ }
  return 'dark';
}
const THEME = detectTheme();

// --- ansi helpers ---
const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const cyan = (s) => c('36', s);
const magenta = (s) => c('35', s);
const yellow = (s) => c('33', s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);

// Severity bucket for a percentage — keys into the active palette below.
function barSeverity(pct) {
  if (pct >= 80) return 'red';
  if (pct >= 50) return 'yellow';
  return 'green';
}

// Per-severity bar styling, split by theme. Each entry defines:
//   block.fill / block.empty : fg color for the █ / ░ track glyphs
//   chip.fill / chip.empty   : [bg, fg] for percentage digits sitting over the filled part
//                              of the bar vs. past the fill point (bg '' = no background)
// Light keeps the original look: a pale chip on a near-white terminal, with the track in the
// bar colour. Dark drops the pale backgrounds (they glare on a dark terminal) in favour of
// plain colour-coded digits over a dim-grey track, with a solid chip only over the fill.
const DARK_TRACK = '38;5;240'; // dim grey for the empty ░ track on a dark terminal
const PALETTES = {
  light: {
    green:  { block: { fill: `38;2;${WARM_GREEN}`, empty: `38;2;${WARM_GREEN}` }, chip: { fill: [`48;2;${WARM_GREEN}`, '97'], empty: ['48;5;156', '30'] } },
    yellow: { block: { fill: '33', empty: '33' },                                 chip: { fill: ['43', '30'],                  empty: ['48;5;229', '30'] } },
    red:    { block: { fill: '31', empty: '31' },                                 chip: { fill: ['41', '97'],                  empty: ['48;5;224', '30'] } },
  },
  dark: {
    green:  { block: { fill: '38;2;124;191;71', empty: DARK_TRACK }, chip: { fill: [`48;2;${WARM_GREEN}`, '231'], empty: ['', '38;2;124;191;71'] } },
    yellow: { block: { fill: '38;5;179',        empty: DARK_TRACK }, chip: { fill: ['48;5;136', '232'],           empty: ['', '38;5;179'] } },
    red:    { block: { fill: '38;5;167',        empty: DARK_TRACK }, chip: { fill: ['48;5;124', '231'],           empty: ['', '38;5;167'] } },
  },
};

// Build an SGR escape from a list of codes, dropping empty ones (so a missing background
// doesn't leave a stray leading ';').
function sgr(codes, s) {
  return `\x1b[${codes.filter(Boolean).join(';')}m${s}\x1b[0m`;
}

// Renders a progress bar with the percentage centered inside it. The label is drawn as a
// chip that follows the fill: cells over the filled part use the solid bar colour, cells
// past the fill point use the theme's "empty" chip so the chip never looks more filled
// than the bar is.
function renderBar(pct, width, sev) {
  const style = PALETTES[THEME][sev];
  const label = `${pct}%`;
  // A label centers exactly only when the bar width shares its parity. The widths are
  // odd, so for even-length labels (1-digit like "9%", or "100%") shrink the bar by one.
  const w = label.length % 2 === 0 ? width - 1 : width;
  const filled = Math.round((pct / 100) * w);
  const start = Math.floor((w - label.length) / 2);
  let cells = '';
  for (let i = 0; i < w; i++) {
    const inLabel = i >= start && i < start + label.length;
    const isFilled = i < filled;
    if (inLabel) {
      const ch = label[i - start];
      const [bg, fg] = isFilled ? style.chip.fill : style.chip.empty;
      cells += sgr([bg, fg, '1'], ch);
    } else {
      cells += c(isFilled ? style.block.fill : style.block.empty, isFilled ? FILLED : EMPTY);
    }
  }
  return `${dim('[')}${cells}${dim(']')}`;
}

function fmtDuration(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return 'now';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d${h}h`;
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

// Renders a subscription window as: <label>[<bar of % used>]<time-to-reset>, matching the
// ctx bar — the bar fills up as the window is consumed and goes red near the cap. Returns
// '' when the window is absent (e.g. non-subscriber, or before first response).
function renderWindow(win, label) {
  if (!win || typeof win.used_percentage !== 'number') return '';
  const used = Math.round(Math.max(0, Math.min(100, win.used_percentage)));
  const bar = renderBar(used, QUOTA_BAR_WIDTH, barSeverity(used));
  let seg = `${dim(label)}${bar}`;
  if (typeof win.resets_at === 'number') {
    const left = fmtDuration(win.resets_at - Math.floor(Date.now() / 1000));
    seg += dim(left);
  }
  return seg;
}

function gitBranch(cwd) {
  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 500,
    }).toString().trim();
    return out && out !== 'HEAD' ? out : '';
  } catch {
    return '';
  }
}

function contextWindowSize(data) {
  const cw = data.context_window || {};
  if (cw.context_window_size) return cw.context_window_size;
  const id = (data.model && data.model.id) || '';
  return /1m/i.test(id) ? 1000000 : 200000;
}

function render(data) {
  const cwd =
    (data.workspace && data.workspace.current_dir) || data.cwd || process.cwd();

  // leading segments: folder + (branch if in a repo)
  const leading = [bold(cyan(path.basename(cwd) || cwd))];
  const branch = gitBranch(cwd);
  if (branch) leading.push(magenta(branch));

  // model + effort  (strip a trailing parenthetical like " (1M context)")
  const rawModel = (data.model && data.model.display_name) || 'Claude';
  const model = rawModel.replace(/\s*\([^)]*\)\s*$/, '');
  const effort = data.effort && data.effort.level;
  let main = cyan(model);
  if (effort) main += `${dim('[')}${yellow(effort)}${dim(']')}`;

  // context bar + tokens
  const cw = data.context_window || {};
  const size = contextWindowSize(data);
  const used = cw.total_input_tokens || 0;
  let pct = cw.used_percentage;
  if (pct == null) pct = size ? (used / size) * 100 : 0;
  pct = Math.max(0, Math.min(100, Math.round(pct)));

  main += `  ${dim('ctx')}${renderBar(pct, BAR_WIDTH, barSeverity(pct))}`;

  const segments = [...leading, main];

  // subscription 5-hour usage window (Pro/Max only; absent until first response)
  const rl = data.rate_limits || {};
  const quota = renderWindow(rl.five_hour, '5h');
  if (quota) segments.push(quota);

  const week = renderWindow(rl.seven_day, '7d');
  if (week) segments.push(week);

  return segments.join(SEP);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(input); } catch { /* defaults */ }
  try { process.stdout.write(render(data)); } catch { process.stdout.write(''); }
});
