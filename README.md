# interactive-plots

Static Plotly figures, one permanent URL each, published with GitHub Pages.

**Live site:** https://jmeneghini.github.io/interactive-plots/

## Layout

```
projects/<name>/     Python that generates the plots
site/<name>/         the generated .html (committed, this is what's served)
tools/plotsite.py    save() helper — writes to the right place
tools/build_index.py generates the browsable index (CI runs it; gitignored)
```

## URLs

A figure saved as `save(fig, "effective-energy")` from `projects/pipi-scattering/`
lands at `site/pipi-scattering/effective-energy.html` and is served at:

```
https://jmeneghini.github.io/interactive-plots/pipi-scattering/effective-energy.html
```

The path mirrors the folder structure, so links stay stable as long as you don't
rename things. `subdir=` in `save()` adds another level if a project needs it.

## Adding a new set of plots

```bash
cp -r projects/example projects/my-analysis
# edit projects/my-analysis/make_plots.py
python projects/my-analysis/make_plots.py
python tools/build_index.py          # optional: preview the index locally
git add projects/my-analysis site/my-analysis
git commit -m "add my-analysis plots"
git push
```

Pushing to `main` triggers the Pages deploy — usually live in under a minute.

## Notes

- `plotsite.save()` uses `include_plotlyjs="cdn"`, so each page is ~50 kB rather
  than ~4 MB. Set `INCLUDE_PLOTLYJS = True` in `tools/plotsite.py` if the plots
  need to work without network access.
- Index pages are regenerated on every push and are gitignored — don't edit them.
- GitHub Pages has a 1 GB repo soft limit and serves files up to 100 MB. Large
  raw data belongs elsewhere (`.gitignore` already excludes `*.h5`, `*.npy`).

## Local preview

```bash
python tools/build_index.py && python -m http.server -d site 8000
```
