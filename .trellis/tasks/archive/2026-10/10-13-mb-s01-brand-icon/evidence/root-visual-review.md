# S01 root visual review

Reviewed evidence/icon-comparison.png at actual CSS display sizes on white and #171B22 backgrounds: three generated candidates, six sizes each, two backgrounds (36 samples).

Selected A refinement. The bookmark notch and broad white bridge arch remain distinguishable at16/24/32px. B reads as folded ribbons and loses its connection shape at16px; original A has unnecessary shading in the white arch. Refined A keeps the approved symbol with a more even bridge treatment. No visible matte or checkerboard in the comparison. Generated raster retains antialiasing rather than an exact two-value palette.

Asset inspection confirms RGBA1254×1254 master, alpha0–255, fully transparent corners and outer edge. This is asset evidence only; native Windows/extension acceptance is recorded separately by the implementation harness.

Consumer scope: changed3 brand surfaces (program, app sidebar, extension); existing functional WorkspaceIcon set preserved. No toolbar/API/permissions behavior changed.
