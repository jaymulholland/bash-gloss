# Summary quality tests

Runs a corpus of tool calls (`cases.json`, ~50 across shell, git, network, destructive,
PowerShell, scripts, agents, MCP, edits, adversarial) through Ollama with the same prompt,
options and program-derived facts as `hooks/register.tsx`, and logs what the model said.

```
node tests/run.mjs --model open-field:latest                 # full run
node tests/run.mjs --model nemo:latest --runs 3              # repeat for consistency
node tests/run.mjs --model open-field:latest --only '^net-'  # subset by id regex
node tests/run.mjs --model open-field:latest --cat opaque    # subset by category
node tests/run.mjs --model open-field:latest --judge nemotron-nano-64k:latest   # advisory LLM grades
```

Outputs, in `tests/logs/` (git-ignored): a `.jsonl` log (one record per call: raw model
text, the text the user would see, checks, latency) and a `.md` review sheet.

## Automatic checks (a floor, not a verdict)

| check | meaning |
|---|---|
| format | exactly `DOES:` and `TOUCHES:` lines, no markdown, no echoed command |
| specific | the `mustMention` regexes (real file names, values, verbs) appear |
| touchesRight | the `touches` regexes appear in the TOUCHES line (catches invented paths) |
| notVague | no "runs a command", "various files", "as specified" |
| noContradiction | does not claim a change on a read-only command, or network use when facts say none |
| notRestatement | not mostly a token-for-token copy of the command |
| noBadClaims | none of the `mustNotMention` patterns appear: wrong claims seen in real runs ("sorted by name", "weekly"), invented effects for unknown commands, obeying injected text |
| factsClassified | `shellFacts` tagged the command as the case author expects (tests the classifier) |

## Human grading

Open the `.md` sheet and grade each item A (accurate), S (specific), U (useful) 1-3.
Suggested bar: no accuracy 1s, mean S and U >= 2.5. Regex checks cannot tell a correct
summary from a plausible wrong one, so accuracy needs eyes. `--judge` adds a small-model
score for triage only.

## Adding cases

Add an object to `cases.json`: `id`, `cat`, `tool`, `command` (or `input`), `mustMention`
and `touches` (regex alternations), optional `facts` (`read-only`, `changes files`,
`network`), `script` (`{path, content}` to simulate a script the command runs), `notes`.
