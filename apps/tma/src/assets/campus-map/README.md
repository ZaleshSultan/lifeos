# Pinned AITU room-map geometry

Derived from Yuujiso/aitumap commit `028869ba9f6b03627d7bef64511491101adf2ace`, MIT Copyright (c) 2023 Yuujiso. Full license is retained beside these files and the generated previews.

Each SVG preserves upstream room/wall/stair geometry for one block/floor. JSX imports, dynamic icon components and scripts are excluded; only bounded SVG geometry, labels and transforms are retained. These room locators are not accessible-route or evacuation plans. Source paths and original/sanitized SHA-256 hashes are in `packages/core/src/campus-map-data.json`. No personal schedule is bundled.

Only exact upstream room IDs and the separately reviewed `C1.3.319` to `C1.3.319P` alias resolve. Wrong explicit suffixes do not resolve. Unresolved rooms use the generic interactive map; upstream supports no room URL query.

Generate cached PNGs once with `LIFEOS_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs LIFEOS_CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/build-campus-room-previews.mjs --render`. Browser network is blocked. Runtime notifications reuse static images and never start a browser. Use `--check` to verify checked-in PNG hashes without a browser.
