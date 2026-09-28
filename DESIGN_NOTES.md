# Design notes

Reference inspected: `../BOW/index.html`, `../BOW/styles.css`, `../BOW/bny-theme.css`, `../BOW/avenir.css`, `../BOW/light-mode.css`, and `../BOW/bny-logo.svg`. The source was inspected without copying its business records, access gate, or Supabase logic.

The monitor uses the BOW deep navy (`#00243d`), teal (`#55c7d3`), restrained borders, near-square cards and controls, compact uppercase navigation, small eyebrow labels, and Avenir-first type stack. Its sidebar, top bar, metrics, attention panel, and dense table follow the BOW page hierarchy. The supplied SVG is copied locally to `public/bny-logo.svg`. At narrow widths the sidebar becomes a horizontal nav and tables scroll within their panel.

The monitor has distinct live and sample-data badges. Amber is reserved for issues and sample mode; gray indicates unavailable evidence. No visual treatment implies operational success without observations.
