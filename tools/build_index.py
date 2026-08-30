#!/usr/bin/env python3
"""Generate index.html for site/ and for every subdirectory under it.

Run locally to preview (`python tools/build_index.py`); CI runs it on every
push before deploying to Pages. Generated indexes are gitignored.
"""

from __future__ import annotations

import datetime as dt
import html
import pathlib
import re
import sys

SITE = pathlib.Path(__file__).resolve().parents[1] / "site"

TITLE_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)

CSS = """
:root{--bg:#fbfbfa;--fg:#1a1a19;--muted:#6b6b66;--line:#e3e3df;--card:#fff;--accent:#2b6cb0}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#eceae5;--muted:#9a978f;--line:#2e2e2b;--card:#1e1e1c;--accent:#7aa8d8}}
*{box-sizing:border-box}
body{margin:0;padding:3rem 1.5rem 5rem;background:var(--bg);color:var(--fg);
  font:16px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:52rem;margin:0 auto}
h1{font-size:1.6rem;margin:0 0 .25rem;letter-spacing:-.01em}
h2{font-size:1rem;margin:2.5rem 0 .75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.sub{color:var(--muted);margin:0 0 2rem;font-size:.9rem}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
ul{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
li a{display:block;padding:.85rem 1rem;background:var(--card);border:1px solid var(--line);
  border-radius:8px;color:var(--fg)}
li a:hover{border-color:var(--accent);text-decoration:none}
li a:hover .name{color:var(--accent)}
.name{font-weight:550}
.path{display:block;color:var(--muted);font-size:.8rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:.15rem}
.empty{color:var(--muted);font-style:italic}
footer{margin-top:3.5rem;padding-top:1.25rem;border-top:1px solid var(--line);color:var(--muted);font-size:.8rem}
"""


def page_title(path: pathlib.Path) -> str:
    """Pull <title> out of a generated plot page, falling back to the filename."""
    try:
        head = path.read_text(errors="replace")[:8192]
    except OSError:
        head = ""
    m = TITLE_RE.search(head)
    if m:
        title = html.unescape(m.group(1)).strip()
        if title and title.lower() != "plotly":
            return title
    return path.stem.replace("-", " ").replace("_", " ")


def pretty(name: str) -> str:
    return name.replace("-", " ").replace("_", " ").strip() or name


def render(heading: str, subtitle: str, sections: list[tuple[str, list[tuple[str, str, str]]]],
           up_href: str | None) -> str:
    parts = [
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
        f"<title>{html.escape(heading)}</title><style>{CSS}</style></head><body><div class=\"wrap\">",
    ]
    if up_href:
        parts.append(f'<p class="sub"><a href="{up_href}">&larr; back</a></p>')
    parts.append(f"<h1>{html.escape(heading)}</h1>")
    parts.append(f'<p class="sub">{html.escape(subtitle)}</p>')

    total = sum(len(items) for _, items in sections)
    if not total:
        parts.append('<p class="empty">Nothing published here yet.</p>')

    for section, items in sections:
        if not items:
            continue
        if section:
            parts.append(f"<h2>{html.escape(section)}</h2>")
        parts.append("<ul>")
        for label, href, hint in items:
            parts.append(
                f'<li><a href="{html.escape(href)}"><span class="name">{html.escape(label)}</span>'
                f'<span class="path">{html.escape(hint)}</span></a></li>'
            )
        parts.append("</ul>")

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    parts.append(f"<footer>Generated {stamp}</footer></div></body></html>")
    return "".join(parts)


def build_dir(directory: pathlib.Path) -> int:
    """Write an index for one directory. Returns the number of plots beneath it."""
    subdirs = sorted(p for p in directory.iterdir() if p.is_dir() and not p.name.startswith("."))
    plots = sorted(p for p in directory.iterdir()
                   if p.is_file() and p.suffix == ".html" and p.name != "index.html")

    counts = {sub: build_dir(sub) for sub in subdirs}

    folder_items = [
        (pretty(sub.name), f"{sub.name}/", f"{counts[sub]} plot{'' if counts[sub] == 1 else 's'}")
        for sub in subdirs if counts[sub]
    ]
    plot_items = [
        (page_title(p), p.name, str(p.relative_to(SITE)))
        for p in plots
    ]

    is_root = directory == SITE
    heading = "Interactive plots" if is_root else pretty(directory.name)
    subtitle = ("Static Plotly figures. Every plot has its own permanent link."
                if is_root else f"site/{directory.relative_to(SITE)}")
    sections = [("Folders" if plot_items else "", folder_items), ("Plots", plot_items)]
    up = None if is_root else "../"

    (directory / "index.html").write_text(render(heading, subtitle, sections, up))
    return len(plot_items) + sum(counts.values())


def main() -> int:
    if not SITE.is_dir():
        print(f"no site/ directory at {SITE}", file=sys.stderr)
        return 1
    total = build_dir(SITE)
    print(f"indexed {total} plot page{'' if total == 1 else 's'} under site/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
