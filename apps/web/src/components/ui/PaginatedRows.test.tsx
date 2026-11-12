import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { PaginatedRows } from './PaginatedRows';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function mount(element: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(element));
  return {
    host,
    update: (next: ReactNode) => act(() => root.render(next)),
    dispose: () => { act(() => root.unmount()); host.remove(); },
  };
}

const names = Array.from({ length: 67 }, (_, index) => 'Session ' + (index + 1));
const renderRow = (name: string) => <div key={name} data-testid="session-row">{name}</div>;

describe('PaginatedRows', () => {
  it('limits DOM rows, navigates pages and expands page size', () => {
    const view = mount(<PaginatedRows items={names} itemLabel="sessions" renderRow={renderRow}/>);
    try {
      expect(view.host.querySelectorAll('[data-testid="session-row"]')).toHaveLength(10);
      expect(view.host.textContent).toContain('Showing 1–10 of 67 sessions');
      act(() => view.host.querySelector<HTMLButtonElement>('button[aria-label="Next sessions page"]')!.click());
      expect(view.host.textContent).toContain('Showing 11–20 of 67 sessions');
      expect(view.host.textContent).toContain('Session 11');
      expect(view.host.querySelector('[data-testid="session-row"]')?.textContent).toBe('Session 11');
      const select = view.host.querySelector<HTMLSelectElement>('select[aria-label="Rows per page for sessions"]')!;
      act(() => {
        select.value = '25';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(view.host.querySelectorAll('[data-testid="session-row"]')).toHaveLength(25);
      expect(view.host.textContent).toContain('Showing 1–25 of 67 sessions');
    } finally { view.dispose(); }
  });

  it('resets after a filter change and clamps after results shrink', () => {
    const view = mount(<PaginatedRows items={names} itemLabel="sessions" renderRow={renderRow} resetKey="all"/>);
    try {
      act(() => view.host.querySelector<HTMLButtonElement>('button[aria-label="Next sessions page"]')!.click());
      view.update(<PaginatedRows items={names.slice(0, 15)} itemLabel="sessions" renderRow={renderRow} resetKey="recent"/>);
      expect(view.host.textContent).toContain('Showing 1–10 of 15 sessions');
      act(() => view.host.querySelector<HTMLButtonElement>('button[aria-label="Next sessions page"]')!.click());
      view.update(<PaginatedRows items={names.slice(0, 3)} itemLabel="sessions" renderRow={renderRow} resetKey="recent"/>);
      expect(view.host.querySelectorAll('[data-testid="session-row"]')).toHaveLength(3);
      expect(view.host.querySelector('nav')).toBeNull();
    } finally { view.dispose(); }
  });
});
