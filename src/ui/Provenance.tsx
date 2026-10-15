/** Labels every output by how far it can be trusted. */
export type Level = 'reference' | 'model' | 'estimate';
const TEXT: Record<Level, { label: string; title: string }> = {
  reference: { label: 'reference-checked', title: 'Agrees with NASA pyCycle to better than 0.05 % on the validation cases (see Validate).' },
  model: { label: 'uncalibrated model', title: 'Physically based model using the validated cycle, but with no external reference for this behaviour.' },
  estimate: { label: 'correlation estimate', title: 'Empirical correlation calibrated to published data where available; indicative only.' },
};
export function Provenance({ level, style }: { level: Level; style?: React.CSSProperties }) {
  const t = TEXT[level];
  return <span className={`prov prov-${level}`} title={t.title} style={style}>{t.label}</span>;
}
