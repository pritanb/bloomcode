import { cn } from '@/lib/utils';

/** A problem's rating: exact contest ratings plainly, estimates with "≈". */
export function RatingChip({
  rating,
  className,
}: {
  rating?: { value: number; estimated: boolean } | null;
  className?: string;
}) {
  if (!rating) return null;
  return (
    <span
      className={cn(
        'shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.75rem] font-medium text-muted-foreground tabular-nums',
        className,
      )}
      title={
        rating.estimated
          ? 'Estimated from difficulty, acceptance rate and topics (about ±150)'
          : 'LeetCode contest rating'
      }
    >
      {rating.estimated ? '≈' : ''}
      {rating.value.toLocaleString()}
    </span>
  );
}
