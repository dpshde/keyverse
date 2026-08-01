#!/usr/bin/env python3
"""Head-to-head keyverse door bench: Elixir vs Node (+ optional Railway)."""
from __future__ import annotations

import json
import os
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] if (Path(__file__).name == "bench_doors.py") else Path.cwd()


def http(method: str, url: str, data: bytes | None = None, headers: dict | None = None, timeout=30):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            dt = (time.perf_counter() - t0) * 1000
            return resp.status, body, dt, dict(resp.headers)
    except urllib.error.HTTPError as e:
        body = e.read()
        dt = (time.perf_counter() - t0) * 1000
        return e.code, body, dt, dict(e.headers)
    except Exception as e:
        dt = (time.perf_counter() - t0) * 1000
        return 0, str(e).encode(), dt, {}


def pct(xs, p):
    if not xs:
        return None
    s = sorted(xs)
    k = (len(s) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def wait_health(base, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        code, body, _, _ = http("GET", f"{base}/health", timeout=2)
        if code == 200 and b'"ok"' in body:
            return True
        time.sleep(0.15)
    return False


def bench_target(name: str, base: str, door: str):
    results = {"name": name, "base": base, "door": door, "steps": {}, "errors": []}

    # setup pack
    from urllib.parse import urlencode

    form = urlencode({"intent": "claim", "door": door}).encode()
    code, body, ms, hdrs = http(
        "POST",
        f"{base}/setup",
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    results["steps"]["setup_ms"] = ms
    results["steps"]["setup_status"] = code
    if code not in (200, 302):
        # maybe already exists - try continue
        results["errors"].append(f"setup status {code}: {body[:200]}")

    # health latency sample
    h_lat = []
    for _ in range(50):
        code, _, ms, _ = http("GET", f"{base}/health")
        if code == 200:
            h_lat.append(ms)
        else:
            results["errors"].append(f"health {code}")
    results["steps"]["health"] = summarize(h_lat)

    # note PUT sequential
    put_lat = []
    for i in range(40):
        slug = "jhn.3.16" if i == 0 else f"jhn.3.{(i % 20) + 1}"
        # use valid-ish verses jhn.3.1-20
        payload = json.dumps(
            {"blocks": [{"id": f"b{i}", "indent": 0, "text": f"bench line {i} {name}"}]}
        ).encode()
        code, body, ms, _ = http(
            "PUT",
            f"{base}/{door}/api/note/{slug}",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        put_lat.append(ms)
        if code != 200:
            results["errors"].append(f"put {slug} {code} {body[:120]}")
    results["steps"]["put_note"] = summarize(put_lat)

    # GET note
    get_lat = []
    for i in range(40):
        slug = f"jhn.3.{(i % 20) + 1}"
        code, _, ms, _ = http("GET", f"{base}/{door}/api/note/{slug}")
        get_lat.append(ms)
        if code not in (200, 404):
            results["errors"].append(f"get {code}")
    results["steps"]["get_note"] = summarize(get_lat)

    # list notes
    list_lat = []
    for _ in range(30):
        code, body, ms, _ = http("GET", f"{base}/{door}/api/notes")
        list_lat.append(ms)
        if code != 200:
            results["errors"].append(f"list {code}")
        else:
            try:
                n = len(json.loads(body))
                results["steps"]["notes_count"] = n
            except Exception:
                pass
    results["steps"]["list_notes"] = summarize(list_lat)

    # protocol
    code, body, ms, _ = http("GET", f"{base}/{door}/api/protocol")
    results["steps"]["protocol_ms"] = ms
    results["steps"]["protocol_status"] = code
    try:
        results["steps"]["protocol"] = json.loads(body)
    except Exception:
        results["steps"]["protocol_raw"] = body[:200].decode(errors="replace")

    # concurrent health (noisy neighbor-ish)
    conc = []
    errs = 0

    def one(_):
        nonlocal errs
        c, _, ms, _ = http("GET", f"{base}/health")
        if c != 200:
            errs += 1
        return ms

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=32) as ex:
        futs = [ex.submit(one, i) for i in range(200)]
        for f in as_completed(futs):
            conc.append(f.result())
    wall = (time.perf_counter() - t0) * 1000
    results["steps"]["concurrent_health_200x32"] = {
        **summarize(conc),
        "wall_ms": wall,
        "rps": 200 / (wall / 1000) if wall else None,
        "errors": errs,
    }

    # concurrent PUT across different slugs
    putc = []
    perrs = 0

    def put_one(i):
        nonlocal perrs
        slug = f"jhn.1.{(i % 25) + 1}"
        payload = json.dumps(
            {"blocks": [{"id": f"c{i}", "indent": 0, "text": f"conc {i}"}]}
        ).encode()
        c, _, ms, _ = http(
            "PUT",
            f"{base}/{door}/api/note/{slug}",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        if c != 200:
            perrs += 1
        return ms

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = [ex.submit(put_one, i) for i in range(80)]
        for f in as_completed(futs):
            putc.append(f.result())
    wall = (time.perf_counter() - t0) * 1000
    results["steps"]["concurrent_put_80x16"] = {
        **summarize(putc),
        "wall_ms": wall,
        "rps": 80 / (wall / 1000) if wall else None,
        "errors": perrs,
    }

    return results


def summarize(xs):
    if not xs:
        return {"n": 0}
    return {
        "n": len(xs),
        "min_ms": round(min(xs), 3),
        "p50_ms": round(pct(xs, 50), 3),
        "p95_ms": round(pct(xs, 95), 3),
        "p99_ms": round(pct(xs, 99), 3),
        "max_ms": round(max(xs), 3),
        "mean_ms": round(statistics.mean(xs), 3),
    }


def rss_kb(pid):
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1])
    except Exception:
        return None


def main():
    out = {"ts": time.time(), "hosts": {}}

    # --- start elixir ---
    e_dir = "/tmp/kv-bench-elixir"
    os.makedirs(e_dir, exist_ok=True)
    env_e = os.environ.copy()
    env_e.update(
        {
            "MIX_ENV": "prod",
            "PORT": "4191",
            "HOST": "127.0.0.1",
            "PACK_DIR": e_dir,
            "FATHOM_SITE": "off",
            "START_SERVER": "true",
        }
    )
    # ensure release or mix run
    elixir = subprocess.Popen(
        ["mix", "run", "--no-halt"],
        cwd=str(ROOT),
        env=env_e,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # --- start node ---
    n_dir = "/tmp/kv-bench-node"
    os.makedirs(n_dir, exist_ok=True)
    env_n = os.environ.copy()
    env_n.update(
        {
            "PORT": "4192",
            "HOST": "127.0.0.1",
            "PACK_DIR": n_dir,
            "FATHOM_SITE": "off",
        }
    )
    node = subprocess.Popen(
        ["node", "server.mjs"],
        cwd=str(ROOT),
        env=env_n,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        ok_e = wait_health("http://127.0.0.1:4191", 45)
        ok_n = wait_health("http://127.0.0.1:4192", 45)
        out["elixir_up"] = ok_e
        out["node_up"] = ok_n
        out["elixir_pid"] = elixir.pid
        out["node_pid"] = node.pid
        out["elixir_rss_kb_idle"] = rss_kb(elixir.pid)
        # node may be parent; find child beam not needed
        out["node_rss_kb_idle"] = rss_kb(node.pid)

        if ok_e:
            out["hosts"]["elixir"] = bench_target(
                "elixir", "http://127.0.0.1:4191", "bench-elixir-door-pack"
            )
            out["elixir_rss_kb_after"] = rss_kb(elixir.pid)
            # beam child
            try:
                ps = subprocess.check_output(["pgrep", "-P", str(elixir.pid)], text=True)
                kids = [int(x) for x in ps.split()]
                out["elixir_child_pids"] = kids
                out["elixir_child_rss_kb"] = {str(p): rss_kb(p) for p in kids}
            except Exception as e:
                out["elixir_child_err"] = str(e)

        if ok_n:
            out["hosts"]["node"] = bench_target(
                "node", "http://127.0.0.1:4192", "bench-node-door-pack"
            )
            out["node_rss_kb_after"] = rss_kb(node.pid)

        # Railway production
        rbase = "https://keyverse-production.up.railway.app"
        if wait_health(rbase, 20):
            r = {"name": "railway", "base": rbase}
            h = []
            for _ in range(40):
                code, body, ms, _ = http("GET", f"{rbase}/health")
                h.append(ms)
            r["health"] = summarize(h)
            code, body, ms, _ = http("GET", f"{rbase}/health")
            try:
                r["health_body"] = json.loads(body)
            except Exception:
                pass
            # concurrent health only (don't spam writes on prod without door)
            conc = []
            t0 = time.perf_counter()
            with ThreadPoolExecutor(max_workers=20) as ex:
                futs = [ex.submit(lambda: http("GET", f"{rbase}/health")[2]) for _ in range(100)]
                for f in as_completed(futs):
                    conc.append(f.result())
            wall = (time.perf_counter() - t0) * 1000
            r["concurrent_health_100x20"] = {
                **summarize(conc),
                "wall_ms": wall,
                "rps": 100 / (wall / 1000),
            }
            # home page latency
            hl = []
            for _ in range(20):
                _, _, ms, _ = http("GET", f"{rbase}/")
                hl.append(ms)
            r["home_get"] = summarize(hl)
            out["hosts"]["railway"] = r
        else:
            out["railway_up"] = False
    finally:
        elixir.terminate()
        node.terminate()
        try:
            elixir.wait(timeout=5)
        except Exception:
            elixir.kill()
        try:
            node.wait(timeout=5)
        except Exception:
            node.kill()

    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    # run from repo root
    os.chdir(os.environ.get("BENCH_ROOT", "/home/exedev/keyverse"))
    main()
