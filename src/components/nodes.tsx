import { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import type { ServiceInfo } from "../lib/parser";

export const ServiceNode = memo(function ServiceNode({ data, selected }: NodeProps<ServiceInfo>) {
  return (
    <div className={`node service-node ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-header">
        <span className="node-icon">📦</span>
        <span className="node-title">{data.name}</span>
        <span className="node-kind">service</span>
      </div>
      <div className="node-body">
        {data.image && <div className="node-row image">{data.image}</div>}
        {data.build && !data.image && <div className="node-row image">build: local</div>}
        {data.ports.length > 0 && (
          <div className="node-row port-row">
            {data.ports.map((p) => (
              <span key={p} className="port-chip">{p}</span>
            ))}
          </div>
        )}
        {data.volumes.length > 0 && (
          <div className="node-row">
            <span className="badge vols">🗄</span> {data.volumes.length} volume{data.volumes.length > 1 ? "s" : ""}
          </div>
        )}
        {data.environmentCount > 0 && (
          <div className="node-row">
            <span className="badge env">⚙</span> {data.environmentCount} env vars
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

export const NetworkNode = memo(function NetworkNode({ data, selected }: NodeProps<{ name: string }>) {
  return (
    <div className={`node network-node ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="node-icon">🌐</span>
      <span className="node-title">{data.name}</span>
      <span className="node-kind">net</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

export const VolumeNode = memo(function VolumeNode({ data, selected }: NodeProps<{ name: string }>) {
  return (
    <div className={`node volume-node ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="node-icon">💾</span>
      <span className="node-title">{data.name}</span>
      <span className="node-kind">vol</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
