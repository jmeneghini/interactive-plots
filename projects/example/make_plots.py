"""Example project: shows the pattern every subfolder should follow.

Run it from anywhere:  python projects/example/make_plots.py
Output lands in site/example/ and each file gets its own URL.
"""

import pathlib
import sys

import numpy as np
import plotly.graph_objects as go

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "tools"))
from plotsite import save  # noqa: E402


def decaying_cosine():
    t = np.linspace(0, 12, 400)
    fig = go.Figure()
    for m, label in [(0.35, "m = 0.35"), (0.55, "m = 0.55")]:
        fig.add_scatter(x=t, y=np.exp(-m * t) * np.cos(2 * t), mode="lines", name=label)
    fig.update_layout(xaxis_title="t", yaxis_title="C(t)", template="plotly_white")
    return fig


def scatter_with_errors():
    rng = np.random.default_rng(0)
    x = np.arange(1, 21)
    y = 0.42 + 0.03 * rng.standard_normal(20)
    fig = go.Figure(
        go.Scatter(x=x, y=y, mode="markers",
                   error_y=dict(type="data", array=np.full_like(y, 0.03)))
    )
    fig.update_layout(xaxis_title="t", yaxis_title="E_eff", template="plotly_white")
    return fig


if __name__ == "__main__":
    save(decaying_cosine(), "decaying-cosine", title="Damped correlator")
    save(scatter_with_errors(), "effective-energy", title="Effective energy plateau")
