import type { ReactNode } from 'react';
import type { ActivityDay } from '../../../shared/contracts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { dateLabel } from '../../components/ui';
import { cn } from '@/lib/utils';

// The 28-day heatmap shared by the Study desk and the Weekly report.
const heat = ['bg-(--heat-0)', 'bg-(--heat-1)', 'bg-(--heat-2)', 'bg-(--heat-3)'];

function Square({ level, className }: { level: number; className?: string }) {
  return <i className={cn('block rounded-[0.3125rem]', heat[level], className)} />;
}

/** Two headline figures above the heatmap ("8 day streak"). */
export function ActivityFigures({ items }: { items: [ReactNode, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {items.map(([value, label]) => (
        <div key={label} className="flex flex-col gap-1">
          <strong className="text-2xl leading-none font-semibold tracking-[-0.03em] tabular-nums">
            {value}
          </strong>
          <span className="text-[0.8125rem] text-muted-foreground">{label}</span>
        </div>
      ))}
    </div>
  );
}

export function ActivityStrip({ activity }: { activity: ActivityDay[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <TooltipProvider>
        <div
          className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1.5"
          role="list"
          aria-label="Completed attempts by study day"
        >
          {activity.map((day) => {
            const label = `${dateLabel(day.date)}: ${day.completedAttempts} completed ${day.completedAttempts === 1 ? 'attempt' : 'attempts'}`;
            return (
              <Tooltip key={day.date}>
                <TooltipTrigger asChild>
                  <span
                    role="listitem"
                    tabIndex={0}
                    className={cn(
                      'block aspect-square rounded-[22%] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                      heat[Math.min(3, day.completedAttempts)],
                    )}
                    aria-label={label}
                  />
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
      <div
        className="flex items-center justify-end gap-1 text-xs text-muted-foreground"
        aria-hidden="true"
      >
        <span className="mr-1">Less</span>
        {heat.map((_, level) => (
          <Square key={level} level={level} className="size-3 rounded-[0.1875rem]" />
        ))}
        <span className="ml-1">More</span>
      </div>
    </div>
  );
}
