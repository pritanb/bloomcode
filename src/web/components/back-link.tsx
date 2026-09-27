import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** Quiet "← Back to …" link above a PageHeader on detail pages. */
export function BackLink({
  to,
  children,
  className,
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'mb-3 inline-flex items-center gap-2 self-start text-sm text-muted-foreground no-underline hover:text-foreground hover:no-underline',
        className,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden="true" focusable="false" />
      {children}
    </Link>
  );
}
