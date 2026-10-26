# Tsuki branding

Illustrator source: `tsuki-icons.ai`. Export the eight named artboards for Anime,
Books, and Movies as SVGs into their matching folders here. Text is outlined so
no font installation is required when generating assets.

Run `pnpm branding:generate` from the repository root after installing workspace
dependencies. The generator uses Sharp shipped with the pinned Next dependency.
Generated public assets are committed so deployment never needs Illustrator.

Each app receives an SVG favicon and 16/32/48 ICO fallback, 192/512 PNG install
icons, a square opaque 180 PNG Apple touch icon, separate 512/1024 maskable PNGs,
and Open Graph/Twitter cards. The decorative squircle is used in the app header;
the operating system applies its own shape to install icons. Maskable artwork is
contained within a centered circle 76% of the canvas diameter, inside the 80%
safe zone. Do not mark the pre-rounded decorative squircle as maskable.

## Apple startup images

`packages/ui/src/pwa-devices.ts` is the single list for both generation and page
metadata. It currently covers 22 screen-size/device-pixel-ratio combinations in
both orientations (44 PNGs per app), from small iPhones to large iPads. New Apple
screen sizes require a new tuple and regeneration. These are full-screen opaque
PNGs with exact natural pixel dimensions, not SVG/data URLs or viewport-sized
screenshots. Foreground artwork is fitted without cropping; gradient backgrounds
fill each screen. Each link includes device width, device height, pixel ratio,
and orientation. No light/dark selector is needed because the branded launch
artwork is intentionally identical in both color modes.

The root layouts emit standalone Apple metadata, the legacy capable opt-in, and
all startup links on the initial document. Files live under `/icons/tsuki/` and
are publicly accessible without authentication. Anime excludes these startup
files from its service-worker precache to avoid fetching every device variant.
Set each deployed app's `NEXT_PUBLIC_APP_URL` to its canonical HTTPS origin for
absolute social image URLs; Vercel's production URL is the fallback.

## Verification and physical-device check

Verified locally: all three production builds, TypeScript, formatting, 44 links
per app, natural dimensions and opacity of all 132 startup images, and anonymous
HTTP 200/image content types for all referenced branding files. Desktop checks
cannot prove which startup image iOS selects or how its install cache behaves.

Before accepting the designs on Apple devices:

1. Use the HTTPS deployment in Safari, then Add to Home Screen. A normal Safari
   tab does not show the installed web app's launch screen.
2. Open the installed app in portrait, fully close it, then cold-launch in
   landscape. Check both an iPhone and an iPad when available.
3. Confirm the touch icon has the OS-applied corners, the app name is correct,
   and neither the symbol nor the lettering is clipped.
4. If old artwork persists, remove that Home Screen installation and add it
   again. If necessary, clear that site's Safari data before reinstalling;
   this also removes locally stored collection data on Books and Movies, so
   preserve anything you need before doing that.

Apple may reuse the previous application snapshot on subsequent launches.
Startup artwork is not a guaranteed full-screen animation or minimum-duration
loading screen. Android creates its own launch surface from manifest assets.

References:
- https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html
- https://web.dev/learn/pwa/enhancements
- https://web.dev/articles/maskable-icon
- https://bugs.webkit.org/show_bug.cgi?id=280262
