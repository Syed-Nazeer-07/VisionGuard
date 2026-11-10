import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Landing } from './Landing';

// Exercise real React Router link clicks, not just hrefs in server HTML.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function verifyLinkNavigation(selector: string, href: string, destination: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<main>Sign-in destination</main>} />
            <Route path="/register" element={<main>Registration destination</main>} />
          </Routes>
        </MemoryRouter>
      );
    });
    const link = host.querySelector<HTMLAnchorElement>(selector);
    expect(link, `Missing clickable anchor: ${selector}`).not.toBeNull();
    expect(link?.getAttribute('href')).toBe(href);
    act(() => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host.textContent).toContain(destination);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
}

describe('public landing navigation', () => {
  it('opens registration from the top navigation CTA', () => {
    verifyLinkNavigation('.vgn-nav-actions a[href="/register"]', '/register', 'Registration destination');
  });

  it('opens sign-in from the top navigation', () => {
    verifyLinkNavigation('.vgn-nav-actions a[href="/login"]', '/login', 'Sign-in destination');
  });

  it('opens registration from the closing CTA', () => {
    verifyLinkNavigation('.vgn-cta-actions a[href="/register"]', '/register', 'Registration destination');
  });

  it('opens sign-in from the closing CTA', () => {
    verifyLinkNavigation('.vgn-cta-actions a[href="/login"]', '/login', 'Sign-in destination');
  });

  it('opens registration from the mobile menu', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      act(() => {
        root.render(
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/register" element={<main>Registration destination</main>} />
            </Routes>
          </MemoryRouter>
        );
      });
      const toggle = host.querySelector<HTMLButtonElement>('.vgn-menu-button');
      expect(toggle).not.toBeNull();
      act(() => toggle?.click());
      const link = host.querySelector<HTMLAnchorElement>('.vgn-mobile-navigation a[href="/register"]');
      expect(link).not.toBeNull();
      act(() => link?.click());
      expect(host.textContent).toContain('Registration destination');
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
