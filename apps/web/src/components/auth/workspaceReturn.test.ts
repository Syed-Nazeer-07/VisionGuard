import { describe, expect, it } from 'vitest';
import { workspaceReturn } from './workspaceReturn';

describe('workspace sign-in return target', () => {
  it('keeps an authenticated deep link and its query parameters', () => {
    expect(workspaceReturn({ pathname: '/app/analyze', search: '?video=abc&quality=1', hash: '#player' }))
      .toBe('/app/analyze?video=abc&quality=1#player');
  });

  it.each(['//example.com', 'https://example.com', '/application', '/app/../login', '/app/%2e%2e/login', '/app\\@example.com'])(
    'falls back when the target leaves the workspace (%s)', pathname => {
      expect(workspaceReturn({ pathname })).toBe('/app');
    }
  );
});
