"""Reject preview paths that escape or alias a library bucket."""
from pathlib import Path


def safe_preview(root: Path, key: str, create: bool = False) -> Path:
    if not isinstance(key, str) or "\\" in key:
        raise ValueError("invalid preview key")
    parts = key.split("/")
    if (not parts or any(part in ("", ".", "..") for part in parts)
            or not (parts[0] == "previews" or parts[:2] == ["private", "previews"])):
        raise ValueError("invalid preview bucket")
    root = root.resolve()
    current = root
    for index, part in enumerate(parts):
        current = current / part
        if current.is_symlink():
            raise ValueError(f"preview path uses a symlink: {current}")
        if index < len(parts) - 1 and create:
            current.mkdir(exist_ok=True)
        if not current.resolve().is_relative_to(root):
            raise ValueError(f"preview path escapes library: {current}")
    return current
