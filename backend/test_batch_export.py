"""
测试 Penpot batch export：一次请求导出多个 frame，观察返回 ZIP 结构。

用法（在项目根目录运行）：
  python -m backend.test_batch_export

脚本会：
1. 登录 Penpot
2. 读取最近一个 special_job 的 file_id / page_id / frame_ids
3. 取前 2 个 frame，发一次 batch export-shapes 请求
4. 下载结果，判断是 PNG 还是 ZIP
5. 如果是 ZIP，打印内部文件列表
6. 把结果保存到 backend/test_batch_export_result.*
"""
from __future__ import annotations

import io
import json
import sqlite3
import sys
import time
import zipfile
from pathlib import Path

# ── 把项目根加到 path ──────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from backend.config import settings
from backend.penpot_client import PenpotClient, to_transit, kw


def main() -> None:
    # ── 从 SQLite 取最近一个完成的 special_job ─────────────────────────────────
    db_path = ROOT / "jobs.db"
    if not db_path.exists():
        print("[ERROR] jobs.db 不存在，请先跑一次特殊品合成")
        return

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM special_jobs WHERE status='done' ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    conn.close()

    if not row:
        print("[ERROR] 没有找到已完成的 special_job，请先跑一次特殊品合成")
        return

    req = json.loads(row["request_json"])
    file_id  = req.get("file_id", "")
    page_id  = req.get("page_id", "")
    frame_ids = req.get("frame_ids", [])

    if not file_id or not page_id or len(frame_ids) < 2:
        print(f"[ERROR] 任务数据不完整: file_id={file_id!r}, page_id={page_id!r}, frames={len(frame_ids)}")
        return

    # 去重后取前 2 个 frame 做测试
    seen: list[str] = []
    for f in frame_ids:
        if f not in seen:
            seen.append(f)
    test_frames = seen[:2]
    if len(test_frames) < 2:
        print(f"[WARN] frame_ids 去重后不足 2 个（共 {len(seen)} 个），用全部")
        test_frames = seen

    print(f"[INFO] 使用任务: {row['id'][:8]}…")
    print(f"[INFO] file_id={file_id[:8]}…  page_id={page_id[:8]}…")
    print(f"[INFO] 测试 frame_ids ({len(test_frames)} 个): {[f[:8]+'…' for f in test_frames]}")

    # ── 登录 ──────────────────────────────────────────────────────────────────
    client = PenpotClient(settings.penpot_base_url, settings.penpot_access_token)
    print(f"[INFO] 登录 {settings.penpot_base_url} …")
    client.login(settings.penpot_email, settings.penpot_password)
    print(f"[INFO] 登录成功，profile_id={client.profile_id[:8]}…")

    # ── 先用 get_file 验证 frame 还存在（file 可能已删除）─────────────────────
    # 这个 file_id 是合成时的副本，可能已经被删了。如果找不到，用原始模板 file_id
    # 直接尝试，失败了再说
    print(f"[INFO] 验证副本文件可访问…")
    try:
        file_data = client.get_file(file_id)
        print(f"[INFO] 文件可访问: {file_data.get('name', '?')}")
    except Exception as e:
        print(f"[WARN] 副本文件无法访问: {e}")
        print("[INFO] 尝试用原始模板 file_id（需要你手动填入）")
        print("       请在脚本里把 file_id / page_id / frame_ids 改为模板的真实值")
        return

    # ── 方案 A：多帧 batch（单次请求，wait=True）─────────────────────────────
    print(f"\n{'='*50}")
    print("方案 A: 多帧 batch export（单请求）")
    print(f"{'='*50}")

    exports_list = [
        {
            "page-id":    page_id,
            "file-id":    file_id,
            "object-id":  fid,
            "type":       kw("png"),
            "suffix":     "",
            "scale":      1.0,
            "name":       f"frame_{i}",
            "background": False,
        }
        for i, fid in enumerate(test_frames)
    ]
    payload = {
        "cmd":        kw("export-shapes"),
        "exports":    exports_list,
        "profile-id": client.profile_id,
        "wait":       True,
    }

    print(f"[INFO] 等待 2s 后发送（{len(exports_list)} 个 frame）…")
    time.sleep(2)
    t0 = time.time()
    body = json.dumps(to_transit(payload))
    resp_a = client._session.post(
        f"{settings.penpot_base_url}/api/export",
        headers={"Content-Type": "application/transit+json"},
        data=body,
        timeout=120,
    )
    t_a = time.time() - t0
    print(f"[INFO] HTTP {resp_a.status_code}, {len(resp_a.content)} bytes, 耗时 {t_a:.2f}s")
    if resp_a.ok:
        ct = resp_a.headers.get("Content-Type", "")
        result_a = _download_export_result(client, resp_a)
        _report_result(result_a, ROOT / "backend" / "test_batch_result_a")
    else:
        print(f"[FAIL] {resp_a.text[:200]}")

    # ── 方案 B：并行单帧导出（ThreadPoolExecutor）────────────────────────────
    print(f"\n{'='*50}")
    print("方案 B: 并行单帧导出（每帧独立请求，并发执行）")
    print(f"{'='*50}")
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def export_single(idx: int, fid: str) -> tuple[int, bytes, float]:
        t = time.time()
        pl = {
            "cmd": kw("export-shapes"),
            "exports": [{
                "page-id":    page_id,
                "file-id":    file_id,
                "object-id":  fid,
                "type":       kw("png"),
                "suffix":     "",
                "scale":      1.0,
                "name":       f"frame_{idx}",
                "background": False,
            }],
            "profile-id": client.profile_id,
            "wait":       True,
        }
        b = json.dumps(to_transit(pl))
        r = client._session.post(
            f"{settings.penpot_base_url}/api/export",
            headers={"Content-Type": "application/transit+json"},
            data=b, timeout=120,
        )
        if not r.ok:
            raise RuntimeError(f"frame_{idx} 导出失败 HTTP {r.status_code}: {r.text[:100]}")
        png = _download_export_result(client, r)
        return idx, png, time.time() - t

    print(f"[INFO] 等待 2s 后并发发送 {len(test_frames)} 个请求…")
    time.sleep(2)
    t0 = time.time()
    results_b: dict[int, bytes] = {}
    with ThreadPoolExecutor(max_workers=len(test_frames)) as pool:
        futures = {pool.submit(export_single, i, fid): i for i, fid in enumerate(test_frames)}
        for fut in as_completed(futures):
            try:
                idx, png, elapsed_i = fut.result()
                results_b[idx] = png
                print(f"  frame_{idx}: {len(png)//1024} KB, 单帧耗时 {elapsed_i:.2f}s")
            except Exception as e:
                print(f"  [FAIL] {e}")
    t_b = time.time() - t0
    print(f"[INFO] 全部完成，总耗时 {t_b:.2f}s（{len(results_b)}/{len(test_frames)} 成功）")
    for idx, png in sorted(results_b.items()):
        p = ROOT / "backend" / f"test_batch_result_b_frame{idx}.png"
        p.write_bytes(png)
        print(f"  已保存: {p.name}")

    # ── 对比结论 ──────────────────────────────────────────────────────────────
    print(f"\n{'='*50}")
    print("对比结论")
    print(f"{'='*50}")
    print(f"  方案 A (batch 单请求):  {'失败' if not resp_a.ok else f'{t_a:.2f}s'}")
    print(f"  方案 B (并行单帧):      {t_b:.2f}s  ({len(test_frames)} 帧同时跑)")
    n = len(test_frames)
    print(f"\n  当前串行估算（{n} 帧 × ~{t_b/n:.1f}s）: ~{t_b:.1f}s（若串行）")
    print(f"  并行方案实际耗时:        {t_b:.2f}s")


# ── 工具函数 ───────────────────────────────────────────────────────────────────

def _download_export_result(client, resp) -> bytes:
    """从 export 响应里取出实际 PNG/ZIP 字节（处理 URI 跳转）"""
    ct = resp.headers.get("Content-Type", "")
    if "json" in ct or "transit" in ct:
        try:
            data = resp.json()
            if isinstance(data, dict):
                clean = {k.lstrip("~:"): v for k, v in data.items()}
                uri = clean.get("uri", "")
                if isinstance(uri, dict):
                    uri = uri.get("~#uri", "")
                if uri:
                    dl = client._session.get(str(uri), timeout=60)
                    return dl.content
        except Exception:
            pass
    return resp.content


def _report_result(data: bytes, base_path: Path) -> None:
    if not data:
        print("  [空响应]")
        return
    is_zip = data[:4] == b'PK\x03\x04'
    is_png = data[:8] == b'\x89PNG\r\n\x1a\n'
    kind = "ZIP" if is_zip else "PNG" if is_png else "未知"
    print(f"  类型: {kind}, 大小: {len(data)//1024} KB")
    if is_zip:
        p = Path(str(base_path) + ".zip")
        p.write_bytes(data)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for info in zf.infolist():
                print(f"    ZIP内: {info.filename}  {info.file_size} bytes")
        print(f"  已保存: {p.name}")
    elif is_png:
        p = Path(str(base_path) + ".png")
        p.write_bytes(data)
        print(f"  已保存: {p.name}")
    else:
        print(f"  原始: {data[:32]!r}")


if __name__ == "__main__":
    main()
