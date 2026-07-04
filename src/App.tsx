import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Connection,
  Edge,
  Node,
  applyNodeChanges,
  NodeChange,
} from "reactflow";
import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { parseCompose, addLinkToYaml, removeLinkFromYaml, findEntityLine } from "./lib/parser";
import { ServiceNode, NetworkNode, VolumeNode } from "./components/nodes";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SAMPLE_YAML } from "./sample";

const nodeTypes = { service: ServiceNode, network: NetworkNode, volume: VolumeNode };

function loadUIState() {
  try {
    return JSON.parse(localStorage.getItem("dcv:ui") || "{}");
  } catch {
    return {};
  }
}

export default function App() {
  const [yamlText, setYamlText] = useState<string>(SAMPLE_YAML);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const debounceRef = useRef<number>();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<{ clear: () => void } | null>(null);
  const highlightTimerRef = useRef<number>();

  const [editorWidth, setEditorWidth] = useState(() => loadUIState().editorWidth ?? 42);
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
      const result = parseCompose(yamlText);
      setError(result.error);
      if (result.error) return;
      setNodes(
        result.nodes.map((n) => {
          const saved = positionsRef.current.get(n.id);
          return saved ? { ...n, position: saved } : n;
        })
      );
      setEdges(result.edges);
    }, 250);
    return () => window.clearTimeout(debounceRef.current);
  }, [yamlText]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      for (const n of next) positionsRef.current.set(n.id, n.position);
      return next;
    });
  }, []);

  // Graph -> YAML: drag a connection
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const updated = addLinkToYaml(yamlText, conn.source, conn.target);
      if (updated) setYamlText(updated);
    },
    [yamlText]
  );

  // Graph -> YAML: delete an edge (select + Del)
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      let text = yamlText;
      for (const e of deleted) {
        const updated = removeLinkFromYaml(text, e.id);
        if (updated) text = updated;
      }
      if (text !== yamlText) setYamlText(text);
    },
    [yamlText]
  );

  // Click a node -> reveal & highlight its YAML line
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const editor = editorRef.current;
      if (!editor) return;
      const line = findEntityLine(yamlText, node.id);
      if (!line) return;
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
    },
    [yamlText]
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
        setCollapsed(true);
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
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) setYamlText(await file.text());
    };
    input.click();
  }, []);

  const downloadFile = useCallback(() => {
    const blob = new Blob([yamlText], { type: "text/yaml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "docker-compose.yml";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [yamlText]);

  const resetLayout = useCallback(() => {
    positionsRef.current.clear();
    const result = parseCompose(yamlText);
    if (!result.error) {
      setNodes(result.nodes);
      setEdges(result.edges);
    }
  }, [yamlText]);

  const stats = useMemo(() => {
    const services = nodes.filter((n) => n.type === "service").length;
    const networks = nodes.filter((n) => n.type === "network").length;
    const volumes = nodes.filter((n) => n.type === "volume").length;
    return { services, networks, volumes };
  }, [nodes]);

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
          <button onClick={toggleEditor} title="Toggle editor (Ctrl+B)">
            {collapsed ? "▸ Editor" : "◂ Editor"}
          </button>
          <button onClick={openFile}>Open</button>
          <button onClick={downloadFile}>Download</button>
          <button onClick={resetLayout}>Re-layout</button>
        </div>
      </header>
      <div className="split">
        <div
          className={`pane editor-pane ${collapsed ? "collapsed" : ""}`}
          style={{ width: collapsed ? 0 : `${editorWidth}%` }}
        >
          <Editor
            language="yaml"
            theme="vs-dark"
            value={yamlText}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
            onChange={(v) => setYamlText(v ?? "")}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              tabSize: 2,
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
          {error && <div className="error-bar">⚠ {error}</div>}
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
        <div className="pane graph-pane">
          <ErrorBoundary>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
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
            Drag from a node's right handle to another node → YAML updates. Select an edge + Del →
            link removed.
          </div>
        </div>
      </div>
    </div>
  );
}
