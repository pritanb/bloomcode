import { useEffect, useState, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon } from '../components/ui';

const storageKey = 'leetcode-tutor-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
let preference: string | null = null;
try {
  preference = localStorage.getItem(storageKey);
} catch {
  /* Storage may be disabled. */
}
let dark = preference === 'dark' || (preference !== 'light' && media.matches);
function applyTheme() {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  listeners.forEach((listener) => listener());
}
applyTheme();
media.addEventListener('change', () => {
  if (preference === 'light' || preference === 'dark') return;
  dark = media.matches;
  applyTheme();
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useDarkMode() {
  return useSyncExternalStore(subscribe, () => dark);
}
function setDarkMode(value: boolean) {
  dark = value;
  preference = dark ? 'dark' : 'light';
  try {
    localStorage.setItem(storageKey, preference);
  } catch {
    /* Keep the in-memory choice. */
  }
  applyTheme();
}
export function ThemeSwitch() {
  const isDark = useDarkMode();
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="sidebar-theme"
      onClick={() => setDarkMode(!dark)}
      aria-label={label}
      title={label}
    >
      <Icon icon={isDark ? Sun : Moon} />
    </Button>
  );
}
export function ThemeToggle() {
  const isDark = useDarkMode();
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;
  return (
    <Button
      variant="ghost"
      className="theme-toggle"
      onClick={() => {
        setDarkMode(!dark);
      }}
      aria-label={label}
      title={label}
    >
      <Icon icon={isDark ? Sun : Moon} />
      {isDark ? 'Light mode' : 'Dark mode'}
    </Button>
  );
}

// Accent colour, stored per device like the light/dark choice. Every accent
// token derives from --brand; --brand-fg keeps text on it readable.
// 'mono' follows the text colour: black in light mode, white in dark mode.
const monoAccent = 'mono';
export const defaultAccent = monoAccent;
const quickAccents = [
  { label: 'Black and white', value: monoAccent },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Teal', value: '#0d9488' },
  { label: 'Sky', value: '#0284c7' },
  { label: 'Indigo', value: '#4f46e5' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Amber', value: '#d97706' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Rose', value: '#e11d48' },
  { label: 'Slate', value: '#475569' },
];
const accentKey = 'leetcode-tutor-accent';
const hexPattern = /^#[0-9a-f]{6}$/i;
let accent = defaultAccent;
try {
  const stored = localStorage.getItem(accentKey);
  if (stored && (stored === monoAccent || hexPattern.test(stored))) accent = stored.toLowerCase();
} catch {
  /* Storage may be disabled. */
}
// Text on the accent: whichever of white or near-black contrasts more.
function readableOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const onWhite = 1.05 / (luminance + 0.05);
  const onBlack = (luminance + 0.05) / 0.0532;
  return onWhite >= onBlack ? '#ffffff' : '#0a0a0b';
}
function applyAccent() {
  const mono = accent === monoAccent;
  document.documentElement.style.setProperty('--brand', mono ? 'var(--foreground)' : accent);
  document.documentElement.style.setProperty(
    '--brand-fg',
    mono ? 'var(--background)' : readableOn(accent),
  );
  listeners.forEach((listener) => listener());
}
applyAccent();
export function useAccent() {
  return useSyncExternalStore(subscribe, () => accent);
}
function setAccent(value: string) {
  accent = value.toLowerCase();
  try {
    if (accent === defaultAccent) localStorage.removeItem(accentKey);
    else localStorage.setItem(accentKey, accent);
  } catch {
    /* Keep the in-memory choice. */
  }
  applyAccent();
}
export function AccentPicker() {
  const current = useAccent();
  const shown = current === monoAccent ? '' : current;
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2.5">
        <label className="relative size-10 shrink-0 cursor-pointer rounded-xl bg-brand shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <input
            type="color"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            value={shown || '#0a0a0b'}
            onChange={(event) => setAccent(event.target.value)}
            aria-label="Accent colour"
          />
        </label>
        <Input
          className="w-30 font-mono lowercase"
          value={draft}
          maxLength={7}
          spellCheck={false}
          placeholder={current === monoAccent ? 'Black' : undefined}
          aria-label="Accent colour hex value"
          onChange={(event) => {
            const value = event.target.value.startsWith('#')
              ? event.target.value
              : `#${event.target.value}`;
            setDraft(value);
            if (hexPattern.test(value)) setAccent(value);
          }}
          onBlur={() => setDraft(shown)}
        />
        <Button
          variant="ghost"
          disabled={current === defaultAccent}
          onClick={() => setAccent(defaultAccent)}
        >
          Reset
        </Button>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Quick accent colours">
        {quickAccents.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={current === item.value}
            aria-label={item.label}
            title={item.label}
            className="size-7 cursor-pointer rounded-full border-0 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] transition-transform duration-120 outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card aria-checked:shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--foreground)] motion-reduce:transition-none"
            style={{
              background:
                item.value === monoAccent
                  ? 'linear-gradient(135deg, #0a0a0b 50%, #fafafa 50%)'
                  : item.value,
            }}
            onClick={() => setAccent(item.value)}
          />
        ))}
      </div>
    </div>
  );
}
