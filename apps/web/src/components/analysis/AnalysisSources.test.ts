import { describe, expect, it } from 'vitest';
import { youtubeSearchUrl } from './AnalysisSources';

describe('YouTube source search', () => {
  it('uses a direct search with an encoded preset or custom query', () => {
    expect(youtubeSearchUrl('')).toBe('https://www.youtube.com/results?search_query=Traffic+video+footage+for+vehicle+object+detection');
    const custom = new URL(youtubeSearchUrl('  rush hour & buses # Delhi  '));
    expect(custom.origin).toBe('https://www.youtube.com');
    expect(custom.searchParams.get('search_query')).toBe('rush hour & buses # Delhi');
    expect(custom.hash).toBe('');
  });
});
