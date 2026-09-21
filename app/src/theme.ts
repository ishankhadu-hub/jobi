export const theme = {
  colors: {
    bg: '#0B1220',
    card: '#141C2E',
    cardAlt: '#1B2540',
    border: '#26324D',
    text: '#E6EDF7',
    textDim: '#9AA7BD',
    primary: '#4F8DF7',
    primaryText: '#FFFFFF',
    success: '#3FB68B',
    warn: '#E0A24E',
    danger: '#E5646E',
    chip: '#22304F',
  },
  radius: 14,
  space: (n: number) => n * 8,
};

// Colour a 0–100 score.
export function scoreColor(score: number) {
  if (score >= 80) return theme.colors.success;
  if (score >= 65) return theme.colors.warn;
  return theme.colors.danger;
}
