# RELO logo guidelines

## Source and approval

- **Raster master:** `relo-approved-original.png` is a byte-for-byte copy of the 1536 × 1024 PNG downloaded as `Vivid Red R Logo on Black.png`. That local file matches the planning chat’s description of the approved logo and was used as the source. The original chat path `/mnt/data/image(6).png` was unavailable for byte comparison.
- **Vector master:** No editable vector source was supplied. All exports in this package are raster PNGs. If the original vector artwork becomes available, retain it alongside the approved PNG.
- The exports are crops, transparency extractions, and resizes of the supplied artwork. Approval applies to the original artwork. The exports carry no separate approval.

## Choose an export

| Asset | Use |
| --- | --- |
| `relo-wordmark-dark.png` | Full lockup with the red R and white RELO lettering on its original dark background. Use where the name should be visible. |
| `relo-symbol-dark.png` | Red R on its original dark background for compact placements. |
| `relo-wordmark-transparent.png` and `relo-symbol-transparent.png` | Place over an existing dark surface. The background was removed from the flattened source, so inspect the antialiased edges on the intended surface. |
| `icons/relo-icon-{16,32,48,128}.png` | Square symbol-only PNGs with transparent padding. Use 16 or 32 px for favicons and wire the corresponding sizes into the extension as needed. |

Keep the red shading, white lettering, and dark-first presentation. Scale proportionally and leave breathing room around the mark. Keep the full lockup out of favicon and toolbar slots, where the lettering becomes hard to read. Check the 16 px symbol at actual size. The cropped lockup is 761 × 679 px and the cropped symbol is 703 × 551 px, including padding. Display PNGs at or below their native resolution in device pixels. For example, use a 128 px asset for a 64 CSS px placement at 2×.

## Upload to ChatGPT Project sources

Upload the original PNG and this guide as individual files. Add the transparent full lockup and transparent symbol if the Project will use them in design work. Keep the four icon sizes in the product repository and bring them into the Project when discussing or reviewing extension or favicon implementation.
