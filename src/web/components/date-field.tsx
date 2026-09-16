import { useState, type ComponentProps } from 'react';
import { CalendarDays } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function DateField({ value, onValueChange, disabled, ...props }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & { value: string; onValueChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  // Construct local dates explicitly: ISO strings parsed as UTC can shift a day.
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(value) && parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : undefined;
  return <div className="date-field">
    <Input {...props} disabled={disabled} value={value} onChange={e => onValueChange(e.target.value)} placeholder="YYYY-MM-DD" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" />
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button type="button" variant="outline" size="icon" disabled={disabled} aria-label="Choose date"><CalendarDays aria-hidden="true" /></Button></PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={selected} defaultMonth={selected} onSelect={date => {
          if (!date) return;
          onValueChange(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
          setOpen(false);
        }} />
      </PopoverContent>
    </Popover>
  </div>;
}
