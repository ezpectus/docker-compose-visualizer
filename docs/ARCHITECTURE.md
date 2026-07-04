# Architecture

## Core principle: single source of truth

The YAML text is the **only** source of truth. The graph is a *derived view*.

```
 ┌────────────┐   parseCompose (debounced 250ms)   ┌────────────┐
 │  YAML text │ ─────────────────────────────────► │   Graph    │
 │  (Monaco)  │                                    │ (ReactFlow)│
 └────────────┘ ◄───────────────────────────────── └────────────┘
        addLinkToYaml / removeLinkFromYaml (AST edit)
```

Any graph interaction (drag connection, delete edge) is translated into a
**text edit**, then the graph is rebuilt from the new text. Two models never
drift apart because there is only one model.

## Why AST edits, not re-serialization

Graph→YAML edits use the `yaml` library's `parseDocument` API and mutate the
document tree, then call `doc.toString()`. This **preserves user comments,
key order, and formatting**. Never do `stringify(parse(text))` — it destroys
comments and reorders keys, and DevOps users will not forgive that.

## Stable IDs

Everything is addressed by deterministic IDs so graph elements can be mapped
back to YAML:

| Entity              | ID format              | Example              |
| ------------------- | ---------------------- | -------------------- |
| Service node        | `service:<name>`       | `service:api`        |
| Network node        | `network:<name>`       | `network:backend`    |
| Volume node         | `volume:<name>`        | `volume:pgdata`      |
| depends_on edge     | `dep:<svc>-><svc>`     | `dep:nginx->api`     |
| network link edge   | `net:<svc>-><network>` | `net:api->backend`   |
| volume mount edge   | `vol:<svc>-><volume>`  | `vol:db->pgdata`     |

Edge deletion parses the edge ID to locate the exact YAML list item to remove.

## Connection semantics (graph → YAML)

Handled in `addLinkToYaml` (`src/lib/parser.ts`):

- **service → service** → appends to `depends_on` (list or map form supported)
- **service → network** → appends to `networks`
- **service → volume** → appends `"<vol>:/data/<vol>"` to `volumes`
- Self-links and duplicates are no-ops; invalid YAML aborts the edit (returns `null`).

## Layout & positions

- Initial layout: **dagre**, `rankdir: LR`, `edgesep: 40`, `marginx: 40`, `marginy: 40`.
- **Adaptive spacing** — `ranksep` and `nodesep` scale with node count:
  - ≤5 nodes: `ranksep: 160`, `nodesep: 80` (spread out, no clumping)
  - ≤10 nodes: `ranksep: 120`, `nodesep: 60` (balanced)
  - >10 nodes: `ranksep: 80`, `nodesep: 45` (compact, no overlap)
- Service node heights are **dynamic** — calculated from the number of ports,
  volumes, env vars, and image/build rows. This prevents node overlap on
  complex compose files.
- User-dragged positions are cached in `positionsRef` (a `Map<nodeId, xy>`)
  in `App.tsx`, so re-parsing on every keystroke does not reset the layout.
  Stale entries (removed nodes) are cleaned up on each parse.
- `fitView` is called after each parse and after Re-layout to keep the graph centered.
- "Re-layout" button clears the cache and re-runs dagre.

## File map

| File                        | Responsibility                                        |
| --------------------------- | ----------------------------------------------------- |
| `src/App.tsx`               | State, two-way sync wiring, toolbar, split layout     |
| `src/lib/parser.ts`         | YAML↔graph: parse, layout, add/remove links (AST)     |
| `src/components/nodes.tsx`  | Custom ReactFlow nodes (memoized)                     |
| `src/components/ErrorBoundary.tsx` | Catches graph crashes, keeps editor alive      |
| `src/sample.ts`             | Demo compose file shown on first load                 |
| `src/styles.css`            | Dark theme, node & edge styling                       |

## Error handling

- Invalid YAML → `parseCompose` returns `error`; the last valid graph stays
  on screen and an error bar appears under the editor.
- Graph edits on invalid YAML are rejected (`addLinkToYaml` returns `null`).
- Cyclic `depends_on` chains are detected via BFS (`hasCycle`) — cyclic edges
  are skipped to prevent dagre layout issues.
- Unhandled exceptions in the graph subtree are caught by `ErrorBoundary`
  (`src/components/ErrorBoundary.tsx`). The boundary resets when children change
  (new YAML → componentDidUpdate clears error state). The graph shows a crash message while the editor remains
  functional — fix the YAML and the graph rebuilds.

## Editor ↔ graph navigation

Clicking a node calls `findEntityLine` (`src/lib/parser.ts`), which walks the
YAML document AST and converts the key node's character range into a line
number. `App.tsx` then uses the Monaco instance (captured in `onMount`) to
`revealLineInCenter` and flash a line decoration (`.yaml-highlight-line`).

## Launchers

`start.bat` (Windows) and `start.sh` (Linux/macOS) check for Node.js, run
`npm install` on first launch, open the browser and start `npm run dev`.

## UI state persistence

Editor width and collapsed state are saved to `localStorage` under the key
`dcv:ui`. Writes are **debounced** (300 ms) so dragging the splitter does not
hammer `localStorage` on every pixel. On mount, a lazy `useState` initializer
reads the saved state once — no re-parse, no extra render.

## Performance

- Node components are wrapped in `React.memo` — React Flow re-renders only
  nodes whose `data` actually changed, not the entire graph on every keystroke.
- YAML parsing is debounced (250 ms) to keep typing responsive.
- Monaco editor refs are typed (`IStandaloneCodeEditor`), not `any`.
- Monaco CDN URL is pinned to an exact version for stable loading.
- `positionsRef` is cleaned up on each parse — removed nodes don't leak memory.

## Extension points

- New node kinds (e.g. `configs`, `secrets`): add to `parseCompose`,
  `NODE_WIDTH`, `getNodeHeight`, `nodeTypes`, plus a component in `nodes.tsx`.
- New edge semantics: extend `addLinkToYaml` / `removeLinkFromYaml` and keep
  the ID scheme consistent (`kind:src->tgt`).
- Editor↔graph highlighting: node click → find YAML key range via
  `doc.contents` node ranges → Monaco `revealLineInCenter` + decoration.
