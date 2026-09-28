# Buckshot Helper

A shell counter for Buckshot Roulette, made to run full-screen on an iPhone.

- **Top half:** blanks. **Bottom half:** live rounds.
- **Setup:** tap a half to add a shell (up to 8 each), then tap **START ROUND** in the middle.
- **Firing:** tap a half each time that kind of shell is fired. The middle display shows the chance the next shell is live.
- **UNDO** reverses the last tap, including the one that emptied the gun. **CLEAR / RESET** empties everything.
- The count survives closing the app.

Sounds (shell loading, pump, shotgun blast, blank click) are synthesised in the browser, so there are no audio files to ship. See `web/sounds/README.txt` to use your own recordings instead.

## Install on iPhone

It's a web app you add to the home screen, which runs full-screen with no browser bars and works offline after the first launch. It needs iOS 16.4 or later.

1. Host the `web/` folder over HTTPS. The included workflow publishes it with GitHub Pages: in the repo go to **Settings → Pages → Build and deployment → Source** and pick **GitHub Actions**, then push to `main` (or run the workflow by hand).
2. On the iPhone, open the Pages URL in **Safari**, tap **Share → Add to Home Screen**.
3. Launch it from the home screen icon.

Sound plays even with the silent switch on (iOS 17+). Use the volume buttons to turn it down.

## Local development

```sh
npx http-server web -p 8080
```

`node tools/make-icons.mjs` regenerates the home-screen icons (needs Playwright).
