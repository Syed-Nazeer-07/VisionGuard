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

it('exposes the analysis action and accessible names for navigation links', () => {
  mobileMediaQuery();
  const view = mount();
  try {
    expect(view.host.querySelector('a[aria-label="Start analysis"]')?.getAttribute('href')).toBe('/app/analyze');
    expect(view.host.querySelector('a[aria-label="Overview"]')?.getAttribute('aria-current')).toBe('page');
    expect(view.host.querySelector('a[aria-label="Settings"]')?.getAttribute('href')).toBe('/app/settings');
  } finally { view.dispose(); }
});
