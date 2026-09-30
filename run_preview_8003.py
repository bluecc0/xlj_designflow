"""Run the isolated new-canvas preview on port 8003."""

from __future__ import annotations

import asyncio
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parent
PRODUCTION = Path(r"D:\design-tool")
DB_PATH = ROOT / "jobs.db"

if ROOT == PRODUCTION or ROOT.name != "design-tool-8003":
    raise RuntimeError("Unexpected preview directory")
if not DB_PATH.is_file():
    raise RuntimeError(f"Isolated preview database does not exist: {DB_PATH}")

os.chdir(ROOT)
source = dotenv_values(PRODUCTION / ".env")
for key, value in source.items():
    if value is not None:
        os.environ[key] = value

login_source = Path(source.get("LOGIN_USERS_PATH") or "login_users.json")
if not login_source.is_absolute():
    login_source = PRODUCTION / login_source
login_target = ROOT / "login_users.json"
shutil.copy2(login_source, login_target)

os.environ.update(
    {
        "OUTPUT_PATH": str(PRODUCTION / "output"),
        "LOGIN_USERS_PATH": str(login_target),
        "SUB2API_MONITOR_ENABLED": "false",
        "MATTING_WARMUP_ENABLED": "false",
    }
)
if not os.environ.get("MATTING_MODEL_PATH"):
    model_path = PRODUCTION / "models" / "BiRefNet"
    if model_path.is_dir():
        os.environ["MATTING_MODEL_PATH"] = str(model_path)

from backend import job_store, main

assert job_store._DB_PATH.resolve() == DB_PATH.resolve()
main._SESSION_COOKIE = "designflow_preview_session_8003"


@asynccontextmanager
async def preview_lifespan(app):
    main.init_db()
    app.state.outpainting_semaphore = asyncio.Semaphore(
        max(1, int(main.settings.bfl_outpainting_max_concurrency or 2))
    )
    app.state.outpainting_tasks = set()
    app.state.outpainting_claims = {}
    await asyncio.to_thread(main._ensure_ui_build)
    try:
        yield
    finally:
        tasks = list(app.state.outpainting_tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        await main.proxy_download_stop()


main.app.router.lifespan_context = preview_lifespan


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(main.app, host="0.0.0.0", port=8003)
