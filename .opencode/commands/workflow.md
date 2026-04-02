---
description: Enable or disable workflows for this session
---

Toggle workflows for the current session:

- `/workflow on` - Enable workflows
- `/workflow off` - Disable workflows
- `/wf on` - Enable workflows (shorthand)
- `/wf off` - Disable workflows (shorthand)

The override is per-session only and resets when the session ends.

---

You can also restrict which agents have workflows active by default via `WORKFLOW_ACTIVE_AGENTS`:

```bash
WORKFLOW_ACTIVE_AGENTS=agent1,agent2,agentN opencode
```

When not set, workflows are active for all agents. `/workflow on` overrides this for the current session.
