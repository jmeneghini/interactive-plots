#!/usr/bin/env python3
"""Publish the flavor-space page: neutral mesons as vectors in (uū, dd̄, ss̄) space.

    uv run python projects/quark-flavor/flavor_space.py   -> site/quark-flavor/flavor-space.{html,js}

The page is hand-written HTML plus JavaScript in this folder; the JavaScript
builds all three Plotly figures in the browser. This script copies both into
the site tree (save_html adds the analytics tag to the HTML). The page loads
the script as flavor-space.js?v=<content hash>, so a changed script gets a new
URL instead of being served from the ten-minute GitHub Pages cache.
"""

import pathlib
import hashlib
import sys

SOURCE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE.parents[1] / "tools"))
from plotsite import save_html  # noqa: E402


def main() -> None:
    code = (SOURCE / "flavor-space.js").read_bytes()
    version = hashlib.sha256(code).hexdigest()[:10]
    html = (SOURCE / "flavor-space.html").read_text(encoding="utf-8")
    tag = 'src="./flavor-space.js"'
    if tag not in html:
        raise SystemExit(f"flavor-space.html no longer loads {tag}; update the cache-busting step")
    page = save_html(html.replace(tag, f'src="./flavor-space.js?v={version}"'), "flavor-space")
    script = page.with_name("flavor-space.js")
    script.write_bytes(code)
    print(f"wrote {script.relative_to(SOURCE.parents[1])}")


if __name__ == "__main__":
    main()
