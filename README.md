<div align="center">

# 🐳 Docker Compose Visualizer

**Stop scrolling. Start seeing.**

A bidirectional visual editor for `docker-compose.yml` — type YAML on the left, watch the graph rebuild on the right. Drag connections on the graph, watch the YAML rewrite itself. Comments and formatting preserved through AST-level edits.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)

</div>

---

## The problem

You inherited a `docker-compose.yml` with 15 services, 4 networks, and volumes
everywhere. You're scrolling up and down, drawing arrows on paper, losing track
of what depends on what.

**We've all been there.** Reading 200 lines of YAML to understand topology is
painful. You need a picture — not a file.

## The solution

Paste your compose file. Get an interactive graph instantly:

- **Services** 📦, **networks** 🌐, and **volumes** 💾 as rich custom nodes
- **Two-way sync** — edit YAML → graph follows. Drag a connection → YAML rewrites itself
- **Comments survive** — graph edits mutate the YAML AST, never re-serialize
- **Click any node** → jump straight to its definition in the editor

No more 3 AM arrow-drawing on paper.

---

## ✨ Features

- **Live graph** — auto-layout via dagre with adaptive spacing based on graph size
- **True two-way sync**:
  - Edit YAML → graph rebuilds in real time (250 ms debounce)
  - Drag a connection → `depends_on` / `networks` / `volumes` entries written into YAML
  - Select an edge + <kbd>Delete</kbd> → link removed from YAML
- **Comment-safe edits** — AST mutations preserve your comments, key order, and formatting
- **Click-to-source** — click any node to jump to (and flash-highlight) its YAML definition
- **Collapsible editor** — toggle via toolbar button, <kbd>Ctrl+B</kbd>, or double-click the splitter. Drag all the way left to auto-collapse
- **Persistent UI state** — editor width and collapsed state survive reloads via `localStorage` (debounced writes)
- **Crash-resistant** — `ErrorBoundary` around the graph means a crash kills the graph, not the editor. Fix the YAML → graph rebuilds
- **Open / Download** — load any compose file, export the edited result
- **Dark mode only.** Obviously.

## 📸 Screenshots

![Main View](screenshots/main-view.png)

![Collapsed Editor](screenshots/collapsed.png)

![Error State](screenshots/error-state.png)

![Large Compose](screenshots/large-compose.png)

## 🚀 Quick start

**Windows** — double-click `start.bat`

**Linux / macOS:**

```bash
chmod +x start.sh && ./start.sh
```

Both scripts check for Node.js, install dependencies on first run, open the browser and start the dev server at `http://localhost:5173`.

**Manual:**

```bash
npm install     # install dependencies (once)
npm run dev     # dev server → http://localhost:5173
npm run build   # type-check + production build → dist/
npm run preview # serve the production build locally
```

Requires **Node.js ≥ 18**.

## 🖱 Usage

1. Paste or **Open** your `docker-compose.yml` in the left pane
2. Edit text — the graph follows
3. Drag from a node's **right handle** to another node:

   | Connection            | YAML result                     |
   | --------------------- | ------------------------------- |
   | service → service     | adds `depends_on` entry         |
   | service → network     | adds entry under `networks`     |
   | service → volume      | adds a `volumes` mount          |

4. Select an edge + <kbd>Delete</kbd> — the link disappears from the YAML
5. Click a node — the editor scrolls to its definition
6. **Download** the result, **Re-layout** to re-run auto-layout

## 🏗 Architecture

The YAML text is the **single source of truth**; the graph is a derived view. Every
graph interaction is translated into an AST-level text edit, then the graph is
rebuilt from the new text — so the two views can never drift apart.

Full details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## 🧰 Stack

| Concern        | Library                                        |
| -------------- | ---------------------------------------------- |
| UI             | React 18 + TypeScript + Vite                   |
| Graph          | [React Flow 11](https://reactflow.dev)         |
| Editor         | [Monaco](https://microsoft.github.io/monaco-editor/) (`@monaco-editor/react`) |
| YAML AST       | [yaml](https://eemeli.org/yaml/)               |
| Auto-layout    | [dagre](https://github.com/dagrejs/dagre)      |

## 🤝 Contributing

PRs welcome. Keep the core rule intact: *never* re-serialize YAML with
`stringify(parse(text))` — all text edits must go through the `yaml` document AST
to preserve user comments and formatting.

## 📄 License

[MIT](LICENSE)
