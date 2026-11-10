import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Landing } from './Landing';

// Public account routes deliberately use native anchors, not React-Router
// interception. Full-page navigation still works if hydration or other JS
// work stalls. Happy DOM does not simulate the browser's network navigation.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function mountLanding() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<Landing />));
  return {
    host,
    dispose: () => {
      act(() => root.unmount());
      host.remove();
    }
  };
}

function expectNativeRouteClick(selector: string, destination: string) {
  const { host, dispose } = mountLanding();
  let sawBubbledClick = false;
  let wasIntercepted = false;
  const cancelExternalNavigation = (event: MouseEvent) => {
    // React's delegated click handler runs on the root BEFORE this document
    // listener. Any SPA preventDefault() would already be observable here.
    sawBubbledClick = true;
    wasIntercepted = event.defaultPrevented;
    event.preventDefault(); // Keep tests on this page; do not load a URL.
  };
  try {
    const link = host.querySelector<HTMLAnchorElement>(selector);
    expect(link, `Missing anchor: ${selector}`).not.toBeNull();
    expect(link?.getAttribute('href')).toBe(destination);
    document.addEventListener('click', cancelExternalNavigation, { once: true });
    act(() => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(sawBubbledClick).toBe(true);
    expect(wasIntercepted).toBe(false);
  } finally {
    document.removeEventListener('click', cancelExternalNavigation);
    dispose();
  }
}

describe('native browser navigation from the public landing page', () => {
  it('does not intercept the header Get started link', () => {
    expectNativeRouteClick('.vgn-nav-actions a[href="/register"]', '/register');
  });
  it('does not intercept the header Sign in link', () => {
    expectNativeRouteClick('.vgn-nav-actions a[href="/login"]', '/login');
  });
  it('does not intercept the hero account link', () => {
    expectNativeRouteClick('.vgn-hero-actions a[href="/register"]', '/register');
  });
  it('does not intercept the closing Get started link', () => {
    expectNativeRouteClick('.vgn-cta-actions a[href="/register"]', '/register');
  });
  it('does not intercept the closing Sign in link', () => {
    expectNativeRouteClick('.vgn-cta-actions a[href="/login"]', '/login');
  });
  it('keeps a usable native registration link in the mobile menu', () => {
    const { host, dispose } = mountLanding();
    try {
      const toggle = host.querySelector<HTMLButtonElement>('.vgn-menu-button');
      expect(toggle).not.toBeNull();
      act(() => toggle?.click());
      const link = host.querySelector<HTMLAnchorElement>('.vgn-mobile-navigation a[href="/register"]');
      expect(link?.getAttribute('href')).toBe('/register');
      expect(link?.tagName).toBe('A');
    } finally {
      dispose();
    }
  });
});
