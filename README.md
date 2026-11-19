<img width="664" height="217" alt="Screenshot 2026-11-18 201817" src="https://github.com/user-attachments/assets/e8364490-2063-458e-9e54-3be163221fb7" />
# bash-gloss

A Claude Code mod that adds a plain-English gloss under tool calls (Bash, PowerShell,
file edits and writes, web fetches, subagents and MCP tools), so cryptic one-liners
(`sed -i 's/.../.../' $f`) tell you what they do and what they touch. The gloss is
written by a model running locally in [Ollama](https://ollama.com), so it costs no
Claude tokens: the mod sends the call to your own machine and draws the reply on
screen. 

**IMPORTANT** this add-on is for the Claude Code extension. You can ask it to help you install & configure. use /plugins to configure manually.
**IMPORTANT** this add-on indiscriminately uses your GPU power by sending its prompts to a local model via your Ollama. likely degraded performance on systems under load.

# why bash-gloss?
a gloss is a quick definition or explanatory note, added to bash commads. its pretty simple.
it gives hints that help you learn and understand the computational actions of your tool calls. not only do you get more insight, but by leveraging a local model, this plugin has 0 token overhead.
I have to stress that it *hints* - as a 8B model can definitely make msitakes; understate dangers, and mis-represent commands. you could of course adjust this addon to use a cloud AI; but I wanted to start local-first.

```
Bash  f=src/app.tsx && sed -i 's/oldName(/newName(/g' $f
  ↳ DOES: Renames the function oldName to newName throughout the file
    TOUCHES: src/app.tsx
```

## Requirements

- [Ollama](https://ollama.com) running locally (default `http://127.0.0.1:11434`)
- A model pulled in Ollama. A small one is plenty, e.g. `ollama pull llama3.2:3b`.
  There is no default: you choose the model when you install, using the name exactly as
  `ollama list` shows it.

## Install

Replace `<owner>/<repo>` with this repository's GitHub path.

### For humans

1. Install Ollama and pull a model: `ollama pull llama3.2:3b`. Check it is
   running with `ollama list` and note the model's name.
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

Installing asks for **Ollama model** (required): type the name from `ollama list`. If you
mistype it, the first gloss shows a toast saying the model is not in Ollama. Fix it
later in `/config`.

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
5. The model has no default, so the plugin does nothing until it is set. Tell the user to
   enter the chosen model name when the install prompts for it, or in `/config` (the
   field is `bash-gloss.model`), since you cannot type slash commands. If Ollama is not
   on `127.0.0.1:11434`, the same goes for `host`.
6. Ask the user to run `/reload-plugins` (or start a new chat). It must report `1 plugin`
   or more. `0 plugins` means step 4 did not finish.
7. Verify: run a Bash command of at least 25 characters, then confirm Ollama received a
   request with
   `grep -a "api/generate" "$LOCALAPPDATA/Ollama/server.log" | tail -n 3` on Windows, or
   `journalctl -u ollama | grep api/generate | tail -n 3` on Linux. A fresh
   `POST "/api/generate"` line means the plugin works. Ask the user whether they also
   see the dim `↳` line under the command.
8. Report which model and host were configured. `dialogNotice` is off by default; tell the
   user they can turn it on in `/config`. Claude Code labels it "from the bash-gloss plugin".

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
| `model` | none (required) | Name of a model you have pulled, as `ollama list` shows it |
| `tools` | `Bash,PowerShell,Agent,mcp` | Which tools get a gloss. Also available: `Edit`, `Write` (explains the change's effect), `WebFetch`, `WebSearch`. `mcp` covers every MCP tool, or name one as `mcp__server__tool` |
| `includeReads` | off | Also gloss `Read`, `Grep` and `Glob`. Asked at install |
| `dialogNotice` | off | While a call waits for approval, show the gloss under the permission dialog. Finished calls keep it under the row |

## Behaviour

- Shell commands shorter than 25 characters are skipped. If a command runs a script file
  (`./deploy.sh`, `python gen.py`), the first 3 KB of it is sent too, so the gloss says what
  the script does. Edit, Write, WebFetch and WebSearch are off by default because the
  transcript already shows what they do.
- The request is sent in the background when the call starts, and the command never
  waits for it. The gloss appears under the row a moment later. A cold model can take a
  few seconds to load.
- Replies are capped at 90 tokens.
- If Ollama is not running, nothing is shown and nothing breaks.
- A small model can misread a gnarly regex. Treat the gloss as a hint, not a fact.
