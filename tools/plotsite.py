"""Helpers for writing Plotly figures into the published site tree.

Import from any script under ``projects/``::

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "tools"))
    from plotsite import save

    save(fig, "effective-mass", title="Effective mass, pi-pi I=1")

The figure lands at ``site/<project>/effective-mass.html`` and is served at
``https://<user>.github.io/<repo>/<project>/effective-mass.html``.
"""

from __future__ import annotations

import pathlib
import re

# How the plotly.js bundle is delivered. "cdn" keeps each file ~50 kB instead
# of ~4 MB; switch to True if the plots must work offline.
INCLUDE_PLOTLYJS = "cdn"

# Makes a standalone plot page fill the browser window instead of sitting in a
# fixed 700x450 box.
_FILL_CSS = ("<style>html,body{margin:0;height:100%}"
             "body>div:first-of-type{height:100%}</style>")

CONFIG = {
    "displaylogo": False,
    "responsive": True,
    "toImageButtonOptions": {"format": "svg"},
}


def repo_root() -> pathlib.Path:
    """Walk up from this file until we find the directory holding ``site/``."""
    for parent in pathlib.Path(__file__).resolve().parents:
        if (parent / "site").is_dir():
            return parent
    raise RuntimeError("could not locate repo root (no site/ directory above tools/)")


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not slug:
        raise ValueError(f"{text!r} slugifies to an empty string")
    return slug


def project_of(script: str | pathlib.Path) -> str:
    """Infer the project name from a script's path under ``projects/``."""
    path = pathlib.Path(script).resolve()
    parts = path.parts
    if "projects" in parts:
        return parts[parts.index("projects") + 1]
    return path.parent.name


def save(fig, name: str, *, project: str | None = None, title: str | None = None,
         subdir: str = "") -> pathlib.Path:
    """Write ``fig`` to ``site/<project>/[<subdir>/]<name>.html`` and return the path.

    ``project`` defaults to the folder the calling script lives in.
    ``title`` becomes the <title> tag, which is what the generated index lists.
    """
    import inspect

    if project is None:
        caller = inspect.stack()[1].filename
        project = project_of(caller)

    out_dir = repo_root() / "site" / slugify(project)
    if subdir:
        out_dir = out_dir / slugify(subdir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{slugify(name)}.html"

    if title:
        fig.update_layout(title=fig.layout.title.text or title)

    fig.write_html(
        out_path,
        include_plotlyjs=INCLUDE_PLOTLYJS,
        full_html=True,
        config=CONFIG,
        div_id="plot",
        default_width="100%",
        default_height="100%",
    )

    # write_html emits a bare <head> with no <title>. Inject one so the tab and
    # the generated index show something meaningful.
    _set_title(out_path, title or name.replace("-", " "))

    print(f"wrote {out_path.relative_to(repo_root())}")
    return out_path


def _set_title(path: pathlib.Path, title: str) -> None:
    """Insert (or replace) the <title> in a plotly-generated page."""
    import html as _html

    doc = path.read_text()
    tag = f"<title>{_html.escape(title)}</title>"
    if re.search(r"<title>.*?</title>", doc, re.IGNORECASE | re.DOTALL):
        doc = re.sub(r"<title>.*?</title>", tag, doc, count=1,
                     flags=re.IGNORECASE | re.DOTALL)
    elif "<head>" in doc:
        doc = doc.replace(
            "<head>",
            '<head><meta name="viewport" content="width=device-width,'
            f'initial-scale=1" />{tag}{_FILL_CSS}',
            1,
        )
    else:
        doc = f"<head>{tag}</head>" + doc
    path.write_text(doc)
