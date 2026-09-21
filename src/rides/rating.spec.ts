import { ratingView } from './rating.js';

describe('ratingView', () => {
  it('has no average before the first rating', () => {
    expect(ratingView(0, 0)).toEqual({ average: null, count: 0 });
  });

  it('rounds to one decimal like the mockup (4.8)', () => {
    expect(ratingView(576, 120)).toEqual({ average: 4.8, count: 120 });
    expect(ratingView(14, 3)).toEqual({ average: 4.7, count: 3 });
  });

  it('keeps a perfect score', () => {
    expect(ratingView(25, 5)).toEqual({ average: 5, count: 5 });
  });
});
