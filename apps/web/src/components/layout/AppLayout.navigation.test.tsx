import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function mobileMediaQuery() {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let compact = true;
  const media = {
    get matches() { return compact; },
    media: '(max-width: 1023px)',
    addEventListener: (_name: string, callback: (event: MediaQueryListEvent) => void) => { listeners.add(callback); },
    removeEventListener: (_name: string, callback: (event: MediaQueryListEvent) => void) => { listeners.delete(callback); },
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    resize(toSmall: boolean) {
      compact = toSmall;
      act(() => {
        for (const listener of listeners) listener({ matches: compact } as MediaQueryListEvent);
      });
    }
  };
}

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<MemoryRouter initialEntries={['/app']}><AppLayout /></MemoryRouter>));
  return {
    host,
    dispose() {
      act(() => root.unmount());
      host.remove();
    }
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('responsive workspace navigation accessibility', () => {
  it('keeps closed mobile navigation inert and restores keyboard focus on Escape', () => {
    mobileMediaQuery();
    const view = mount();
    try {
      const trigger = view.host.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')!;
      const drawer = view.host.querySelector<HTMLElement>('#vg-workspace-navigation')!;
      expect(drawer.inert).toBe(true);
      expect(drawer.getAttribute('aria-hidden')).toBe('true');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      act(() => trigger.click());
      expect(drawer.inert).toBe(false);
      expect(drawer.getAttribute('role')).toBe('dialog');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(view.host.querySelector('button[aria-label="Close menu"]')).toBe(document.activeElement);
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(drawer.inert).toBe(true);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    } finally { view.dispose(); }
  });

  it('clears the mobile drawer state when returning to a desktop viewport', () => {
    const viewport = mobileMediaQuery();
    const view = mount();
    try {
      const trigger = view.host.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')!;
      const drawer = view.host.querySelector<HTMLElement>('#vg-workspace-navigation')!;
      act(() => trigger.click());
      viewport.resize(false);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(drawer.inert).toBe(false);
      expect(drawer.getAttribute('role')).toBeNull();
    } finally { view.dispose(); }
  });
});

it('keeps analysis in navigation and omits the redundant launcher and ordinary role', () => {
  mobileMediaQuery();
  const view = mount();
  try {
    expect(view.host.querySelector('a[aria-label="Live analysis"]')?.getAttribute('href')).toBe('/app/analyze');
    expect(view.host.querySelector('.vg-product-topbar')?.textContent).not.toMatch(/Viewer|Analyze/);
    expect(view.host.querySelector('select[aria-label="Color theme"]')).not.toBeNull();
    expect(view.host.querySelector('a[aria-label="Overview"]')?.getAttribute('aria-current')).toBe('page');
    expect(view.host.querySelector('a[aria-label="Settings"]')?.getAttribute('href')).toBe('/app/settings');
  } finally { view.dispose(); }
});

it('removes the desktop bar and preserves appearance and active tab sharing controls in the sidebar', () => {
  const viewport = mobileMediaQuery();
  const view = mount();
  try {
    viewport.resize(false);
    expect(view.host.querySelector<HTMLElement>('.vg-mobile-bar')?.hidden).toBe(true);
    expect(view.host.querySelector('.vg-side-theme select[aria-label="Color theme"]')).not.toBeNull();
    expect(view.host.querySelectorAll('select[aria-label="Color theme"]')).toHaveLength(1);
    act(() => window.dispatchEvent(new CustomEvent('visionguard:tab-capture-status', { detail: { active: true } })));
    expect(view.host.querySelector('.vg-side-capture a')?.getAttribute('href')).toBe('/app/analyze');
    const stop = vi.fn();
    window.addEventListener('visionguard:stop-tab-capture', stop);
    try {
      act(() => view.host.querySelector<HTMLButtonElement>('.vg-side-capture button')!.click());
      expect(stop).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener('visionguard:stop-tab-capture', stop); }
    viewport.resize(true);
    expect(view.host.querySelector<HTMLElement>('.vg-mobile-bar')?.hidden).toBe(false);
    expect(view.host.querySelector('.vg-mobile-bar select[aria-label="Color theme"]')).not.toBeNull();
    expect(view.host.querySelector('.vg-mobile-bar .vg-capture-status')).not.toBeNull();
  } finally { view.dispose(); }
});
