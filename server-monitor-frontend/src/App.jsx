import { useEffect, useState } from "react";

const API_BASE = "http://localhost:8080";

function StatusBadge({ ok }) {
  return (
    <span
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        fontWeight: 600,
        color: "white",
        backgroundColor: ok ? "#16a34a" : "#dc2626",
      }}
    >
      {ok ? "UP" : "DOWN"}
    </span>
  );
}

function Card({ title, value }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 16,
        background: "white",
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280" }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [intervalSec, setIntervalSec] = useState(10);

  async function fetchMetrics() {
    try {
      setError("");
      const res = await fetch(`${API_BASE}/api/metrics`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      setData(json);
    } catch (e) {
      setError(e.message);
      setData({ ok: false });
    }
  }

  useEffect(() => {
    fetchMetrics();
    const id = setInterval(fetchMetrics, intervalSec * 1000);
    return () => clearInterval(id);
  }, [intervalSec]);

  const metrics = data?.metrics;

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "40px auto",
        padding: 16,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0 }}>Server Monitor</h1>
        <StatusBadge ok={data?.ok} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label>
          Refresh interval:{" "}
          <select
            value={intervalSec}
            onChange={(e) => setIntervalSec(Number(e.target.value))}
          >
            <option value={10}>10s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
          </select>
        </label>
      </div>

      {error && (
        <div style={{ color: "#dc2626", marginBottom: 16 }}>
          Error: {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
        }}
      >
        <Card title="CPU Usage" value={metrics ? `${metrics.cpuPct}%` : "—"} />
        <Card
          title="Memory Usage"
          value={metrics ? `${metrics.memPct}%` : "—"}
        />
        <Card title="Disk Usage" value={metrics?.diskPct ?? "—"} />
        <Card title="Load Avg" value={metrics?.loadAvg ?? "—"} />
        <Card title="Uptime" value={metrics?.uptime ?? "—"} />
      </div>

      <div style={{ marginTop: 20, color: "#6b7280", fontSize: 12 }}>
        Last check:{" "}
        {data?.ts ? new Date(data.ts).toLocaleString() : "—"}
      </div>
    </div>
  );
}
