import type { SendTableInput } from "./types.js";

// Keep each row intact and each page inside both Telegram's block and text limits.
export function* tablePages(table: SendTableInput): Generator<string[][]> {
  const overhead = table.title.length + table.headers.join("").length;
  let rows: string[][] = [];
  let size = overhead;
  for (const row of table.rows) {
    const length = row.join("").length;
    if (rows.length && (size + length > 32_000 || rows.length === 490)) {
      yield rows;
      rows = [];
      size = overhead;
    }
    rows.push(row);
    size += length;
  }
  if (rows.length) yield rows;
}

export function richTable(table: SendTableInput, rows: string[][]) {
  const cell = (text: string) => ({ text, align: "left", valign: "top" });
  return {
    skip_entity_detection: true,
    blocks: [
      { type: "heading", size: 2, text: table.title },
      {
        type: "table",
        is_bordered: true,
        cells: [
          table.headers.map((name) => ({ ...cell(name), is_header: true })),
          ...rows.map((row) => row.map(cell)),
        ],
      },
    ],
  };
}

// This path also handles a single unusually long source value, without truncating it.
export function* plainTable(table: SendTableInput, rows: string[][]) {
  const records = [
    table.title,
    ...rows.map((row) =>
      row.map((v, i) => table.headers[i] + ": " + v).join("\n"),
    ),
  ];
  let page = "";
  for (const record of records) {
    if (page && page.length + record.length + 2 > 4000) {
      yield page;
      page = "";
    }
    if (page) page += "\n\n";
    for (const char of record) {
      if (page.length + char.length > 4000) {
        yield page;
        page = "";
      }
      page += char;
    }
  }
  if (page) yield page;
}
