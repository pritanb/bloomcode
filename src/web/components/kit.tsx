/**
 * BloomCode screen kit: the shared building blocks every screen is composed from.
 *
 * Convention
 * - Screens compose these components plus Tailwind utility classes. Do not add per-screen
 *   CSS files or new class-name rules; if a look repeats on two screens, add or extend a
 *   component here instead. Truly custom visuals (calendar heatmap, charts) are the only
 *   exception and keep their CSS next to the component.
 * - Colour comes from tokens (styles.css), exposed to Tailwind as bg-card, text-muted-foreground,
 *   ring-card-ring, bg-brand-soft/text-brand-text, text-up/text-warn and the meaning tones
 *   bg-tone-{sky,emerald,amber,rose}-soft + text-tone-*. Never hard-code hex values in a screen.
 *   Surfaces are monochrome; use a `tone` only when the colour carries meaning.
 * - Type scale: 15px body (text-[0.9375rem]), 13px meta (text-[0.8125rem]), 17px section title
 *   (font-heading), 24px page title, 28px KPI figure. Headings use font-heading (DM Sans).
 * - Pages fit the window: put the part that should take the remaining height in <FillPage>,
 *   and let long content scroll inside <ScrollRegion> or <Panel scroll>. Never shrink tiles
 *   or type to make a page fit.
 *
 * Components
 * - PageHeader      title (+ description) with optional trailing actions.
 * - FillPage        fills the window height below the header; children stack with a 16px gap.
 * - ScrollRegion    flex-1 area that scrolls internally (keeps focus rings unclipped).
 * - Panel           the card: 22px radius, 1px alpha ring, 24px padding. Optional header
 *                   (title, icon, tone, meta, actions) and `scroll` for an internally
 *                   scrolling body with a fixed header.
 * - SectionHeader   the Panel header on its own, for sections that sit on the page background.
 * - IconTile        tinted square icon (tone × size); the leading visual for tiles and rows.
 * - StatTile        KPI card: muted label, large tabular figure, sub/delta line, icon tile.
 * - Meter           thin progress bar (role="progressbar").
 * - TileGrid, Tile  responsive auto-fill grid of clickable cards (button, or asChild for links).
 * - List, ListRow   divided rows: leading icon, title (link), meta, trailing value, active bar.
 * - EmptyState      centred icon + title + one line + optional action.
 * - ToneBadge       pill for labels; tone only when the colour means something.
 * - Callout         inset note ("Next time" …), neutral or brand with an accent bar.
 * - SidePanel*      right-hand sheet built on Radix Dialog for inspecting one item.
 * Existing helpers stay in components/ui.tsx (Field, Loading, ErrorNotice, dateLabel …) and
 * shadcn primitives in components/ui/*.
 */
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Dialog, Slot } from 'radix-ui';
import { X, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type Tone = 'neutral' | 'brand' | 'solid' | 'sky' | 'emerald' | 'amber' | 'rose';

/* ------------------------------------------------------------------ page structure */

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn('mb-5 flex flex-wrap items-end justify-between gap-4 *:min-w-0', className)}
    >
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-[-0.025em]">{title}</h1>
        {description && (
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Takes the window height left under the PageHeader (the app shell reads the `fill-page`
 * hook). Narrow or short windows fall back to ordinary page scrolling.
 */
export function FillPage({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('fill-page flex min-w-0 flex-col gap-4', className)} {...props} />;
}

export function ScrollRegion({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('relative -m-1 min-h-0 flex-1 overflow-y-auto p-1 *:shrink-0', className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ icon tile */

export const iconTileVariants = cva('grid shrink-0 place-items-center', {
  variants: {
    tone: {
      neutral: 'bg-muted text-foreground',
      brand: 'bg-brand-soft text-brand-text',
      solid: 'bg-primary text-primary-foreground',
      sky: 'bg-tone-sky-soft text-tone-sky',
      emerald: 'bg-tone-emerald-soft text-tone-emerald',
      amber: 'bg-tone-amber-soft text-tone-amber',
      rose: 'bg-tone-rose-soft text-tone-rose',
    },
    size: {
      sm: 'size-7 rounded-lg [&>svg]:size-3.5',
      md: 'size-10 rounded-[0.875rem] [&>svg]:size-[1.125rem]',
      lg: 'size-11 rounded-[0.875rem] [&>svg]:size-[1.125rem]',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'md' },
});

export function IconTile({
  icon: Glyph,
  tone,
  size,
  className,
}: { icon: LucideIcon; className?: string } & VariantProps<typeof iconTileVariants>) {
  return (
    <span className={cn(iconTileVariants({ tone, size }), className)} aria-hidden="true">
      <Glyph focusable="false" />
    </span>
  );
}

/* ------------------------------------------------------------------ panel */

export const panelClass =
  'flex min-w-0 flex-col gap-4 rounded-3xl bg-card p-6 text-card-foreground ring-1 ring-card-ring';

export function SectionHeader({
  title,
  icon,
  tone = 'neutral',
  meta,
  actions,
  level = 2,
  className,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  /** Quiet trailing text such as a count ("3 habits"). */
  meta?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={cn('flex min-h-7 items-center justify-between gap-4 *:min-w-0', className)}>
      <Heading className="flex items-center gap-2.5 font-heading text-[1.0625rem] font-semibold tracking-[-0.01em]">
        {icon && <IconTile icon={icon} tone={tone} size="sm" />}
        {title}
      </Heading>
      {(meta || actions) && (
        <div className="flex shrink-0 items-center gap-3 text-[0.8125rem] text-muted-foreground tabular-nums">
          {meta}
          {actions}
        </div>
      )}
    </div>
  );
}

export function Panel({
  title,
  icon,
  tone,
  meta,
  actions,
  level,
  scroll = false,
  className,
  bodyClassName,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  meta?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  /** Body scrolls inside the panel while the header stays put. Give the panel a height (e.g. flex-1 in FillPage). */
  scroll?: boolean;
  bodyClassName?: string;
}) {
  const header = title !== undefined && (
    <SectionHeader
      title={title}
      icon={icon}
      tone={tone}
      meta={meta}
      actions={actions}
      level={level}
    />
  );
  return (
    <section className={cn(panelClass, scroll && 'min-h-0', className)} {...props}>
      {header}
      {scroll ? (
        <ScrollRegion className={cn('flex flex-col gap-4', bodyClassName)}>{children}</ScrollRegion>
      ) : bodyClassName ? (
        <div className={bodyClassName}>{children}</div>
      ) : (
        children
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ KPI */

export function StatTile({
  label,
  value,
  unit,
  sub,
  icon,
  tone = 'neutral',
  children,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Smaller muted suffix after the figure, e.g. "/ 5". */
  unit?: ReactNode;
  /** Delta or context line under the figure; colour meaning with text-up / text-warn. */
  sub?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  /** Extra content under the figure (e.g. a Meter). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(panelClass, 'relative gap-0 px-[1.375rem] py-5', className)}>
      {icon && (
        <IconTile
          icon={icon}
          tone={tone}
          size="lg"
          className="absolute top-[1.125rem] right-[1.125rem]"
        />
      )}
      <p className="pr-12 text-[0.9375rem] text-muted-foreground">{label}</p>
      <p className="mt-[1.125rem] text-[1.75rem] leading-none font-semibold tracking-[-0.035em] tabular-nums">
        {value}
        {unit && (
          <span className="ml-1 text-base font-medium tracking-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </p>
      {sub && (
        <p className="mt-2.5 flex min-h-5 items-center gap-1 text-[0.8125rem] text-muted-foreground">
          {sub}
        </p>
      )}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function Meter({
  value,
  max = 100,
  label,
  valueText,
  className,
}: {
  value: number;
  max?: number;
  label: string;
  valueText?: string;
  className?: string;
}) {
  const clamped = Math.min(Math.max(value, 0), max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
        style={{ width: `${max ? (clamped / max) * 100 : 0}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ tiles */

export function TileGrid({
  min = '20rem',
  className,
  style,
  ...props
}: ComponentProps<'div'> & { /** Narrowest a tile may get before wrapping. */ min?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(min(100%,var(--tile-min)),1fr))] gap-4',
        className,
      )}
      style={{ '--tile-min': min, ...style } as CSSProperties}
      {...props}
    />
  );
}

/** A clickable card. Renders a <button>; pass asChild to wrap a <Link> or a Radix trigger. */
export function Tile({
  asChild = false,
  className,
  ...props
}: ComponentProps<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={cn(
        panelClass,
        'cursor-pointer gap-3.5 px-6 py-[1.375rem] text-left no-underline transition-shadow outline-none hover:no-underline hover:shadow-[0_0_0_4px_var(--brand-soft)] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  );
}

export function TileTitle({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'font-heading text-[1.0625rem] leading-snug font-semibold tracking-[-0.01em]',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ lists */

export function List({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cn('m-0 flex list-none flex-col divide-y p-0', className)} {...props} />;
}

export function ListRow({
  icon,
  tone = 'neutral',
  leading,
  title,
  to,
  meta,
  trailing,
  active = false,
  children,
  className,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  /** Custom leading visual (e.g. a state icon) when an IconTile does not fit. */
  leading?: ReactNode;
  title: ReactNode;
  /** Makes the title a router link. */
  to?: string;
  meta?: ReactNode;
  trailing?: ReactNode;
  /** Current row: muted background and a brand bar on the left. */
  active?: boolean;
  /** Extra body content under the meta line. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        'relative flex items-start gap-3.5 py-3.5',
        active &&
          'rounded-2xl border-transparent bg-muted px-4 before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary',
        className,
      )}
    >
      {icon ? <IconTile icon={icon} tone={tone} size="md" /> : leading}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <span className="min-w-0 text-[0.9375rem] font-medium">
            {to ? (
              <Link className="text-foreground" to={to}>
                {title}
              </Link>
            ) : (
              title
            )}
          </span>
          {trailing && (
            <span className="shrink-0 text-[0.8125rem] text-muted-foreground tabular-nums">
              {trailing}
            </span>
          )}
        </div>
        {meta && <div className="text-[0.8125rem] text-muted-foreground">{meta}</div>}
        {children}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ empty state */

export function EmptyState({
  icon,
  tone = 'neutral',
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-muted px-6 py-10 text-center',
        className,
      )}
    >
      {icon && <IconTile icon={icon} tone={tone} className="mb-2 bg-card" />}
      <h3 className="font-heading text-[1.0625rem] font-semibold tracking-[-0.01em]">{title}</h3>
      {description && (
        <p className="max-w-[30rem] text-[0.9375rem] text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ badges & callouts */

export const toneBadgeVariants = cva(
  'inline-flex min-h-6 w-fit shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium [&>svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'bg-secondary text-secondary-foreground',
        muted: 'bg-muted text-muted-foreground',
        outline: 'ring-1 ring-border text-foreground ring-inset',
        brand: 'bg-brand-soft text-brand-text',
        solid: 'bg-primary text-primary-foreground',
        sky: 'bg-tone-sky-soft text-tone-sky',
        emerald: 'bg-tone-emerald-soft text-tone-emerald',
        amber: 'bg-tone-amber-soft text-tone-amber',
        rose: 'bg-tone-rose-soft text-tone-rose',
      },
      /** Long labels (topics) wrap instead of truncating. */
      wrap: { true: 'text-left whitespace-normal wrap-anywhere', false: 'whitespace-nowrap' },
    },
    defaultVariants: { tone: 'neutral', wrap: false },
  },
);

export function ToneBadge({
  tone,
  wrap,
  className,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof toneBadgeVariants>) {
  return <span className={cn(toneBadgeVariants({ tone, wrap }), className)} {...props} />;
}

export function Callout({
  label,
  tone = 'neutral',
  children,
  className,
}: {
  label?: ReactNode;
  tone?: 'neutral' | 'brand';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-1 overflow-hidden rounded-2xl px-3.5 py-3 text-[0.9375rem] leading-relaxed',
        tone === 'brand'
          ? 'bg-brand-soft pl-5 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary'
          : 'bg-muted',
        className,
      )}
    >
      {label && (
        <span
          className={cn(
            'text-[0.8125rem] font-medium',
            tone === 'brand' ? 'font-semibold text-brand-text' : 'text-muted-foreground',
          )}
        >
          {label}
        </span>
      )}
      <div>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ side panel */

export const SidePanel = Dialog.Root;
export const SidePanelTrigger = Dialog.Trigger;

export function SidePanelContent({
  eyebrow,
  closeLabel = 'Close',
  className,
  children,
}: {
  /** Small content above the title, e.g. a ToneBadge. */
  eyebrow?: ReactNode;
  closeLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-100 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <Dialog.Content
        className={cn(
          'fixed inset-y-0 right-0 z-101 flex w-[min(36rem,100vw)] flex-col gap-4 overflow-y-auto *:shrink-0 rounded-l-3xl bg-card p-7 text-card-foreground shadow-[0_0_0_1px_var(--card-ring),-12px_0_40px_rgb(0_0_0/0.14)] wrap-anywhere outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-8 motion-reduce:animate-none',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">{eyebrow}</div>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label={closeLabel}>
              <X aria-hidden="true" />
            </Button>
          </Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function SidePanelTitle({ className, ...props }: ComponentProps<typeof Dialog.Title>) {
  return (
    <Dialog.Title
      className={cn(
        'font-heading text-[1.375rem] leading-tight font-bold tracking-[-0.02em]',
        className,
      )}
      {...props}
    />
  );
}

export const SidePanelDescription = Dialog.Description;

/** A small heading inside panels and side panels ("Why", "Next time"). */
export function Subheading({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      className={cn('font-heading text-[0.9375rem] font-semibold tracking-[-0.005em]', className)}
      {...props}
    />
  );
}
