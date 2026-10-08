# autoeffort

A mod for Claude Code that sets the effort of every model request by work phase: context gathering, planning, implementation, verification. Effort is set separately for each model step (`turn.step`), in the main thread and in every subagent.

## Phases and levels

| Phase | Marker | Default level |
|---|---|---|
| context gathering | `⟦phase:gather⟧` | `medium` |
| analysis and planning | `⟦phase:plan⟧` | `xhigh` |
| implementation | `⟦phase:implement⟧` | `medium` |
| verification | `⟦phase:verify⟧` | `xhigh` |

Only `medium`, `high`, `xhigh` and `max` are used. `low` is never used: an incoming or computed `low` is raised to `medium` (the `medium` floor).

## How the phase is determined

1. **Marker.** The mod adds an `autoeffort:phase-marker` section to the system prompt: at the start of every response the model declares, with a single marker, what it will do in the next step (`⟦phase:gather|plan|implement|verify⟧`, characters U+27E6 / U+27E7). The marker is stripped from the response stream, even when split across chunks, so it shows up neither on screen nor in the history. A marker that lands in thinking is hidden too, but only a marker in the response text sets the phase. It applies to one next step of its own thread.
2. **Rules**, when there was no marker:
   - first step of a turn → `plan`;
   - several consecutive read-only steps (threshold `readStreak`, 3 by default) → `plan`;
   - only Read, Grep, Glob, LS, WebFetch, WebSearch → `gather`;
   - Edit, MultiEdit, Write, NotebookEdit → `implement`;
   - Bash with a verification command (`verifyPattern`) after an edit in the turn → `verify`;
   - otherwise the phase of the thread's previous step, or `plan` if there is none.

## Skill or agent floor

The session baseline is the `effort` a main-thread step arrives with outside a skill. If a skill (for example, one with `effort: max` in its frontmatter) or a subagent arrives with a different level, that level becomes a lower bound: result = max(phase level, floor). The skill floor is lifted at the end of the main thread's turn.

## Settings

`userConfig` options (change them through `/config` or in `~/.claude/settings.json`). The key in `pluginConfigs` is `autoeffort@autoeffort` for an installed mod and `autoeffort` for one loaded from a local directory:

```json
{
  "pluginConfigs": {
    "autoeffort@autoeffort": {
      "options": {
        "enabled": true,
        "gather": "medium",
        "plan": "xhigh",
        "implement": "medium",
        "verify": "xhigh",
        "readStreak": 3,
        "verifyPattern": "(^|[\\s;&|(])((npm|pnpm|yarn|bun)\\s+(run\\s+)?(test|lint|build|typecheck|check)(?![\\w-])|npx\\s+(jest|vitest|eslint|tsc)\\b|(jest|vitest|pytest|eslint|tsc|mypy|ruff)(\\s|$)|cargo\\s+(check|test|clippy)\\b|go\\s+(test|vet)\\b|make\\s+(test|check|lint)\\b)"
      }
    }
  }
}
```

## Installation

In the Claude Code prompt in the terminal:

```
/plugin install autoeffort --marketplace dmytro-rudenko/autoeffort
```

Then press `y` to add the marketplace, choose the installation scope and go through the options screen. The mod starts working in the same session, no restart needed.

### From a local directory

For development, load the mod from a clone of the repository, one-off:

```sh
git clone https://github.com/dmytro-rudenko/autoeffort.git ~/autoeffort
claude --plugin-dir ~/autoeffort
```

Permanently, through `CLAUDE_CODE_PLUGIN_DIRS` in the `env` of `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/autoeffort" } }
```

## The `/autoeffort` command

- `/autoeffort` — status: enabled or not, the baseline level (`baseline`), the active skill, the phase of each thread and the last 20 decisions as `<thread>#<step> <level> · <phase> (<source>)`, with a floor shown as the suffix ` ↑<label>:<level>`, for example `↑skill:review:max` or `↑agent:max`.
- `/autoeffort on` / `/autoeffort off` — enable or disable without a restart. A disabled mod rewrites nothing and does not add the prompt section.
- `/autoeffort log` — the full decision log of the session: time (ISO), thread, step, level, phase, source, floor and incoming effort.

After each main-thread decision the status line shows `⚙ <level> · <phase> (<source>)`, for example `⚙ high · gather (rule:read) ↑skill`: here the floor is shortened to `↑skill` or `↑agent`, without the skill name and level. A main-thread step without `effort` and `/autoeffort off` both clear the status line.

## Known limitations

1. If the first turn of a session is a skill with its own effort, there is no baseline yet, so its floor is not detected.
2. The skill flag is shared across the whole session: a skill loaded in a subagent marks main-thread decisions in the log as bounded by the skill floor.
3. Changing `enabled` in `/config` after a hot reload takes effect from the next session; to switch right away, use `/autoeffort on|off`.
4. Rules look at past steps, so at a phase boundary one step may get an imprecise level. The marker reduces this but does not eliminate it.
5. Effort is set per model request, not per individual tool.
6. If the engine reports effort as a number (a token budget) rather than a level, the mod cannot detect a skill or agent floor and replaces the number with the phase level.

If the model has no `effort`, or an error occurs in the mod's logic, the request goes through unchanged (fail-open) and the error is written to the log.

## Development

```sh
claude plugin validate .
claude plugin test .
tsc -p .
```

## License

[MIT](LICENSE)
