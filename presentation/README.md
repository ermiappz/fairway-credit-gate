# Private browser demonstration

Serve this directory over HTTP. `data.json` is the snapshot/replay payload; `app.js` and `styles.css` implement the interactive views. Source strings are escaped before rendering. No external scripts, fonts, analytics or live backend calls are used. GitHub links require repository access; cross-project links point to separate private Sites.

The top-level workspace `demo-console/build.py` assembles these files from repository-owned demo outputs. Each committed presentation directory is independently runnable. Do not publish this directory publicly without reviewing its data scope.
