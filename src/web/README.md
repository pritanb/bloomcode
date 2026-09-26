# Frontend notes

Screens are composed from `components/kit.tsx` and Tailwind utilities. Do not add a per-screen CSS file. If a look repeats, extend the kit.

`styles/styles.css` holds the colour tokens and maps them into Tailwind (`bg-card`, `text-muted-foreground`, `text-up`, the tone colours). `styles/layout.css` is only the app shell: sidebar, macOS title bar, and the rule that keeps a page from scrolling while its panels do.

Primitives in `components/ui/` are shadcn/Radix components, styled with Tailwind inside `cn()` and `cva()`. Add one with `npx shadcn add <name>` (`components.json`). Tailwind, `@tailwindcss/vite`, `tw-animate-css` and the `shadcn` CLI are build-time devDependencies. `cn` and `class-variance-authority` are bundled into the UI.
