#!/usr/bin/env node
// src/cli.js
//
// `sparkline render data.csv --out chart.svg`
//
// The CLI exists because half the people who want a sparkline want it in a
// build script or a status page, not in a browser. It is the same renderer:
// everything here is argument parsing, file IO, and error messages.
//
// Node stdlib only. The library has no runtime dependencies and the CLI does
// not get to be the thing that adds one.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// The CLI ships inside the package, so it imports the modules directly rather
// than going through the public entry point. Anything reached this way that is
// not re-exported by sparkline.js is internal and can change.
import { normalizeData, parseSeries, resolveDelimiter, statsOf } from './data.js';
import {
  VERSION,
  getTheme,
  isBuiltInMarker,
  isBuiltInTheme,
  listMarkers,
  listThemes,
} from './theme.js';
import { describe, toSVGString, toTextString } from './sparkline.js';

/** Exit codes, so scripts can tell "bad usage" from "bad data". */
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

const PROGRAM = 'sparkline';

/* ------------------------------------------------------------------ *
 * Argument definitions
 * ------------------------------------------------------------------ */

const OPTIONS = {
  out: { type: 'string', short: 'o' },
  format: { type: 'string', short: 'f' },
  width: { type: 'string' },
  height: { type: 'string' },
  stroke: { type: 'string' },
  'stroke-width': { type: 'string' },
  fill: { type: 'string' },
  normalize: { type: 'string', short: 'n' },
  gutter: { type: 'string' },
  column: { type: 'string', short: 'c' },
  delimiter: { type: 'string', short: 'd' },
  header: { type: 'boolean' },
  'no-header': { type: 'boolean' },
  theme: { type: 'string', short: 't' },
  markers: { type: 'string', short: 'm' },
  downsample: { type: 'string' },
  'downsample-method': { type: 'string' },
  type: { type: 'string' },
  curve: { type: 'string' },
  gaps: { type: 'string' },
  label: { type: 'string' },
  'input-format': { type: 'string' },
  stdin: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  version: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
};

const USAGE = `${PROGRAM} ${VERSION}

Render a sparkline from a CSV or JSON file.

USAGE
  ${PROGRAM} render <input> [options]
  ${PROGRAM} render --stdin [options]
  ${PROGRAM} describe <input> [options]   Print the numbers, draw nothing
  ${PROGRAM} themes                       List the built-in themes
  ${PROGRAM} markers                      List the built-in markers

INPUT
  <input>                   Path to a .csv, .tsv, .json or .ndjson file.
                            Use "-" or --stdin to read standard input.
  --stdin                   Read the series from standard input.
  --input-format <fmt>      csv | json | auto   (default: auto, by extension)
  -c, --column <name|idx>   Which column or JSON field holds the values.
                            Default: the first mostly-numeric column.
  -d, --delimiter <char>    Field delimiter, or one of: tab, comma,
                            semicolon, pipe. Default: sniffed from the file.
      --header              Treat the first row as a header.
      --no-header           Treat the first row as data.
                            Default: detected.
      --gaps <mode>         break | skip | zero | interpolate  (default: break)
      --downsample <n>      Reduce to at most n points before drawing.
      --downsample-method <m>  lttb | mean | min | max | nth  (default: lttb)

OUTPUT
  -o, --out <path>          Write here instead of standard output.
  -f, --format <fmt>        svg | txt   (default: svg, or from --out's
                            extension)
  -q, --quiet               Do not print the summary line to stderr.

CHART
      --width <px>          Default: 100
      --height <px>         Default: 20
      --type <type>         line | area | bar | tick   (default: line)
      --curve <curve>       linear | step | monotone   (default: linear)
  -n, --normalize <mode>    extent | zero | symmetric  (default: extent)
                            'extent' scales to the data's own min and max.
                            'zero' pins the baseline at zero, as 1.x did.
      --stroke <color>      Default: currentColor
      --stroke-width <px>   Default: 1
      --fill <color>        Default: none
      --gutter <px>         Padding so the stroke is not clipped.
                            Default: the stroke width.
  -t, --theme <name>        ${listThemes().join(', ')}
  -m, --markers <list>      Comma-separated: ${listMarkers().join(', ')}
      --label <text>        Accessible label. Default: generated from the data.

  -v, --version             Print the version and exit.
  -h, --help                Print this and exit.

EXIT CODES
  0  wrote a chart
  1  could not read or parse the input
  2  bad usage

EXAMPLES
  ${PROGRAM} render latency.csv --column p95 --out latency.svg
  ${PROGRAM} render metrics.json --format txt --markers min,max,last
  cat sales.csv | ${PROGRAM} render --stdin --normalize zero --type bar
`;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Thrown for anything the user can fix by changing the command line. */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = EXIT_USAGE;
  }
}

/** Thrown for anything wrong with the data or the filesystem. */
class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
    this.exitCode = EXIT_ERROR;
  }
}

function toNumber(raw, flag) {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new UsageError(`--${flag} must be a number, got "${raw}"`);
  }
  if (value < 0) {
    throw new UsageError(`--${flag} must not be negative, got "${raw}"`);
  }
  return value;
}

function oneOf(raw, flag, allowed) {
  if (raw === undefined) return undefined;
  if (!allowed.includes(raw)) {
    throw new UsageError(
      `--${flag} must be one of ${allowed.join(', ')}, got "${raw}"`,
    );
  }
  return raw;
}

/**
 * Resolve the header flags into true / false / null (auto).
 *
 * @param {object} values parsed flags
 * @returns {boolean|null}
 */
function resolveHeader(values) {
  if (values.header && values['no-header']) {
    throw new UsageError('--header and --no-header cannot both be given');
  }
  if (values.header) return true;
  if (values['no-header']) return false;
  return null;
}

/**
 * Decide the output format: the flag wins, then the --out extension, then svg.
 *
 * @param {string|undefined} flag
 * @param {string|undefined} out
 * @returns {'svg'|'txt'}
 */
function resolveFormat(flag, out) {
  if (flag) return oneOf(flag, 'format', ['svg', 'txt']);
  if (out) {
    const ext = extname(out).toLowerCase();
    if (ext === '.txt') return 'txt';
    if (ext === '.svg') return 'svg';
  }
  return 'svg';
}

/* ------------------------------------------------------------------ *
 * Reading input
 * ------------------------------------------------------------------ */

/**
 * Read the input file, or standard input.
 *
 * @param {string|undefined} input path, "-", or undefined
 * @param {boolean} useStdin
 * @returns {{text: string, filename: string|null}}
 */
function readInput(input, useStdin) {
  const fromStdin = useStdin || input === '-' || input === undefined;

  if (fromStdin) {
    if (!useStdin && input === undefined) {
      throw new UsageError(
        `no input given. Pass a file, or --stdin to read standard input.\n` +
          `Try: ${PROGRAM} render data.csv`,
      );
    }
    try {
      // fd 0 rather than a stream: the whole series has to be in memory to be
      // scaled anyway, so there is nothing to gain from streaming it.
      return { text: readFileSync(0, 'utf8'), filename: null };
    } catch (err) {
      throw new InputError(`could not read standard input: ${err.message}`);
    }
  }

  try {
    return { text: readFileSync(input, 'utf8'), filename: input };
  } catch (err) {
    if (err.code === 'ENOENT') throw new InputError(`no such file: ${input}`);
    if (err.code === 'EISDIR') throw new InputError(`${input} is a directory`);
    if (err.code === 'EACCES') throw new InputError(`cannot read ${input}: permission denied`);
    throw new InputError(`could not read ${input}: ${err.message}`);
  }
}

/**
 * Map a parsed command line onto library options.
 *
 * Every default here is the library's default, restated as text in --help
 * rather than duplicated as a value. If they ever drift, --help is the lie.
 *
 * @param {object} values parsed flags
 * @returns {object} options for toSVGString()/toTextString()
 */
function buildOptions(values) {
  const options = {};

  const width = toNumber(values.width, 'width');
  const height = toNumber(values.height, 'height');
  const strokeWidth = toNumber(values['stroke-width'], 'stroke-width');
  const gutter = toNumber(values.gutter, 'gutter');
  const maxPoints = toNumber(values.downsample, 'downsample');

  if (width !== undefined) options.width = width;
  if (height !== undefined) options.height = height;
  if (strokeWidth !== undefined) options.strokeWidth = strokeWidth;
  if (gutter !== undefined) options.gutter = gutter;
  if (maxPoints !== undefined) {
    if (maxPoints < 2) throw new UsageError('--downsample must be at least 2');
    options.maxPoints = maxPoints;
  }

  if (values.stroke !== undefined) options.stroke = values.stroke;
  if (values.fill !== undefined) options.fill = values.fill;
  if (values.theme !== undefined) options.theme = values.theme;
  if (values.label !== undefined) options.ariaLabel = values.label;

  const type = oneOf(values.type, 'type', ['line', 'area', 'bar', 'tick']);
  if (type !== undefined) options.type = type;

  const curve = oneOf(values.curve, 'curve', ['linear', 'step', 'monotone']);
  if (curve !== undefined) options.curve = curve;

  const normalize = oneOf(values.normalize, 'normalize', ['extent', 'zero', 'symmetric']);
  if (normalize !== undefined) options.normalize = normalize;

  const gaps = oneOf(values.gaps, 'gaps', ['break', 'skip', 'zero', 'interpolate']);
  if (gaps !== undefined) options.gaps = gaps;

  const method = oneOf(values['downsample-method'], 'downsample-method', [
    'lttb',
    'mean',
    'min',
    'max',
    'nth',
  ]);
  if (method !== undefined) options.downsampleMethod = method;

  if (values.markers !== undefined) {
    const names = values.markers.split(',').map((n) => n.trim()).filter(Boolean);
    const known = listMarkers();
    for (const name of names) {
      if (!known.includes(name)) {
        throw new UsageError(
          `unknown marker "${name}". Known markers: ${known.join(', ')}`,
        );
      }
    }
    options.markers = names;
  }

  // An area with no fill is just a line, which is a confusing thing to be
  // handed back after asking for an area.
  if (options.type === 'area' && options.fill === undefined && values.theme === undefined) {
    options.fill = options.stroke ?? 'currentColor';
  }

  return options;
}

/* ------------------------------------------------------------------ *
 * The render command
 * ------------------------------------------------------------------ */

function summarise(stats, missing, source, format) {
  const round = (n) => (Number.isFinite(n) ? Number(n.toFixed(4)) : 'n/a');
  const parts = [
    `${stats.count} points`,
    `min ${round(stats.min)}`,
    `max ${round(stats.max)}`,
    `last ${round(stats.last)}`,
  ];
  if (missing) parts.push(`${missing} missing`);
  return `${PROGRAM}: ${format} from ${source} -- ${parts.join(', ')}`;
}

/**
 * `sparkline render <input>`
 *
 * @param {object} values parsed flags
 * @param {string[]} positionals everything after the command
 * @param {{stdout: Function, stderr: Function}} io
 * @returns {number} exit code
 */
function commandRender(values, positionals, io) {
  if (positionals.length > 1) {
    throw new UsageError(
      `render takes one input file, got ${positionals.length}: ${positionals.join(', ')}`,
    );
  }

  const input = positionals[0];
  if (input && values.stdin) {
    throw new UsageError(`cannot use --stdin and an input file (${input}) together`);
  }

  const { text, filename } = readInput(input, Boolean(values.stdin));
  if (!text.trim()) {
    throw new InputError(filename ? `${filename} is empty` : 'standard input was empty');
  }

  const inputFormat = oneOf(values['input-format'], 'input-format', ['csv', 'json', 'auto']);
  const delimiter = values.delimiter === undefined
    ? undefined
    : resolveDelimiter(values.delimiter);

  const header = resolveHeader(values);

  let series;
  try {
    series = parseSeries(text, {
      format: inputFormat,
      filename,
      delimiter,
      header,
      column: values.column ?? null,
    });
  } catch (err) {
    throw new InputError(err.message.replace(/^sparkline: /, ''));
  }

  const options = buildOptions(values);
  const normalized = normalizeData(series.values, { gaps: options.gaps ?? 'break' });
  const stats = statsOf(normalized.values, normalized.gaps);
  const missing = normalized.gaps.filter(Boolean).length;

  // The library no-ops on a series this short. A CLI that wrote an empty file
  // and exited 0 would be worse than useless in a build script, so here it is
  // an error instead.
  if (normalized.values.length < 2) {
    throw new InputError(
      `need at least 2 values to draw, got ${normalized.values.length}` +
        (series.column ? ` in column "${series.column}"` : ''),
    );
  }
  if (missing === normalized.values.length) {
    throw new InputError(
      `every value is empty or non-numeric` +
        (series.column ? ` in column "${series.column}"` : '') +
        `. Check --column and --delimiter.`,
    );
  }

  const format = resolveFormat(values.format, values.out);
  let output;
  try {
    output = format === 'txt'
      ? toTextString(series.values, options)
      : toSVGString(series.values, options);
  } catch (err) {
    // Option validation lives in the library, so its errors surface here.
    throw new UsageError(err.message.replace(/^sparkline: /, ''));
  }

  if (!output) {
    throw new InputError('nothing to draw');
  }

  const payload = format === 'txt' ? `${output}\n` : `${output}\n`;

  if (values.out) {
    try {
      writeFileSync(values.out, payload, 'utf8');
    } catch (err) {
      throw new InputError(`could not write ${values.out}: ${err.message}`);
    }
    if (!values.quiet) {
      io.stderr(
        `${summarise(stats, missing, filename ? basename(filename) : 'stdin', format)}\n`,
      );
      io.stderr(`${PROGRAM}: wrote ${values.out}\n`);
    }
  } else {
    io.stdout(payload);
    if (!values.quiet) {
      io.stderr(
        `${summarise(stats, missing, filename ? basename(filename) : 'stdin', format)}\n`,
      );
    }
  }

  return EXIT_OK;
}

/* ------------------------------------------------------------------ *
 * Informational commands
 * ------------------------------------------------------------------ */

function commandThemes(io) {
  const names = listThemes();
  io.stdout(`${names.length} themes\n`);
  io.stdout(`  ${'name'.padEnd(16)}${'type'.padEnd(7)}${'stroke'.padEnd(16)}width\n`);
  for (const name of names) {
    // A theme is just a bag of resolved options, so print the ones that
    // actually change the picture. A block-character preview would be
    // pointless here: every theme renders identical blocks.
    const style = getTheme(name);
    const type = style.type || 'line';
    const stroke = style.stroke || 'currentColor';
    const width = style.strokeWidth ?? 1;
    const builtIn = isBuiltInTheme(name) ? '' : '  (custom)';
    io.stdout(
      `  ${name.padEnd(16)}${type.padEnd(7)}${stroke.padEnd(16)}${width}${builtIn}\n`,
    );
  }
  io.stdout('\nUse one: --theme ink\n');
  return EXIT_OK;
}

function commandMarkers(io) {
  const names = listMarkers();
  io.stdout(`${names.length} markers\n`);
  for (const name of names) {
    io.stdout(`  ${name}${isBuiltInMarker(name) ? '' : '  (custom)'}\n`);
  }
  io.stdout('\nCombine them: --markers min,max,last\n');
  return EXIT_OK;
}

function commandDescribe(values, positionals, io) {
  const input = positionals[0];
  const { text, filename } = readInput(input, Boolean(values.stdin));
  const series = parseSeries(text, {
    filename,
    delimiter: values.delimiter === undefined ? undefined : resolveDelimiter(values.delimiter),
    header: resolveHeader(values),
    column: values.column ?? null,
  });

  const summary = describe(series.values, buildOptions(values));
  const rows = [
    ['points', summary.count],
    ['missing', summary.missing],
    ['min', summary.min],
    ['max', summary.max],
    ['mean', Number.isFinite(summary.mean) ? Number(summary.mean.toFixed(4)) : 'n/a'],
    ['first', summary.first],
    ['last', summary.last],
    ['domain', `${summary.domain[0]} .. ${summary.domain[1]}`],
  ];
  if (series.column) rows.unshift(['column', series.column]);
  if (series.columns) rows.unshift(['columns', series.columns.join(', ')]);

  for (const [key, value] of rows) {
    io.stdout(`${String(key).padEnd(9)} ${value}\n`);
  }
  return EXIT_OK;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

const COMMANDS = new Set(['render', 'themes', 'markers', 'describe', 'help']);

/**
 * Run the CLI.
 *
 * Exported so the whole thing can be driven from a test without spawning a
 * process, which is why it takes its argv and its output sinks as arguments.
 *
 * @param {string[]} [argv] arguments after the program name
 * @param {{stdout?: Function, stderr?: Function}} [io]
 * @returns {number} exit code
 */
export function run(argv = process.argv.slice(2), io = {}) {
  const out = io.stdout || ((text) => process.stdout.write(text));
  const err = io.stderr || ((text) => process.stderr.write(text));
  const sink = { stdout: out, stderr: err };

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    // parseArgs' own messages are good; they just need the program name and a
    // pointer at --help.
    err(`${PROGRAM}: ${error.message}\n`);
    err(`Try '${PROGRAM} --help'.\n`);
    return EXIT_USAGE;
  }

  const { values, positionals } = parsed;

  if (values.version) {
    out(`${VERSION}\n`);
    return EXIT_OK;
  }
  if (values.help || positionals[0] === 'help' || positionals.length === 0) {
    out(USAGE);
    return positionals.length === 0 && !values.help ? EXIT_USAGE : EXIT_OK;
  }

  const [command, ...rest] = positionals;
  if (!COMMANDS.has(command)) {
    err(`${PROGRAM}: unknown command "${command}"\n`);
    err(`Commands: ${[...COMMANDS].join(', ')}\n`);
    err(`Try '${PROGRAM} --help'.\n`);
    return EXIT_USAGE;
  }

  try {
    switch (command) {
      case 'render':
        return commandRender(values, rest, sink);
      case 'themes':
        return commandThemes(sink);
      case 'markers':
        return commandMarkers(sink);
      case 'describe':
        return commandDescribe(values, rest, sink);
      default:
        out(USAGE);
        return EXIT_OK;
    }
  } catch (error) {
    err(`${PROGRAM}: ${error.message}\n`);
    if (error.exitCode === EXIT_USAGE) err(`Try '${PROGRAM} --help'.\n`);
    return error.exitCode || EXIT_ERROR;
  }
}

/**
 * True when this module is the program being run, rather than an import.
 *
 * @returns {boolean}
 */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === entry;
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exitCode = run();
}
