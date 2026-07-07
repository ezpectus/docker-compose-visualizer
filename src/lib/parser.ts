import { parseDocument, isMap, isSeq, YAMLMap } from "yaml";
import type { Node, Edge } from "reactflow";
import dagre from "dagre";

export interface ServiceInfo {
  name: string;
  image?: string;
  build?: boolean;
  ports: string[];
  volumes: string[];
  networks: string[];
  dependsOn: string[];
  environmentCount: number;
  file?: string;
  fileColor?: string;
}

export interface ParseResult {
  nodes: Node[];
  edges: Edge[];
  error: string | null;
  warnings: string[];
}

export interface ComposeFile {
  name: string;
  text: string;
}

export const FILE_COLORS = [
  "#5b9dff",
  "#5fd68b",
  "#ffb454",
  "#ff7b9c",
  "#b57bff",
  "#4dd0e1",
  "#c0ca33",
  "#ff8a65",
  "#7986cb",
  "#f06292",
  "#26a69a",
  "#ffd54f",
];

function asStringList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "object") return Object.keys(value as object);
  return [String(value)];
}

function extractHostPort(port: string): string | null {
  // "8080:80" -> "8080", "8080:80/tcp" -> "8080", "8080" -> "8080"
  const m = port.match(/^(\d+):/);
  if (m) return m[1];
  const m2 = port.match(/^(\d+)/);
  return m2 ? m2[1] : null;
}

function detectWarnings(
  services: Record<string, Record<string, unknown>>,
  networkNames: Set<string>,
  volumeNames: Set<string>,
  serviceNames: Set<string>,
  fileLabel?: string
): string[] {
  const warnings: string[] = [];
  const portOwners = new Map<string, string[]>();

  for (const [name, svc] of Object.entries(services)) {
    const s = (svc ?? {}) as Record<string, unknown>;
    const label = fileLabel ? `${fileLabel}/${name}` : name;

    // Port conflicts
    const ports = asStringList(s.ports);
    for (const p of ports) {
      const hp = extractHostPort(p);
      if (!hp) continue;
      const owners = portOwners.get(hp) ?? [];
      owners.push(label);
      portOwners.set(hp, owners);
    }

    // Dangling network refs
    const nets = asStringList(s.networks);
    for (const net of nets) {
      if (!networkNames.has(net)) {
        warnings.push(`⚠ ${label}: references undefined network "${net}"`);
      }
    }

    // Dangling depends_on refs
    const deps = asStringList(s.depends_on);
    for (const dep of deps) {
      if (!serviceNames.has(dep)) {
        warnings.push(`⚠ ${label}: depends_on undefined service "${dep}"`);
      }
    }

    // Dangling volume refs
    const vols = asStringList(s.volumes);
    for (const vol of vols) {
      const volName = vol.split(":")[0];
      if (volName && !volumeNames.has(volName) && !volName.startsWith("./") && !volName.startsWith("/")) {
        warnings.push(`⚠ ${label}: references undefined volume "${volName}"`);
      }
    }
  }

  for (const [port, owners] of portOwners) {
    if (owners.length > 1) {
      warnings.push(`⚠ Port ${port} mapped by ${owners.length} services: ${owners.join(", ")}`);
    }
  }

  return warnings;
}

export function parseCompose(text: string): ParseResult {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text);
    if (doc.errors.length > 0) {
      const msg = doc.errors[0].message;
      const hint = /keys must be unique/i.test(msg)
        ? " — looks like multiple compose files were pasted as one. Use \"Open\" and select all files together for multi-file mode instead of pasting them into a single document."
        : "";
      return { nodes: [], edges: [], error: msg + hint, warnings: [] };
    }
  } catch (e) {
    return { nodes: [], edges: [], error: (e as Error).message, warnings: [] };
  }

  const json = doc.toJS() ?? {};
  const services: Record<string, Record<string, unknown>> = json.services ?? {};
  const networks: Record<string, unknown> = json.networks ?? {};
  const volumes: Record<string, unknown> = json.volumes ?? {};

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const serviceNames = new Set(Object.keys(services));
  const networkNames = new Set(Object.keys(networks));
  const volumeNames = new Set(Object.keys(volumes));

  for (const [name, svc] of Object.entries(services)) {
    const s = (svc ?? {}) as Record<string, unknown>;
    const info: ServiceInfo = {
      name,
      image: typeof s.image === "string" ? s.image : undefined,
      build: s.build !== undefined,
      ports: asStringList(s.ports),
      volumes: asStringList(s.volumes),
      networks: asStringList(s.networks),
      dependsOn: asStringList(s.depends_on),
      environmentCount: s.environment
        ? Array.isArray(s.environment)
          ? s.environment.length
          : Object.keys(s.environment as object).length
        : 0,
    };
    nodes.push({
      id: `service:${name}`,
      type: "service",
      position: { x: 0, y: 0 },
      data: info,
    });

    for (const dep of info.dependsOn) {
      if (!serviceNames.has(dep)) continue;
      if (hasCycle("service:" + name, "service:" + dep, edges)) continue;
      edges.push({
        id: `dep:${name}->${dep}`,
        source: `service:${name}`,
        target: `service:${dep}`,
        type: "smoothstep",
        animated: true,
        label: "depends_on",
        className: "edge-depends",
      });
    }
    for (const net of info.networks) {
      if (!networkNames.has(net)) continue;
      edges.push({
        id: `net:${name}->${net}`,
        source: `service:${name}`,
        target: `network:${net}`,
        type: "smoothstep",
        className: "edge-network",
      });
    }
    for (const vol of info.volumes) {
      const volName = vol.split(":")[0];
      if (!volumeNames.has(volName)) continue;
      edges.push({
        id: `vol:${name}->${volName}`,
        source: `service:${name}`,
        target: `volume:${volName}`,
        type: "smoothstep",
        className: "edge-volume",
      });
    }
  }

  for (const name of Object.keys(networks)) {
    nodes.push({
      id: `network:${name}`,
      type: "network",
      position: { x: 0, y: 0 },
      data: { name },
    });
  }
  for (const name of Object.keys(volumes)) {
    nodes.push({
      id: `volume:${name}`,
      type: "volume",
      position: { x: 0, y: 0 },
      data: { name },
    });
  }

  const warnings = detectWarnings(services, networkNames, volumeNames, serviceNames);

  return { nodes: layout(nodes, edges), edges, error: null, warnings };
}

/**
 * Parse multiple compose files into one merged graph.
 * Networks with the same name are merged into a single node — they become
 * the connection points between files (the typical multi-stack setup:
 * many compose files joined by one external network).
 * Services and volumes stay file-scoped (prefixed ids) to avoid collisions.
 */
export function parseMultiCompose(files: ComposeFile[]): ParseResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const errors: string[] = [];
  const networkFiles = new Map<string, string[]>(); // network name -> files using it

  interface ParsedFile {
    file: ComposeFile;
    idx: number;
    services: Record<string, Record<string, unknown>>;
    networks: Record<string, unknown>;
    volumes: Record<string, unknown>;
  }
  const parsed: ParsedFile[] = [];

  files.forEach((file, idx) => {
    let doc: ReturnType<typeof parseDocument>;
    try {
      doc = parseDocument(file.text);
      if (doc.errors.length > 0) {
        errors.push(`${file.name}: ${doc.errors[0].message}`);
        return;
      }
    } catch (e) {
      errors.push(`${file.name}: ${(e as Error).message}`);
      return;
    }
    const json = doc.toJS() ?? {};
    parsed.push({
      file,
      idx,
      services: json.services ?? {},
      networks: json.networks ?? {},
      volumes: json.volumes ?? {},
    });
  });

  const allWarnings: string[] = [];

  for (const p of parsed) {
    for (const net of Object.keys(p.networks)) {
      const list = networkFiles.get(net) ?? [];
      list.push(p.file.name);
      networkFiles.set(net, list);
    }
  }

  const allNetworkNames = new Set(networkFiles.keys());

  // One shared node per network name
  for (const [net, usedBy] of networkFiles) {
    nodes.push({
      id: `network:${net}`,
      type: "network",
      position: { x: 0, y: 0 },
      data: { name: net, sharedBy: usedBy.length > 1 ? usedBy : undefined },
    });
  }

  for (const p of parsed) {
    const color = FILE_COLORS[p.idx % FILE_COLORS.length];
    const prefix = `${p.idx}#`;
    const serviceNames = new Set(Object.keys(p.services));
    const volumeNames = new Set(Object.keys(p.volumes));
    allWarnings.push(...detectWarnings(p.services, allNetworkNames, volumeNames, serviceNames, p.file.name));

    for (const name of volumeNames) {
      nodes.push({
        id: `volume:${prefix}${name}`,
        type: "volume",
        position: { x: 0, y: 0 },
        data: { name, file: p.file.name, fileColor: color },
      });
    }

    for (const [name, svc] of Object.entries(p.services)) {
      const s = (svc ?? {}) as Record<string, unknown>;
      const info: ServiceInfo = {
        name,
        image: typeof s.image === "string" ? s.image : undefined,
        build: s.build !== undefined,
        ports: asStringList(s.ports),
        volumes: asStringList(s.volumes),
        networks: asStringList(s.networks),
        dependsOn: asStringList(s.depends_on),
        environmentCount: s.environment
          ? Array.isArray(s.environment)
            ? s.environment.length
            : Object.keys(s.environment as object).length
          : 0,
        file: p.file.name,
        fileColor: color,
      };
      nodes.push({
        id: `service:${prefix}${name}`,
        type: "service",
        position: { x: 0, y: 0 },
        data: info,
      });

      for (const dep of info.dependsOn) {
        if (!serviceNames.has(dep)) continue;
        if (hasCycle(`service:${prefix}${name}`, `service:${prefix}${dep}`, edges)) continue;
        edges.push({
          id: `dep:${prefix}${name}->${dep}`,
          source: `service:${prefix}${name}`,
          target: `service:${prefix}${dep}`,
          type: "smoothstep",
          animated: true,
          label: "depends_on",
          className: "edge-depends",
        });
      }
      for (const net of info.networks) {
        if (!networkFiles.has(net)) continue;
        edges.push({
          id: `net:${prefix}${name}->${net}`,
          source: `service:${prefix}${name}`,
          target: `network:${net}`,
          type: "smoothstep",
          className: "edge-network",
        });
      }
      for (const vol of info.volumes) {
        const volName = vol.split(":")[0];
        if (!volumeNames.has(volName)) continue;
        edges.push({
          id: `vol:${prefix}${name}->${volName}`,
          source: `service:${prefix}${name}`,
          target: `volume:${prefix}${volName}`,
          type: "smoothstep",
          className: "edge-volume",
        });
      }
    }
  }

  return {
    nodes: layout(nodes, edges),
    edges,
    error: errors.length > 0 ? errors.join(" | ") : null,
    warnings: allWarnings,
  };
}

const NODE_WIDTH: Record<string, number> = {
  service: 240,
  network: 180,
  volume: 180,
};

function getNodeHeight(n: Node): number {
  if (n.type === "service") {
    const info = n.data as ServiceInfo;
    let h = 42;
    if (info.file) h += 18;
    if (info.image || info.build) h += 22;
    if (info.ports.length > 0) h += 24 + Math.ceil(info.ports.length / 3) * 22;
    if (info.volumes.length > 0) h += 22;
    if (info.environmentCount > 0) h += 22;
    h += 18;
    return Math.max(h, 80);
  }
  return 56;
}

function layout(nodes: Node[], edges: Edge[]): Node[] {
  const count = nodes.length;
  const ranksep = count <= 5 ? 160 : count <= 10 ? 120 : 80;
  const nodesep = count <= 5 ? 80 : count <= 10 ? 60 : 45;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep, ranksep, edgesep: 40, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const w = NODE_WIDTH[n.type ?? "service"] ?? 240;
    const h = getNodeHeight(n);
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    const w = NODE_WIDTH[n.type ?? "service"] ?? 240;
    const h = getNodeHeight(n);
    return { ...n, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
  });
}

/** Mutate YAML text: add depends_on / network / volume link. Preserves comments & formatting. */
export function addLinkToYaml(
  text: string,
  sourceId: string,
  targetId: string
): string | null {
  const [srcKind, srcName] = splitId(sourceId);
  const [tgtKind, tgtName] = splitId(targetId);
  if (srcKind !== "service") return null;

  const doc = parseDocument(text);
  if (doc.errors.length > 0) return null;
  const services = doc.get("services");
  if (!isMap(services)) return null;
  const svc = services.get(srcName);
  if (!isMap(svc)) return null;

  if (tgtKind === "service") {
    if (srcName === tgtName) return null;
    appendToListKey(doc, svc, "depends_on", tgtName);
  } else if (tgtKind === "network") {
    appendToListKey(doc, svc, "networks", tgtName);
  } else if (tgtKind === "volume") {
    appendToListKey(doc, svc, "volumes", `${tgtName}:/data/${tgtName}`);
  } else {
    return null;
  }
  return doc.toString();
}

/** Remove a link (edge deleted on graph). */
export function removeLinkFromYaml(text: string, edgeId: string): string | null {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return null;
  const services = doc.get("services");
  if (!isMap(services)) return null;

  const m = edgeId.match(/^(dep|net|vol):(.+?)->(.+)$/);
  if (!m) return null;
  const [, kind, svcName, target] = m;
  const svc = services.get(svcName);
  if (!isMap(svc)) return null;

  const key = kind === "dep" ? "depends_on" : kind === "net" ? "networks" : "volumes";
  const list = svc.get(key);
  if (isSeq(list)) {
    const idx = list.items.findIndex((it) => {
      const v = String((it as { value?: unknown })?.value ?? it);
      return kind === "vol" ? v.split(":")[0] === target : v === target;
    });
    if (idx >= 0) {
      list.items.splice(idx, 1);
      if (list.items.length === 0) svc.delete(key);
      return doc.toString();
    }
  } else if (isMap(list) && kind !== "vol") {
    if (list.has(target)) {
      list.delete(target);
      if (list.items.length === 0) svc.delete(key);
      return doc.toString();
    }
  }
  return null;
}

function appendToListKey(doc: ReturnType<typeof parseDocument>, map: YAMLMap, key: string, value: string) {
  const existing = map.get(key);
  if (isSeq(existing)) {
    const has = existing.items.some((it) => String((it as { value?: unknown })?.value ?? it) === value);
    if (!has) existing.add(doc.createNode(value));
  } else if (isMap(existing)) {
    if (!existing.has(value)) existing.set(value, null);
  } else {
    map.set(doc.createNode(key), doc.createNode([value]));
  }
}

/** Find the 1-based line number of a service/network/volume key in the YAML text. */
export function findEntityLine(text: string, nodeId: string): number | null {
  const [kind, name] = splitId(nodeId);
  const sectionKey =
    kind === "service" ? "services" : kind === "network" ? "networks" : "volumes";
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return null;
  const section = doc.get(sectionKey);
  if (!isMap(section)) return null;
  for (const item of section.items) {
    const key = item.key as { value?: unknown; range?: [number, number, number] } | null;
    if (key && String(key.value) === name && key.range) {
      const offset: number = key.range[0];
      return text.slice(0, offset).split("\n").length;
    }
  }
  return null;
}

function splitId(id: string): [string, string] {
  const i = id.indexOf(":");
  if (i < 0) return [id, ""];
  return [id.slice(0, i), id.slice(i + 1)];
}

function hasCycle(source: string, target: string, edges: Edge[]): boolean {
  if (source === target) return true;
  const visited = new Set<string>();
  const queue = [target];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === source) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const e of edges) {
      if (e.source === node) queue.push(e.target);
    }
  }
  return false;
}
