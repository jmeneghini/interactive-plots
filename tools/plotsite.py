"""Helpers for writing plots into the published site tree.

Import from any script under ``projects/``::

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "tools"))
    from plotsite import save, save_html

Use ``save()`` for a plain Plotly figure::

    save(fig, "effective-mass", title="Effective mass, pi-pi I=1")

Use ``save_html()`` when the script assembles its own HTML document — custom
controls, stylesheets, browser-side callbacks::

    save_html(document, "rgl-lattice")

Either way the page lands at ``site/<project>/<name>.html`` and is served at
``https://<user>.github.io/<repo>/<project>/<name>.html``. ``<project>`` defaults
to the folder the calling script lives in.
"""

from __future__ import annotations

import html as _html
import inspect
import pathlib
import re

# How the plotly.js bundle is delivered. "cdn" keeps each file ~50 kB instead
# of ~4 MB; switch to True if the plots must work offline.
INCLUDE_PLOTLYJS = "cdn"

# Makes a bare write_html() page fill the browser window instead of sitting in a
# fixed 700x450 box. Only applied by save(); a hand-built document brings its own
# layout.
_FILL_CSS = ("<style>html,body{margin:0;height:100%}"
             "body>div:first-of-type{height:100%}</style>")

CONFIG = {
    "displaylogo": False,
    "responsive": True,
    "toImageButtonOptions": {"format": "svg"},
}

_TITLE_RE = re.compile(r"<title>.*?</title>", re.IGNORECASE | re.DOTALL)


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


def output_path(name: str, project: str, subdir: str = "") -> pathlib.Path:
    """Resolve ``site/<project>/[<subdir>/]<name>.html``, creating the directory."""
    out_dir = repo_root() / "site" / slugify(project)
    if subdir:
        out_dir = out_dir / slugify(subdir)
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir / f"{slugify(name)}.html"


def _caller_project(depth: int = 2) -> str:
    return project_of(inspect.stack()[depth].filename)


def _report(path: pathlib.Path) -> pathlib.Path:
    print(f"wrote {path.relative_to(repo_root())}")
    return path


def save(fig, name: str, *, project: str | None = None, title: str | None = None,
         subdir: str = "") -> pathlib.Path:
    """Write a Plotly figure to the site tree and return the path.

    ``title`` becomes the <title> tag, which is what the generated index lists.
    """
    out_path = output_path(name, project or _caller_project(), subdir)

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
    doc = _with_title(out_path.read_text(), title or name.replace("-", " "),
                      extra_head=_FILL_CSS)
    out_path.write_text(doc)
    return _report(out_path)


def save_html(document: str | pathlib.Path, name: str, *, project: str | None = None,
              title: str | None = None, subdir: str = "") -> pathlib.Path:
    """Write a complete, self-assembled HTML document to the site tree.

    ``document`` is either the HTML itself or a path to a file containing it.
    A <title> already present in the document is left alone unless ``title``
    overrides it; the index reads that tag, so every page should have one.
    """
    out_path = output_path(name, project or _caller_project(), subdir)

    doc = document
    if isinstance(document, pathlib.Path) or (
            isinstance(document, str) and "<" not in document[:200]):
        doc = pathlib.Path(document).read_text(encoding="utf-8")

    if title or not _TITLE_RE.search(doc):
        doc = _with_title(doc, title or name.replace("-", " "))

    out_path.write_text(doc, encoding="utf-8")
    return _report(out_path)


def _with_title(doc: str, title: str, extra_head: str = "") -> str:
    """Insert (or replace) the <title> in an HTML document."""
    tag = f"<title>{_html.escape(title)}</title>"
    if _TITLE_RE.search(doc):
        return _TITLE_RE.sub(tag, doc, count=1)
    if "<head>" in doc:
        return doc.replace(
            "<head>",
            '<head><meta name="viewport" content="width=device-width,'
            f'initial-scale=1" />{tag}{extra_head}',
            1,
        )
    return f"<head>{tag}{extra_head}</head>" + doc
