export const SYNTHESIS_PROFILES = [
  { value: 'auto', label: 'Auto' },
  { value: 'concise', label: 'Concise' },
  { value: 'strategic', label: 'Strategic' },
];

export function getSynthesisProfileLabel(profile) {
  const match = SYNTHESIS_PROFILES.find((item) => item.value === profile);
  return match ? match.label : 'Auto';
}
