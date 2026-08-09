export const CREATOR_TIERS = [
  { minPoints: 0, name: '新手取景员' },
  { minPoints: 30, name: '机位记录者' },
  { minPoints: 100, name: '出片向导' },
  { minPoints: 300, name: '城市光影领航员' },
];

export function getCreatorTier(points = 0) {
  const normalizedPoints = Math.max(0, Number(points) || 0);
  let index = 0;

  for (let cursor = 0; cursor < CREATOR_TIERS.length; cursor += 1) {
    if (normalizedPoints >= CREATOR_TIERS[cursor].minPoints) index = cursor;
  }

  const current = CREATOR_TIERS[index];
  const next = CREATOR_TIERS[index + 1] || null;
  const range = next ? next.minPoints - current.minPoints : 1;
  const progress = next
    ? Math.min(1, Math.max(0, (normalizedPoints - current.minPoints) / range))
    : 1;

  return {
    current,
    next,
    progress,
    remaining: next ? Math.max(0, next.minPoints - normalizedPoints) : 0,
  };
}