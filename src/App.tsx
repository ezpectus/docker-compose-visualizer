import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Connection,
  Edge,
  Node,
  applyNodeChanges,
  NodeChange,
  ReactFlowInstance,
} from "reactflow";
import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  parseCompose,
  parseMultiCompose,
  addLinkToYaml,
  removeLinkFromYaml,
  findEntityLine,
  FILE_COLORS,
  type ComposeFile,
} from "./lib/parser";
import { ServiceNode, NetworkNode, VolumeNode } from "./components/nodes";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SAMPLE_YAML } from "./sample";

const nodeTypes = { service: ServiceNode, network: NetworkNode, volume: VolumeNode };

function loadUIState(): { editorWidth?: number; collapsed?: boolean } {
  try {
    return JSON.parse(localStorage.getItem("dcv:ui") || "{}");
  } catch {
    return {};
  }
}

export default function App() {
  const [yamlText, setYamlText] = useState<string>(SAMPLE_YAML);
  const [files, setFiles] = useState<ComposeFile[]>([]);
  const [activeFile, setActiveFile] = useState(0);
  const [multiMode, setMultiMode] = useState(false);
  const hasFiles = files.length > 0;
  const canMulti = files.length > 1;
  const activeText = hasFiles ? files[activeFile]?.text ?? "" : yamlText;
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [hoveredFile, setHoveredFile] = useState<number | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const graphPaneRef = useRef<HTMLDivElement | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const debounceRef = useRef<number>();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<{ clear: () => void } | null>(null);
  const highlightTimerRef = useRef<number>();
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const prevNodeIdsRef = useRef<Set<string>>(new Set());

  const [editorWidth, setEditorWidth] = useState(() => {
    const ui = loadUIState();
    return ui.editorWidth ?? 42;
  });
  const [collapsed, setCollapsed] = useState(() => loadUIState().collapsed ?? false);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  const draggingRef = useRef(false);
  const saveTimerRef = useRef<number>();
  const toggleEditor = useCallback(() => setCollapsed((c: boolean) => !c), []);
  useEffect(() => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      localStorage.setItem("dcv:ui", JSON.stringify({ editorWidth, collapsed }));
    }, 300);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [editorWidth, collapsed]);

  // Ctrl+B toggles the editor panel (like VS Code)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleEditor();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleEditor]);

  // YAML -> graph (debounced)
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const result = multiMode && canMulti
        ? parseMultiCompose(files)
        : parseCompose(activeText);
      setError(result.error);
      setWarnings(result.warnings);
      if (result.error && !(multiMode && canMulti)) return;
      if (multiMode && canMulti && result.nodes.length === 0 && result.error) return;
      const prevIds = new Set(positionsRef.current.keys());
      const newIds = new Set(result.nodes.map((n) => n.id));
      for (const id of prevIds) {
        if (!newIds.has(id)) positionsRef.current.delete(id);
      }
      setNodes(
        result.nodes.map((n) => {
          const saved = positionsRef.current.get(n.id);
          return saved ? { ...n, position: saved } : n;
        })
      );
      setEdges(result.edges);
      const currentIds = new Set(result.nodes.map((n) => n.id));
      let structureChanged = false;
      for (const id of currentIds) {
        if (!prevNodeIdsRef.current.has(id)) { structureChanged = true; break; }
      }
      if (!structureChanged && currentIds.size !== prevNodeIdsRef.current.size) {
        structureChanged = true;
      }
      prevNodeIdsRef.current = currentIds;
      if (structureChanged) {
        requestAnimationFrame(() => {
          rfInstanceRef.current?.fitView({ padding: 0.15, minZoom: 0.4, maxZoom: 1.2 });
        });
      }
    }, 250);
    return () => window.clearTimeout(debounceRef.current);
  }, [activeText, files, multiMode, canMulti]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          positionsRef.current.set(c.id, c.position);
        }
      }
      return next;
    });
  }, []);

  // Graph -> YAML: drag a connection (disabled in multi-file merged view)
  const onConnect = useCallback(
    (conn: Connection) => {
      if (multiMode && canMulti) return;
      if (!conn.source || !conn.target) return;
      const updated = addLinkToYaml(activeText, conn.source, conn.target);
      if (!updated) return;
      if (hasFiles) {
        setFiles((prev) => prev.map((f, i) => (i === activeFile ? { ...f, text: updated } : f)));
      } else {
        setYamlText(updated);
      }
    },
    [activeText, multiMode, canMulti, hasFiles, activeFile]
  );

  // Graph -> YAML: delete an edge (disabled in multi-file merged view)
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (multiMode && canMulti) return;
      let text = activeText;
      for (const e of deleted) {
        const updated = removeLinkFromYaml(text, e.id);
        if (updated) text = updated;
      }
      if (text !== activeText) {
        if (hasFiles) {
          setFiles((prev) => prev.map((f, i) => (i === activeFile ? { ...f, text } : f)));
        } else {
          setYamlText(text);
        }
      }
    },
    [activeText, multiMode, canMulti, hasFiles, activeFile]
  );

  // Click a node -> reveal & highlight its YAML line (switches file tab in multi mode)
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const editor = editorRef.current;
      if (!editor) return;
      let text = activeText;
      let nodeId = node.id;
      let switchedFile = false;
      if (multiMode && canMulti) {
        const m = node.id.match(/^(\w+):(\d+)#(.+)$/);
        if (m) {
          const idx = Number(m[2]);
          if (idx >= files.length) return;
          switchedFile = idx !== activeFile;
          setActiveFile(idx);
          text = files[idx].text;
          nodeId = `${m[1]}:${m[3]}`;
        } else if (node.id.startsWith("network:")) {
          // Shared network: find first file that declares it
          const netName = node.id.slice("network:".length);
          const idx = files.findIndex((f) => findEntityLine(f.text, `network:${netName}`) !== null);
          if (idx < 0) return;
          switchedFile = idx !== activeFile;
          setActiveFile(idx);
          text = files[idx].text;
        } else {
          return;
        }
      }
      const line = findEntityLine(text, nodeId);
      if (!line) return;
      const reveal = () => {
        editor.revealLineInCenter(line);
        decorationsRef.current?.clear();
        decorationsRef.current = editor.createDecorationsCollection([
          {
            range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
            options: { isWholeLine: true, className: "yaml-highlight-line" },
          },
        ]);
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = window.setTimeout(() => decorationsRef.current?.clear(), 1600);
      };
      // If the tab changed, wait for the editor to receive the new file content
      if (switchedFile) {
        window.setTimeout(reveal, 50);
      } else {
        reveal();
      }
    },
    [activeText, multiMode, canMulti, files, activeFile]
  );

  // Cleanup highlight timer on unmount
  useEffect(() => {
    return () => window.clearTimeout(highlightTimerRef.current);
  }, []);

  // Draggable splitter
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const pct = (e.clientX / window.innerWidth) * 100;
      if (pct < 15) {
        if (!collapsedRef.current) setCollapsed(true);
      } else {
        if (collapsedRef.current) setCollapsed(false);
        setEditorWidth(Math.min(70, Math.max(15, pct)));
      }
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const openFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yml,.yaml";
    input.multiple = true;
    input.onchange = async () => {
      const selected = Array.from(input.files ?? []);
      if (selected.length === 0) return;
      if (selected.length === 1) {
        setFiles([]);
        setMultiMode(false);
        setYamlText(await selected[0].text());
      } else {
        const loaded: ComposeFile[] = await Promise.all(
          selected.map(async (f) => ({ name: f.name, text: await f.text() }))
        );
        positionsRef.current.clear();
        setFiles(loaded);
        setActiveFile(0);
        setMultiMode(true);
      }
      input.value = "";
    };
    input.click();
  }, []);

  const closeFile = useCallback(
    (idx: number) => {
      const next = files.filter((_, i) => i !== idx);
      positionsRef.current.clear();
      if (next.length <= 1) {
        if (next.length === 1) setYamlText(next[0].text);
        setActiveFile(0);
        setFiles([]);
        setMultiMode(false);
        return;
      }
      const newActive = activeFile > idx ? activeFile - 1 : activeFile;
      setActiveFile(Math.min(newActive, Math.max(next.length - 1, 0)));
      setFiles(next);
    },
    [files, activeFile]
  );

  const downloadFile = useCallback(() => {
    const text = activeText;
    const name = hasFiles ? files[activeFile]?.name ?? "docker-compose.yml" : "docker-compose.yml";
    const blob = new Blob([text], { type: "text/yaml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [activeText, hasFiles, files, activeFile]);

  const exportPng = useCallback(() => {
    const flowEl = graphPaneRef.current?.querySelector(".react-flow") as HTMLElement | null;
    if (!flowEl) return;
    const viewport = flowEl.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!viewport) return;

    const rect = flowEl.getBoundingClientRect();
    const transform = viewport.style.transform;
    const m = transform.match(/translate\(([\d.-]+)px,\s*([\d.-]+)px\)\s*scale\(([\d.]+)\)/);
    const tx = m ? parseFloat(m[1]) : 0;
    const ty = m ? parseFloat(m[2]) : 0;
    const scale = m ? parseFloat(m[3]) : 1;

    // Clone viewport and inline computed styles so it renders inside foreignObject
    const clone = viewport.cloneNode(true) as HTMLElement;
    clone.style.transform = "";
    const inlineStyles = (el: HTMLElement) => {
      const cs = window.getComputedStyle(el);
      let css = "";
      for (let i = 0; i < cs.length; i++) {
        const prop = cs.item(i);
        css += `${prop}:${cs.getPropertyValue(prop)};`;
      }
      el.setAttribute("style", css);
      for (const child of Array.from(el.children)) {
        inlineStyles(child as HTMLElement);
      }
    };
    inlineStyles(clone);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${rect.width}px;height:${rect.height}px;background:#0d0f17;">
          <div style="transform:translate(${tx}px,${ty}px) scale(${scale});transform-origin:0 0;">
            ${clone.outerHTML}
          </div>
        </div>
      </foreignObject>
    </svg>`;

    const canvas = document.createElement("canvas");
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0d0f17";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const img = new Image();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(pngBlob);
        a.download = "compose-graph.png";
        a.click();
        URL.revokeObjectURL(a.href);
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("PNG export failed");
    };
    img.src = url;
  }, []);

  const importFromUrl = useCallback(async () => {
    if (!urlInput.trim()) return;
    setUrlLoading(true);
    try {
      const url = urlInput.trim()
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setFiles([]);
      setMultiMode(false);
      setYamlText(text);
      setError(null);
      setUrlInput("");
    } catch (e) {
      setError(`URL import failed: ${(e as Error).message}`);
    } finally {
      setUrlLoading(false);
    }
  }, [urlInput]);

  const resetLayout = useCallback(() => {
    positionsRef.current.clear();
    const result = multiMode && canMulti ? parseMultiCompose(files) : parseCompose(activeText);
    if (!result.error) {
      setNodes(result.nodes);
      setEdges(result.edges);
      requestAnimationFrame(() => {
        rfInstanceRef.current?.fitView({ padding: 0.15, minZoom: 0.4, maxZoom: 1.2 });
      });
    }
  }, [activeText, multiMode, canMulti, files]);

  const stats = useMemo(() => {
    const services = nodes.filter((n) => n.type === "service").length;
    const networks = nodes.filter((n) => n.type === "network").length;
    const volumes = nodes.filter((n) => n.type === "volume").length;
    return { services, networks, volumes };
  }, [nodes]);

  // Apply search filter + tab hover dimming to nodes and edges
  const { displayedNodes, displayedEdges } = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && hoveredFile === null) return { displayedNodes: nodes, displayedEdges: edges };
    const dimmedNodeIds = new Set<string>();
    const displayedNodes = nodes.map((n) => {
      let dimmed = false;
      if (q) {
        const name = (n.data as { name?: string }).name?.toLowerCase() ?? "";
        if (!name.includes(q)) dimmed = true;
      }
      if (hoveredFile !== null && !dimmed) {
        const m = n.id.match(/^(\w+):(\d+)#/);
        const fileIdx = m ? Number(m[2]) : null;
        if (fileIdx !== null && fileIdx !== hoveredFile) dimmed = true;
      }
      if (dimmed) dimmedNodeIds.add(n.id);
      return { ...n, className: dimmed ? "node-dimmed" : undefined };
    });
    const displayedEdges = edges.map((e) =>
      dimmedNodeIds.has(e.source) || dimmedNodeIds.has(e.target)
        ? { ...e, className: "edge-dimmed" }
        : e
    );
    return { displayedNodes, displayedEdges };
  }, [nodes, edges, search, hoveredFile]);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-icon">🐳</span> Compose Visualizer
        </div>
        <div className="stats">
          <span>📦 {stats.services}</span>
          <span>🌐 {stats.networks}</span>
          <span>💾 {stats.volumes}</span>
        </div>
        <div className="actions">
          <input
            className="search-input"
            type="text"
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button onClick={toggleEditor} title="Toggle editor (Ctrl+B)">
            {collapsed ? "▸ Editor" : "◂ Editor"}
          </button>
          <button onClick={openFile}>Open</button>
          {canMulti && (
            <button
              onClick={() => setMultiMode((m) => !m)}
              className={multiMode ? "btn-active" : ""}
              title="Toggle merged multi-file view"
            >
              {multiMode ? "🔗 Multi" : "🔗 Single"}
            </button>
          )}
          <button onClick={downloadFile}>Download</button>
          <button onClick={exportPng} title="Export graph as PNG">📷 PNG</button>
          <button onClick={resetLayout}>Re-layout</button>
        </div>
      </header>
      <div className="url-bar">
        <input
          type="text"
          placeholder="Import from URL (GitHub raw / blob link)..."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") importFromUrl(); }}
        />
        <button onClick={importFromUrl} disabled={urlLoading}>
          {urlLoading ? "Loading..." : "Fetch"}
        </button>
      </div>
      <div className="split">
        <div
          className={`pane editor-pane ${collapsed ? "collapsed" : ""}`}
          style={{ width: collapsed ? 0 : `${editorWidth}%` }}
        >
          {hasFiles && (
            <div className="file-tabs">
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className={`file-tab ${i === activeFile ? "active" : ""}`}
                  onClick={() => setActiveFile(i)}
                  onMouseEnter={() => setHoveredFile(i)}
                  onMouseLeave={() => setHoveredFile(null)}
                  style={{ borderTopColor: FILE_COLORS[i % FILE_COLORS.length] }}
                  title={f.name}
                >
                  <span className="file-tab-name">{f.name}</span>
                  <span
                    className="file-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFile(i);
                    }}
                  >
                    ×
                  </span>
                </div>
              ))}
            </div>
          )}
          <Editor
            language="yaml"
            theme="vs-dark"
            value={activeText}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
            onChange={(v) => {
              if (hasFiles) {
                setFiles((prev) =>
                  prev.map((f, i) => (i === activeFile ? { ...f, text: v ?? "" } : f))
                );
              } else {
                setYamlText(v ?? "");
              }
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 13.5,
              fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
              fontLigatures: true,
              lineHeight: 20,
              tabSize: 2,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderWhitespace: "selection",
              cursorBlinking: "smooth",
              smoothScrolling: true,
              padding: { top: 8, bottom: 8 },
            }}
          />
          {error && <div className="error-bar">⚠ {error}</div>}
          {warnings.length > 0 && !error && (
            <div className="warning-bar">
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
        </div>
        <div
          className="splitter"
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.cursor = "col-resize";
          }}
          onDoubleClick={toggleEditor}
          title="Drag to resize · double-click to collapse"
        />
        <div className="pane graph-pane" ref={graphPaneRef}>
          <ErrorBoundary>
          <ReactFlow
            nodes={displayedNodes}
            edges={displayedEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onInit={(inst) => { rfInstanceRef.current = inst; }}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
            fitViewOptions={{ padding: 0.15, minZoom: 0.4, maxZoom: 1.2 }}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#232840" gap={24} size={1.5} />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) =>
                n.type === "service" ? "#5b9dff" : n.type === "network" ? "#b57bff" : "#ffb454"
              }
            />
          </ReactFlow>
          </ErrorBoundary>
          <div className="hint">
            {multiMode && canMulti
              ? "Multi-file view: shared networks connect the stacks. Click a node to jump to its file."
              : "Drag from a node's right handle to another node → YAML updates. Select an edge + Del → link removed."}
          </div>
        </div>
      </div>
    </div>
  );
}
