# bash-gloss

A Claude Code mod that adds a plain-English gloss under every Bash tool call, so
cryptic one-liners (`sed -i 's/.../.../' $f`) tell you what they do and what they
touch. The gloss is written by a model running locally in [Ollama](https://ollama.com),
so it costs no Claude tokens: the mod sends the command to your own machine and
draws the reply on screen. Claude never sees it.

```
Bash  f=src/app.tsx && sed -i 's/oldName(/newName(/g' $f
  ↳ DOES: Renames the function oldName to newName throughout the file
    TOUCHES: src/app.tsx
```

## Requirements

- [Ollama](https://ollama.com) running locally (default `http://127.0.0.1:11434`)
- A model pulled in Ollama. A small one is plenty: `ollama pull nemotron-3-nano:4b`

## Install

Replace `<owner>/<repo>` with this repository's GitHub path.

### For humans

1. Install Ollama and pull a model: `ollama pull nemotron-3-nano:4b`. Check it is
   running with `ollama list`.
2. Add the plugin. Pick one:
   - **Terminal session**, at the Claude Code prompt:
     ```
     /plugin install bash-gloss --marketplace <owner>/<repo>
     ```
     Answer `y` to add the marketplace, then choose the **user** scope so every session
     loads it.
   - **Any shell** (also works when you use Claude Code through VS Code):
     ```
     claude plugin install bash-gloss --marketplace <owner>/<repo> --scope user
     ```
   - **Desktop app**, where `/plugin` does not run: click **+** next to the prompt box,
     then **Plugins**, **Add marketplace** with `<owner>/<repo>`, then **Add plugin**.
3. Start a new session and run any Bash command of 25 or more characters. A dim `↳` line
   should appear under it within a few seconds.

If the model name differs on your machine, open `/config` and change **Ollama model**.

### For agents

Do these in order and stop on the first failure, telling the user what failed.

1. Check Ollama: `curl -s http://127.0.0.1:11434/api/tags` must return JSON. If it does
   not, tell the user Ollama is not running. Do not install Ollama for them.
2. Pick a model from the `name` fields in that JSON. If the user has none, ask which to
   pull. Do not pull a large model without asking.
3. Install: `claude plugin install bash-gloss --marketplace <owner>/<repo> --scope user`.
   Add the marketplace first with `claude plugin marketplace add <owner>/<repo>` if the
   command says it is unknown.
4. If the chosen model is not `nemotron-3-nano:4b`, set the `model` option to it through
   `/config` (the field is `bash-gloss.model`). If Ollama is not on
   `127.0.0.1:11434`, set `host` the same way.
5. Verify, after the plugin is active (a new session, or `/reload-plugins`): run a Bash
   command of at least 25 characters, then confirm Ollama received a request with
   `grep -a "api/generate" "$LOCALAPPDATA/Ollama/server.log" | tail -n 3` on Windows, or
   `journalctl -u ollama | grep api/generate | tail -n 3` on Linux. A fresh
   `POST "/api/generate"` line means the plugin works.
6. Report which model and host were configured. Do not enable `dialogNotice` unless the
   user asks, because it is experimental.

### Troubleshooting

- **No gloss appears:** check the transcript for a dim `bash-gloss:` line saying a hook
  failed. Then check Ollama is reachable and the model name is one `ollama list` shows.
- **Gloss is slow the first time:** a cold model has to load. Later calls take about a
  second.
- **Unknown marketplace or plugin:** run `claude plugin marketplace add <owner>/<repo>`
  first. A private repository needs your machine signed in to GitHub (`gh auth login`
  then `gh auth setup-git`).

## Settings

Set these in the plugin's config screen or `/config`.

| Setting | Default | What it does |
| --- | --- | --- |
| `host` | `http://127.0.0.1:11434` | Your Ollama server |
| `model` | `nemotron-3-nano:4b` | Any model you have pulled |
| `dialogNotice` | off | Experimental: also show the gloss under the "Allow this bash command?" dialog |

## Behaviour

- Commands shorter than 25 characters are skipped.
- The request is sent in the background when the call starts, and the command never
  waits for it. The gloss appears under the row a moment later. A cold model can take a
  few seconds to load.
- Replies are capped at 90 tokens.
- If Ollama is not running, nothing is shown and nothing breaks.
- A small model can misread a gnarly regex. Treat the gloss as a hint, not a fact.
