import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useAnalysisFocus } from './useAnalysisFocus';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Harness({ active }: { active: boolean }) {
  const { focusMode, setFocusMode } = useAnalysisFocus(active);
  return <div className={focusMode ? 'vg-analyze-focus' : ''}>
    <button type="button" aria-pressed={focusMode} onClick={() => setFocusMode(value => !value)}>
      {focusMode ? 'Exit focus' : 'Focus view'}
    </button>
  </div>;
}

function mount(active = true) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<Harness active={active}/>));
  return {
    host,
    render: (nextActive: boolean) => act(() => root.render(<Harness active={nextActive}/>)),
    dispose: () => { act(() => root.unmount()); host.remove(); }
  };
}

describe('Live Analysis Focus View', () => {
  it('enters focus and exits via the same visible button', () => {
    const view = mount();
    try {
      const button = view.host.querySelector('button')!;
      expect(button.textContent).toBe('Focus view');
      expect(button.getAttribute('aria-pressed')).toBe('false');
      act(() => button.click());
      expect(button.textContent).toBe('Exit focus');
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(view.host.firstElementChild?.classList.contains('vg-analyze-focus')).toBe(true);
      act(() => button.click());
      expect(button.textContent).toBe('Focus view');
      expect(view.host.firstElementChild?.classList.contains('vg-analyze-focus')).toBe(false);
    } finally { view.dispose(); }
  });

  it('exits focus on Escape without needing browser fullscreen', () => {
    const view = mount();
    try {
      act(() => view.host.querySelector('button')!.click());
      act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(view.host.querySelector('button')!.textContent).toBe('Focus view');
    } finally { view.dispose(); }
  });

  it('automatically exits if the retained player is hidden by route navigation', () => {
    const view = mount();
    try {
      act(() => view.host.querySelector('button')!.click());
      view.render(false);
      expect(view.host.firstElementChild?.classList.contains('vg-analyze-focus')).toBe(false);
      view.render(true);
      expect(view.host.querySelector('button')!.textContent).toBe('Focus view');
    } finally { view.dispose(); }
  });
});
