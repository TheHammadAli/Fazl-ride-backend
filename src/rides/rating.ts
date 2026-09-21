// What the apps show next to a person's name, e.g. "4.8 (120)".
export function ratingView(sum: number, count: number) {
  return {
    average: count > 0 ? Math.round((sum / count) * 10) / 10 : null,
    count,
  };
}
