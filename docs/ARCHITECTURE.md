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

In **multi-file mode**, service and volume IDs are prefixed with the file
index: `service:0#api`, `volume:1#pgdata`. Networks are merged by name and
keep the unprefixed `network:<name>` ID. Edge IDs follow the same prefixing
pattern. This prevents collisions between files while allowing shared networks
to act as cross-file connection points.

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

## Validation warnings

The parser (`detectWarnings` in `src/lib/parser.ts`) checks for common mistakes:

- **Port conflicts** — two or more services mapping the same host port.
  Detected by extracting the host-side port from each `ports` entry and
  checking for duplicates.
- **Dangling network references** — a service lists a network under `networks`
  that is not declared in the top-level `networks` section.
- **Dangling `depends_on` references** — a service depends on another service
  that doesn't exist in the same file.
- **Dangling volume references** — a service mounts a named volume that is not
  declared in the top-level `volumes` section (bind mounts starting with `./`,
  `../`, `/`, or `~/` are excluded).

Warnings are returned in `ParseResult.warnings` and displayed in an orange
warning bar below the editor. They do not block the graph from rendering.

## Multi-file mode

`parseMultiCompose` in `src/lib/parser.ts` accepts an array of `ComposeFile`
objects and produces a single merged graph:

- **Networks** with the same name across files are merged into one node.
  Shared networks (used by 2+ files) display a glow indicator and file count.
- **Services and volumes** are file-scoped with prefixed IDs (`<idx>#<name>`)
  to prevent name collisions. This models independently-run `docker-compose`
  projects that only connect through shared `external: true` networks — the
  common reverse-proxy pattern (one proxy stack + several app stacks). It is
  *not* the `docker-compose -f a.yml -f b.yml` deep-merge model, so
  cross-file `depends_on` is correctly flagged as a dangling reference: it
  would not work at runtime between separate compose projects either.
- **File badges** — each service and volume node shows a colored badge
  indicating which file it belongs to.
- **Error tolerance** — if one file has invalid YAML, the others still render.
  The error is shown in the error bar; warnings from valid files are still
  shown alongside it (error and warnings are independent, non-exclusive UI).
- **Toggle** — the toolbar `🔗 Multi / 🔗 Single` button switches between
  merged view (read-only graph) and per-file editing (full graph editing).
- **Tab hover** — hovering a file tab dims all nodes not belonging to that file.

### Adding files

The native file picker (`Open` button) can only browse one folder per
invocation, so `openFile` / drag-and-drop both funnel through a shared
`addFiles` helper (`App.tsx`) that **merges** newly picked files into whatever
is already loaded, instead of replacing it:

- Click `Open` (or drop files) once per folder to accumulate a multi-file set.
- The browser never exposes a file's source folder — only its bare name —
  and many unrelated projects use the literal filename `docker-compose.yml`.
  Matching purely by name would silently overwrite an unrelated project's
  file on a name clash, so `addFiles` instead:
  - **same name + identical content** → no-op (already loaded).
  - **same name + different content** → treated as a different file and
    auto-renamed with a `(2)`/`(3)`/... suffix, so nothing is silently lost.
- If the combined set collapses to exactly one file, the app reverts to
  single-file mode automatically.
- Drag-and-drop accepts any `.yml`/`.yaml` file dropped anywhere on the app
  (`onDrop` on the root `.app` element), with a visual overlay while dragging.
  Monaco's own `dropIntoEditor` is disabled so file drops over the editor
  pane bubble up to the app-level handler instead of being inserted as text.

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
- Monaco loads from CDN via `@monaco-editor/react`'s built-in loader
  (`@monaco-editor/loader`). No explicit CDN URL pinning in app code — the
  loader uses its own default version.
- `positionsRef` is cleaned up on each parse — removed nodes don't leak memory.

## Search / Filter

The toolbar search input filters nodes by **name or image** (case-insensitive
substring match, e.g. `postgres` finds any service using a postgres image).
Non-matching nodes get the `node-dimmed` CSS class (opacity 0.2), and edges
connected to a dimmed node get `edge-dimmed`. This is a display-only filter —
it does not modify the graph or YAML. Applied via the `displayedNodes` /
`displayedEdges` `useMemo` in `App.tsx`.

## Export as PNG

The `📷 PNG` button clones the `.react-flow__viewport` DOM node, inlines every
element's computed styles (so it renders correctly outside the live document),
and embeds the clone inside an SVG `<foreignObject>`. This is necessary
because React Flow renders nodes as HTML (`div`s), not SVG — a naive
`XMLSerializer` pass over the SVG layer alone would only capture the edges,
not the service/network/volume node boxes. The resulting SVG is rasterized
onto a `<canvas>` (dark background) via an `Image` + `drawImage`, then
exported with `canvas.toBlob`. No external dependencies — pure browser APIs.

## Import from URL

The URL bar accepts GitHub raw or blob URLs. Blob URLs are automatically
converted to raw URLs (`github.com` → `raw.githubusercontent.com`, `/blob/` →
`/`). The fetched YAML replaces the editor content. This is useful for
reviewing compose files from other repositories without cloning.

## Extension points

- New node kinds (e.g. `configs`, `secrets`): add to `parseCompose`,
  `NODE_WIDTH`, `getNodeHeight`, `nodeTypes`, plus a component in `nodes.tsx`.
- New edge semantics: extend `addLinkToYaml` / `removeLinkFromYaml` and keep
  the ID scheme consistent (`kind:src->tgt`).
- Editor↔graph highlighting: node click → find YAML key range via
  `doc.contents` node ranges → Monaco `revealLineInCenter` + decoration.
