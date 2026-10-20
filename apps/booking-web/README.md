# Demo Hotel — direct booking website concept

Responsive React public website prototype. This is a demo brand, not a live hotel listing.

From repository root:

```powershell
npm install
npm run dev:booking
```

Open http://127.0.0.1:5177/. The FDS preview remains at http://127.0.0.1:5176/.

## Included

- Editorial homepage, room cards, amenities, location placeholder and FAQ accordions.
- Date and guest search, room category filters, accessible room-detail dialog.
- Guest information form, pay-at-property option and itemized price summary.
- Demo confirmation reference and printable booking details.
- Desktop and mobile layouts with keyboard-accessible controls.
- Prototype inventory checks excluding departure dates, and locally saved demo bookings.

## Boundaries

Rooms, nightly prices, stock, policies and property identity are illustrative samples. No FDS data is read across ports. Bookings are saved only to this site's `miri-direct-bookings` browser storage; they do not create FDS reservations, send email, reserve live stock or process payments. No personal details should be used for this prototype.

Production integration must fetch published room types / approved date-specific prices and shared availability from the Node API, create reservations transactionally, apply configured taxes and cancellation policies, and send confirmation emails. Replace sample branding, address and photography with approved property content before launch.

Photography loads from images.unsplash.com and fonts from Google Fonts; local system fonts are the fallback. Images are illustrative, not photos of an actual property.

Checks: root `npm test`, `npm run lint`, `npm run build`. Optional desktop / mobile Chromium smoke test: `artifacts/test-booking-chromium.mjs` (uses a machine-specific Playwright runtime path).

## Demo customer accounts

The public brand is Demo Hotel, with no real city or property identity. Navigation offers Sign in / Register; registration signs the guest in and opens My account. A signed-in checkout links the new booking to that account. Guest checkout is still available. Earlier guest bookings are not automatically linked by email.

Demo account records are local to this browser; passwords use a per-account salt and PBKDF2-SHA256 hash rather than plaintext. Sessions use sessionStorage and expire after eight hours. This does not provide production security or server-enforced access control. Email verification, password recovery, cross-device sessions and synchronization with the FDS require backend integration.
