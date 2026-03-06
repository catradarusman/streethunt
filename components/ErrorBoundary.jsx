import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("App error:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight:"100dvh", background:"#0A0A0A", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 28px", gap:24, textAlign:"center" }}>
          <div style={{ fontSize:48 }}>💀</div>
          <div>
            <p style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:28, fontWeight:800, color:"#fff", marginBottom:8 }}>SOMETHING BROKE</p>
            <p style={{ fontFamily:"'Space Mono',monospace", fontSize:11, color:"#ffffff40", lineHeight:1.7 }}>
              {this.state.error?.message || "Unexpected error"}
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ padding:"14px 32px", background:"#C6FF00", border:"none", borderRadius:12, color:"#0A0A0A", fontSize:14, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, letterSpacing:"0.08em" }}
          >
            RELOAD →
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
