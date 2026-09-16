# Corporate Trust design integration

Status: implemented and independently reviewed; no blocking findings. Typecheck, lint, 152 automated tests and 47 browser checks passed. Desktop/mobile and light/dark screenshots inspected.

Verification limits: contrast assertions sample computed solid backgrounds rather than fully compositing decorative gradients. VoiceOver/Safari announcements have not been manually certified. The existing lazy CodeMirror bundle-size warning remains non-blocking.

QA isolation note: an initial preview helper bound a fixed port and a worker inadvertently visited the existing pilot after its own bind failed. The disclosure audit contained no new entries during that visit; existing entries predated QA. No data rollback was performed. Standalone visual helpers now own temporary databases and port-0 listeners, with regression guards against live-pilot defaults.

## Scope

Restyle every existing app screen: study desk, question library, library management, question detail, topic list/detail, settings and attempt workspace. Preserve the API, study data, scoring rules, scheduling, disclosure safeguards and all user-facing actions. No new product features or backend changes.

## System

- Keep React components and plain CSS; do not add a CSS framework or parallel component library.
- Centralise semantic colour, type, spacing, radius, shadow and motion tokens. Components consume tokens rather than stacking page-specific colour overrides.
- Use self-hosted Plus Jakarta Sans for application text and system monospace for code/time. No third-party font request at runtime.
- Use Lucide icons alongside text; decorative icons are hidden from assistive technology.
- Share navigation, page titles, fields, buttons, cards and status treatments. Keep feature components and existing routing intact.

## Visual direction

The user's supplied Corporate Trust system is authoritative: slate-50 `#F8FAFC` canvas, white surfaces, indigo `#4F46E5` and violet `#7C3AED`, slate-900 `#0F172A` text, muted slate `#64748B`, border `#E2E8F0`, emerald `#10B981` for success accents. Use contrast-safe semantic text colours where the accent itself is unsuitable as small text.

Use the indigo-to-violet signature on primary actions and restrained brand/progress accents. Introduce soft coloured elevation and 12px card / 8px input radii. Keep the daily plan visually dominant and detailed administration in the library.

This is a working study application, not a marketing landing page: do not add pricing sections, promotional copy, giant hero typography, decorative fake metrics, rotating controls or pulsing distractions. Data surfaces and the code editor stay flat and stable; hover elevation belongs on actual interactive elements.

## Responsive and accessibility requirements

- Preserve automatic light/dark preference, deriving dark tokens from the same palette.
- Maintain visible keyboard focus, semantic headings, labelled controls and textual status meaning.
- Provide at least 44px target areas for primary navigation and controls; checkbox/radio labels may form the target area.
- Support 375px mobile layouts without requiring horizontal scrolling through data. Use labelled stacked records where wide tables cannot fit.
- Retain reduced-motion behaviour; transitions must not shift layout or obscure focus.

## Verification and release

Use failing design-contract tests before implementation. Run existing behaviour tests and new real-browser checks against disposable databases, not the user's pilot: catalogue reads can record exposure. Verify font loading, light/dark tokens, contrast samples, keyboard focus, target sizes and all route layouts. Inspect desktop/mobile screenshots before release.

Only mark this integration complete after production build, typecheck, lint, regression tests and browser review pass. The existing Sheet/MCP cutover boundary remains unchanged.
