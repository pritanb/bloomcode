/** Display labels for stored enum values; never apply to user-authored text. */
export function enumLabel(value: string | null | undefined): string {
  if (!value) return '';
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function helpLabel(value: string): string {
  return ({ none: 'No help', small: 'Small hint', major: 'Major help', solution: 'Solution viewed', unknown: 'Unknown help' } as Record<string, string>)[value] ?? enumLabel(value);
}

export function languageLabel(value: string): string {
  return ({ python: 'Python', java: 'Java', javascript: 'JavaScript', typescript: 'TypeScript', cpp: 'C++', other: 'Other' } as Record<string, string>)[value] ?? enumLabel(value);
}
