---
name: redeven-assist
description: Use Redeven's local assistant surfaces consistently from an AI coding agent. Use when the user wants Ask Flower, Ask Codex, or unified context actions on files, terminals, git views, or monitored processes, especially when the assistant surface may need to fall back to the local runtime.
---

# Redeven Assist

Use this skill when the task is about asking Redeven's assistant surfaces to inspect or explain a target.

## Rule of Thumb

- Prefer the UI surface that already owns the context.
- Use Ask Flower for file, terminal, git, and monitor context when Flower is configured.
- Use Ask Codex for Codex-owned workspaces and transcript-oriented analysis when Codex is available.
- If the remote environment does not provide Flower but the local runtime does, keep the user workflow the same and let the local runtime carry the assistant turn.

## Context Discipline

- Pass structured context, not raw prose re-interpretation.
- Keep file paths, working directories, selections, and process snapshots intact.
- Avoid flattening a terminal selection into a generic text blob when the selection still has a working directory.

## Command Path

When a concrete Redeven target is needed, resolve it first:

```bash
redeven targets resolve --target local --json
```

Then continue with the target-specific UI or CLI flow the current workspace exposes.
