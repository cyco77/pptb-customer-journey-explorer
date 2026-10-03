export type EntityExportRow = {
  displayName: string;
  logicalName: string;
  view: string;
  recordCount: string;
};

const CSV_HEADERS = ["Display Name", "Logical Name", "View", "Record Count"] as const;

function escapeCsvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function escapeMarkdownValue(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function buildEntitiesCsv(rows: EntityExportRow[]): string {
  const records = rows.map((row) =>
    [row.displayName, row.logicalName, row.view, row.recordCount].map(escapeCsvValue).join(","),
  );
  return [CSV_HEADERS.join(","), ...records].join("\n");
}

export function buildEntitiesMarkdown(rows: EntityExportRow[]): string {
  const records = rows.map((row) =>
    `| ${escapeMarkdownValue(row.displayName)} | ${escapeMarkdownValue(row.logicalName)} | ${escapeMarkdownValue(row.view)} | ${escapeMarkdownValue(row.recordCount)} |`,
  );
  return [
    "| Display Name | Logical Name | View | Record Count |",
    "| --- | --- | --- | ---: |",
    ...records,
  ].join("\n");
}
