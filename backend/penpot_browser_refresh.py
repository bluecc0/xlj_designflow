from __future__ import annotations

import json
import asyncio
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable, Optional

import requests

from .penpot_client import PenpotClient


def _free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def _find_browser() -> Optional[str]:
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def _cdp_call(ws, state: dict[str, int], method: str, params: Optional[dict] = None):
    state["id"] += 1
    msg_id = state["id"]
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == msg_id:
            if "error" in msg:
                raise RuntimeError(msg["error"])
            return msg.get("result")


async def _async_cdp_call(ws, state: dict[str, int], method: str, params: Optional[dict] = None):
    state["id"] += 1
    msg_id = state["id"]
    await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    while True:
        msg = json.loads(await ws.recv())
        if msg.get("id") == msg_id:
            if "error" in msg:
                raise RuntimeError(msg["error"])
            return msg.get("result")


async def _refresh_with_websockets(ws_url: str, edit_url: str, auth_token: str, wait_seconds: float) -> str:
    from websockets.asyncio.client import connect

    async with connect(ws_url, origin="http://127.0.0.1") as ws:
        state = {"id": 0}
        await _async_cdp_call(ws, state, "Network.enable")
        await _async_cdp_call(ws, state, "Page.enable")
        await _async_cdp_call(ws, state, "Runtime.enable")
        await _async_cdp_call(
            ws,
            state,
            "Network.setCookie",
            {
                "name": "auth-token",
                "value": auth_token,
                "url": edit_url.split("/#/")[0],
                "path": "/",
            },
        )
        await _async_cdp_call(ws, state, "Page.navigate", {"url": edit_url})
        await asyncio.sleep(wait_seconds)
        state_result = await _async_cdp_call(
            ws,
            state,
            "Runtime.evaluate",
            {
                "expression": "({href: location.href, title: document.title, ready: document.readyState})",
                "returnByValue": True,
            },
        )
        return ((state_result or {}).get("result") or {}).get("value", {}).get("title", "")


def refresh_penpot_workspace(
    *,
    edit_url: str,
    client: PenpotClient,
    wait_seconds: float = 12.0,
    log: Optional[Callable[[str], None]] = None,
) -> bool:
    """Open Penpot workspace in a temporary headless browser to let Penpot refresh layout data."""

    def emit(msg: str) -> None:
        if log:
            log(msg)

    browser = _find_browser()
    if not browser:
        emit("未找到 Chrome/Edge，跳过 Penpot 布局刷新")
        return False

    auth_token = client._session.cookies.get("auth-token")
    if not auth_token:
        emit("未找到 Penpot auth-token，跳过 Penpot 布局刷新")
        return False

    port = _free_port()
    profile_dir = tempfile.mkdtemp(prefix="penpot-headless-")
    proc: Optional[subprocess.Popen] = None
    try:
        proc = subprocess.Popen(
            [
                browser,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-extensions",
                "--remote-allow-origins=*",
                f"--remote-debugging-port={port}",
                f"--user-data-dir={profile_dir}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        for _ in range(60):
            try:
                requests.get(f"http://127.0.0.1:{port}/json/version", timeout=1).json()
                break
            except Exception:
                time.sleep(0.2)
        else:
            emit("Headless 浏览器启动超时，跳过 Penpot 布局刷新")
            return False

        tab = requests.put(f"http://127.0.0.1:{port}/json/new?about:blank", timeout=2).json()
        title = ""
        try:
            import websocket

            ws = websocket.create_connection(
                tab["webSocketDebuggerUrl"],
                timeout=10,
                origin="http://127.0.0.1",
            )
            try:
                state = {"id": 0}
                _cdp_call(ws, state, "Network.enable")
                _cdp_call(ws, state, "Page.enable")
                _cdp_call(ws, state, "Runtime.enable")
                _cdp_call(
                    ws,
                    state,
                    "Network.setCookie",
                    {
                        "name": "auth-token",
                        "value": auth_token,
                        "url": edit_url.split("/#/")[0],
                        "path": "/",
                    },
                )
                _cdp_call(ws, state, "Page.navigate", {"url": edit_url})
                time.sleep(wait_seconds)
                state_result = _cdp_call(
                    ws,
                    state,
                    "Runtime.evaluate",
                    {
                        "expression": "({href: location.href, title: document.title, ready: document.readyState})",
                        "returnByValue": True,
                    },
                )
                title = ((state_result or {}).get("result") or {}).get("value", {}).get("title", "")
            finally:
                try:
                    ws.close()
                except Exception:
                    pass
        except ModuleNotFoundError:
            title = asyncio.run(
                _refresh_with_websockets(
                    tab["webSocketDebuggerUrl"],
                    edit_url,
                    auth_token,
                    wait_seconds,
                )
            )
        emit(f"Penpot 布局刷新完成: {title or 'workspace'}")
        return True
    except Exception as exc:
        emit(f"Penpot 布局刷新失败，继续导出: {exc}")
        return False
    finally:
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        shutil.rmtree(profile_dir, ignore_errors=True)
