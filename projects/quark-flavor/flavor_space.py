#!/usr/bin/env python3
"""Publish the flavor-space page: neutral mesons as vectors in (uū, dd̄, ss̄) space.

    uv run python projects/quark-flavor/flavor_space.py   -> site/quark-flavor/flavor-space.{html,js}

The page is hand-written HTML plus JavaScript in this folder; the JavaScript
builds all three Plotly figures in the browser. This script copies both into
the site tree (save_html adds the analytics tag to the HTML).
"""

import pathlib
import shutil
import sys

SOURCE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE.parents[1] / "tools"))
from plotsite import save_html  # noqa: E402


def main() -> None:
    page = save_html(SOURCE / "flavor-space.html", "flavor-space")
    script = page.with_name("flavor-space.js")
    shutil.copyfile(SOURCE / "flavor-space.js", script)
    print(f"wrote {script.relative_to(SOURCE.parents[1])}")


if __name__ == "__main__":
    main()
