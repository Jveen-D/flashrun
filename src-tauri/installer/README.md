# FlashRun Windows installer branding

Installer branding introduced in v1.1.6. Artwork generation itself does not create a version, tag or release.

## Design and scope

- Reuse `icons/icon.ico` and the original `icons/128x128@2x.png` logo. Deep navy, cyan and violet artwork complements the existing application identity.
- NSIS EXE: branded welcome/finish sidebar and right-aligned header, Simplified Chinese and English selection, concise welcome/finish copy, clearer maintenance, WebView2 and shortcut labels.
- WiX MSI: matching welcome/finish background and header banner. The existing English MSI language is retained, avoiding a second MSI variant in this presentation-only change.
- Product homepage and descriptions now identify FlashRun. Publisher stays `d8506`, the previous default derived from `com.d8506.flashrun`; changing it changes NSIS registry paths and may affect upgrade discovery. This metadata is not a verified signing identity.
- Existing installer behavior is retained: current-user NSIS install, WebView2 provisioning, privilege requests, shortcut locations/defaults, upgrade/downgrade handling, and app launch selection. No startup entry, telemetry, extra software or signing configuration is added.
- The delete-data checkbox refers to local webview data: the stock template deletes the app-identifier folders in local/roaming AppData, while FlashRun's current project configuration lives at `%USERPROFILE%/flashrun-config.json`.

## Implementation boundaries

The CLI is pinned to **2.10.1** in `package.json`. Its [NSIS template](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.10.1/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi) includes `installerHooks` before defining its MUI pages. `branding.nsh` uses that placement for presentation-only MUI defines; it contains no installation callbacks or executable commands. Recheck this ordering on a CLI upgrade.

`customLanguageFiles` replaces Tauri's custom strings, so both files include all keys from the pinned [official language files](https://github.com/tauri-apps/tauri/tree/tauri-cli-v2.10.1/crates/tauri-bundler/src/bundle/windows/nsis/languages), followed by the FlashRun page labels. Standard buttons, directory controls and other native strings still come from NSIS's built-in language packs.

No full NSIS/WiX template is forked. See the [Tauri configuration reference](https://v2.tauri.app/reference/config/#nsisconfig) for supported branding fields.

## Artwork and reproducibility

`preview.png` is a board of the actual artwork files, **not a screenshot of a running installer**. Text controls are deliberately absent from the MSI background's white area because WiX draws them at runtime.

| Resource | Dimensions | Format |
| --- | --- | --- |
| `assets/nsis-sidebar.bmp` | 164 × 314 | 24-bit uncompressed BMP |
| `assets/nsis-header.bmp` | 150 × 57 | 24-bit uncompressed BMP |
| `assets/wix-banner.bmp` | 493 × 58 | 24-bit uncompressed BMP |
| `assets/wix-dialog.bmp` | 493 × 312 | 24-bit uncompressed BMP |

The editable artwork source is `scripts/generate-installer-assets.mjs`. It generates SVG layouts, embeds the original logo without retouching, rasterizes them, and writes conventional BMP files. The renderer is a development-only tool, not an application dependency. To regenerate on Windows with Segoe UI available:

```powershell
$renderTools = Join-Path $env:TEMP 'flashrun-installer-art-tools'
$renderCache = Join-Path $env:TEMP 'flashrun-installer-art-cache'
npm install --prefix $renderTools --cache $renderCache --registry https://registry.npmjs.org --no-audit --no-fund --ignore-scripts @resvg/resvg-js@2.6.2
node scripts/generate-installer-assets.mjs (Join-Path $renderTools 'node_modules/@resvg/resvg-js/index.js')
```

This does not compile the Tauri application or install system build tools. Different system fonts may affect text rendering, so review regenerated artwork before committing it.

## Validation and remaining acceptance

`pnpm test` validates BMP dimensions/headers, ICO availability, and completeness of both language files and their page-label references. Schema validation and these resource checks do **not** compile NSIS/WiX scripts or exercise installer UI.

The GitHub Windows release build retains `windows-installer-inputs` for 30 days, including the generated NSIS/WiX scripts and branding inputs. Inspect these against the release commit before publication. This confirms packaging inputs, not rendered UI behavior. Before a release, check:

1. Chinese and English language selection, welcome and finish copy, directory and maintenance pages; no clipped text at 100%, 125%, 150% and 200% Windows scaling.
2. Sidebar/header positioning and MSI native text over the white background.
3. Fresh install and upgrade from v1.1.5 in a disposable environment; existing install detection, selected install location, shortcuts and uninstall behavior.
4. WebView2 prerequisite messages and unchanged system signature/security prompts.

No actual installer preview, installation or upgrade has been performed for this change. The separate v1.1.5 application-close GUI test remains user-owned and has not been reported as passed.
