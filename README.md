Native Obsidian 1.14.5 checks on macOS, captured in an isolated temporary vault using generated fixtures.

The local preview combines upstream `fb6b52607`, the changes in [#1959](https://github.com/YishenTu/claudian/pull/1959), [#1960](https://github.com/YishenTu/claudian/pull/1960), [#1961](https://github.com/YishenTu/claudian/pull/1961), [#1963](https://github.com/YishenTu/claudian/pull/1963), and the separately reviewed literal-filename notification patch. The product source changes are verified independently; these captures show their combined native-host checks. No provider request was sent.

| Capture | Observed check and boundary |
| --- | --- |
| [Symlink vault](images/symlink-vault-refresh.png) | Obsidian naturally retains the symlink root. The production notification callback synchronously emits `modify` for the exact native `TFile`, with filesystem-watcher events excluded. The file view is opened afterward to inspect its content. |
| [Environment ownership](images/environment-ownership-diagnostic.png) | A diagnostic fixture executes the real snippet-to-scope-to-settings-to-runtime helpers. The Claude endpoint is absent from Codex's environment. This is not a settings-screen interaction recording. |
| [Pi history](images/pi-history-error-rendering.png) | Temporary native JSONL passes through the production parser and actual message renderer. Partial text and terminal error are visible; this capture does not exercise the whole history-service hydration flow. |
| [LaTeX comparisons](images/latex-comparison-rendering.png) | The actual Obsidian Markdown renderer produces two MathJax expressions with zero formula errors; the neighboring placeholder remains text. |
| [Literal filename](images/literal-filename-refresh.png) | Relative and canonical absolute paths both notify the same actual `$TASK_LITERAL.md` file while the environment variable has another value. The fixture restores that variable and opens the native file view afterward. |

The native run completed with zero renderer errors, removed its temporary profile/vault, and preserved the existing CLI socket identity. The screenshots contain only generated demonstration content.
