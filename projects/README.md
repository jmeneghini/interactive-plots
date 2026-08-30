# projects/

One subfolder per analysis. Each folder holds the Python that generates its
plots; the generated HTML goes to `site/<folder-name>/` and is committed.

To start a new one:

```bash
cp -r projects/example projects/my-analysis
$EDITOR projects/my-analysis/make_plots.py
python projects/my-analysis/make_plots.py
```

`save()` infers the project name from the script's own path, so nothing else
needs renaming.
