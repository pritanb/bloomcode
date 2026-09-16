import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from './ui';

const storageKey = 'leetcode-tutor-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
let preference: string | null = null;
try { preference = localStorage.getItem(storageKey); } catch { /* Storage may be disabled. */ }
let dark = preference === 'dark' || (preference !== 'light' && media.matches);
function applyTheme() {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  listeners.forEach(listener => listener());
}
applyTheme();
media.addEventListener('change', () => {
  if (preference === 'light' || preference === 'dark') return;
  dark = media.matches;
  applyTheme();
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function useDarkMode() {
  return useSyncExternalStore(subscribe, () => dark);
}
function setDarkMode(value: boolean) {
  dark = value;
  preference = dark ? 'dark' : 'light';
  try { localStorage.setItem(storageKey, preference); } catch { /* Keep the in-memory choice. */ }
  applyTheme();
}
export function ThemeSwitch() {
  const isDark = useDarkMode();
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;
  return <Button variant="ghost" size="icon" className="sidebar-theme" onClick={() => setDarkMode(!dark)} aria-label={label} title={label}>
    <Icon icon={isDark ? Sun : Moon} />
  </Button>;
}
export function ThemeToggle() {
  const isDark = useDarkMode();
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;
  return <Button variant="ghost" className="theme-toggle" onClick={() => {
    setDarkMode(!dark);
  }} aria-label={label} title={label}>
    <Icon icon={isDark ? Sun : Moon} />
    {isDark ? 'Light mode' : 'Dark mode'}
  </Button>;
}
