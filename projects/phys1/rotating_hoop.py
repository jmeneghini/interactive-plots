#!/usr/bin/env python3
"""Publish the static rotating-hoop page.

Run ``uv run python projects/phys1/rotating_hoop.py`` from any directory.
The HTML and JavaScript beside this script are copied to site/phys1/; the
JavaScript integrates the equation of motion in the browser.

GitHub Pages lets browsers cache files for ten minutes, so the published HTML
loads the script as ``rotating-hoop.js?v=<content hash>``. A changed script
then gets a new URL and is fetched fresh instead of served from cache.
"""

from hashlib import sha256
from pathlib import Path
from shutil import copyfile


SOURCE = Path(__file__).resolve().parent
DESTINATION = SOURCE.parents[1] / "site" / "phys1"
SCRIPT = "rotating-hoop.js"


def main() -> None:
    DESTINATION.mkdir(parents=True, exist_ok=True)

    script = DESTINATION / SCRIPT
    copyfile(SOURCE / SCRIPT, script)
    print(f"wrote {script.relative_to(SOURCE.parents[1])}")

    version = sha256(script.read_bytes()).hexdigest()[:10]
    html = (SOURCE / "rotating-hoop.html").read_text(encoding="utf-8")
    tag = f'src="./{SCRIPT}"'
    if tag not in html:
        raise SystemExit(f"rotating-hoop.html no longer loads {tag}; update the cache-busting step")
    page = DESTINATION / "rotating-hoop.html"
    page.write_text(html.replace(tag, f'src="./{SCRIPT}?v={version}"'), encoding="utf-8")
    print(f"wrote {page.relative_to(SOURCE.parents[1])}")


if __name__ == "__main__":
    main()
