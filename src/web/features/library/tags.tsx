import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Tag } from '../../../shared/contracts';
import { ToneBadge } from '../../components/kit';
import { cn } from '@/lib/utils';

/** The tag's chosen colour, shown as a small dot so surfaces stay monochrome. */
export function TagDot({ hue, className }: { hue?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-2 shrink-0 rounded-full bg-muted-foreground', className)}
      style={hue === undefined ? undefined : { backgroundColor: `hsl(${hue} 65% 55%)` }}
    />
  );
}

/** A tag chip that opens the tag's notebook page. */
export function TagBadge({ tag, className }: { tag: Tag; className?: string }) {
  return (
    <ToneBadge tone="outline" className={cn('max-w-full gap-1.5', className)} title={tag.name}>
      <TagDot hue={tag.hue} />
      <Link
        className="min-w-0 truncate text-foreground no-underline hover:underline"
        to={`/patterns?tag=${encodeURIComponent(tag.id)}`}
      >
        {tag.name}
      </Link>
    </ToneBadge>
  );
}

const difficultyTones = { Easy: 'emerald', Medium: 'amber', Hard: 'rose' } as const;

export function DifficultyBadge({
  difficulty,
  unknown = 'Unknown',
}: {
  difficulty: string | null | undefined;
  unknown?: ReactNode;
}) {
  const tone = difficultyTones[difficulty as keyof typeof difficultyTones] ?? 'muted';
  return <ToneBadge tone={tone}>{difficulty ?? unknown}</ToneBadge>;
}

/** Pill-shaped checkbox choice used for tags and lists in the question form. */
export function ChoicePill({ children }: { children: ReactNode }) {
  return (
    <label className="inline-flex min-h-9 max-w-full cursor-pointer items-center gap-2 rounded-full bg-card px-3 text-sm ring-1 ring-border transition-colors ring-inset hover:bg-muted has-data-[state=checked]:bg-brand-soft has-data-[state=checked]:ring-transparent motion-reduce:transition-none">
      {children}
    </label>
  );
}
