# @codemcp/workflows-opencode-tui

OpenCode TUI sidebar plugin that displays the current [responsible-vibe](https://mrsimpson.github.io/responsible-vibe-mcp/) workflow phase and name.

## Installation

Add the plugin to your OpenCode TUI config. Create or edit `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@codemcp/workflows-opencode-tui"]
}
```

OpenCode will install the package automatically via Bun on next startup — no manual `npm install` needed.

## What it shows

When a workflow is active, the sidebar displays:

```
Workflow
epcc: code
```

The plugin reads state from `.vibe/conversations/*/state.json` in your project directory and updates whenever any responsible-vibe tool is invoked.

## Supported tool modes

The plugin works with both integration modes:

| Mode                         | Tool names                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **opencode-plugin** (direct) | `start_development`, `proceed_to_phase`, `conduct_review`, `reset_development`, `setup_project_docs`                                                   |
| **MCP server**               | `workflows_start_development`, `workflows_proceed_to_phase`, `workflows_conduct_review`, `workflows_reset_development`, `workflows_setup_project_docs` |

## Configuration

### Agent filtering

By default the sidebar widget is visible for all agents. Set `WORKFLOW_ACTIVE_AGENTS` to a comma-separated list of agent names to show it only for those agents:

```bash
# Only show the workflow widget when the "coder" or "architect" agent is active
WORKFLOW_ACTIVE_AGENTS=coder,architect
```

This uses the same env var as the `@codemcp/workflows-opencode` plugin, so both plugins respond consistently to the same configuration.

## Local development

To test the plugin locally before publishing, point `tui.json` at the absolute path to this package:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/path/to/responsible-vibe-mcp/packages/opencode-tui-plugin"]
}
```

## License

MIT
