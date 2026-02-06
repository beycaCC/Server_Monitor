import { useEffect, useMemo, useState } from "react";

const API_BASE = "/monitor-api";

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

function formatUptime(seconds) {
  if (seconds == null) return "—";
  const s = Number(seconds);
  if (Number.isNaN(s)) return "—";

  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [intervalSec, setIntervalSec] = useState(10);

  async function fetchMetrics() {
    try {
      setError("");
      const res = await fetch(`${API_BASE}/api/metrics`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Request failed");
      setData(json);
    } catch (e) {
      setError(e?.message ?? String(e));
      setData({ ok: false });
    }
  }

  useEffect(() => {
    fetchMetrics();
    const id = setInterval(fetchMetrics, intervalSec * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalSec]);

  // Normalize FastAPI response -> UI-friendly fields
  const ui = useMemo(() => {
    const m = data?.metrics;
    if (!m) {
      return {
        cpu: "—",
        mem: "—",
        disk: "—",
        load: "—",
        uptime: "—",
        hostname: "",
      };
    }

    const cpu = m.cpu_percent != null ? `${m.cpu_percent}%` : "—";
    const mem = m.mem_percent != null ? `${m.mem_percent}%` : "—";

    // Show root disk "/" if present, otherwise first disk entry
    const rootDisk =
      Array.isArray(m.disk) && m.disk.length > 0
        ? m.disk.find((d) => d.mount === "/") || m.disk[0]
        : null;
    const disk = rootDisk?.percent != null ? `${rootDisk.percent}%` : "—";

    const load =
      Array.isArray(m.load_avg) && m.load_avg.length === 3
        ? `${m.load_avg[0]} ${m.load_avg[1]} ${m.load_avg[2]}`
        : "—";

    const uptime = formatUptime(m.uptime_seconds);

    return {
      cpu,
      mem,
      disk,
      load,
      uptime,
      hostname: m.hostname ?? "",
    };
  }, [data]);

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
        <div>
          <h1 style={{ margin: 0 }}>Server Monitor</h1>
          {ui.hostname ? (
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
              Host: {ui.hostname}
            </div>
          ) : null}
        </div>
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
        <div style={{ color: "#dc2626", marginBottom: 16 }}>Error: {error}</div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
        }}
      >
        <Card title="CPU Usage" value={ui.cpu} />
        <Card title="Memory Usage" value={ui.mem} />
        <Card title="Disk Usage" value={ui.disk} />
        <Card title="Load Avg" value={ui.load} />
        <Card title="Uptime" value={ui.uptime} />
      </div>

      <div style={{ marginTop: 20, color: "#6b7280", fontSize: 12 }}>
        Last check: {data?.ts ? new Date(data.ts).toLocaleString() : "—"}
      </div>
    </div>
  );
}
