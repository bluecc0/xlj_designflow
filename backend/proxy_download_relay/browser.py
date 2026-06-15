from __future__ import annotations

import asyncio
import logging
import mimetypes
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from playwright.async_api import (
    BrowserContext,
    Download,
    Error as PlaywrightError,
    Page,
    async_playwright,
)

from .config import settings

logger = logging.getLogger(__name__)
# Ensure logs are visible in uvicorn output (root logger may not be configured)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s %(message)s", datefmt="%H:%M:%S"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)


DOWNLOAD_TEXT_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        "\u4e0b\u8f7d",
        "\u7acb\u5373\u4e0b\u8f7d",
        "\u514d\u8d39\u4e0b\u8f7d",
        "\u4e0b\u8f7d\u7d20\u6750",
        "\u4e0b\u8f7d\u539f\u56fe",
        "\u4e0b\u8f7d\u6587\u4ef6",
        "\u4e0b\u8f7d\u56fe\u7247",
        "\u539f\u56fe",
        "\u7d20\u6750",
        r"download",
        r"save",
        r"free\s*download",
    ]
]

DIRECT_FILE_EXTENSIONS = {
    ".zip",
    ".rar",
    ".7z",
    ".psd",
    ".ai",
    ".eps",
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".svg",
    ".webp",
    ".gif",
    ".mp4",
    ".mov",
}

KNOWN_FORMATS = ("PSD", "PNG", "AI", "EPS", "JPG", "JPEG", "PDF", "SVG")


class BrowserRelay:
    def __init__(self) -> None:
        self._playwright = None
        self._context: BrowserContext | None = None
        self._lock = asyncio.Lock()

    async def start(self, headless: bool | None = None) -> None:
        if headless is None:
            headless = settings.relay_headless
        logger.info("browser.start: headless=%s channel=%s profile=%s", headless, settings.browser_channel, settings.relay_profile_dir)
        settings.relay_storage_dir.mkdir(parents=True, exist_ok=True)
        settings.relay_profile_dir.mkdir(parents=True, exist_ok=True)
        self._playwright = await async_playwright().start()
        self._context = await self._playwright.chromium.launch_persistent_context(
            user_data_dir=str(settings.relay_profile_dir),
            headless=headless,
            accept_downloads=True,
            channel=settings.browser_channel,
            viewport={"width": 1920, "height": 1080},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/130.0.0.0 Safari/537.36"
            ),
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ],
        )
        logger.info("browser.start: context ready")

    async def stop(self) -> None:
        if self._context is not None:
            await self._context.close()
            self._context = None
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None

    async def ensure_started(self) -> BrowserContext:
        if self._context is None:
            await self.start()
        assert self._context is not None
        return self._context

    async def check_login_status(self) -> dict[str, Any]:
        """检测花瓣网登录状态"""
        async with self._lock:
            context = await self.ensure_started()
            page = await context.new_page()
            try:
                await self._prepare_page(page)
                await page.goto(
                    settings.relay_login_url,
                    wait_until="domcontentloaded",
                    timeout=settings.relay_navigation_timeout_ms,
                )
                await page.wait_for_timeout(2000)

                url = page.url
                logged_in = False
                username = ""

                # 检查是否被重定向到登录页
                if "/login" in url.lower():
                    logged_in = False
                else:
                    # 查找登录状态指示器：用户头像、个人菜单等
                    selectors = [
                        ".user-avatar",
                        ".user-info",
                        ".user-name",
                        ".header-user",
                        ".header .avatar",
                        "[class*='user']",
                        "[class*='avatar']",
                        "a[href*='/user/']",
                        "a[href*='/profile/']",
                    ]
                    for selector in selectors:
                        try:
                            el = page.locator(selector).first
                            if await el.is_visible():
                                logged_in = True
                                try:
                                    username = (await el.inner_text(timeout=500)).strip()[:40]
                                except PlaywrightError:
                                    pass
                                break
                        except PlaywrightError:
                            continue

                    # 通过页面文本进一步确认
                    if not logged_in:
                        body_text = await page.inner_text("body")
                        logged_in = not any(
                            kw in body_text
                            for kw in ["登录", "注册", "Log in", "Sign in"]
                        )

                # 收集 cookies 摘要
                cookies = await context.cookies()
                cookie_names = [c["name"] for c in cookies if c.get("domain", "").find("huaban") != -1]

                return {
                    "logged_in": logged_in,
                    "username": username[:40] if username else "",
                    "page_url": url,
                    "has_cookies": len(cookie_names) > 0,
                }
            finally:
                await page.close()

    async def trigger_login(self) -> None:
        """非阻塞打开登录页面（API 用），临时切换到有头模式"""
        async with self._lock:
            if self._context is not None:
                await self._context.close()
                self._context = None
            await self.start(headless=False)
            context = self._context
            page = await context.new_page()
            await self._prepare_page(page)
            await page.goto(
                settings.relay_login_url,
                wait_until="domcontentloaded",
                timeout=settings.relay_navigation_timeout_ms,
            )
            print(f"Browser opened at {settings.relay_login_url}")

    async def login_shell(self) -> None:
        """阻塞式登录（CLI 用），临时切换到有头模式，完成后恢复无头"""
        async with self._lock:
            if self._context is not None:
                await self._context.close()
                self._context = None
            await self.start(headless=False)
            context = self._context
            page = await context.new_page()
            await self._prepare_page(page)
            await page.goto(
                settings.relay_login_url,
                wait_until="domcontentloaded",
                timeout=settings.relay_navigation_timeout_ms,
            )
            print(f"Browser opened at {settings.relay_login_url}")
            print("Log in manually, confirm downloads work, then press Enter here to close.")
            input()
            await page.close()
            # 登录完成后切换回无头模式
            await self._context.close()
            self._context = None
            await self.start(headless=True)
            print("Switched back to headless mode.")

    async def fetch_with_format(
        self, source_url: str, download_format: str | None
    ) -> tuple[Path, dict[str, Any]]:
        async with self._lock:
            started = time.monotonic()
            logger.info("fetch_with_format: start, url=%s format=%s", source_url[:100], download_format)
            try:
                context = await self.ensure_started()
                parsed = urlparse(source_url)
                self._assert_allowed_url(source_url)

                if Path(parsed.path).suffix.lower() in DIRECT_FILE_EXTENSIONS:
                    logger.info("fetch_with_format: direct file extension, using HTTP download")
                    return await self._download_via_http(context, source_url)

                logger.info("fetch_with_format: opening page...")
                page = await context.new_page()
                try:
                    await self._prepare_page(page)
                    result = await self._download_from_page(page, source_url, download_format)
                    logger.info("fetch_with_format: done elapsed=%.2fs", time.monotonic() - started)
                    return result
                finally:
                    await page.close()
            except Exception:
                logger.exception("fetch_with_format: failed elapsed=%.2fs", time.monotonic() - started)
                raise

    async def inspect(self, source_url: str) -> dict[str, Any]:
        async with self._lock:
            started = time.monotonic()
            logger.info("inspect: start url=%s", source_url[:100])
            try:
                context = await self.ensure_started()
                self._assert_allowed_url(source_url)
                parsed = urlparse(source_url)

                suffix = Path(parsed.path).suffix.lower()
                if suffix in DIRECT_FILE_EXTENSIONS:
                    direct_format = suffix.lstrip(".").upper()
                    logger.info("inspect: direct file format=%s elapsed=%.2fs", direct_format, time.monotonic() - started)
                    return {
                        "source_url": source_url,
                        "title": Path(parsed.path).name,
                        "formats": [direct_format],
                    }

                page = await context.new_page()
                try:
                    await self._prepare_page(page)
                    logger.info("inspect: goto domcontentloaded timeout=%sms", settings.relay_navigation_timeout_ms)
                    await page.goto(
                        source_url,
                        wait_until="domcontentloaded",
                        timeout=settings.relay_navigation_timeout_ms,
                    )
                    self._assert_allowed_url(page.url)
                    logger.info("inspect: loaded final_url=%s", page.url[:120])
                    await page.wait_for_timeout(1500)
                    title = await page.title()
                    formats = await self._discover_download_formats(page)
                    logger.info("inspect: done elapsed=%.2fs formats=%s title=%s", time.monotonic() - started, formats, title)
                    return {
                        "source_url": source_url,
                        "title": title,
                        "formats": formats,
                    }
                finally:
                    await page.close()
            except Exception:
                logger.exception("inspect: failed elapsed=%.2fs", time.monotonic() - started)
                raise

    async def _prepare_page(self, page: Page) -> None:
        # 隐藏 webdriver 特征
        await page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        """)

    async def _download_from_page(
        self, page: Page, source_url: str, download_format: str | None
    ) -> tuple[Path, dict[str, Any]]:
        started = time.monotonic()
        logger.info("download_from_page: loading %s", source_url[:100])
        await page.goto(
            source_url,
            wait_until="load",
            timeout=settings.relay_navigation_timeout_ms,
        )
        self._assert_allowed_url(page.url)
        logger.info("download_from_page: loaded final_url=%s elapsed=%.2fs", page.url[:120], time.monotonic() - started)
        logger.info("download_from_page: page loaded, waiting network idle...")
        try:
            await page.wait_for_load_state("networkidle", timeout=10_000)
            logger.info("download_from_page: network idle reached")
        except PlaywrightError:
            logger.warning("download_from_page: network idle timeout, continuing")
        await page.wait_for_timeout(2000)
        logger.info("download_from_page: ready, scanning for download button (format=%s)", download_format)

        download = await self._try_click_download(page, download_format)
        if download is not None:
            if isinstance(download, str):
                logger.info("download_from_page: got captured file url, downloading via HTTP: %s", download[:100])
                return await self._download_via_http(page.context, download, source_url)
            logger.info("download_from_page: got playwright download, saving...")
            return await self._save_playwright_download(download, source_url)

        if download_format:
            texts = await self._collect_button_texts(page)
            raise RuntimeError(f"Unable to download requested format: {download_format}")

        logger.info("download_from_page: no direct download, searching for candidate URL...")
        candidate = await self._find_download_candidate(page)
        if candidate is None:
            texts = await self._collect_button_texts(page)
            logger.error("download_from_page: no candidate found, visible buttons: %s", texts[:30])
            raise RuntimeError(
                "No download action found on page. Visible buttons: " +
                (", ".join(texts[:30]) if texts else "(none)")
            )
        logger.info("download_from_page: downloading via HTTP: %s", candidate[:100])
        return await self._download_via_http(page.context, candidate, source_url)

    def _assert_allowed_url(self, source_url: str) -> None:
        parsed = urlparse(source_url)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        allowed = settings.allowed_hosts
        if hostname and not any(hostname == item or hostname.endswith("." + item) for item in allowed):
            raise ValueError(f"Host not allowed: {hostname}")

    async def _collect_button_texts(self, page: Page) -> list[str]:
        """收集页面上所有可见按钮和链接的文本（用于调试）"""
        texts: list[str] = []
        for selector in ["button", "a", "[role='button']"]:
            locator = page.locator(selector)
            count = await locator.count()
            for index in range(min(count, 50)):
                try:
                    text = (await locator.nth(index).inner_text(timeout=300)).strip()
                except PlaywrightError:
                    continue
                if text and len(text) < 100:
                    texts.append(text)
        return texts

    async def _try_click_download(
        self, page: Page, download_format: str | None
    ) -> Download | str | None:
        if download_format:
            logger.info("try_click: targeting format %s", download_format)
            targeted = await self._try_click_specific_format(page, download_format)
            if targeted is not None:
                return targeted
            texts = await self._collect_button_texts(page)
            await self._log_page_diagnostics(page, f"format-{download_format}-not-triggered", [])
            raise RuntimeError(
                f"指定格式 {download_format} 没有触发下载。Visible buttons: " +
                (", ".join(texts[:30]) if texts else "(none)")
            )

        for locator in [page.locator("a, button"), page.locator("[role='button']")]:
            count = await locator.count()
            logger.info("try_click: scanning %d elements with selector...", min(count, 80))
            for index in range(min(count, 80)):
                handle = locator.nth(index)
                try:
                    text = (await handle.inner_text(timeout=500)).strip()
                except PlaywrightError:
                    continue
                if not text:
                    continue
                if any(pattern.search(text) for pattern in DOWNLOAD_TEXT_PATTERNS):
                    logger.info("try_click: found download text '%s', clicking...", text[:60])
                    download = await self._click_download_flow(page, handle)
                    if download is not None:
                        return download
        logger.info("try_click: no matching download button found")
        return None

    async def _try_click_specific_format(
        self, page: Page, download_format: str
    ) -> Download | str | None:
        normalized = download_format.strip().upper()

        direct_handle = await self._find_clickable_with_text(
            page,
            {f"\u4e0b\u8f7d {normalized}", f"\u4e0b\u8f7d{normalized}"},
            selectors=["button", "a", "[role='button']"],
        )
        if direct_handle is not None:
            download = await self._click_download_flow(page, direct_handle)
            if download is not None:
                return download

        trigger = await self._find_clickable_with_text(
            page,
            {"\u4e0b\u8f7d PSD", "\u4e0b\u8f7dPNG", "\u4e0b\u8f7d PNG", "\u4e0b\u8f7d AI", "\u4e0b\u8f7d EPS", "\u4e0b\u8f7d JPG", "\u4e0b\u8f7d JPEG"},
            selectors=["button", "a", "[role='button']"],
        )
        if trigger is not None:
            try:
                await trigger.click()
                await page.wait_for_timeout(800)
            except PlaywrightError:
                pass

        dropdown_handle = await self._find_clickable_with_text(
            page,
            {f"\u4e0b\u8f7d {normalized}", f"\u4e0b\u8f7d{normalized}", normalized},
            selectors=[".ant-dropdown *", ".ant-modal *", "[role='dialog'] *", "button", "a", "[role='button']"],
        )
        if dropdown_handle is not None:
            return await self._click_download_flow(page, dropdown_handle)

        return None

    async def _click_download_flow(self, page: Page, handle) -> Download | str | None:
        recent_responses: list[str] = []
        file_response_urls: list[str] = []

        def _remember_response(response) -> None:
            try:
                url = str(response.url)
                headers = response.headers
                content_type = headers.get("content-type", "")
                disposition = headers.get("content-disposition", "")
                looks_like_file = bool(disposition) or any(ext in url.lower() for ext in DIRECT_FILE_EXTENSIONS)
                if response.status < 400 and looks_like_file:
                    file_response_urls.append(url)
                    del file_response_urls[:-6]
                if response.status >= 400 or looks_like_file:
                    recent_responses.append(
                        f"{response.status} {url[:180]} ct={content_type[:80]} cd={disposition[:120]}"
                    )
                    del recent_responses[:-12]
            except Exception:
                pass

        page.on("response", _remember_response)
        # \u63d0\u53d6 href \u5907\u7528
        href = None
        try:
            try:
                tag = await handle.evaluate("el => el.tagName.toLowerCase()")
                if tag == "a":
                    href = await handle.get_attribute("href")
                    logger.info("click_flow: clicked <a> href=%s", href[:100] if href else None)
            except PlaywrightError:
                pass

            # \u5148\u5c1d\u8bd5 expect_download
            try:
                async with page.expect_download(timeout=8_000) as event:
                    await handle.click()
                logger.info("click_flow: expect_download succeeded")
                return await event.value
            except PlaywrightError as exc:
                logger.info("click_flow: expect_download failed, checking confirm buttons: %s", exc)

            # \u68c0\u67e5\u786e\u8ba4\u6309\u94ae
            await page.wait_for_timeout(1_000)
            for label in ("\u786e\u8ba4\u4e0b\u8f7d", "\u518d\u6b21\u4e0b\u8f7d"):
                confirm = page.locator("button").filter(has_text=label).first
                try:
                    if await confirm.is_visible():
                        logger.info("click_flow: clicking confirm '%s'", label)
                        async with page.expect_download(timeout=20_000) as event:
                            await confirm.click()
                        logger.info("click_flow: confirm download succeeded")
                        return await event.value
                except PlaywrightError as exc:
                    logger.warning("click_flow: confirm '%s' did not trigger download: %s", label, exc)
                    await self._log_page_diagnostics(page, f"confirm-{label}", recent_responses)
                    if file_response_urls:
                        logger.warning("click_flow: using captured file response url=%s", file_response_urls[-1][:180])
                        return file_response_urls[-1]
                    continue

            logger.info("click_flow: no download triggered")
            await self._log_page_diagnostics(page, "no-download-triggered", recent_responses)
            if file_response_urls:
                logger.warning("click_flow: using captured file response url=%s", file_response_urls[-1][:180])
                return file_response_urls[-1]
            return None
        finally:
            try:
                page.remove_listener("response", _remember_response)
            except Exception:
                pass

    async def _log_page_diagnostics(self, page: Page, reason: str, recent_responses: list[str] | None = None) -> None:
        """Dump enough browser state to diagnose why a click did not produce a download."""
        safe_reason = re.sub(r"[^a-zA-Z0-9._-]+", "_", reason)[:60] or "debug"
        stamp = int(time.time() * 1000)
        debug_dir = settings.relay_storage_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        screenshot_path = debug_dir / f"{stamp}_{safe_reason}.png"
        html_path = debug_dir / f"{stamp}_{safe_reason}.html"
        try:
            pages = []
            for p in page.context.pages:
                try:
                    pages.append(p.url[:180])
                except Exception:
                    pass
            title = await page.title()
            body_text = ""
            try:
                body_text = (await page.inner_text("body", timeout=1000)).strip()
            except PlaywrightError as exc:
                body_text = f"<body text unavailable: {exc}>"
            button_texts = await self._collect_button_texts(page)
            logger.warning(
                "download_diag: reason=%s url=%s title=%s pages=%s recent_responses=%s buttons=%s body_preview=%s",
                reason,
                page.url[:180],
                title[:120],
                pages,
                recent_responses or [],
                button_texts[:30],
                " ".join(body_text.split())[:500],
            )
            try:
                await page.screenshot(path=str(screenshot_path), full_page=True, timeout=3000)
                logger.warning("download_diag: screenshot=%s", screenshot_path)
            except PlaywrightError as exc:
                logger.warning("download_diag: screenshot failed: %s", exc)
            try:
                html_path.write_text(await page.content(), encoding="utf-8")
                logger.warning("download_diag: html=%s", html_path)
            except Exception as exc:
                logger.warning("download_diag: html dump failed: %s", exc)
        except Exception:
            logger.exception("download_diag: failed reason=%s", reason)

    async def _discover_download_formats(self, page: Page) -> list[str]:
        formats = self._extract_formats(await self._collect_candidate_texts(page))

        trigger = await self._find_clickable_with_text(
            page,
            {
                "\u4e0b\u8f7d PSD",
                "\u4e0b\u8f7d PNG",
                "\u4e0b\u8f7d AI",
                "\u4e0b\u8f7d EPS",
                "\u4e0b\u8f7d JPG",
                "\u4e0b\u8f7d JPEG",
                "\u4e0b\u8f7d",
            },
        )
        if trigger is not None:
            try:
                await trigger.click()
                await page.wait_for_timeout(800)
            except PlaywrightError:
                pass

        merged = formats[:]
        seen = set(merged)
        for item in self._extract_formats(await self._collect_candidate_texts(page)):
            if item not in seen:
                seen.add(item)
                merged.append(item)
        return merged

    async def _collect_candidate_texts(self, page: Page) -> list[str]:
        texts: list[str] = []
        selectors = [
            "button",
            "a",
            "[role='button']",
            ".ant-dropdown *",
            ".ant-modal *",
            "[role='dialog'] *",
        ]
        for selector in selectors:
            locator = page.locator(selector)
            count = await locator.count()
            for index in range(min(count, 80)):
                handle = locator.nth(index)
                try:
                    text = (await handle.inner_text(timeout=300)).strip()
                except PlaywrightError:
                    continue
                if text:
                    texts.append(text)
        return texts

    def _extract_formats(self, texts: list[str]) -> list[str]:
        formats: list[str] = []
        seen: set[str] = set()
        for raw_text in texts:
            text = " ".join(raw_text.upper().split())
            for pattern in (
                r"\u4e0b\u8f7d\s*(PSD|PNG|AI|EPS|JPG|JPEG|PDF|SVG)\b",
                r"\b(PSD|PNG|AI|EPS|JPG|JPEG|PDF|SVG)\s*\u6587\u4ef6\b",
            ):
                for match in re.findall(pattern, text):
                    if match in KNOWN_FORMATS and match not in seen:
                        seen.add(match)
                        formats.append(match)
        return formats

    async def _find_clickable_with_text(
        self, page: Page, targets: set[str], selectors: list[str] | None = None
    ):
        normalized_targets = {" ".join(item.upper().split()) for item in targets}
        search_selectors = selectors or [
            "button",
            "a",
            "[role='button']",
            ".ant-dropdown *",
            ".ant-modal *",
            "[role='dialog'] *",
        ]
        for selector in search_selectors:
            locator = page.locator(selector)
            count = await locator.count()
            for index in range(min(count, 80)):
                handle = locator.nth(index)
                try:
                    text = (await handle.inner_text(timeout=300)).strip()
                except PlaywrightError:
                    continue
                if not text:
                    continue
                normalized = " ".join(text.upper().split())
                if normalized not in normalized_targets:
                    continue
                try:
                    if await handle.is_visible():
                        return handle
                except PlaywrightError:
                    continue
        return None

    async def _find_download_candidate(self, page: Page) -> str | None:
        anchors = page.locator("a[href]")
        count = await anchors.count()
        for index in range(min(count, 80)):
            handle = anchors.nth(index)
            href = await handle.get_attribute("href")
            if not href:
                continue
            lower_href = href.lower()
            try:
                text = (await handle.inner_text(timeout=500) or "").strip()
            except PlaywrightError:
                text = ""
            if any(ext in lower_href for ext in DIRECT_FILE_EXTENSIONS):
                return page.url.rstrip("/") if href == "#" else urljoin(page.url, href)
            if any(pattern.search(text) for pattern in DOWNLOAD_TEXT_PATTERNS):
                return urljoin(page.url, href)
        return None

    async def _download_via_http(
        self,
        context: BrowserContext,
        file_url: str,
        source_url: str | None = None,
    ) -> tuple[Path, dict[str, Any]]:
        logger.info("http_download: starting, url=%s", file_url[:100])
        cookies = await context.cookies()
        cookie_header = "; ".join(f"{item['name']}={item['value']}" for item in cookies)
        headers = {"Cookie": cookie_header, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"}
        self._assert_allowed_url(file_url)
        async with httpx.AsyncClient(
            follow_redirects=False,
            timeout=settings.relay_request_timeout_seconds,
        ) as client:
            current_url = file_url
            response = None
            for redirect_round in range(6):
                self._assert_allowed_url(current_url)
                logger.info("http_download: request round %d, url=%s", redirect_round, current_url[:100])
                response = await client.get(current_url, headers=headers)
                if response.is_redirect:
                    location = response.headers.get("location")
                    logger.info("http_download: redirect %d -> %s", response.status_code, (location or "")[:100])
                    if not location:
                        break
                    current_url = urljoin(str(response.url), location)
                    continue
                break
            assert response is not None
            self._assert_allowed_url(str(response.url))
            response.raise_for_status()
            filename = self._resolve_filename(response, file_url)
            file_path = self._unique_path(filename)
            file_path.write_bytes(response.content)
            size = file_path.stat().st_size
            logger.info("http_download: saved %s (%d bytes)", file_path.name, size)
            return file_path, {
                "source_url": source_url or file_url,
                "filename": file_path.name,
                "content_type": response.headers.get("content-type"),
                "size": size,
            }

    async def _save_playwright_download(
        self, download: Download, source_url: str
    ) -> tuple[Path, dict[str, Any]]:
        suggested = download.suggested_filename
        file_path = self._unique_path(suggested)
        started = time.monotonic()
        logger.info("save_playwright_download: saving suggested=%s target=%s", suggested, file_path)
        await asyncio.wait_for(
            download.save_as(str(file_path)),
            timeout=max(30, settings.relay_request_timeout_seconds),
        )
        logger.info("save_playwright_download: done elapsed=%.2fs size=%s", time.monotonic() - started, file_path.stat().st_size)
        return file_path, {
            "source_url": source_url,
            "filename": file_path.name,
            "content_type": mimetypes.guess_type(suggested)[0],
            "size": file_path.stat().st_size,
        }

    def _resolve_filename(self, response: httpx.Response, file_url: str) -> str:
        disposition = response.headers.get("content-disposition", "")
        match = re.search(r'filename="?([^";]+)"?', disposition)
        if match:
            return match.group(1)
        parsed = urlparse(file_url)
        name = Path(parsed.path).name
        if name:
            return name
        return "download.bin"

    def _unique_path(self, filename: str) -> Path:
        candidate = settings.relay_storage_dir / Path(filename).name
        stem = candidate.stem
        suffix = candidate.suffix
        counter = 1
        while candidate.exists():
            candidate = settings.relay_storage_dir / f"{stem}-{counter}{suffix}"
            counter += 1
        return candidate


relay = BrowserRelay()
