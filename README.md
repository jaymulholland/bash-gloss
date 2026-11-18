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
2. Add the plugin. It is two steps: add the marketplace (this repository), then install
   the plugin from it. Adding the marketplace alone does not install anything. Pick one:
   - **Inside Claude Code (terminal or VS Code)**: type `/plugins`, add the marketplace
     `<owner>/<repo>`, open the **Discover** tab, select `bash-gloss` and install it with
     the **user** scope so every session loads it.
   - **Terminal with `claude` on your PATH**:
     ```
     claude plugin marketplace add <owner>/<repo>
     claude plugin install bash-gloss --marketplace <owner>/<repo> --scope user
     ```
     If you only have the VS Code extension, `claude` is not on your PATH. Use the
     `/plugins` route above instead.
   - **Desktop app**, where `/plugin` does not run: click **+** next to the prompt box,
     then **Plugins**, **Add marketplace** with `<owner>/<repo>`, then **Add plugin**.
3. Run `/reload-plugins`, or start a new chat. It should report `1 plugin`.
4. Run any Bash command of 25 or more characters. A dim `↳` line should appear under it
   within a few seconds.

If the model name differs on your machine, open `/config` and change **Ollama model**.

### For agents

Do these in order and stop on the first failure, telling the user what failed.

1. Check Ollama: `curl -s http://127.0.0.1:11434/api/tags` must return JSON. If it does
   not, tell the user Ollama is not running. Do not install Ollama for them.
2. Pick a model from the `name` fields in that JSON. If the user has none, ask which to
   pull. Do not pull a large model without asking.
3. Find the `claude` command. Try `claude --version`. If it is not recognized, the user
   probably has only the VS Code extension, which bundles its own copy. Look for
   `claude.exe` (Windows) or `claude` under
   `~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/` and use the
   newest version folder. If you find none, stop and tell the user to either install the
   standalone Claude Code CLI or follow the "For humans" steps with `/plugins`. Slash
   commands such as `/plugins` are typed by the user, so you cannot run them.
4. Install in two steps, using the command from step 3 in place of `claude`. Both are
   needed: adding the marketplace alone installs nothing.
   ```
   claude plugin marketplace add <owner>/<repo>
   claude plugin install bash-gloss --marketplace <owner>/<repo> --scope user
   ```
   Then confirm with `claude plugin list` that `bash-gloss` appears as installed. If the
   marketplace is already added, skip the first command.
5. If the chosen model is not `nemotron-3-nano:4b`, tell the user to set it in `/config`
   (the field is `bash-gloss.model`), since you cannot type slash commands. If Ollama is
   not on `127.0.0.1:11434`, the same goes for `host`.
6. Ask the user to run `/reload-plugins` (or start a new chat). It must report `1 plugin`
   or more. `0 plugins` means step 4 did not finish.
7. Verify: run a Bash command of at least 25 characters, then confirm Ollama received a
   request with
   `grep -a "api/generate" "$LOCALAPPDATA/Ollama/server.log" | tail -n 3` on Windows, or
   `journalctl -u ollama | grep api/generate | tail -n 3` on Linux. A fresh
   `POST "/api/generate"` line means the plugin works. Ask the user whether they also
   see the dim `↳` line under the command.
8. Report which model and host were configured. Do not enable `dialogNotice` unless the
   user asks, because it is experimental.

### Troubleshooting

- **No gloss appears:** check the transcript for a dim `bash-gloss:` line saying a hook
  failed. Then check Ollama is reachable and the model name is one `ollama list` shows.
- **Gloss is slow the first time:** a cold model has to load. Later calls take about a
  second.
- **`/reload-plugins` says `0 plugins`:** the marketplace is added but the plugin is not
  installed. Open `/plugins`, go to **Discover** and install `bash-gloss`.
- **`claude` is not recognized:** you have the VS Code extension but not the standalone
  CLI. Use `/plugins` inside Claude Code instead.
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
