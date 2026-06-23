# Chatbox CE — Session Grouping fork

A fork of [Chatbox Community Edition](https://github.com/ChatBoxAI/ChatBox) that replaces the flat, ever-growing chat list with a **file-explorer-style sidebar**: nestable groups, a per-group paginated view, and an AI assistant that can reorganize the whole sidebar through tool calls.

> Base: upstream **v1.21.1**. Personal fork, maintained for personal builds — not affiliated with the upstream project. Same GPLv3 license.

---

## Why this fork

Chatbox keeps every conversation in one long, time-ordered list. That works for a handful of chats and breaks down once you have hundreds — there is no way to file related sessions together, the only navigation is scroll + search, and the list is a single flat stack with no hierarchy.

This fork adds the missing structure: **folders for your chats**, with real nesting, drag-and-drop ordering, and an AI manager that can sort things for you.

## What it adds

### File-explorer sidebar
- **Always-on rail** on the far left; hovering opens a **nested group tree** flyout. Clicking a group "enters" it and the main panel shows **only that group's direct sessions**.
- **Up to 4 levels** of group nesting (`MAX_GROUP_DEPTH = 4`).
- **Real pagination per group** — the per-group panel is backed by a keyset/index-backed query on the DB session-meta store (infinite scroll), not `getAll()` + slice. It stays fast with thousands of sessions.
- **Drag-and-drop** (dnd-kit) to reorder groups among their siblings and to reorder sessions within a group, with animated overlays.
- **Per-group color**, rename, duplicate (clones the group's sessions and direct sub-groups), and delete (sessions fall back to *Unassigned*).
- Two pinned virtual views, visually separated from real groups:
  - **Unassigned** — sessions with no group.
  - **Starred** — a virtual pseudo-group collecting starred sessions in time order. Sessions join by being starred and leave by being un-starred; move/copy/delete are disabled here (it is a view, not a container).

### AI Manager session
- A reserved, pinned system session at the bottom of the sidebar that exposes a **session-management toolset** to the model (only inside this session).
- ~23 model-callable tools: list/move/rename/duplicate/delete sessions and groups, set color/parent, reorder, plus **bulk** variants (single confirmation per batch) and an auto-organize proposal hook.
- It always reads the **complete** session set (counts, per-group totals, ids + titles) — no pagination truncation.
- Reading aids for deciding where things go: cached **session summaries** (generated on demand), `bulk_get_summaries` (parallel, configurable concurrency with 10→3→1 fallback), and a last-N-messages fallback.
- All destructive actions go through a confirmation modal.

### Adaptive session summaries
- The default summary prompt first classifies the conversation type (dev task / Q&A / brainstorm / role-play / consultation / casual) before summarizing, instead of one rigid template.
- Resolution order: per-session prompt → global default prompt → built-in. Both overrides are editable in settings.

### Selective export / import
- A dual-layer checkbox tree (groups + sessions) for exporting a chosen subset.
- Import is compatible with the **official Chatbox** export format (ungrouped sessions land in *Unassigned*) and with this fork's group format; dangling group references are cleared rather than dropped.

## Build & run

Requires Node ≥ 20 and **pnpm**. From the repo root:

```bash
pnpm install
pnpm run dev        # desktop dev (Electron + renderer)
pnpm run build      # production build
pnpm run package    # package for the current OS
pnpm run check      # tsc --noEmit
pnpm exec vitest run # tests
```

For everything about the base application (providers, models, knowledge base, MCP, platforms), see the upstream project: **https://github.com/ChatBoxAI/ChatBox**.

## License

GPLv3 — see [LICENSE](./LICENSE). Chatbox and the Chatbox logo are trademarks of their respective owners; this is an independent fork.
