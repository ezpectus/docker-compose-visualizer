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
}

export interface ParseResult {
  nodes: Node[];
  edges: Edge[];
  error: string | null;
}

function asStringList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "object") return Object.keys(value as object);
  return [String(value)];
}

export function parseCompose(text: string): ParseResult {
  let doc;
  try {
    doc = parseDocument(text);
    if (doc.errors.length > 0) {
      return { nodes: [], edges: [], error: doc.errors[0].message };
    }
  } catch (e) {
    return { nodes: [], edges: [], error: (e as Error).message };
  }

  const json = doc.toJS() ?? {};
  const services: Record<string, any> = json.services ?? {};
  const networks: Record<string, any> = json.networks ?? {};
  const volumes: Record<string, any> = json.volumes ?? {};

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const [name, svc] of Object.entries(services)) {
    const s = svc ?? {};
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
          : Object.keys(s.environment).length
        : 0,
    };
    nodes.push({
      id: `service:${name}`,
      type: "service",
      position: { x: 0, y: 0 },
      data: info,
    });

    for (const dep of info.dependsOn) {
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
      if (volumes[volName] !== undefined) {
        edges.push({
          id: `vol:${name}->${volName}`,
          source: `service:${name}`,
          target: `volume:${volName}`,
          type: "smoothstep",
          className: "edge-volume",
        });
      }
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

  return { nodes: layout(nodes, edges), edges, error: null };
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
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120, edgesep: 40 });
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
    const idx = list.items.findIndex((it: any) => {
      const v = String(it?.value ?? it);
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

function appendToListKey(doc: any, map: YAMLMap, key: string, value: string) {
  const existing = map.get(key);
  if (isSeq(existing)) {
    const has = existing.items.some((it: any) => String(it?.value ?? it) === value);
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
    const key: any = item.key;
    if (key && String(key.value) === name && key.range) {
      const offset: number = key.range[0];
      return text.slice(0, offset).split("\n").length;
    }
  }
  return null;
}

function splitId(id: string): [string, string] {
  const i = id.indexOf(":");
  return [id.slice(0, i), id.slice(i + 1)];
}
