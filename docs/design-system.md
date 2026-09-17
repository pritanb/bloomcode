# UI design system

The application uses actual shadcn/ui Radix Nova registry components, generated with the shadcn CLI. `components.json` records the preset, neutral palette and aliases; component source lives in `src/web/components/ui`. The upstream MIT license is in `docs/licenses/shadcn-ui.txt`.

## Visual direction

Use the approved warm-and-indigo study workspace: warm off-white (`#F7F6F2`) backgrounds, white cards, charcoal text and restrained indigo (`#4F46E5`) primary actions. Dark mode uses charcoal backgrounds and a lighter indigo (`#A5B4FC`) accent. Keep borders subtle and use color for selected navigation, primary actions and progress, not decoration.

Use system sans-serif for interface text and system monospace for code. Page titles are 30–32px; numeric summaries use tabular figures. Feature the next or active question, with a quieter plan, recap and practice history. No downloaded fonts, gradients or promotional styling. Transitions respond to interaction and respect reduced motion.

## Implementation

- Use the generated Button, Card, Input, Label, Textarea, Badge, Separator, Table, Checkbox, Select, Popover, Calendar and Collapsible in feature screens. Keep registry styling rather than rebuilding controls in CSS.
- Use the shared SelectField, DateField and Disclosure compositions for dropdowns, date picking and expandable sections. Use styled shadcn Select menus rather than NativeSelect or browser datalists. The tag multi-select composes shadcn Popover, Input and Checkbox.
- `styles.css` contains Tailwind v4 integration and shadcn semantic variables. `layout.css` contains only application typography, layout, responsive records and editor framing.
- `ui.tsx` provides application compositions such as labelled fields and responsive record tables; these compose the generated primitives. Forward accessible labels to the actual controls, including SelectTrigger.
- Keep the existing API, routing, CodeMirror and save queue. Preserve input and checkbox handlers, form submission and duplicate-safe finish logic.
- Mobile tables become labelled record cards. Navigation and forms wrap, focus stays visible, and reduced motion is respected.

## Verification

Follow [testing policy](testing.md): typecheck, lint, build and relevant critical tests for integration changes, plus the one existing solve/save/reload browser flow. Inspect a few representative screenshots on an owned port-0 server with a temporary SQLite database; never use the live pilot for QA. Do not add cosmetic test matrices.
