# Provisional run rejected for taskbar acceptance

Titlebar, sidebar and the temporary Chrome extension rendered the new blue
bookmark/bridge icon. The app and Chrome closed normally, with no remaining
fixture processes.

The taskbar selector matched the unrelated File Explorer window named
Markbridge. `taskbar-button.png` therefore does not verify the app's taskbar
icon. This raw run remains provisional, and AC-S01-4 is not passed by this run.
The next run requires the exact owned main-window title prefix, uses UTF-8
helper output, and obtains physical client bounds with explicit DPI awareness.
