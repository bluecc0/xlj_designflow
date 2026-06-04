# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

DesignFlow is an AI-driven e-commerce design asset platform. Operations/designers use conversational AI + a Penpot template library + AI image generation + a local product image library to batch-create product posters.

## Commands

```bash
# Start backend (development)
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Install backend dependencies
pip install -r backend/requirements.txt

# Run a quick API health check
curl http://localhost:8000/health
```

The backend serves the frontend as static files at `/ui`. There is no Node.js build step — `frontend/index.html` contains inline `<script type="text/babel">` blocks that are compiled in the browser. `frontend/build.py` is known broken (see IDEAS.md #10).

On Windows, `start.example.bat` orchestrates the full stack (backend, MCP server, plugin server) with auto-detected IP.

## Architecture

```
frontend-dist/        React UI (browser-side Babel, no build toolchain)
  src/Chat.jsx        Main chat + AI image generation (~1857 lines)
  src/app.jsx         Root component, auth gate, 3-column layout
  src/TemplatePanel.jsx  Left sidebar template browser
  src/Canvas.jsx      Center composition preview
  src/api.js          API client (IIFE, sets window.API)

backend/              Python FastAPI server
  main.py             All routes, lifespan, auth middleware (~1860 lines)
  config.py           Settings from .env + root-level JSON files
  models.py           Pydantic request/response models
  penpot_client.py    Penpot REST API client with Transit+JSON codec
  compose.py          General template compose engine
  special_compose.py  Multi-board compose for "特殊品" templates
  special_compose_full.py  Extended special compose with scene/banner slots
  ai_image.py         AI image generation via APIMart
  table_parser.py     Rule-based Excel/CSV column mapping
  product_library.py  Local product image lookup (path-based, no directory scan)
  job_store.py        SQLite persistence for jobs, sessions, AI chat history
  penpot_browser_refresh.py  Windows browser automation for Penpot layout refresh
  slot_schema.py      Loader for slot_schema.json

jobs.db               SQLite database (auto-created on startup)
product-library/      Local product images organized by type folders
output/               Exported results & AI-generated images
```

## Key Design Decisions

- **No frontend build step**: React runs in the browser via Babel standalone. JSX files in `frontend/src/` are inlined into `index.html` via `build.py`.
- **Penpot as template store**: All design templates live in Penpot files within projects whose names contain "模板". The backend scans Penpot's API to discover templates automatically. No separate template database.
- **Slot naming convention**: Penpot layers use `slot/` prefix (e.g., `slot/product_1/image`, `slot/product_1/name`). The backend finds replaceable layers by this prefix.
- **Serial compose lock**: Penpot's exporter is single-process, so all compose operations go through `threading.Semaphore(1)` to avoid version conflicts.
- **Product image matching is path-based**: `ProductLibrary.find()` constructs candidate paths and checks `exists()`, never using `iterdir()` for hot-path lookups (UNC path perf concern with large directories).
- **Special compose flows** are configured declaratively in `special_flows.json`, not hardcoded.

## Template Discovery Flow

1. `GET /templates` fetches all teams from Penpot
2. Filters to projects whose names contain "模板"
3. Within those projects, filters to files whose names also contain "模板"
4. Each file's frames (boards) become individual `TemplateInfo` entries
5. Special template files ("特殊品模板", "特殊品（完整）模板") are flagged with `is_special` / `is_special_full`

## AI Image Generation

- `/Gpt image 2 <prompt>` → model `gpt-image-2` (text-to-image, strong Chinese understanding)
- `/Nano Banana pro <prompt>` → model `gemini-3-pro-image-preview` (image editing, high consistency)
- Session context: subsequent prompts in the same session get auto-enriched via LLM (SiliconFlow Qwen) and the previous result image is injected as reference
- Slash command routing in `SLASH_MODEL_MAP` (ai_image.py:36-42)

## Key Files for Context

- Product knowledge base injected into AI chat system prompt: `KNOWLEDGE.md`
- Slot field definitions (column aliases, discard keywords): `slot_schema.json`
- Special compose flow config: `special_flows.json`
- Future ideas and known tech debt: `IDEAS.md`
- Full product spec (somewhat outdated vs implementation): `design-tool-prd.md`
