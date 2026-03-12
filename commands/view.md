---
description: "Open the PM knowledge base dashboard in your browser. Browse landscape, strategy, competitors, shared research, customer evidence themes, and backlog."
---

Start the PM dashboard server by running:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/server.js --mode dashboard --dir "${CLAUDE_PROJECT_DIR:-$PWD}/pm"
```

Parse the returned JSON, extract `url`, and print it for the user to open. The server auto-exits after 30 minutes of inactivity.
