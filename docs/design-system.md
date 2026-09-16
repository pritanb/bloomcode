# UI design system

The application uses actual shadcn/ui Radix Nova registry components, generated with the shadcn CLI. `components.json` records the preset, neutral palette and aliases; component source lives in `src/web/components/ui`. The upstream MIT license is in `docs/licenses/shadcn-ui.txt`.

## Visual direction

Use an understated sidebar application: white/neutral surfaces, zinc-like grey borders, near-black text and monochrome primary actions. Dark mode follows the system preference and uses neutral dark surfaces, not purple accents. Use system sans-serif for interface text and system monospace for code. No downloaded font, gradients, ornaments or promotional styling.

## Implementation

- Use the generated Button, Card, Input, Label, Textarea, Badge, Separator, Table, Checkbox, Select, Popover, Calendar and Collapsible in feature screens. Keep registry styling rather than rebuilding controls in CSS.
- Use the shared SelectField, DateField and Disclosure compositions for dropdowns, date picking and expandable sections. Use styled shadcn Select menus rather than NativeSelect or browser datalists. The tag multi-select composes shadcn Popover, Input and Checkbox.
- `styles.css` contains Tailwind v4 integration and shadcn semantic variables. `layout.css` contains only application typography, layout, responsive records and editor framing.
- `ui.tsx` provides application compositions such as labelled fields and responsive record tables; these compose the generated primitives. Forward accessible labels to the actual controls, including SelectTrigger.
- Keep the existing API, routing, CodeMirror and save queue. Preserve input and checkbox handlers, form submission and duplicate-safe finish logic.
- Mobile tables become labelled record cards. Navigation and forms wrap, focus stays visible, and reduced motion is respected.

## Verification

Follow [testing policy](testing.md): typecheck, lint, build and relevant critical tests for integration changes, plus the one existing solve/save/reload browser flow. Inspect a few representative screenshots on an owned port-0 server with a temporary SQLite database; never use the live pilot for QA. Do not add cosmetic test matrices.
