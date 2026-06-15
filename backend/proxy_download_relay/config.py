from __future__ import annotations

from pathlib import Path

from ..config import settings as app_settings


class RelaySettings:
    @property
    def relay_token(self) -> str:
        return app_settings.proxy_download_token.strip() or "change-me"

    @property
    def relay_storage_dir(self) -> Path:
        path = app_settings.output_path / "proxy-downloads"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def relay_profile_dir(self) -> Path:
        legacy = app_settings.root_dir / "proxy_download" / "browser_profile"
        if legacy.exists():
            legacy.mkdir(parents=True, exist_ok=True)
            return legacy
        path = app_settings.root_dir / "runtime" / "proxy-browser-profile"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def relay_allowed_hosts(self) -> str:
        return app_settings.proxy_download_allowed_hosts

    @property
    def relay_headless(self) -> bool:
        return app_settings.proxy_download_headless

    @property
    def relay_browser_channel(self) -> str | None:
        value = app_settings.proxy_download_browser_channel
        if value is None:
            return None
        value = value.strip()
        return value or None

    @property
    def relay_login_url(self) -> str:
        return app_settings.proxy_download_login_url

    @property
    def relay_request_timeout_seconds(self) -> int:
        return app_settings.proxy_download_request_timeout_seconds

    @property
    def relay_navigation_timeout_ms(self) -> int:
        return app_settings.proxy_download_navigation_timeout_ms

    @property
    def allowed_hosts(self) -> set[str]:
        hosts = {
            item.strip().lower()
            for item in self.relay_allowed_hosts.split(",")
            if item.strip()
        }
        if "huaban.com" in hosts:
            hosts.add("huabanimg.com")
        return hosts

    @property
    def browser_channel(self) -> str | None:
        return self.relay_browser_channel


settings = RelaySettings()
