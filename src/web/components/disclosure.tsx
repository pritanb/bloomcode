import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
export function Disclosure({
  title,
  children,
  quiet = false,
}: {
  title: string;
  children: ReactNode;
  /** Muted, flush-left trigger for secondary details under a section. */
  quiet?: boolean;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn('group mb-2', quiet && '-ml-2.5 text-muted-foreground')}
        >
          <ChevronDown
            className="transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
          {title}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
