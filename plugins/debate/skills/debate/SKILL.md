---
name: debate
description: Debate any idea between two isolated agents — an Advocate and a Critic relayed by the main session — and publish an HTML report with a verdict, pros & cons, and the full transcript
user-invocable: true
argument-hint: "<idea | @file> [--rounds N] [--points N] [--interactive]"
---

Run a moderated debate about an idea the user gives you — a one-line feature, a whole product, anything at all. Two subagents with **separate contexts** argue it: the **Advocate** (`debate-advocate`) is always for the idea and the **Critic** (`debate-critic`) is always against it. They never talk to each other — **you are the moderator**: every message passes through you and is relayed verbatim. Both sides keep their stance but are honest about individual points: a strong argument gets conceded, not nitpicked. When the rounds are done you judge the ledger, write the verdict, and produce an HTML report (idea → conclusion → pros & cons → full transcript), published as an Artifact and saved locally.

**Config file:** `~/.debate_config` (simple `key=value` format, created on first run with the defaults below)

**Constants (hardcoded):**
- **Settings** — precedence: CLI flag > `~/.debate_config` > default:
  - `rounds` — default `5`. One round = one Critic turn followed by one Advocate turn. Round 1 is the opening; closing statements are not a round. Flag: `--rounds N`.
  - `points` — default `4`. Target number of new points per side per turn. It is a **suggestion, not a quota**: a side gives fewer when it only has fewer strong ones and more when it genuinely has more — never padded, never truncated. Flag: `--points N`.
  - `interactive` — default `false`. Pause after every round so the user can continue, inject a note, or stop. Flag: `--interactive`.
  - `output_dir` — default empty. Empty means `<repo_root>/.claude/debates/` inside a git repo, else `~/.claude/debates/`. A non-empty value is used as given.
- **Agents:** `debate-critic` and `debate-advocate`, shipped with this plugin — spawn with the Agent tool (`subagent_type`), continue with SendMessage. Display names everywhere: **Critic** and **Advocate**.
- **Tools this skill uses:** Agent (spawn a debater), SendMessage (continue a debater — if it is not loaded, load it first with ToolSearch `select:SendMessage`), AskUserQuestion (gates), Artifact (publish).
- **Lookup cap:** each debater may use at most 2 tool lookups per turn (fixed, not a setting; the agent definitions enforce it — repeat it in every prompt anyway).
- **Report template:** `$CLAUDE_SKILL_DIR/report.html` (bash) / `$env:CLAUDE_SKILL_DIR\report.html` (PowerShell). It is design-complete: fill its placeholders, never restyle it at runtime. The markup contract for every placeholder is the comment at the top of the template. The report is **light by default**; it turns dark only when a host stamps `data-theme="dark"` on the root (e.g. the Artifact viewer's explicit dark setting) — never from the OS preference.
- **Report file name:** `<YYYY-MM-DD>-<slug>.html` — `<slug>` = first ≤6 words of the idea, lower-case ASCII kebab-case, ≤40 chars. If the file already exists, append `-2`, `-3`, ….
- **Point IDs:** `R<round>-C<n>` for Critic objections, `R<round>-P<n>` for Advocate pro arguments — `<round>` is the round the point was first raised in, `<n>` restarts at 1 every round (`R1-C1, R1-C2 … R2-C1 …`). IDs are always written in full (`R2-C1`, never `C1`), so every ID is unique and shows its round at a glance; never renumbered, never reused. Objections carry `severity: blocker|major|minor`; pro arguments carry `weight: decisive|major|minor`.
- **Response verbs:** the other side answers a point with `CONCEDE` / `PARTIAL` / `REBUT`; the owner replies to a `REBUT` or `PARTIAL` with `ACCEPT` / `DEFEND`; the other side replies to a `DEFEND` with `ACCEPT` / `HOLD`. That is the whole thread — at most three exchanges per point; nothing is argued past a `HOLD`.
- **Ledger statuses:** `open` (awaiting an answer) → exactly one of `conceded` (the other side conceded it — the strongest outcome), `stands` (owner defended, other side accepted the defence), `narrowed` (owner accepted a `PARTIAL`; record the narrowed wording), `contested` (a defence met a `HOLD`, or the thread was still open at the end), `withdrawn` (owner accepted a rebuttal).
- **Verdict scale:** `Go` · `Go with conditions` · `Rethink` · `No-go`, with confidence `low` / `medium` / `high`.
- **Early stop:** (a) a `blocker` objection reaches `conceded` or `stands` → stop, reason `blocker accepted`; (b) a full round in which neither side raised a new point and no thread is `open` → stop, reason `converged`.

**Procedure:**

1. **Parse `$ARGUMENTS`:**
   - Extract `--rounds N`, `--points N` (positive integers) and `--interactive`, then remove them. What remains is the idea.
   - If the idea starts with `@`, read that file and use its contents as the idea.
   - If nothing remains, STOP: `"What idea should be debated? Pass it as text or @file."`
   - Keep the idea **verbatim** as `<idea>`; derive `<slug>` from it.

2. **Load or create config:**
   - If `~/.debate_config` exists, read it (`key=value` lines; `#` comments allowed; unknown keys ignored; an invalid number falls back to the default).
   - If it does NOT exist (first run), write it with the defaults:
     ```
     rounds=5
     points=4
     interactive=false
     output_dir=
     ```
     and tell the user once: `"Created ~/.debate_config — edit it anytime to change the defaults."`
   - Resolve `<rounds>`, `<points>`, `<interactive>`, `<output_dir>` by precedence (flag > config > default).

3. **Resolve the output directory:**
   - `<output_dir>` non-empty → use it as given.
   - Else, if `git rev-parse --show-toplevel` succeeds → `<repo_root>/.claude/debates/`.
   - Else → `~/.claude/debates/`.
   - Create it if missing. **Never** add anything to `.gitignore`.

4. **Write the brief:**
   - Decide whether the idea can be debated meaningfully as given. It is under-specified only when the target user, the scope, or the core mechanism cannot even be assumed sensibly (e.g. just `"a new browser"`). In that case ask **at most 3** questions in a single AskUserQuestion call (the user can type free text via *Other*); otherwise ask nothing.
   - Compose `<brief>`:
     ```
     # Brief
     ## Idea (verbatim)
     <idea>
     ## Restatement
     <2–4 neutral sentences — no evaluation>
     ## Assumptions
     - <what both sides must argue under; include the user's answers>
     ## Context
     - <repo root, stack, relevant facts — only when the idea concerns the current project; otherwise "none">
     ## Format of this debate
     - <rounds> rounds; ~<points> new points per turn (a target, not a quota); at most 2 tool lookups per turn.
     - Language: <language of the idea>.
     ```
   - Print the brief, then start. Do not ask for approval of the brief.

5. **Round 1 — Critic opens:**
   - `Agent(subagent_type: "debate-critic", name: "critic-<slug>")` with the prompt:
     ```
     OPENING TURN — Round 1 of <rounds>.
     <brief>
     Give your objections now: target ~<points>, fewer if you only have fewer strong ones, more if you genuinely have more. Name them R1-C1, R1-C2, …. Use your opening-turn format.
     ```
   - Wait for the completion notification. **Never** write a side's turn yourself.
   - Record the message **verbatim** in `<transcript>` (round, side, text). Add every `C` point to `<ledger>` as `open`.
   - Print one progress line, e.g. `R1 Critic: raised R1-C1…R1-C4 (1 blocker, 2 major, 1 minor)`.

6. **Round 1 — Advocate answers:**
   - `Agent(subagent_type: "debate-advocate", name: "advocate-<slug>")` with the prompt:
     ```
     OPENING TURN — Round 1 of <rounds>.
     <brief>
     The Critic's opening, verbatim:
     <Critic's message>
     --- Moderator ---
     Answer every objection (CONCEDE / PARTIAL / REBUT), then give your independent pro arguments: target ~<points>, fewer if you only have fewer strong ones, more if you genuinely have more. Name them R1-P1, R1-P2, …. Use your opening-turn format.
     ```
   - Wait; record verbatim; update `<ledger>` (each `C` → `conceded`, or stays `open` with the Advocate's `REBUT`/`PARTIAL` noted; each new `P` → `open`).
   - Progress line, e.g. `R1 Advocate: conceded R1-C2 · partial R1-C4 · rebutted R1-C1, R1-C3 · raised R1-P1…R1-P3 (1 decisive)`.

7. **Rounds 2 … `<rounds>`** — for each round `k`:
   - **Critic's turn.** `SendMessage(to: "critic-<slug>")` with:
     ```
     Round <k> of <rounds>. The Advocate's message, verbatim:
     <Advocate's last message>
     --- Moderator ---
     Respond to: <built from the ledger — for each Critic point the Advocate answered with REBUT/PARTIAL: "R1-C3 (Advocate: REBUT) → ACCEPT or DEFEND"; for each Advocate point the Critic rebutted and the Advocate DEFENDed: "R1-P1 (Advocate: DEFEND) → ACCEPT or HOLD"; for the Advocate's new points: "R2-P1, R2-P2 → CONCEDE / PARTIAL / REBUT">
     Closed — do not reopen: <IDs with statuses, or "none yet">
     New objections: target ~<points>, only genuinely new — name them R<k>-C1, R<k>-C2, …; "none" is fine.
     User note: <text>   ← this line only when the user injected one
     ```
     Wait; record verbatim; update `<ledger>`; progress line.
   - **Advocate's turn.** The same, mirrored: the Critic's message verbatim plus the Advocate's to-do list, closed list, and new-points target.
   - **Ledger update rules:** `CONCEDE` → `conceded`. `REBUT`/`PARTIAL` → stays `open`, awaiting the owner. Owner `ACCEPT` after `REBUT` → `withdrawn`; owner `ACCEPT` after `PARTIAL` → `narrowed`; owner `DEFEND` → stays `open`, awaiting the other side. Other side `ACCEPT` → `stands`; other side `HOLD` → `contested`. A required response a side omitted: ask for it once more in the next Moderator block; if it is omitted again, close that thread as `contested`.
   - **Early stop check** after the Advocate's turn (see Constants). On a stop, print `Stopping after round <k>: <reason>` and go to step 8.
   - **Interactive pause** (only when `<interactive>`): AskUserQuestion `"Round <k> of <rounds> done — continue? (Choose Other to type a note both sides will receive before the next round.)"` with options **Continue** (`"Run round <k+1>"`) and **Stop and summarize** (`"Skip the remaining rounds; closing statements and report now"`). Free text → it is the user note for the next round's Moderator blocks and is recorded in `<transcript>` as **User**; then continue.
   - **Lost agent:** if SendMessage fails because the agent no longer exists, re-spawn it with the same `subagent_type`, the name suffixed `-r`, and a prompt containing `<brief>`, the full `<transcript>` so far and `"You are resuming as the <side>. Your earlier points are the R<n>-C (or R<n>-P) IDs above; continue from the ledger state."` — then resend the turn.
   - **Format slip:** if a reply ignores the fixed format, send one `--- Moderator ---` reminder asking for it in the fixed format; if the second reply still slips, use it as is.

8. **Closing statements** — Critic first, then Advocate, each via SendMessage:
   ```
   CLOSING TURN. Final ledger:
   <every point: ID · title · status · one-line resolution>
   Write your closing statement in the fixed format. Raise nothing new.
   ```
   Record both verbatim. This step also runs after an early stop.

9. **Judge the ledger** (you, the moderator — never the debaters):
   - Close every thread still `open` as `contested`.
   - **Pros** = `P` points with status `conceded` / `stands` / `narrowed` / `contested`, in that order, then by weight. **Cons** = `C` points likewise, then by severity. **Withdrawn** = every `withdrawn` point on either side.
   - Write `<conclusion>`: verdict and confidence; one sentence naming the single reason that decided it (`<verdict_line>`); 2–4 sentences of reasoning; the decisive point IDs; a condition or mitigation for every con that is `conceded` or `stands`; the open questions the user must settle before committing (mostly the `contested` threads).
   - Weighing: a `blocker` that is `conceded` or `stands` → `No-go`; a `blocker` that is `contested` → at best `Rethink`; `Go` only when no `major` con is `conceded`/`stands` without a concrete mitigation. The number of points is irrelevant — status, severity and weight are what count.
   - Compute the scoreboard from the ledger: pros and cons standing (the sizes of the Pros/Cons lists) and raised in total; pros conceded by the Critic; cons conceded by the Advocate; contested and withdrawn counts; rounds run of `<rounds>` with a stop label (`completed`, `stopped early: converged`, `stopped early: blocker accepted`, `stopped by user`); and, per round, objections raised, pros raised, concessions and withdrawals for the timeline.

10. **Render the report:**
    - Read the template. Drop its leading `<!-- … -->` documentation comment (the output starts at `<title>`), then replace every `{{PLACEHOLDER}}` exactly as that comment specifies — the verdict banner, the scoreboard numbers (plain integers; they also drive the balance bar), the round timeline, one card per argument, and the transcript as speech cards: escape `<`, `>`, `&` in verbatim text; render the debaters' Markdown into the documented markup; give every point card `id="R1-C3"` / `id="R2-P1"` so the argument cards can link to it. Nothing outside the placeholders changes.
    - Write the filled fragment to `<scratchpad>/debate-<slug>.html` (the session's scratchpad directory, or the OS temp dir if there is none) — this copy is for publishing.
    - Write the local copy to `<output_dir>/<YYYY-MM-DD>-<slug>.html` as a full document: `<!doctype html><html lang="<lang>"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`, then everything above the template's `<!-- head-end -->` marker, then `</head><body>`, then everything below the marker, then `</body></html>`.

11. **Publish:** `Artifact(file_path: <scratchpad fragment>, favicon: "⚖️", title: <TITLE — the short idea name>, description: "<verdict> — <one-line reason>")`. If the tool is unavailable or fails, say so and continue; the local file is the deliverable either way.

12. **Open the report** — launch the local copy in the default browser with the command that matches the current OS/shell:
    - Windows PowerShell: `Start-Process "<output_dir>\<file>"`
    - Windows Git Bash: `cmd //c start "" "<output_dir>\<file>"` (Windows-style path)
    - macOS: `open "<output_dir>/<file>"`
    - Linux: `xdg-open "<output_dir>/<file>"`
    If the command fails (no browser, headless session), do not stop — the path is in the summary anyway.

13. **Final summary** — print:
    - Verdict + confidence, and one sentence why.
    - Top 3 pros and top 3 cons (ID · title · status).
    - Rounds run of `<rounds>` (with the stop reason if early), points withdrawn, threads contested.
    - The local file path (and whether it was opened) and the Artifact URL (or why there is none).

**Rules:**
- **NEVER** let the debaters talk to each other — every message goes through you.
- **NEVER** alter, summarize, soften, or reorder a debater's message when relaying it or recording it in the transcript — verbatim, plus a clearly marked `--- Moderator ---` block of your own.
- **NEVER** write a turn on a debater's behalf, and **NEVER** continue before the agent's completion notification has arrived.
- **NEVER** let the Critic argue for the idea or the Advocate against it; if a reply does, send one reminder and strike the offending point from the ledger.
- **NEVER** reopen a closed point, pad to reach `points`, or argue a thread past a `HOLD`.
- **NEVER** touch `.gitignore`, commit, or push anything.
- **NEVER** run this skill in a forked context (`context: fork`) — the moderator must keep the ledger and transcript in the main session.
- **NEVER** restyle the report template at runtime — placeholders only.
- **ALWAYS** print one progress line after every turn.
- **ALWAYS** produce the report, even after an early stop or a failure mid-debate (mark it partial and say what is missing).
- **ALWAYS** open the local report in the browser when the run finishes; if that fails, print the path and move on.
- **ALWAYS** write point IDs in full (`R2-C1`, never `C1`), keep them stable, and carry the `Closed — do not reopen` list in every Moderator block.
- **ALWAYS** debate in the language of the idea and write the report in it too.
- **ALWAYS** create `~/.debate_config` on the first run and tell the user once.

$ARGUMENTS
