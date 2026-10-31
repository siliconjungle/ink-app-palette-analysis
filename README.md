# Palette Analysis

Inspect image palettes through colour-space charts, brightness and saturation comparisons, nearest-colour fields and dithering reports.

## Install

Requires a running [Ink OS](https://github.com/siliconjungle/ink-os-platform) instance and its `ink-os` CLI. Use Node.js 24 or later for development.

```sh
git clone https://github.com/siliconjungle/ink-app-palette-analysis.git
cd ink-app-palette-analysis
npm ci
npm test
npm run build
# Select your Ink instance using its CLI connection profile.
ink-os deploy .
```

The CLI deploys committed source from your checkout. Commit any edits before deploying them. No credentials or personal instance configuration belong in this repository.

## Behaviour and limits

Charts run locally using the bundled DawnBringer Lua scripts and Wasmoon runtime. Large palettes are reduced with explicitly labelled quantisation. Images are limited to 24 MiB and 16 million pixels. Background workflow analysis accepts non-interlaced 8-bit PNGs.

## Development

`npm run dev` opens a local development server. Preview fixtures are separate from live Ink data.

## Notices

DawnBringer scripts and colour calculations are by Richard “DawnBringer” Fhager; the original script notices and readme are retained in `web/vendor/dawn`. Wasmoon and bundled fonts retain their licenses.

## License

MIT for app code. Bundled third-party components retain their own licenses and notices.
