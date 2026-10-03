type StatusValues = {
  state?: string;
  status?: string;
  stateDisplay?: string;
  statusDisplay?: string;
  stateLabels?: Record<string, string>;
  statusLabels?: Record<string, string>;
};

function resolveLabel(
  value: string | undefined,
  display: string | undefined,
  labels: Record<string, string> | undefined,
): string | undefined {
  if (display?.trim()) return display.trim();
  if (!value) return undefined;
  return labels?.[value] ?? value;
}

export function getCombinedStatusLabel(values: StatusValues): string | undefined {
  const stateLabel = resolveLabel(values.state, values.stateDisplay, values.stateLabels);
  const statusLabel = resolveLabel(values.status, values.statusDisplay, values.statusLabels);

  if (!stateLabel) return statusLabel;
  if (!statusLabel) return stateLabel;
  if (stateLabel.localeCompare(statusLabel, undefined, { sensitivity: "accent" }) === 0) {
    return statusLabel;
  }
  return `${stateLabel} · ${statusLabel}`;
}
