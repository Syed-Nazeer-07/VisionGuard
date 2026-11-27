import { useSyncExternalStore } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

const contrastQuery = '(prefers-color-scheme: dark)';
const themeKey = 'visionguard:appearance';
const themeChange = 'visionguard:appearance-change';
type Appearance = 'light' | 'dark' | 'system';

function current(): Appearance {
  const value = document.documentElement.dataset.appearance;
  return value === 'light' || value === 'dark' ? value : 'system';
}

function apply(appearance: Appearance) {
  const dark = appearance === 'dark' || (appearance === 'system' && window.matchMedia?.(contrastQuery).matches);
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101010' : '#f6f6f6');
  window.dispatchEvent(new Event(themeChange));
}

export function watchAppearance() {
  const media = window.matchMedia?.(contrastQuery);
  const syncSystem = () => { if (current() === 'system') apply('system'); };
  const syncStorage = (event: StorageEvent) => {
    if (event.key !== themeKey && event.key !== null) return;
    apply(event.newValue === 'light' || event.newValue === 'dark' || event.newValue === 'system' ? event.newValue : 'dark');
  };
  media?.addEventListener('change', syncSystem);
  window.addEventListener('storage', syncStorage);
}

function subscribe(onChange: () => void) {
  window.addEventListener(themeChange, onChange);
  return () => window.removeEventListener(themeChange, onChange);
}

export function ThemeControl({ expanded = false }: { expanded?: boolean }) {
  const appearance = useSyncExternalStore(subscribe, current, () => 'system' as const);
  const Icon = appearance === 'light' ? Sun : appearance === 'dark' ? Moon : Monitor;
  return <label className={expanded ? 'vg-theme-control vg-theme-expanded' : 'vg-theme-control'}>
    <Icon size={17} aria-hidden="true"/>
    <select aria-label="Color theme" title="Color theme" value={appearance}
      onChange={event => {
        const value = event.target.value as Appearance;
        try { localStorage.setItem(themeKey, value); } catch { /* Apply for this page. */ }
        apply(value);
      }}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>;
}
