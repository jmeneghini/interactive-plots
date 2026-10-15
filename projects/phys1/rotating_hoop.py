#!/usr/bin/env python3
"""Publish the static rotating-hoop page.

Run ``uv run python projects/phys1/rotating_hoop.py`` from any directory.
The HTML and JavaScript beside this script are copied to site/phys1/; the
JavaScript integrates the equation of motion in the browser.
"""

from pathlib import Path
from shutil import copyfile


SOURCE = Path(__file__).resolve().parent
DESTINATION = SOURCE.parents[1] / "site" / "phys1"


def main() -> None:
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name in ("rotating-hoop.html", "rotating-hoop.js"):
        destination = DESTINATION / name
        copyfile(SOURCE / name, destination)
        print(f"wrote {destination.relative_to(SOURCE.parents[1])}")


if __name__ == "__main__":
    main()
