import Papa from "papaparse";
import type { FileFormat, ParsedFile } from "../validators/types";

export function detectFormat(filename: string): FileFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jsonl.gz")) return "jsonl.gz";
  if (lower.endsWith(".csv.gz")) return "csv.gz";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".csv")) return "csv";
  throw new Error(`Unsupported file format: ${filename}`);
}

async function decompressGzip(buffer: ArrayBuffer): Promise<string> {
  const decompressed = Bun.gunzipSync(new Uint8Array(buffer));
  return new TextDecoder().decode(decompressed);
}

async function* parseJsonl(content: string): AsyncGenerator<Record<string, unknown>, void, unknown> {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      try {
        yield JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        throw new Error(`Invalid JSON on line: ${trimmed.substring(0, 50)}...`);
      }
    }
  }
}

async function* parseCsv(content: string): AsyncGenerator<Record<string, unknown>, void, unknown> {
  const result = Papa.parse<Record<string, unknown>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => value.trim(),
  });

  if (result.errors.length > 0) {
    const firstError = result.errors[0];
    throw new Error(`CSV parsing error at row ${firstError.row}: ${firstError.message}`);
  }

  for (const record of result.data) {
    yield record;
  }
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const format = detectFormat(file.name);
  const buffer = await file.arrayBuffer();

  let content: string;
  if (format === "jsonl.gz" || format === "csv.gz") {
    content = await decompressGzip(buffer);
  } else {
    content = new TextDecoder().decode(buffer);
  }

  const baseFormat = format.replace(".gz", "") as "jsonl" | "csv";
  const lines = content.split("\n").filter((l) => l.trim()).length;

  const records = baseFormat === "jsonl" ? parseJsonl(content) : parseCsv(content);

  return {
    format,
    records,
    totalLines: baseFormat === "csv" ? lines - 1 : lines, // CSV has header
  };
}

// Browser-compatible version (no Bun.gunzipSync)
export async function parseFileClient(file: File): Promise<ParsedFile> {
  const format = detectFormat(file.name);
  const buffer = await file.arrayBuffer();

  let content: string;
  if (format === "jsonl.gz" || format === "csv.gz") {
    // Use DecompressionStream API (available in modern browsers)
    const stream = new Response(buffer).body;
    if (!stream) throw new Error("Failed to create stream from buffer");

    const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
    const decompressedResponse = new Response(decompressedStream);
    content = await decompressedResponse.text();
  } else {
    content = new TextDecoder().decode(buffer);
  }

  const baseFormat = format.replace(".gz", "") as "jsonl" | "csv";
  const lines = content.split("\n").filter((l) => l.trim()).length;

  const records = baseFormat === "jsonl" ? parseJsonl(content) : parseCsv(content);

  return {
    format,
    records,
    totalLines: baseFormat === "csv" ? lines - 1 : lines,
  };
}
