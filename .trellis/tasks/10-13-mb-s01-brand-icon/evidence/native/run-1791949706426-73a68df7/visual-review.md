# Native brand review — PASS

Reviewed the current run's unmodified screenshots and extracted icons:

- `desktop-window.png`: the owned Windows titlebar and application sidebar show
  the blue bookmark silhouette and white bridge arch.
- `taskbar-button.png`: the button is specifically named
  `Markbridge · 签桥 - 1 running window`; its icon matches the titlebar/sidebar.
  The selector excludes the File Explorer window seen in the rejected prior run.
- `window-icon-small.png`: a real 32×32 WM_GETICON small handle has the same
  mark. Tauri supplies no optional large handle; that absence is recorded.
- `exe-associated-icon.png`: Windows extracts the same mark from the copied exe.
- `chrome-extensions.png`: actual Chrome renders the new icon for the unpacked
  temporary extension. Its manifest references all four local PNG sizes; decoded
  dimensions and SHA-256 values match the repository bytes.

The 1100×760 CSS viewport at devicePixelRatio 1.25 corresponds to the helper's
1375×950 physical client and GetDpiForWindow 120. The same current executable is
25,361,920 bytes, SHA-256
`ef06b936da825542c990bbb2125f620075172992ac25d4e680bd58adb663b41e`.

This is portable-exe validation, without installer execution or pairing. Chrome
ran headlessly in its disposable profile; the extension-card screenshot is real
Chrome UI rendering, not a screenshot of a pinned toolbar action. No daily
profile, installed extension, system icon cache or shortcuts were modified.
Both processes exited normally with code 0, and the final owned-process and
listener lists are empty. AC-S01-4 passes this observed surface scope.
