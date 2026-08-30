import json
from pathlib import Path

import numpy as np
import plotly.graph_objects as go


# ============================================================
# RGL transformation
#
#   svec = s_tilde * dvec
#   s_tilde = 1 + Delta / Ecm^2
#
#   nvec = nvec_perp + n_parallel * dvec
#   n_parallel = (nvec . dvec) / d^2
#
#   alpha_n = gamma^{-1}(n_parallel - s_tilde/2)
#   rvec_n = nvec_perp + alpha_n * dvec
# ============================================================

def rgl_transform(
    nvecs,
    dvec,
    Delta_over_mref2,
    Ecm2_over_mref2,
    mrefL,
):
    nvecs = np.asarray(nvecs, dtype=float)
    dvec = np.asarray(dvec, dtype=float)

    if Ecm2_over_mref2 <= 0:
        raise ValueError("Ecm2_over_mref2 must be positive.")

    if mrefL <= 0:
        raise ValueError("mrefL must be positive.")

    d2 = np.dot(dvec, dvec)

    s_tilde = (
        1.0
        + Delta_over_mref2 / Ecm2_over_mref2
    )
    svec = s_tilde * dvec

    gamma = np.sqrt(
        1.0
        + (2.0 * np.pi) ** 2
        * d2
        / (mrefL**2 * Ecm2_over_mref2)
    )

    n_minus_s_over_2 = nvecs - 0.5 * svec

    if d2 == 0:
        return {
            "rvec_n": nvecs.copy(),
            "n_minus_s_over_2": n_minus_s_over_2,
            "svec": svec,
            "s_tilde": s_tilde,
            "gamma": 1.0,
        }

    n_parallel = (nvecs @ dvec) / d2
    nvec_perp = (
        nvecs
        - n_parallel[:, np.newaxis] * dvec
    )

    alpha_n = (
        n_parallel - 0.5 * s_tilde
    ) / gamma

    rvec_n = (
        nvec_perp
        + alpha_n[:, np.newaxis] * dvec
    )

    return {
        "rvec_n": rvec_n,
        "n_minus_s_over_2": n_minus_s_over_2,
        "svec": svec,
        "s_tilde": s_tilde,
        "gamma": gamma,
    }


# ------------------------------------------------------------
# Integer-lattice slice
# ------------------------------------------------------------

N = 5

nx, ny = np.meshgrid(
    np.arange(-N, N + 1),
    np.arange(-N, N + 1),
)

lattice = np.column_stack(
    [nx.ravel(), ny.ravel()]
)


# ------------------------------------------------------------
# Initial parameters
# ------------------------------------------------------------

initial_dx = 0
initial_dy = 1
initial_Delta_over_mref2 = 0.0
initial_Ecm2_over_mref2 = 4.0
initial_mrefL = 15.0

initial_result = rgl_transform(
    lattice,
    np.array([initial_dx, initial_dy]),
    initial_Delta_over_mref2,
    initial_Ecm2_over_mref2,
    initial_mrefL,
)


# ------------------------------------------------------------
# Initial Plotly figure
# ------------------------------------------------------------

fig = go.Figure()

fig.add_trace(
    go.Scatter(
        x=lattice[:, 0],
        y=lattice[:, 1],
        mode="markers",
        name="integer lattice n",
        marker=dict(
            size=8,
            symbol="circle-open",
            color="#555555",
        ),
    )
)

fig.add_trace(
    go.Scatter(
        x=initial_result["n_minus_s_over_2"][:, 0],
        y=initial_result["n_minus_s_over_2"][:, 1],
        mode="markers",
        name="n − s/2",
        marker=dict(
            size=10,
            symbol="x",
            color="#e45756",
        ),
    )
)

fig.add_trace(
    go.Scatter(
        x=initial_result["rvec_n"][:, 0],
        y=initial_result["rvec_n"][:, 1],
        mode="markers",
        name="RGL lattice rₙ",
        marker=dict(
            size=7,
            symbol="circle",
            color="#4c78a8",
        ),
    )
)

fig.add_trace(
    go.Scatter(
        x=[0],
        y=[0],
        mode="markers",
        name="origin",
        marker=dict(
            size=12,
            symbol="cross",
            color="black",
        ),
    )
)

fig.update_layout(
    width=750,
    height=750,
    title=(
        f"RGL lattice: d=({initial_dx}, {initial_dy}), "
        f"s̃={initial_result['s_tilde']:.4f}, "
        f"γ={initial_result['gamma']:.4f}"
    ),
    margin=dict(l=70, r=30, t=80, b=60),
    xaxis=dict(
        title="x",
        scaleanchor="y",
        scaleratio=1,
        zeroline=True,
    ),
    yaxis=dict(
        title="y",
        zeroline=True,
    ),
    legend=dict(
        x=0.02,
        y=0.98,
    ),
)


# include_plotlyjs="cdn" is applied here.
plot_html = fig.to_html(
    full_html=False,
    include_plotlyjs="cdn",
    div_id="rgl-plot",
    config={
        "responsive": True,
        "displaylogo": False,
    },
)


# ------------------------------------------------------------
# HTML controls
# ------------------------------------------------------------

controls_html = """
<div class="rgl-controls">
    <h2>RGL parameters</h2>

    <label>
        <span>dₓ</span>
        <output id="dx-value"></output>
        <input
            id="dx"
            type="range"
            min="-4"
            max="4"
            step="1"
            value="0"
        >
    </label>

    <label>
        <span>dᵧ</span>
        <output id="dy-value"></output>
        <input
            id="dy"
            type="range"
            min="-4"
            max="4"
            step="1"
            value="1"
        >
    </label>

    <label>
        <span>Δ / mref²</span>
        <output id="Delta-value"></output>
        <input
            id="Delta"
            type="range"
            min="-2"
            max="2"
            step="0.02"
            value="0"
        >
    </label>

    <label>
        <span>Ecm² / mref²</span>
        <output id="Ecm2-value"></output>
        <input
            id="Ecm2"
            type="range"
            min="0.1"
            max="20"
            step="0.1"
            value="4"
        >
    </label>

    <label>
        <span>mref Lᵥ</span>
        <output id="mrefL-value"></output>
        <input
            id="mrefL"
            type="range"
            min="2"
            max="50"
            step="0.5"
            value="15"
        >
    </label>

    <div id="rgl-info" class="rgl-info"></div>
</div>
"""


# ------------------------------------------------------------
# Browser-side RGL transformation
# ------------------------------------------------------------

javascript = r"""
<script>
const latticeX = __LATTICE_X__;
const latticeY = __LATTICE_Y__;

const plot = document.getElementById("rgl-plot");

function controlValue(id) {
    return Number(document.getElementById(id).value);
}

function updateReadout(id, digits) {
    document.getElementById(id + "-value").textContent =
        controlValue(id).toFixed(digits);
}

function updatePlot() {
    const dx = controlValue("dx");
    const dy = controlValue("dy");

    const Delta_over_mref2 =
        controlValue("Delta");

    const Ecm2_over_mref2 =
        controlValue("Ecm2");

    const mrefL =
        controlValue("mrefL");

    const d2 = dx * dx + dy * dy;

    const sTilde =
        1.0
        + Delta_over_mref2 / Ecm2_over_mref2;

    const sx = sTilde * dx;
    const sy = sTilde * dy;

    const gamma = Math.sqrt(
        1.0
        + Math.pow(2.0 * Math.PI, 2)
        * d2
        / (
            Math.pow(mrefL, 2)
            * Ecm2_over_mref2
        )
    );

    const shiftedX = [];
    const shiftedY = [];
    const rvecX = [];
    const rvecY = [];

    for (let i = 0; i < latticeX.length; i++) {
        const nx = latticeX[i];
        const ny = latticeY[i];

        // nvec - svec/2
        shiftedX.push(nx - 0.5 * sx);
        shiftedY.push(ny - 0.5 * sy);

        if (d2 === 0) {
            rvecX.push(nx);
            rvecY.push(ny);
            continue;
        }

        const nParallel =
            (nx * dx + ny * dy) / d2;

        const nPerpX =
            nx - nParallel * dx;

        const nPerpY =
            ny - nParallel * dy;

        const alphaN =
            (nParallel - 0.5 * sTilde) / gamma;

        rvecX.push(
            nPerpX + alphaN * dx
        );

        rvecY.push(
            nPerpY + alphaN * dy
        );
    }

    const traces = [
        {
            x: latticeX,
            y: latticeY,
            type: "scatter",
            mode: "markers",
            name: "integer lattice n",
            marker: {
                size: 8,
                symbol: "circle-open",
                color: "#555555"
            }
        },
        {
            x: shiftedX,
            y: shiftedY,
            type: "scatter",
            mode: "markers",
            name: "n − s/2",
            marker: {
                size: 10,
                symbol: "x",
                color: "#e45756"
            }
        },
        {
            x: rvecX,
            y: rvecY,
            type: "scatter",
            mode: "markers",
            name: "RGL lattice rₙ",
            marker: {
                size: 7,
                symbol: "circle",
                color: "#4c78a8"
            }
        },
        {
            x: [0],
            y: [0],
            type: "scatter",
            mode: "markers",
            name: "origin",
            marker: {
                size: 12,
                symbol: "cross",
                color: "black"
            }
        }
    ];

    const layout = {
        width: 750,
        height: 750,
        title: (
            "RGL lattice: d=("
            + dx
            + ", "
            + dy
            + "), s̃="
            + sTilde.toFixed(4)
            + ", γ="
            + gamma.toFixed(4)
        ),
        margin: {
            l: 70,
            r: 30,
            t: 80,
            b: 60
        },
        xaxis: {
            title: "x",
            scaleanchor: "y",
            scaleratio: 1,
            zeroline: true,
            autorange: true
        },
        yaxis: {
            title: "y",
            zeroline: true,
            autorange: true
        },
        legend: {
            x: 0.02,
            y: 0.98
        }
    };

    Plotly.react(
        plot,
        traces,
        layout,
        {
            responsive: true,
            displaylogo: false
        }
    );

    const P2_over_mref2 =
        Math.pow(2.0 * Math.PI, 2)
        * d2
        / Math.pow(mrefL, 2);

    const relation = d2 === 0
        ? "Rest frame: rₙ = n because d = 0."
        : (
            "αₙ = γ⁻¹(n∥ − s̃/2)<br>"
            + "rₙ = n⊥ + αₙd"
        );

    document.getElementById("rgl-info").innerHTML = (
        "s̃ = " + sTilde.toFixed(6) + "<br>"
        + "s = ("
        + sx.toFixed(6)
        + ", "
        + sy.toFixed(6)
        + ")<br>"
        + "γ = " + gamma.toFixed(6) + "<br>"
        + "|d|² = " + d2.toFixed(0) + "<br>"
        + "|P|²/mref² = "
        + P2_over_mref2.toFixed(6)
        + "<br><br>"
        + relation
    );
}

const controls = [
    ["dx", 0],
    ["dy", 0],
    ["Delta", 2],
    ["Ecm2", 2],
    ["mrefL", 1]
];

for (const [id, digits] of controls) {
    const input = document.getElementById(id);

    input.addEventListener("input", function () {
        updateReadout(id, digits);
        updatePlot();
    });

    updateReadout(id, digits);
}

updatePlot();
</script>
"""

javascript = javascript.replace(
    "__LATTICE_X__",
    json.dumps(lattice[:, 0].tolist()),
).replace(
    "__LATTICE_Y__",
    json.dumps(lattice[:, 1].tolist()),
)


# ------------------------------------------------------------
# Complete HTML document
# ------------------------------------------------------------

stylesheet = """
<style>
body {
    margin: 0;
    padding: 20px;
    background: white;
    color: #222222;
    font-family: Arial, sans-serif;
}

.rgl-page {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 24px;
    max-width: 1120px;
    margin: 0 auto;
}

.rgl-controls {
    box-sizing: border-box;
    width: 300px;
    margin-top: 65px;
    padding: 18px;
    border: 1px solid #d8d8d8;
    border-radius: 10px;
    background: #fafafa;
}

.rgl-controls h2 {
    margin: 0 0 20px;
    font-size: 18px;
}

.rgl-controls label {
    display: grid;
    grid-template-columns: 1fr auto;
    margin-bottom: 18px;
    font-size: 14px;
}

.rgl-controls input {
    grid-column: 1 / -1;
    width: 100%;
    margin-top: 6px;
}

.rgl-controls output {
    font-family: monospace;
}

.rgl-info {
    margin-top: 20px;
    padding-top: 15px;
    border-top: 1px solid #d8d8d8;
    font-family: monospace;
    font-size: 14px;
    line-height: 1.55;
}

@media (max-width: 950px) {
    .rgl-page {
        flex-direction: column;
        align-items: center;
    }

    .rgl-controls {
        width: min(750px, 95vw);
        margin-top: 0;
    }
}
</style>
"""

html = (
    "<!doctype html>"
    "<html lang='en'>"
    "<head>"
    "<meta charset='utf-8'>"
    "<meta name='viewport' "
    "content='width=device-width, initial-scale=1'>"
    "<title>RGL moving-frame momentum lattice</title>"
    + stylesheet
    + "</head>"
    "<body>"
    "<main class='rgl-page'>"
    + controls_html
    + plot_html
    + "</main>"
    + javascript
    + "</body>"
    "</html>"
)


# ------------------------------------------------------------
# Save the HTML
# ------------------------------------------------------------

output_html = Path("rgl_lattice.html").resolve()

output_html.write_text(
    html,
    encoding="utf-8",
)

print(f"Wrote: {output_html}")