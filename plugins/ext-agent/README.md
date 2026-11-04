# ext-agent

A [Claude Code](https://claude.com/claude-code) plugin that lets the **Agent tool dispatch subagents to
pi or [opencode](https://opencode.ai)** instead of a Claude model.

- Adds one agent type, `ext-agent:worker`. Its turns are run by the `pi` or `opencode` CLI; **no Claude model is
  called for their worker turns**. The parent Claude conversation still uses its normal allowance, and external provider usage is billed separately.
- Routes existing registered agent types, including GSD roles, through editable `agentRoutes` configuration.
- Keeps Claude Code's native subagent experience: background runs, `SendMessage` to continue a
  session, `TaskStop`, and the live "Ran 3 commands" view of what the worker is doing.
- Built-in subagents (`general-purpose`, `Explore`, …) keep working. Blocking them is an explicit opt-in.
- Optional git worktree per worker, laid out like Claude Code's own.

It is written with Claude Code's function-hooks plugin API; see `plugins/ext-agent/hooks/register.ts`.

## Requirements

- Claude Code with function hooks (developed against 2.1.285), **and the environment variable
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`** (see below).
- `pi` and/or `opencode` on your `PATH`, already logged in to whatever provider you want them to use.
- `git` if you use worktrees. macOS or Linux (the plugin runs `/bin/sh`); Windows is not supported.

## Install

This fork's routing changes are on `feat/custom-subagent-routing`, not the upstream repository or the fork's default branch. Clone that branch and register the local checkout:

```sh
git clone --branch feat/custom-subagent-routing --single-branch https://github.com/gtirloni/ext-agent.git
cd ext-agent
claude plugin marketplace add .
claude plugin install ext-agent@ext-agent
```

The marketplace still uses the name `ext-agent`. If you already registered upstream under that name, review `claude plugin marketplace list` and replace that registration with this checkout before installing. Keep the checkout available for local marketplace updates. These instructions do not change your installation until you run them.

Then **turn on function hooks and restart Claude Code.** Plugins like this one only load when
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is set where Claude Code starts. Either export it in your shell profile:

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

or put it in the `env` block of `~/.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }
}
```

If it is missing, dispatching `ext-agent:worker` falls back to a small Claude model that only tells you the plugin is
not active; it does not run your task. Custom routed types do not have that fallback warning: without the mod active, their ordinary Claude agent definitions can run natively. Confirm the mod is loaded before relying on external routing.

## Using it

Ask Claude to use it, or call the Agent tool with `subagent_type: "ext-agent:worker"`. The prompt may start with
header lines:

```
model: pi:openai-codex/gpt-6-luna:high
cwd: /path/to/project
worktree: fix-login

Fix the failing login test and run the suite.
```

| Header | Meaning |
| --- | --- |
| `model: pi` / `model: pi:<provider>/<model>[:<thinking>]` | Run `pi`. Bare `pi` lets pi use its own default model. Thinking is `off`, `minimal`, `low`, `medium`, `high` or `xhigh`. |
| `model: opencode` / `model: opencode:<provider/model>[#variant]` | Run `opencode`. The model must appear in `opencode models`. |
| `cwd: <absolute path>` | Directory to work in. Default: the session's directory. |
| `worktree: <name>` | Work in a git worktree of that name, made or reused. The Agent call's `isolation: "worktree"` does the same. |

For configured custom routes, the external session is keyed by Claude's agent ID. Send a follow-up to that same agent to continue; a newly spawned agent gets a separate session even if it has the same name. The legacy `ext-agent:worker` uses its name when available, otherwise its ID. Avoid named teammate dispatches: those can start separate Claude processes where this mod does not take over. A successful external answer ends with `— answered by pi|opencode, <model>`.

Run it in the background with the Agent tool's `run_in_background`, as with any subagent.

> **Permissions.** pi and opencode have their own read / bash / edit / write tools and run them **without Claude
> Code's permission prompts** (opencode with `--auto`). A worker can change files and run commands in its directory.
> Use a worktree, or a directory you are happy for it to edit.

## Configuration

Set these in Claude Code's plugin config menu (each option is a row there), or in `settings.json` under
`pluginConfigs`, keyed by the plugin id (`ext-agent@ext-agent` for the install above). Finish active workers before editing configuration and start a new Claude Code session afterward.

| Option | Default | |
| --- | --- | --- |
| `blockBuiltin` | `false` | `false`: `ext-agent:worker` is added next to the built-in agent types. `true`: only `ext-agent:worker` and configured custom routes can be dispatched; built-in types are hidden from the model and refused with a message saying how to dispatch instead. |
| `defaultModel` | `pi` | Used by legacy `ext-agent:worker` when its call names no `model:`. Custom routes use their configured runtime/model instead. Same syntax as the header, e.g. `pi:openai-codex/gpt-6-luna:high`. |
| `worktreeLayout` | `claude` | `claude`: `<repo>/.claude/worktrees/<name>` on branch `worktree-<name>`, as Claude Code does; a new branch starts from the remote's default branch, or from the current `HEAD` if the `worktree.baseRef` setting is `head`. `sibling`: `<repo>-wt/<name>` beside the repo on branch `wip/<name>`, off `worktreeBase` or `main`. An unavailable base falls back to the current HEAD. |
| `agentRoutes` | `"{}"` | JSON string mapping exact agent types to `{runtime, model?, instructionsFile}`; see the GSD example below. |
| `stallMinutes` | `15` | Stop an external worker after this many minutes without output while no tool is active; `0` disables this check. |
| `toolStallMinutes` | `45` | The equivalent no-output limit while a tool is active; `0` disables this check. |
| `worktreeBase` | `""` | Sibling-layout starting branch; empty means `main`. If the chosen base cannot be resolved, git uses the current HEAD. |
| `worktreeSeed` | `""` | Optional program and arguments run inside each created/reused worktree. Split on whitespace, not parsed as shell syntax. Nonzero exit status is ignored. |

An existing worktree or branch of the same name is reused, not recreated.

Example, blocking built-in agents and using a fixed pi model:

```json
{
  "pluginConfigs": {
    "ext-agent@ext-agent": {
      "options": { "blockBuiltin": true, "defaultModel": "pi:openai-codex/gpt-6-luna:high" }
    }
  }
}
```

## Route existing agents (including GSD)

Configure `agentRoutes` in the plugin's options. Its value is a JSON **string** mapping exact registered `subagent_type` names to an external runtime, optional model, and role instructions file. For example, paste this into the **Custom agent routes (JSON)** option:

```json
{
  "gsd-executor": {
    "runtime": "opencode",
    "model": "PROVIDER/MODEL",
    "instructionsFile": "~/.claude/agents/gsd-executor.md"
  },
  "gsd-verifier": {
    "runtime": "pi",
    "instructionsFile": "~/.claude/agents/gsd-verifier.md"
  }
}
```

Replace `PROVIDER/MODEL` with an installed runtime's model identifier (`opencode models` lists OpenCode's). Omit `model` to use that runtime's default. Authenticate and configure providers in Pi/OpenCode themselves; this mod does not manage credentials.

For direct editing of Claude Code's `settings.json`, this smaller example routes only the executor and stores the option as an escaped string:

```json
{
  "pluginConfigs": {
    "ext-agent@ext-agent": {
      "options": {
        "blockBuiltin": false,
        "agentRoutes": "{\"gsd-executor\":{\"runtime\":\"opencode\",\"model\":\"PROVIDER/MODEL\",\"instructionsFile\":\"~/.claude/agents/gsd-executor.md\"}}"
      }
    }
  }
}
```

No GSD workflow changes are needed: `Agent(subagent_type="gsd-executor", model="sonnet", ...)` keeps its original type, but the route takes precedence over the requested Claude model. Unlisted types, such as `gsd-planner`, stay native with `blockBuiltin: false`. With `blockBuiltin: true`, only routed types and `ext-agent:worker` are allowed. The custom agent must already be registered in Claude Code; this option does not create agent definitions.

`instructionsFile` explicitly identifies the role body to send with the task. Use an absolute path or `~/...` and point it at the actual agent definition used by your GSD installation. YAML frontmatter is stripped. Claude-specific frontmatter settings, tool restrictions, skills and MCP configuration are **not** translated into Pi/OpenCode settings; configure equivalent capabilities in the external runtime. The role text is supplied as task context alongside that runtime's own system prompt, not as a replacement system prompt.

Edit the option to change models or add/remove routes; no plugin code edits are required. Finish active workers before changing configuration, then start a new Claude Code session. Within a loaded plugin instance, follow-up messages keep the worker's bound model and role text and reuse its external session.

Invalid route configuration blocks Agent dispatch with a diagnostic until fixed. Missing/empty role files, startup errors and unsuccessful external runs report errors; they do not retry with Claude or another provider. The permissions and worktree behavior described in this README still apply. Route matching is exact and case-sensitive; wildcards are unsupported. `fork` and `ext-agent:worker` cannot be custom route keys. Unknown fields are rejected.

## How it works

The plugin hooks the Agent tool and the worker's model loop:

- When a worker takes a turn, the plugin starts `pi -p --mode json` (or `opencode run --format json`) in the worker's
  directory, in its own process group so `TaskStop` or an interrupt takes down everything the CLI started.
- Each tool call the CLI makes is replayed as one of the worker's own tool calls (`Bash`, `Read`, `Write`, `Edit`)
  answered with what the CLI already got, so Claude Code's subagent view shows it like any other agent's activity.
  The transcript keeps at most 1500 characters of each result.
- The CLI's final text becomes the worker's answer.
- A long worker's transcript would eventually pass the context window and end the agent with "Prompt is too long", so
  when Claude Code compacts a worker, the plugin drops the middle of the transcript itself (keeping the task and the
  last 80 messages) without asking any model. The full history stays in pi's / opencode's own session.

## What it sends, runs and decides

**Network.** The plugin itself makes no network calls and sends nothing anywhere. The `pi` / `opencode` process it
starts receives the task prompt (your header lines stripped) plus the configured role body for routed agents and reads and writes files in the worker's directory;
what that process sends to its model provider is up to its own configuration, not this plugin. For an opencode model,
the plugin runs `opencode models` once to check the name.

**What it reads.** For each worker turn the plugin reads that worker's *own* transcript (`$.session.messages({ agentId })`),
not the main conversation, to find the newest task message and its `model:` / `cwd:` / `worktree:` header lines. It
strips `<system-reminder>` blocks and hands the task text, plus the configured role body for routed agents, to the `pi` / `opencode` process as its prompt. When a
worker is compacted (`session.compact`), it reads that worker's transcript to drop the middle of it. It reads Claude
Code's merged settings only for the `worktree.baseRef` value, and the plugin's own options. For custom routes it reads `instructionsFile` before dispatch and when first binding the worker, strips YAML frontmatter, and retains the body for follow-ups. It reads `HOME` to expand `~/` paths. The external CLI reads and writes project files; the supervisor also writes worker logs described below.

**Programs it runs.** Everything goes through two Claude Code calls: `$.process.run(argv)` starts a program with the
given argument list, waits for it to finish and returns its output (used for the short `git`, `test` and
`opencode models` commands below); `$.process.spawn({ argv })` starts a program with the given argument list and
streams its output while it runs (used only for the `pi` / `opencode` agent process, wrapped in the fixed `/bin/sh`
script below). Neither call is given a shell string built from your input. The argument lists are assembled in
`hooks/register.ts` from fixed program names plus the values you pass (model, directory, prompt), each as its own
argument; the table summarizes command shapes:

| Program | Why |
| --- | --- |
| `pi` or `opencode` | The agent itself: `pi -p --mode json [--model <m>] --session-id <key> <prompt>`, or `opencode run --standalone --auto --format json [--model <m>] --title <key> [--session <id>] <prompt>`. |
| `opencode models`, `opencode session list --standalone --format json` | Validate an opencode model name; find the opencode session of a worker being continued. |
| `/bin/sh` | A fixed wrapper `cd "$1" && shift; set -m; "$@" & …` that changes into the worker's directory and runs the CLI in its own process group, so `TaskStop` or an interrupt stops everything the CLI started. The directory and the CLI's arguments are passed as separate arguments, not spliced into the script. |
| `/bin/sh` (second use) | The fixed text `cd "$1" && exec opencode session list --standalone --format json`, with the worker's directory as `$1`, to list opencode sessions from that directory. |
| `test -d <cwd>` | Check the `cwd:` header names a directory. |
| `git rev-parse`, `git worktree list`, `git worktree prune`, `git symbolic-ref`, `git worktree add` | Only for `worktree:` / `isolation: "worktree"`: find the repo, reuse or create the worktree and its branch. |

The supervisor additionally runs logging utilities (`mkdir`, `dirname`, `date`, `tail`) and shell job-control commands. If configured, `worktreeSeed` runs its program through a fixed shell wrapper in the worktree. It also reads Claude Code's merged settings when selecting a new Claude-layout worktree base.

**Hooks and what they decide.**

| Hook | What it decides, and when |
| --- | --- |
| `agent.offer` | Only with `blockBuiltin`: keeps configured route types and plugin-provided types visible; hides other agents. |
| `tool.describe` (Agent) | Describes the legacy worker, lists configured route types, and explains that routes override model selection. |
| `turn.step` | On the main conversation, normalizes external Agent model arguments into prompt headers before schema validation; configured routes override the requested model. On routed/legacy worker loops, runs the external CLI and returns its report. Native worker loops pass through. |
| `tool.call` (Agent) | Rejects invalid routing configuration. For routed types, validates the role file and external model and normalizes prompt headers. For all external workers, translates `isolation: "worktree"` into a worktree header. Unlisted types pass through unless `blockBuiltin` is enabled. |
| `tool.call` (the worker's own `Bash`, `Read`, `Write`, `Edit`) | Stands in for these tools **only for calls this plugin itself created** to mirror what pi / opencode already did: it waits for the CLI's result and returns it. Any other tool call, from any agent, passes to the next hook unchanged. |
| `session.compact` | Only for a worker's own transcript: drops the middle of it without asking a model (see How it works). Any other compaction passes through unchanged. |

The plugin never answers a permission check: Claude Code's own permission rules decide for everything it does not
create. The mirrored `Bash`/`Read`/`Write`/`Edit` calls are answered from the CLI's output and execute nothing in
Claude Code.

**Tool input it changes:** the Agent tool's `model`, `prompt` headers and `isolation` fields described above; `subagent_type` is preserved.

## Limits

- Only the Claude Code side is managed. pi and opencode have their own context limits and compaction; a very long
  worker session can be rejected by the provider ("Bad Request"). Spawn a new routed agent for a fresh session; legacy workers use a new name or ID.
- The model you name must be one your pi / opencode is set up to use.
- The worker's tool calls in the subagent view are a summary: long file contents and diffs are clipped.

## Troubleshooting

- *The agent answers "ext-agent is not active"*: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is not set where Claude Code
  started, or Claude Code was not restarted after you set it.
- *"Unknown opencode model"*: the name is not in `opencode models`.
- *"ended without an answer"*: the CLI exited without a successful reply (a nonzero exit is an error even if it emitted partial text); the message includes its error or last stderr lines
  (often an authentication or provider error).
- *A GSD agent still runs natively*: confirm the mod is loaded, `agentRoutes` uses the exact registered `subagent_type`, and the dispatch is not a separate named teammate. An unlisted type intentionally stays native.
- *"invalid agentRoutes"*: correct JSON syntax or unsupported fields; all Agent dispatch is blocked until fixed.
- *Missing or empty role instructions*: point `instructionsFile` at the installed role file, using an absolute or `~/` path, and confirm its body is readable and nonempty.
- Check the plugin loads: `claude plugin validate plugins/ext-agent`.
- *The result says the subagent "ended without delivering a report through SubagentHandback"*: check that the updated plugin is loaded and restart Claude Code; the agent may lack the handback tool. In auto mode the engine only accepts a report through that tool, so a worker's last step calls it for the CLI, then ends with the same text for runs that do not have the tool.
- *The agent answers "ext-agent is not active" although the variable is set*: check whether the dispatch named the agent (`name`) and started a separate teammate process where this plugin does not take over. Leave `name` out.

## License

MIT

## Stall watchdog

A worker whose `pi` / `opencode` process prints nothing for `stallMinutes` (default 15) while no tool call is running, or
for `toolStallMinutes` (default 45) while one has started and not finished, is stopped. The Agent call then answers
`ext-agent: stopped pi (...): no output for N minutes, waiting for ...`, so the dispatcher hears about it instead of
waiting for hours. `0` turns a limit off. pi's OSC 7501 status reports exist only in its interactive mode; the plugin
runs `pi -p --mode json`, so it reads the event stream instead.

## Worktree base and seed

`worktreeBase` (sibling layout) names the branch a new worktree starts from instead of `main`. `worktreeSeed` is a
program with arguments that runs inside every worktree the plugin makes or reuses, so a project can give each worker a
warm build cache (for example a copy-on-write clone of a shared cargo target directory). It must be safe to run again;
a nonzero exit status is ignored.

## Worker logs

Each run appends the CLI's stderr, its start line and how it ended (exit code, or a signal sent to the
supervisor) to `~/.claude/state/ext-agent/<session key>.log`, where the key is `ext-<agent ID>` for configured routes and `ext-<agent name or ID>` for legacy workers. Characters outside letters, digits, underscores and hyphens are replaced with hyphens. If `HOME` is absent, the supervisor uses `/tmp` as its base.
Read it when a worker ends without an answer.

## Development checks

From the repository root, run:

```sh
node --test tests/routing.test.ts
claude plugin validate plugins/ext-agent
git diff --check
```

The tests require Node.js 22.18+ and mock the mod engine and subprocess events; they do not call model providers. They cover route validation, native pass-through, role transfer, worktree delegation, Pi/OpenCode failure reporting, startup/stream exceptions, follow-ups, streamed arguments and legacy worker compatibility. Plugin validation is not a live runtime test.

Before relying on this fork, perform a live smoke test in a disposable project with authenticated Pi/OpenCode: route a registered role, dispatch it through Agent without a teammate name, confirm its external-provider report and role-specific output, send a follow-up, and confirm an unlisted planner remains native. Test a deliberately unavailable external model and verify that an error reaches the caller without provider fallback. This live Claude Code + GSD test has not yet been performed for this branch.

Keep the root and packaged READMEs synchronized when changing behavior.
