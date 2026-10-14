# Initial S02 visual review

Root viewed Chrome connection at1440×900,1920×1080,640×480 and AI at640×480. Connected source/new setup grouping and aligned wide columns satisfy visual direction. Small window retains readable left category labels and a scrollable content area.

Two issues require repair before final freeze:
1. Global button:hover:enabled beats selected category fill; pointer-selected row gets generic grey outline/background. Add scoped hover/selected-hover rules preserving selected tint and transparent border.
2. Shared settings-scroll retains previous long-tab bottom offset. After controls in Chrome were scrolled into view, first AI visit screenshot starts at Save config, hiding title and form. Reset settings scroller on category change and assert first page content/top. Do not reset library scroll or inputs.

Copied initial screenshots to this directory before updated captures. These are review evidence, not final accepted output.
