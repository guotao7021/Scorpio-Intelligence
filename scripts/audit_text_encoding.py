#!/usr/bin/env python3
"""Audit website text files for UTF-8 decode errors and common mojibake."""

from __future__ import annotations

from pathlib import Path


TEXT_SUFFIXES = {
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".sql",
    ".toml",
    ".txt",
    ".yaml",
    ".yml",
}

FOCUS_FILES = {
    Path("docs/public/scorpio_v1_admin.html"),
    Path("docs/public/scorpio_v1_admin.js"),
    Path("cloudflare/license-api/src/worker.js"),
    Path("README.md"),
}

LATIN_MOJIBAKE_MARKERS = (
    "\u00c3",
    "\u00c2",
    "\u00e2\u20ac",
)

CJK_MOJIBAKE_MARKERS = (
    "\u9435",
    "\u93bb",
    "\u9365",
    "\u934f",
    "\u7487",
    "\u7039",
    "\u93c1",
    "\u6423",
    "\u9286",
    "\u7d1d",
    "\u20ac",
)


def is_text_file(path: Path) -> bool:
    return (
        path.is_file()
        and path.suffix.lower() in TEXT_SUFFIXES
        and ".git" not in path.parts
        and "node_modules" not in path.parts
    )


def has_chinese(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def audit_file(root: Path, path: Path) -> list[str]:
    rel = path.relative_to(root).as_posix()
    data = path.read_bytes()
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        return [f"{rel}: UTF-8 decode error at byte {exc.start}: {exc.reason}"]

    findings: list[str] = []
    if "\ufffd" in text:
        findings.append(f"{rel}: contains U+FFFD replacement character")

    for line_no, line in enumerate(text.splitlines(), 1):
        latin_hits = [marker for marker in LATIN_MOJIBAKE_MARKERS if marker in line]
        cjk_hits = [marker for marker in CJK_MOJIBAKE_MARKERS if marker in line]
        if latin_hits or len(cjk_hits) >= 4:
            escaped = line.strip()[:180].encode("unicode_escape").decode("ascii")
            findings.append(f"{rel}:{line_no}: suspicious mojibake marker: {escaped}")
            break

    if path.relative_to(root) in FOCUS_FILES:
        cjk_count = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
        print(
            f"focus {rel}: bytes={len(data)} chinese_chars={cjk_count} "
            f"replacement_chars={text.count(chr(0xFFFD))}"
        )

    if has_chinese(text) and b"charset=\"utf-8\"" not in data.lower() and path.suffix == ".html":
        findings.append(f"{rel}: HTML contains Chinese but does not declare charset=utf-8")

    return findings


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    findings: list[str] = []
    for path in sorted(p for p in root.rglob("*") if is_text_file(p)):
        findings.extend(audit_file(root, path))

    if findings:
        print("encoding audit failed:")
        for finding in findings:
            print(f"- {finding}")
        return 1

    print("encoding audit passed: UTF-8 text files look clean.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
