# Makery Stitch typography

The editor keeps its warm paper surfaces, red actions, Newsreader headings, and Archivo controls. Typography is defined centrally in `src/pages/MakeryTypography.css`; layout files must not introduce local font sizes, families, weights, or line heights.

| Role | Size / line height | Font / weight | Use |
|---|---|---|---|
| H1 | 30–36 px / 1.15 | Newsreader 500 | Page title |
| H2 | 24 px / 1.2 | Newsreader 500 | Stage title |
| H3 | 16 px / 1.4 | Archivo 600 | Sidebar section |
| H4 | 14 px / 1.4 | Archivo 600 | Subsection or item title |
| H5 | 13 px / 1.4 | Archivo 600 | Small subsection |
| Body | 14 px / 1.5 | Archivo 400 | Instructions and input values |
| Label | 13 px / 1.4 | Archivo 500 | Controls, options, navigation, text actions |
| Subtext | 12 px / 1.45 | Archivo 400 | Hints, counts, status, secondary metadata |
| Button | 14 px / 1.3 | Archivo 600 | Primary, secondary, tool and utility buttons |

## Application

Use semantic headings for the document outline. When visual rank differs from semantic rank, use `.ms-type-h1` through `.ms-type-h5`. Other reusable classes are `.ms-type-body`, `.ms-type-label`, `.ms-type-subtext`, `.ms-type-button`, and `.ms-type-value`.

Primary and secondary buttons have identical typography. Emphasis comes from background and border treatment, never a different family or weight. Text links and tabs use Label. Numeric measurements use tabular figures.

The wordmark uses the Brand token. SVG ruler labels use a Ruler token in drawing coordinates; this geometric scaling is the only size exception. Font source files remain in `MakeryStitchFonts.css`.

The main page title has no eyebrow. Section titles sit closer to their controls than to the preceding section. Preserve existing interaction and sidebar behavior when applying these roles.
