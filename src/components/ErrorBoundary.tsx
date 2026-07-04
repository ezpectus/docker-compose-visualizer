import { Component, ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Graph crashed:", err, info);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false, message: "" });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: "8px" }}>
          <span style={{ fontSize: "28px" }}>💥</span>
          <span style={{ color: "#ff5c7a", fontSize: "13px", fontFamily: "JetBrains Mono, monospace" }}>
            Graph crashed: {this.state.message}
          </span>
          <span style={{ color: "#8b90ab", fontSize: "12px" }}>Editor still works — fix the YAML and the graph will rebuild.</span>
        </div>
      );
    }
    return this.props.children;
  }
}
