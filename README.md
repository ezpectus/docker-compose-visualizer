<div align="center">

# 🐳 Docker Compose Visualizer

**A bidirectional visual editor for `docker-compose.yml`.**
Type YAML — watch the graph rebuild. Drag connections on the graph — watch the YAML rewrite itself.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)

</div>

---

## Why I built this

I was debugging a Docker Compose setup at 3 AM — 15 services, 4 networks, volumes
everywhere. I couldn't tell what depended on what. I kept scrolling up and down the
YAML file, drawing arrows on paper, losing track.

I thought: *why can't I just see this?*

Every DevOps engineer and backend developer has been there. You inherit someone else's
compose file, or your own has grown into a monster. You need to understand the topology
fast — not by reading 200 lines of YAML, but by looking at a picture.

So I built this. Paste your `docker-compose.yml`, see your infrastructure instantly.
Drag connections to rewire it. The YAML updates itself.

No more 3 AM arrow-drawing on paper.

---

## ✨ Features

- **Live graph** — services 📦, networks 🌐 and volumes 💾 rendered as rich custom nodes with images, port chips and env counters. Auto-layout via dagre.
- **True two-way sync** — the killer feature:
  - Edit YAML → the graph rebuilds in real time (250 ms debounce).
  - Drag a connection between nodes → `depends_on` / `networks` / `volumes` entries are written into the YAML.
  - Select an edge and press <kbd>Delete</kbd> → the link is removed from the YAML.
- **Comment-safe edits** — graph-driven changes mutate the YAML AST, so your comments, key order and formatting survive untouched.
- **Click-to-source** — click any node to jump to (and flash-highlight) its definition in the editor.
- **Collapsible editor panel** — toggle with the toolbar button, <kbd>Ctrl+B</kbd>, or double-click the splitter. Drag the splitter to resize — drag all the way left to auto-collapse.
- **Persistent UI state** — editor width and collapsed state survive page reloads via `localStorage` (debounced writes).
- **Crash-resistant** — an `ErrorBoundary` around the graph means a parsing crash kills the graph, not the editor. Fix the YAML and the graph rebuilds.
- **Open / Download** — load any compose file, export the edited result.
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

1. Paste or **Open** your `docker-compose.yml` in the left pane.
2. Edit text — the graph follows.
3. Drag from a node's **right handle** to another node:

   | Connection            | YAML result                     |
   | --------------------- | ------------------------------- |
   | service → service     | adds `depends_on` entry         |
   | service → network     | adds entry under `networks`     |
   | service → volume      | adds a `volumes` mount          |

4. Select an edge + <kbd>Delete</kbd> — the link disappears from the YAML.
5. Click a node — the editor scrolls to its definition.
6. **Download** the result, **Re-layout** to re-run auto-layout.

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

## 🗺 Roadmap

- [ ] Export graph as PNG/SVG (for those Reddit screenshots)
- [ ] `configs` / `secrets` / `healthcheck` support
- [ ] Node inspector panel (edit image, ports, env from the graph)
- [ ] Multi-file support (`compose.override.yml`)
- [ ] Shareable links (compose encoded in URL)
- [ ] Web Worker for parsing + layout (keep main thread free on 50+ service configs)
- [ ] Lazy-load Monaco editor (faster first paint)
- [ ] Cycle detection for `depends_on` (prevent dagre layout issues)

## 🤝 Contributing

PRs welcome. Keep the core rule intact: *never* re-serialize YAML with
`stringify(parse(text))` — all text edits must go through the `yaml` document AST
to preserve user comments and formatting.

## 📄 License

[MIT](LICENSE)
