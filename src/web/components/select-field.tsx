import type { ComponentProps, ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Radix reserves the empty string for its placeholder. Keep the app's existing
// empty-value filters while giving their explicit “All / Any” option a value.
const emptyValue = '__all__';
type Props = Omit<ComponentProps<typeof SelectTrigger>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
  required?: boolean;
  children: ReactNode;
};
export function SelectField({
  value,
  onValueChange,
  name,
  required,
  disabled,
  children,
  ...trigger
}: Props) {
  return (
    <Select
      value={value || emptyValue}
      onValueChange={(next) => onValueChange(next === emptyValue ? '' : next)}
      name={name}
      required={required}
      disabled={disabled}
    >
      <SelectTrigger {...trigger}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectGroup>{children}</SelectGroup>
      </SelectContent>
    </Select>
  );
}
export function SelectOption({
  value,
  children,
  ...props
}: Omit<ComponentProps<typeof SelectItem>, 'value'> & { value?: string }) {
  return (
    <SelectItem {...props} value={(value ?? String(children)) || emptyValue}>
      {children}
    </SelectItem>
  );
}
