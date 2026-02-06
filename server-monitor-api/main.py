from __future__ import annotations

import os
import socket
import time
from typing import Any, Dict, List, Optional

import psutil
from fastapi import FastAPI, Response
from pydantic import BaseModel


APP_NAME = "Server Monitor API"
APP_VERSION = "1.0.0"

# Optional shared secret (simple protection). If MONITOR_TOKEN is set,
# clients must pass: Authorization: Bearer <token>
MONITOR_TOKEN = os.getenv("MONITOR_TOKEN")


app = FastAPI(title=APP_NAME, version=APP_VERSION)


def _require_auth(authorization: Optional[str]) -> None:
    if not MONITOR_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise PermissionError("Missing Authorization Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if token != MONITOR_TOKEN:
        raise PermissionError("Invalid token")


def _bytes_to_human(n: int) -> str:
    # Small helper for readable numbers
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    val = float(n)
    i = 0
    while val >= 1024 and i < len(units) - 1:
        val /= 1024
        i += 1
    return f"{val:.1f}{units[i]}"


class DiskUsageItem(BaseModel):
    mount: str
    total_bytes: int
    used_bytes: int
    free_bytes: int
    percent: float


class NetIO(BaseModel):
    bytes_sent: int
    bytes_recv: int


class Metrics(BaseModel):
    cpu_percent: float
    load_avg: List[float]
    mem_percent: float
    mem_total_bytes: int
    mem_used_bytes: int
    mem_available_bytes: int
    disk: List[DiskUsageItem]
    net_io: NetIO
    uptime_seconds: int
    hostname: str


class ApiResponse(BaseModel):
    ok: bool
    ts: str
    metrics: Optional[Metrics] = None
    error: Optional[str] = None


@app.get("/", response_class=Response)
def root() -> Response:
    return Response(
        content=f"{APP_NAME} is running. Try GET /api/health or /api/metrics\n",
        media_type="text/plain",
    )


@app.get("/api/health", response_model=Dict[str, Any])
def health() -> Dict[str, Any]:
    return {"ok": True, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


@app.get("/api/metrics", response_model=ApiResponse)
def metrics(response: Response, authorization: Optional[str] = None) -> ApiResponse:
    try:
        _require_auth(authorization)

        # CPU percent (non-blocking quick sample)
        cpu_percent = psutil.cpu_percent(interval=0.2)

        # Load average (Linux/macOS). On Windows may not exist.
        try:
            load_avg = list(os.getloadavg())
        except Exception:
            load_avg = [0.0, 0.0, 0.0]

        vm = psutil.virtual_memory()

        # Disks: common to show just root + any mounted filesystems
        disk_items: List[DiskUsageItem] = []
        seen_mounts = set()

        for part in psutil.disk_partitions(all=False):
            m = part.mountpoint
            if m in seen_mounts:
                continue
            seen_mounts.add(m)

            # Skip pseudo filesystems
            if part.fstype in ("tmpfs", "devtmpfs", "squashfs"):
                continue

            try:
                du = psutil.disk_usage(m)
            except PermissionError:
                continue

            disk_items.append(
                DiskUsageItem(
                    mount=m,
                    total_bytes=du.total,
                    used_bytes=du.used,
                    free_bytes=du.free,
                    percent=float(du.percent),
                )
            )

        # If no partitions were returned (rare), fallback to "/"
        if not disk_items:
            du = psutil.disk_usage("/")
            disk_items.append(
                DiskUsageItem(
                    mount="/",
                    total_bytes=du.total,
                    used_bytes=du.used,
                    free_bytes=du.free,
                    percent=float(du.percent),
                )
            )

        net = psutil.net_io_counters()
        net_io = NetIO(bytes_sent=net.bytes_sent, bytes_recv=net.bytes_recv)

        uptime_seconds = int(time.time() - psutil.boot_time())
        hostname = socket.gethostname()

        m = Metrics(
            cpu_percent=float(cpu_percent),
            load_avg=[float(load_avg[0]), float(load_avg[1]), float(load_avg[2])],
            mem_percent=float(vm.percent),
            mem_total_bytes=int(vm.total),
            mem_used_bytes=int(vm.used),
            mem_available_bytes=int(vm.available),
            disk=disk_items,
            net_io=net_io,
            uptime_seconds=uptime_seconds,
            hostname=hostname,
        )

        return ApiResponse(
            ok=True,
            ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            metrics=m,
        )
    except PermissionError as e:
        response.status_code = 401
        return ApiResponse(ok=False, ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), error=str(e))
    except Exception as e:
        response.status_code = 503
        return ApiResponse(ok=False, ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), error=str(e))
