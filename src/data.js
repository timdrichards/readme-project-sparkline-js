// src/data.js
//
// Everything between "the caller handed us something" and "we have an array of
// numbers and a parallel array of gap flags".
//
// The renderer never sees raw input. It sees a Series:
//
//   {values: number[], gaps: boolean[], labels: string[] | null, stats}
//
// `gaps[i] === true` means "there is no value here" -- a null, an empty CSV
// cell, a NaN. values[i] is still a number in that case (the interpolated or
// carried value) so that scales and paths do not have to special-case holes
// everywhere; they just consult `gaps`.

/* ------------------------------------------------------------------ *
 * Number parsing
 * ------------------------------------------------------------------ */

const BLANK_TOKENS = new Set(['', '-', '--', 'n/a', 'na', 'null', 'nil', 'none', 'nan']);

/**
 * Parse one cell into a number, or NaN if it is not one.
 *
 * Tolerant on purpose: spreadsheet exports arrive with thousands separators,
 * currency symbols, trailing percent signs, and parentheses for negatives.
 * Anything in BLANK_TOKENS is a gap, not a zero -- treating a blank as zero is
 * how a monitoring chart ends up claiming an outage.
 *
 * @param {unknown} raw
 * @returns {number} NaN for blanks and unparseable cells
 */
export function parseNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (raw === null || raw === undefined || typeof raw === 'boolean') return NaN;

  let text = String(raw).trim();
  if (BLANK_TOKENS.has(text.toLowerCase())) return NaN;

  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1).trim();
  }

  let scale = 1;
  if (text.endsWith('%')) {
    text = text.slice(0, -1).trim();
    scale = 0.01;
  }

  // Strip a leading currency symbol and any thousands separators. We do not
  // try to handle locales that use ',' as a decimal point; pass numbers, not
  // strings, if you need that.
  text = text.replace(/^[$£€¥]\s*/, '').replace(/,/g, '');

  if (text === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return NaN;

  const value = Number(text);
  return Number.isFinite(value) ? sign * value * scale : NaN;
}

/**
 * True when `raw` parses as a number.
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
export function looksNumeric(raw) {
  return !Number.isNaN(parseNumber(raw));
}

/* ------------------------------------------------------------------ *
 * Series construction
 * ------------------------------------------------------------------ */

/**
 * Pull a numeric value out of one input item.
 *
 * Accepts a number, a numeric string, or an object with a `value` key.
 *
 * The object form is undocumented. It exists because one internal dashboard
 * stores rows as `{label, value}` and nobody wanted to map over them twice.
 * It has never been in the docs and may be removed in 3.0 -- if you are
 * relying on it, say so on the issue tracker. -- ah
 *
 * @param {unknown} item
 * @returns {number} NaN when the item carries no value
 */
function valueOf(item) {
  if (item === null || item === undefined) return NaN;
  if (typeof item === 'object' && !Array.isArray(item)) {
    if ('value' in item) return parseNumber(item.value);
    if ('y' in item) return parseNumber(item.y);
    return NaN;
  }
  return parseNumber(item);
}

function labelOf(item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    if (typeof item.label === 'string') return item.label;
    if (typeof item.name === 'string') return item.name;
    if (typeof item.x === 'string') return item.x;
  }
  return null;
}

/**
 * Summary statistics over the non-gap values of a series.
 *
 * Indices point into the full array, gaps included, so they can be used to
 * look up a point. When every value is a gap the min/max indices are -1.
 *
 * @param {number[]} values
 * @param {boolean[]} gaps
 * @returns {{count: number, present: number, min: number, max: number,
 *   minIndex: number, maxIndex: number, first: number, last: number,
 *   mean: number, sum: number, range: number}}
 */
export function statsOf(values, gaps) {
  const stats = {
    count: values.length,
    present: 0,
    min: Infinity,
    max: -Infinity,
    minIndex: -1,
    maxIndex: -1,
    first: NaN,
    last: NaN,
    mean: NaN,
    sum: 0,
    range: 0,
  };

  for (let i = 0; i < values.length; i += 1) {
    if (gaps[i]) continue;
    const v = values[i];
    stats.present += 1;
    stats.sum += v;
    if (v < stats.min) {
      stats.min = v;
      stats.minIndex = i;
    }
    if (v > stats.max) {
      stats.max = v;
      stats.maxIndex = i;
    }
    if (Number.isNaN(stats.first)) stats.first = v;
    stats.last = v;
  }

  if (stats.present === 0) {
    stats.min = 0;
    stats.max = 0;
    stats.first = NaN;
    stats.last = NaN;
    stats.mean = NaN;
    return stats;
  }

  stats.mean = stats.sum / stats.present;
  stats.range = stats.max - stats.min;
  return stats;
}

/**
 * Fill the numbers sitting under gap positions so downstream code can do
 * arithmetic on `values` without checking `gaps` first.
 *
 * - 'break'       leave a hole; the path is split into segments (default)
 * - 'skip'        drop the point entirely and close the line over it
 * - 'zero'        treat the gap as 0
 * - 'interpolate' straight line between the neighbouring real values
 *
 * 'break' and 'skip' look identical when there is one missing point in the
 * middle of a dense series, and completely different when a whole weekend is
 * missing. That is the case worth picking deliberately.
 *
 * @param {number[]} values mutated in place
 * @param {boolean[]} gaps
 * @param {'break'|'skip'|'zero'|'interpolate'} mode
 * @returns {{values: number[], gaps: boolean[]}}
 */
export function applyGapMode(values, gaps, mode) {
  if (mode === 'skip') {
    const outValues = [];
    const outGaps = [];
    for (let i = 0; i < values.length; i += 1) {
      if (gaps[i]) continue;
      outValues.push(values[i]);
      outGaps.push(false);
    }
    return { values: outValues, gaps: outGaps };
  }

  if (mode === 'zero') {
    for (let i = 0; i < values.length; i += 1) {
      if (gaps[i]) values[i] = 0;
    }
    return { values, gaps: gaps.map(() => false) };
  }

  if (mode === 'interpolate') {
    let i = 0;
    while (i < values.length) {
      if (!gaps[i]) {
        i += 1;
        continue;
      }
      let end = i;
      while (end < values.length && gaps[end]) end += 1;

      const before = i - 1;
      const after = end;
      const hasBefore = before >= 0 && !gaps[before];
      const hasAfter = after < values.length && !gaps[after];

      for (let j = i; j < end; j += 1) {
        if (hasBefore && hasAfter) {
          const t = (j - before) / (after - before);
          values[j] = values[before] + (values[after] - values[before]) * t;
        } else if (hasBefore) {
          values[j] = values[before];
        } else if (hasAfter) {
          values[j] = values[after];
        } else {
          values[j] = 0;
        }
      }
      i = end;
    }
    return { values, gaps: gaps.map(() => false) };
  }

  // 'break': carry the last known value forward so the numbers are sane, but
  // keep the gap flag so the renderer knows to lift the pen.
  let carry = NaN;
  for (let i = 0; i < values.length; i += 1) {
    if (!gaps[i]) {
      carry = values[i];
    } else {
      values[i] = Number.isNaN(carry) ? 0 : carry;
    }
  }
  return { values, gaps };
}

/**
 * Turn whatever the caller passed into a Series.
 *
 * Accepted input:
 *   [1, 2, 3]                      numbers
 *   ['1', '2', '3']                numeric strings
 *   [1, null, 3]                   null / undefined / NaN become gaps
 *   [{value: 1}, {value: 2}]       object form (undocumented, see valueOf)
 *   Float64Array / other TypedArray
 *
 * @param {Array<unknown>|Float64Array} input
 * @param {{gaps?: 'break'|'skip'|'zero'|'interpolate'}} [opts]
 * @returns {{values: number[], gaps: boolean[], labels: string[]|null, stats: object}}
 */
export function normalizeData(input, opts = {}) {
  const { gaps: gapMode = 'break' } = opts;

  if (input === null || input === undefined) {
    throw new TypeError('sparkline: data must be an array');
  }
  const isTyped = ArrayBuffer.isView(input) && !(input instanceof DataView);
  if (!Array.isArray(input) && !isTyped) {
    throw new TypeError(
      `sparkline: data must be an array, received ${typeof input}`,
    );
  }

  const source = isTyped ? Array.from(input) : input;
  const values = new Array(source.length);
  const flags = new Array(source.length);
  let labels = null;

  for (let i = 0; i < source.length; i += 1) {
    const value = valueOf(source[i]);
    const missing = Number.isNaN(value);
    values[i] = missing ? 0 : value;
    flags[i] = missing;

    const label = labelOf(source[i]);
    if (label !== null) {
      if (!labels) labels = new Array(source.length).fill(null);
      labels[i] = label;
    }
  }

  const adjusted = applyGapMode(values, flags, gapMode);
  if (gapMode === 'skip' && labels) {
    labels = labels.filter((_, i) => !flags[i]);
  }

  return {
    values: adjusted.values,
    gaps: adjusted.gaps,
    labels,
    stats: statsOf(adjusted.values, adjusted.gaps),
  };
}

/* ------------------------------------------------------------------ *
 * Downsampling
 * ------------------------------------------------------------------ */

/**
 * Largest-Triangle-Three-Buckets. Keeps the visual shape of a series while
 * cutting the point count, which plain every-nth sampling does not: nth-point
 * sampling drops exactly the spikes people are looking for.
 *
 * Gaps are preserved by running LTTB over each contiguous run separately.
 *
 * @param {number[]} values
 * @param {boolean[]} gaps
 * @param {number} threshold target point count (>= 3)
 * @returns {{values: number[], gaps: boolean[]}}
 */
function lttb(values, gaps, threshold) {
  const n = values.length;
  if (threshold >= n || threshold < 3) return { values, gaps };

  const sampled = [values[0]];
  const sampledGaps = [gaps[0]];
  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0;

  for (let i = 0; i < threshold - 2; i += 1) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);

    // Average of the next bucket: the third point of the triangle.
    let avgX = 0;
    let avgY = 0;
    let avgCount = 0;
    for (let j = rangeStart; j < rangeEnd; j += 1) {
      avgX += j;
      avgY += values[j];
      avgCount += 1;
    }
    if (avgCount === 0) {
      avgX = rangeStart;
      avgY = values[Math.min(rangeStart, n - 1)];
    } else {
      avgX /= avgCount;
      avgY /= avgCount;
    }

    const bucketStart = Math.floor(i * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);

    let maxArea = -1;
    let chosen = bucketStart;
    for (let j = bucketStart; j < bucketEnd; j += 1) {
      const area = Math.abs(
        (a - avgX) * (values[j] - values[a]) - (a - j) * (avgY - values[a]),
      );
      if (area > maxArea) {
        maxArea = area;
        chosen = j;
      }
    }

    sampled.push(values[chosen]);
    sampledGaps.push(gaps[chosen]);
    a = chosen;
  }

  sampled.push(values[n - 1]);
  sampledGaps.push(gaps[n - 1]);
  return { values: sampled, gaps: sampledGaps };
}

function bucketReduce(values, gaps, threshold, pick) {
  const n = values.length;
  const out = [];
  const outGaps = [];
  const size = n / threshold;
  for (let i = 0; i < threshold; i += 1) {
    const start = Math.floor(i * size);
    const end = Math.min(Math.floor((i + 1) * size), n);
    const slice = [];
    let allGaps = true;
    for (let j = start; j < end; j += 1) {
      if (!gaps[j]) {
        slice.push(values[j]);
        allGaps = false;
      }
    }
    if (allGaps) {
      out.push(values[start] ?? 0);
      outGaps.push(true);
    } else {
      out.push(pick(slice));
      outGaps.push(false);
    }
  }
  return { values: out, gaps: outGaps };
}

/**
 * Reduce a series to at most `threshold` points.
 *
 * Methods:
 *   'lttb'  shape-preserving (default) -- keeps spikes
 *   'mean'  bucket average -- smooth, hides spikes
 *   'min'   bucket minimum
 *   'max'   bucket maximum
 *   'nth'   every nth point -- fastest, least honest
 *
 * Returns the input untouched when it is already short enough.
 *
 * @param {number[]} values
 * @param {boolean[]} gaps
 * @param {number} threshold
 * @param {'lttb'|'mean'|'min'|'max'|'nth'} [method]
 * @returns {{values: number[], gaps: boolean[]}}
 */
export function downsample(values, gaps, threshold, method = 'lttb') {
  if (!Number.isFinite(threshold) || threshold < 1) {
    throw new TypeError('downsample: threshold must be a positive number');
  }
  const n = values.length;
  if (n <= threshold) return { values, gaps };

  switch (method) {
    case 'lttb':
      return lttb(values, gaps, Math.floor(threshold));
    case 'mean':
      return bucketReduce(values, gaps, Math.floor(threshold), (slice) =>
        slice.reduce((sum, v) => sum + v, 0) / slice.length);
    case 'min':
      return bucketReduce(values, gaps, Math.floor(threshold), (slice) => Math.min(...slice));
    case 'max':
      return bucketReduce(values, gaps, Math.floor(threshold), (slice) => Math.max(...slice));
    case 'nth': {
      const step = Math.ceil(n / threshold);
      const out = [];
      const outGaps = [];
      for (let i = 0; i < n; i += step) {
        out.push(values[i]);
        outGaps.push(gaps[i]);
      }
      // Always keep the final point: the last value is usually the one the
      // reader cares about, and step arithmetic tends to drop it.
      if (out.length && values[n - 1] !== out[out.length - 1]) {
        out.push(values[n - 1]);
        outGaps.push(gaps[n - 1]);
      }
      return { values: out, gaps: outGaps };
    }
    default:
      throw new TypeError(
        `downsample: unknown method "${method}". Use lttb, mean, min, max, or nth.`,
      );
  }
}

/* ------------------------------------------------------------------ *
 * Delimited text
 * ------------------------------------------------------------------ */

const DELIMITER_ALIASES = {
  tab: '\t',
  '\\t': '\t',
  comma: ',',
  semicolon: ';',
  pipe: '|',
  space: ' ',
};

/**
 * Resolve a CLI-style delimiter spec ('tab', '\t', ';') to one character.
 *
 * @param {string} spec
 * @returns {string}
 */
export function resolveDelimiter(spec) {
  if (spec === undefined || spec === null) return ',';
  const alias = DELIMITER_ALIASES[String(spec).toLowerCase()];
  if (alias) return alias;
  const value = String(spec);
  if (value.length !== 1) {
    throw new TypeError(
      `sparkline: --delimiter must be one character (or tab, comma, semicolon, pipe)`,
    );
  }
  return value;
}

/**
 * Guess the delimiter by counting candidates on the first few lines and
 * taking the one with the most consistent count per line.
 *
 * @param {string} text
 * @returns {string}
 */
export function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5);
  if (lines.length === 0) return ',';

  let best = ',';
  let bestScore = -1;
  for (const candidate of [',', '\t', ';', '|']) {
    const counts = lines.map((line) => line.split(candidate).length - 1);
    const first = counts[0];
    if (first === 0) continue;
    const consistent = counts.every((c) => c === first);
    const score = (consistent ? 1000 : 0) + first;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Parse delimited text into rows of strings.
 *
 * Handles quoted fields, doubled quotes inside them, embedded newlines, and
 * both line ending conventions. It is not a full CSV library and does not try
 * to be; it is the subset the CLI needs to read an export.
 *
 * @param {string} text
 * @param {{delimiter?: string}} [opts]
 * @returns {string[][]}
 */
export function parseDelimited(text, opts = {}) {
  const delimiter = opts.delimiter || ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  // Strip a UTF-8 BOM: Excel writes one and it poisons the first header name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (i < src.length) {
    const char = src[i];

    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (char === '\n' || char === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += char === '\r' && src[i + 1] === '\n' ? 2 : 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/**
 * Decide whether the first row is a header.
 *
 * The rule: it is a header if at least one of its cells is non-numeric while
 * the same cell in the next row is numeric. A single-column file of numbers
 * therefore has no header, which is what people expect.
 *
 * @param {string[][]} rows
 * @returns {boolean}
 */
export function detectHeader(rows) {
  if (rows.length < 2) return false;
  const [first, second] = rows;
  for (let i = 0; i < Math.min(first.length, second.length); i += 1) {
    if (!looksNumeric(first[i]) && looksNumeric(second[i])) return true;
  }
  return false;
}

/**
 * Choose a column from parsed rows.
 *
 * `spec` may be a header name (exact, then case-insensitive), a zero-based
 * index as a number or numeric string, or null/undefined to auto-pick the
 * first column whose body is numeric.
 *
 * @param {string[][]} rows body rows, header already removed
 * @param {string[]|null} header
 * @param {string|number|null} [spec]
 * @returns {{index: number, name: string|null, cells: string[]}}
 */
export function pickColumn(rows, header, spec = null) {
  if (rows.length === 0) {
    throw new Error('sparkline: no data rows found');
  }
  const width = Math.max(...rows.map((r) => r.length));

  let index = -1;
  if (spec !== null && spec !== undefined && spec !== '') {
    if (typeof spec === 'number' || /^\d+$/.test(String(spec))) {
      index = Number(spec);
      if (index < 0 || index >= width) {
        throw new Error(
          `sparkline: column index ${index} is out of range (file has ${width} columns)`,
        );
      }
    } else if (header) {
      const wanted = String(spec);
      index = header.indexOf(wanted);
      if (index === -1) {
        index = header.findIndex(
          (name) => name.trim().toLowerCase() === wanted.trim().toLowerCase(),
        );
      }
      if (index === -1) {
        throw new Error(
          `sparkline: no column named "${wanted}". Columns: ${header.join(', ')}`,
        );
      }
    } else {
      throw new Error(
        `sparkline: --column "${spec}" is a name, but this input has no header row. ` +
          'Pass --header, or use a zero-based column index.',
      );
    }
  } else {
    for (let c = 0; c < width; c += 1) {
      const cells = rows.map((r) => r[c]);
      const numeric = cells.filter((cell) => looksNumeric(cell)).length;
      if (numeric >= Math.max(1, Math.ceil(cells.length * 0.6))) {
        index = c;
        break;
      }
    }
    if (index === -1) {
      throw new Error(
        'sparkline: could not find a numeric column. Pass --column with a name or index.',
      );
    }
  }

  return {
    index,
    name: header ? (header[index] ?? null) : null,
    cells: rows.map((r) => (r[index] === undefined ? '' : r[index])),
  };
}

/**
 * Read a numeric series out of delimited text.
 *
 * @param {string} text
 * @param {{delimiter?: string, header?: boolean|null, column?: string|number|null,
 *   labelColumn?: string|number|null}} [opts]
 * @returns {{values: unknown[], labels: string[]|null, column: string|null, columns: string[]|null}}
 */
export function parseCSV(text, opts = {}) {
  const delimiter = opts.delimiter || sniffDelimiter(text);
  const rows = parseDelimited(text, { delimiter });
  if (rows.length === 0) {
    throw new Error('sparkline: input is empty');
  }

  const hasHeader = opts.header === null || opts.header === undefined
    ? detectHeader(rows)
    : Boolean(opts.header);

  const header = hasHeader ? rows[0].map((cell) => cell.trim()) : null;
  const body = hasHeader ? rows.slice(1) : rows;
  if (body.length === 0) {
    throw new Error(
      'sparkline: input has a header row but no data rows. ' +
        'Pass --no-header if the first line is data.',
    );
  }

  const column = pickColumn(body, header, opts.column ?? null);

  let labels = null;
  if (opts.labelColumn !== null && opts.labelColumn !== undefined) {
    labels = pickColumn(body, header, opts.labelColumn).cells;
  } else if (header && column.index > 0) {
    // Convention, not configuration: if the series is not the first column,
    // the first column is almost always the timestamp or the label.
    labels = body.map((r) => (r[0] === undefined ? '' : r[0]));
  }

  return {
    values: column.cells,
    labels,
    column: column.name,
    columns: header,
  };
}

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

function findArray(node, key) {
  if (Array.isArray(node)) return node;
  if (!node || typeof node !== 'object') return null;

  if (key) {
    const target = key.split('.').reduce(
      (acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined),
      node,
    );
    if (Array.isArray(target)) return target;
    throw new Error(`sparkline: --column "${key}" did not resolve to an array in this JSON`);
  }

  for (const candidate of ['data', 'values', 'series', 'points', 'items', 'results']) {
    if (Array.isArray(node[candidate])) return node[candidate];
  }
  return null;
}

/**
 * Read a numeric series out of JSON or NDJSON text.
 *
 * Accepted shapes:
 *   [1, 2, 3]
 *   [{value: 1}, ...] / [{y: 1}, ...]
 *   [{cpu: 1, mem: 2}, ...]        with `column: 'cpu'`
 *   {data: [...]} / {values: [...]} / {series: [...]}
 *   one JSON value per line (NDJSON)
 *
 * @param {string} text
 * @param {{column?: string|number|null}} [opts]
 * @returns {{values: unknown[], labels: string[]|null, column: string|null, columns: string[]|null}}
 */
export function parseJSON(text, opts = {}) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('sparkline: input is empty');

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    // Try NDJSON before giving up: one JSON value per line is what most
    // logging pipelines emit.
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
    try {
      parsed = lines.map((line) => JSON.parse(line));
    } catch {
      throw new Error(`sparkline: input is not valid JSON (${err.message})`);
    }
  }

  const key = typeof opts.column === 'string' && !/^\d+$/.test(opts.column)
    ? opts.column
    : null;

  let array = findArray(parsed, null);
  if (!array && key) array = findArray(parsed, key);
  if (!array) {
    throw new Error(
      'sparkline: JSON input must be an array, or an object with a ' +
        'data/values/series array',
    );
  }

  const first = array.find((item) => item !== null && item !== undefined);
  const isObjectRows = first && typeof first === 'object' && !Array.isArray(first);

  let columns = null;
  let values = array;
  let column = null;
  let labels = null;

  if (isObjectRows) {
    columns = [...new Set(array.flatMap((item) => (item ? Object.keys(item) : [])))];

    if (opts.column !== null && opts.column !== undefined && opts.column !== '') {
      const wanted = String(opts.column);
      const resolved = /^\d+$/.test(wanted) ? columns[Number(wanted)] : wanted;
      if (!resolved || !columns.includes(resolved)) {
        throw new Error(
          `sparkline: no field named "${wanted}" in this JSON. Fields: ${columns.join(', ')}`,
        );
      }
      column = resolved;
      values = array.map((item) => (item ? item[resolved] : null));
    } else if (columns.includes('value') || columns.includes('y')) {
      // Leave the objects alone; normalizeData() understands {value}.
      column = columns.includes('value') ? 'value' : 'y';
    } else {
      const numeric = columns.find((name) =>
        array.every((item) => item === null || item === undefined || looksNumeric(item[name])),
      );
      if (!numeric) {
        throw new Error(
          `sparkline: could not find a numeric field in this JSON. Fields: ${columns.join(', ')}. ` +
            'Pass --column.',
        );
      }
      column = numeric;
      values = array.map((item) => (item ? item[numeric] : null));
    }

    const labelKey = ['label', 'name', 'time', 'timestamp', 'date', 'x'].find((k) =>
      columns.includes(k));
    if (labelKey) {
      labels = array.map((item) => (item && item[labelKey] != null ? String(item[labelKey]) : ''));
    }
  }

  return { values, labels, column, columns };
}

/**
 * Guess a format from a filename and/or the text itself.
 *
 * @param {string|null} filename
 * @param {string} text
 * @returns {'json'|'csv'}
 */
export function detectFormat(filename, text) {
  if (filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.json') || lower.endsWith('.ndjson')) return 'json';
    if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return 'csv';
  }
  const head = text.trimStart()[0];
  return head === '[' || head === '{' ? 'json' : 'csv';
}

/**
 * Read a series out of text in either supported format.
 *
 * @param {string} text
 * @param {{format?: 'json'|'csv'|'auto', filename?: string|null, delimiter?: string,
 *   header?: boolean|null, column?: string|number|null}} [opts]
 * @returns {{values: unknown[], labels: string[]|null, column: string|null,
 *   columns: string[]|null, format: 'json'|'csv'}}
 */
export function parseSeries(text, opts = {}) {
  const format = !opts.format || opts.format === 'auto'
    ? detectFormat(opts.filename ?? null, text)
    : opts.format;

  const result = format === 'json' ? parseJSON(text, opts) : parseCSV(text, opts);
  return { ...result, format };
}

/* ------------------------------------------------------------------ *
 * Text output
 * ------------------------------------------------------------------ */

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Render a series as Unicode block characters, one column per value.
 *
 * This is what `--format txt` produces. It shares the scale logic with the SVG
 * renderer in spirit but not in code: eight buckets is not enough resolution
 * for the gutter and stroke-width machinery to mean anything.
 *
 * @param {number[]} values
 * @param {boolean[]} [gaps]
 * @param {{normalize?: 'extent'|'zero'|'symmetric', gapChar?: string}} [opts]
 * @returns {string}
 */
export function toBlocks(values, gaps = [], opts = {}) {
  const { normalize = 'extent', gapChar = ' ' } = opts;
  if (values.length === 0) return '';

  const stats = statsOf(values, gaps.length ? gaps : values.map(() => false));
  let lo = stats.min;
  let hi = stats.max;

  if (normalize === 'zero') {
    lo = Math.min(0, stats.min);
    hi = Math.max(0, stats.max);
  } else if (normalize === 'symmetric') {
    const extreme = Math.max(Math.abs(stats.min), Math.abs(stats.max));
    lo = -extreme;
    hi = extreme;
  }

  const span = hi - lo;
  return values
    .map((value, i) => {
      if (gaps[i]) return gapChar;
      if (span === 0) return BLOCKS[0];
      const t = (value - lo) / span;
      const bucket = Math.min(BLOCKS.length - 1, Math.max(0, Math.round(t * (BLOCKS.length - 1))));
      return BLOCKS[bucket];
    })
    .join('');
}
