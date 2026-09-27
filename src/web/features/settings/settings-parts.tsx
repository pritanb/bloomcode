import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Subheading } from '../../components/kit';

/** Quiet explanatory line under a settings control. */
export function Help({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn('text-[0.8125rem] leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

/** One titled block of a settings form; blocks are divided by the parent's divide-y. */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 py-5 first:pt-0 last:pb-1">
      <Subheading>{title}</Subheading>
      {children}
    </section>
  );
}
