import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { Client } from "ssh2";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const {
  PORT = "8080",
  TARGET_HOST,
  TARGET_PORT = "22",
  TARGET_USER,
  SSH_PRIVATE_KEY_PATH,
  SSH_READY_TIMEOUT_MS = "6000",
  SSH_CMD_TIMEOUT_MS = "8000",
} = process.env;

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const HOST = requireEnv("TARGET_HOST", TARGET_HOST);
const USER = requireEnv("TARGET_USER", TARGET_USER);
const KEY_PATH = requireEnv("SSH_PRIVATE_KEY_PATH", SSH_PRIVATE_KEY_PATH);

const PORT_NUM = Number(PORT);
const TARGET_PORT_NUM = Number(TARGET_PORT);
const READY_TIMEOUT_MS = Number(SSH_READY_TIMEOUT_MS);
const CMD_TIMEOUT_MS = Number(SSH_CMD_TIMEOUT_MS);

function readPrivateKey(keyPath) {
  // Read once at startup (faster + fewer failure points)
  try {
    return fs.readFileSync(keyPath, "utf8");
  } catch (e) {
    throw new Error(
      `Failed to read SSH private key at '${keyPath}'. ` +
        `Verify the path exists and that the process has permission to read it. ` +
        `Original error: ${e.message}`
    );
  }
}



console.log("SSH_PRIVATE_KEY_PATH =", process.env.SSH_PRIVATE_KEY_PATH);




const PRIVATE_KEY = readPrivateKey(KEY_PATH);

function sshExec(command, { timeoutMs = CMD_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;

    const finish = (err, out) => {
      if (settled) return;
      settled = true;

      try {
        conn.end();
      } catch {
        // ignore
      }

      if (err) reject(err);
      else resolve(out);
    };

    const timer = setTimeout(() => {
      finish(new Error(`SSH command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            return finish(err);
          }

          let stdout = "";
          let stderr = "";

          stream
            .on("close", (code) => {
              clearTimeout(timer);
              if (code !== 0) {
                return finish(
                  new Error(
                    `SSH command failed (exit ${code}). ` +
                      (stderr ? `stderr: ${stderr.trim()}` : "")
                  )
                );
              }
              finish(null, stdout.trim());
            })
            .on("data", (data) => {
              stdout += data.toString();
            });

          stream.stderr.on("data", (data) => {
            stderr += data.toString();
          });
        });
      })
      .on("error", (e) => {
        clearTimeout(timer);
        finish(e);
      })
      .connect({
        host: HOST,
        port: TARGET_PORT_NUM,
        username: USER,
        privateKey: PRIVATE_KEY,
        readyTimeout: READY_TIMEOUT_MS,
      });
  });
}

// Linux metrics (works on most Ubuntu/Debian/RHEL servers)
async function getMetricsLinux() {
  const cpuCmd = `
read cpu user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat
prev_idle=$idle
prev_total=$((user+nice+system+idle+iowait+irq+softirq+steal))
sleep 0.3
read cpu user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat
idle2=$idle
total2=$((user+nice+system+idle+iowait+irq+softirq+steal))
diff_idle=$((idle2-prev_idle))
diff_total=$((total2-prev_total))
usage=$(( (1000*(diff_total-diff_idle)/diff_total +5)/10 ))
echo $usage
`.trim();

  const memCmd = `free -m | awk 'NR==2{printf "%.1f", $3*100/$2 }'`; // %
  const diskCmd = `df -h / | awk 'NR==2{print $5}'`; // e.g. 37%
  const loadCmd = `cat /proc/loadavg | awk '{print $1" "$2" "$3}'`;
  const uptimeCmd = `uptime -p 2>/dev/null || cat /proc/uptime | awk '{print $1}'`;

  const [cpuPct, memPct, diskPct, loadAvg, uptime] = await Promise.all([
    sshExec(cpuCmd),
    sshExec(memCmd),
    sshExec(diskCmd),
    sshExec(loadCmd),
    sshExec(uptimeCmd),
  ]);

  return {
    cpuPct: Number(cpuPct),
    memPct: Number(memPct),
    diskPct,
    loadAvg,
    uptime,
  };
}

// Basic root route so visiting http://localhost:8080/ is not a 404
app.get("/", (req, res) => {
  res.type("text/plain").send("Server Monitor API is running. Try /api/health or /api/metrics");
});

app.get("/api/health", async (req, res) => {
  try {
    await sshExec("echo ok");
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({
      ok: false,
      ts: new Date().toISOString(),
      error: e?.message ?? String(e),
    });
  }
});

app.get("/api/metrics", async (req, res) => {
  try {
    const metrics = await getMetricsLinux();
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      target: { host: HOST, user: USER, port: TARGET_PORT_NUM },
      metrics,
    });
  } catch (e) {
    res.status(503).json({
      ok: false,
      ts: new Date().toISOString(),
      error: e?.message ?? String(e),
    });
  }
});


app.get("/api/debug/ssh", async (req, res) => {
  try {
    const out = await sshExec("whoami && hostname");
    res.json({ ok: true, ts: new Date().toISOString(), output: out });
  } catch (e) {
    res.status(503).json({ ok: false, ts: new Date().toISOString(), error: e?.message ?? String(e) });
  }
});

app.listen(PORT_NUM, () => {
  console.log(`Monitor API listening on http://localhost:${PORT_NUM}`);
  console.log(`Target: ${USER}@${HOST}:${TARGET_PORT_NUM}`);
});