// Accepts 03XXXXXXXXX, 923XXXXXXXXX, 00923XXXXXXXXX and +923XXXXXXXXX
// (spaces, dashes and brackets ignored) and returns +923XXXXXXXXX.
export function normalizePkPhone(input: string): string | null {
  const compact = input.replace(/[\s\-()]/g, '');
  const match = /^(?:\+92|0092|92|0)(3\d{9})$/.exec(compact);
  return match ? `+92${match[1]}` : null;
}

export const PK_PHONE_REGEX = /^\+923\d{9}$/;
