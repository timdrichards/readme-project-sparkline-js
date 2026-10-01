// src/theme.js
//
// Palettes, presets, style resolution, marker registry.
//
// Nothing in here touches the DOM. Markers return plain shape descriptors so
// the same marker works for the SVG renderer, the canvas renderer, and the
// CLI's string output. That is the whole reason registerMarker() is useful as
// an extension point instead of just a colour setting.

/** Library version. Mirrors package.json; checked by the CLI's --version. */
export const VERSION = '2.1.0';

/* ------------------------------------------------------------------ *
 * Colour utilities
 * ------------------------------------------------------------------ */

const NAMED_COLORS = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  orange: '#ffa500',
  purple: '#800080',
  teal: '#008080',
  navy: '#000080',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  fuchsia: '#ff00ff',
  yellow: '#ffff00',
};

/** Colours we cannot inspect: they resolve against the host page, not us. */
const DEFERRED_COLORS = new Set(['currentColor', 'none', 'transparent', 'inherit']);

/**
 * True when a colour value only means something once the host page renders it.
 * `currentColor` is the library's default stroke, so contrast checks and
 * palette mixing have to skip it rather than guess.
 *
 * @param {unknown} color
 * @returns {boolean}
 */
export function isDeferredColor(color) {
  return typeof color === 'string' && DEFERRED_COLORS.has(color.trim());
}

function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}

function hexPair(n) {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

/**
 * Parse a CSS colour into `{r, g, b, a}` with channels in 0..255.
 * Understands #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), and a small set
 * of named colours. Returns null for anything else, including `currentColor`.
 *
 * @param {string} color
 * @returns {{r: number, g: number, b: number, a: number} | null}
 */
export function parseColor(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim().toLowerCase();
  if (!value || DEFERRED_COLORS.has(color.trim())) return null;

  const named = NAMED_COLORS[value];
  const hex = named || value;

  if (hex.startsWith('#')) {
    const body = hex.slice(1);
    if (body.length === 3 || body.length === 4) {
      const [r, g, b, a = 'f'] = body.split('');
      return {
        r: parseInt(r + r, 16),
        g: parseInt(g + g, 16),
        b: parseInt(b + b, 16),
        a: parseInt(a + a, 16) / 255,
      };
    }
    if (body.length === 6 || body.length === 8) {
      if (!/^[0-9a-f]+$/.test(body)) return null;
      return {
        r: parseInt(body.slice(0, 2), 16),
        g: parseInt(body.slice(2, 4), 16),
        b: parseInt(body.slice(4, 6), 16),
        a: body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const fn = /^rgba?\(([^)]+)\)$/.exec(value);
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (raw) =>
      raw.endsWith('%') ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);
    const alpha = parts[3] === undefined
      ? 1
      : parts[3].endsWith('%')
        ? parseFloat(parts[3]) / 100
        : parseFloat(parts[3]);
    const rgb = {
      r: channel(parts[0]),
      g: channel(parts[1]),
      b: channel(parts[2]),
      a: Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1,
    };
    if (!Number.isFinite(rgb.r) || !Number.isFinite(rgb.g) || !Number.isFinite(rgb.b)) {
      return null;
    }
    return rgb;
  }

  return null;
}

/**
 * Serialise a parsed colour back to CSS. Emits #rrggbb when fully opaque so
 * the SVG output stays readable in a diff.
 *
 * @param {{r: number, g: number, b: number, a?: number}} rgb
 * @returns {string}
 */
export function formatColor(rgb) {
  const a = rgb.a === undefined ? 1 : clamp(rgb.a, 0, 1);
  if (a >= 1) return `#${hexPair(rgb.r)}${hexPair(rgb.g)}${hexPair(rgb.b)}`;
  const round = (n) => clamp(Math.round(n), 0, 255);
  return `rgba(${round(rgb.r)}, ${round(rgb.g)}, ${round(rgb.b)}, ${Number(a.toFixed(3))})`;
}

/**
 * Apply an alpha channel to a colour. Deferred colours (`currentColor`) are
 * returned untouched, because we cannot resolve them without the host page.
 *
 * @param {string} color
 * @param {number} alpha 0..1
 * @returns {string}
 */
export function withAlpha(color, alpha) {
  const rgb = parseColor(color);
  if (!rgb) return color;
  return formatColor({ ...rgb, a: clamp(alpha, 0, 1) * (rgb.a ?? 1) });
}

/**
 * Linear blend between two colours in sRGB space.
 *
 * @param {string} from
 * @param {string} to
 * @param {number} t 0 = from, 1 = to
 * @returns {string}
 */
export function mixColors(from, to, t) {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return t < 0.5 ? from : to;
  const k = clamp(t, 0, 1);
  return formatColor({
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
    a: (a.a ?? 1) + ((b.a ?? 1) - (a.a ?? 1)) * k,
  });
}

/**
 * WCAG relative luminance, 0 (black) to 1 (white).
 *
 * @param {string} color
 * @returns {number | null} null when the colour cannot be resolved here
 */
export function relativeLuminance(color) {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const channel = (raw) => {
    const c = clamp(raw, 0, 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/**
 * WCAG contrast ratio between two colours, 1..21.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number | null} null when either colour is deferred
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick whichever of `dark`/`light` reads better on `background`.
 *
 * @param {string} background
 * @param {string} [dark]
 * @param {string} [light]
 * @returns {string}
 */
export function pickReadable(background, dark = '#111111', light = '#ffffff') {
  const withDark = contrastRatio(background, dark);
  const withLight = contrastRatio(background, light);
  if (withDark === null || withLight === null) return dark;
  return withDark >= withLight ? dark : light;
}

/* ------------------------------------------------------------------ *
 * Base defaults
 * ------------------------------------------------------------------ */

/**
 * Every option the renderer understands, with its default.
 *
 * `normalize` is the one to look at. It was 'zero' in 1.x and became 'extent'
 * in 2.0 so that flat-ish series stop looking like flat lines. It is a visual
 * breaking change with no error attached, which is exactly why people only
 * notice it in review. -- ah
 */
export const BASE_STYLE = Object.freeze({
  // Geometry
  width: 100,
  height: 20,
  gutter: null, // null => fall back to strokeWidth, see resolveStyle()
  type: 'line', // 'line' | 'area' | 'bar' | 'tick'
  curve: 'linear', // 'linear' | 'step' | 'monotone'

  // Scale
  normalize: 'extent', // 'extent' | 'zero' | 'symmetric' | [min, max]
  gaps: 'break', // 'break' | 'skip' | 'zero' | 'interpolate'

  // Data reduction, applied before scaling
  maxPoints: null, // null => draw every point
  downsampleMethod: 'lttb', // 'lttb' | 'mean' | 'min' | 'max' | 'nth'

  // Paint
  stroke: 'currentColor',
  strokeWidth: 1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none',
  fillOpacity: 0.15,
  background: 'none',
  barGap: 1,
  barRadius: 0,

  // Markers
  markers: [],
  markerSize: 2,
  markerColors: null, // {min, max, first, last, mean, zero}

  // Accessibility
  role: 'img',
  ariaLabel: null, // null => generated, '' or false => omitted
  title: null,
  desc: null,
  focusable: false,

  // Output plumbing
  className: null,
  precision: 2,
});

/** Options that must be finite numbers if given at all. */
const NUMERIC_OPTIONS = [
  'width',
  'height',
  'gutter',
  'strokeWidth',
  'fillOpacity',
  'barGap',
  'barRadius',
  'markerSize',
  'precision',
  'maxPoints',
];

const VALID_DOWNSAMPLE = new Set(['lttb', 'mean', 'min', 'max', 'nth']);

const VALID_TYPES = new Set(['line', 'area', 'bar', 'tick']);
const VALID_CURVES = new Set(['linear', 'step', 'monotone']);
const VALID_NORMALIZE = new Set(['extent', 'zero', 'symmetric']);
const VALID_GAPS = new Set(['break', 'skip', 'zero', 'interpolate']);

/* ------------------------------------------------------------------ *
 * Built-in themes
 * ------------------------------------------------------------------ */

/**
 * A theme is a partial style object. It is merged under explicit options, so
 * anything the caller passes always wins over the theme.
 */
const BUILT_IN_THEMES = {
  // Inherits the surrounding text colour. Deliberately the default: a
  // sparkline sitting next to a number should look like part of the number.
  default: {
    stroke: 'currentColor',
    strokeWidth: 1,
    fill: 'none',
    markerColors: {
      min: 'currentColor',
      max: 'currentColor',
      first: 'currentColor',
      last: 'currentColor',
      mean: 'currentColor',
      zero: 'currentColor',
    },
  },

  // Same shape, but explicit greys, for contexts where `currentColor` lands
  // on something unhelpful (inside a button, say).
  mono: {
    stroke: '#333333',
    strokeWidth: 1,
    fill: 'none',
    markerColors: {
      min: '#767676',
      max: '#111111',
      first: '#767676',
      last: '#111111',
      mean: '#9a9a9a',
      zero: '#cccccc',
    },
  },

  ink: {
    stroke: '#1f2933',
    strokeWidth: 1.25,
    fill: '#1f2933',
    fillOpacity: 0.08,
    type: 'area',
    markerColors: {
      min: '#7b8794',
      max: '#1f2933',
      first: '#9aa5b1',
      last: '#1f2933',
      mean: '#cbd2d9',
      zero: '#e4e7eb',
    },
  },

  positive: {
    stroke: '#0f7b4f',
    strokeWidth: 1.25,
    fill: '#0f7b4f',
    fillOpacity: 0.12,
    type: 'area',
    markerColors: {
      min: '#7cb59b',
      max: '#0b5c3a',
      first: '#7cb59b',
      last: '#0b5c3a',
      mean: '#b9d7c9',
      zero: '#d7e7df',
    },
  },

  negative: {
    stroke: '#b3261e',
    strokeWidth: 1.25,
    fill: '#b3261e',
    fillOpacity: 0.12,
    type: 'area',
    markerColors: {
      min: '#8c1d18',
      max: '#d68b86',
      first: '#d68b86',
      last: '#8c1d18',
      mean: '#eccbc9',
      zero: '#f4e0df',
    },
  },

  dusk: {
    stroke: '#9fb3ff',
    strokeWidth: 1.25,
    fill: '#9fb3ff',
    fillOpacity: 0.18,
    type: 'area',
    background: 'none',
    markerColors: {
      min: '#5f74bd',
      max: '#d8e0ff',
      first: '#5f74bd',
      last: '#d8e0ff',
      mean: '#7d8fd6',
      zero: '#41508a',
    },
  },

  // Thicker stroke, square caps, high-contrast marker colours. Meant for
  // small print and for anyone who has turned on a contrast preference.
  'high-contrast': {
    stroke: '#000000',
    strokeWidth: 2,
    strokeLinecap: 'butt',
    strokeLinejoin: 'miter',
    fill: 'none',
    markerSize: 2.5,
    markerColors: {
      min: '#000000',
      max: '#000000',
      first: '#000000',
      last: '#000000',
      mean: '#555555',
      zero: '#555555',
    },
  },

  // No alpha anywhere: alpha is the first thing a cheap printer loses.
  print: {
    stroke: '#000000',
    strokeWidth: 0.75,
    strokeLinecap: 'butt',
    fill: 'none',
    fillOpacity: 1,
    markerSize: 1.5,
    markerColors: {
      min: '#000000',
      max: '#000000',
      first: '#000000',
      last: '#000000',
      mean: '#000000',
      zero: '#000000',
    },
  },
};

/** name -> frozen partial style */
const themes = new Map();

for (const [name, theme] of Object.entries(BUILT_IN_THEMES)) {
  themes.set(name, Object.freeze({ ...theme }));
}

const BUILT_IN_THEME_NAMES = Object.freeze(Object.keys(BUILT_IN_THEMES));

/**
 * Register a theme under `name`, or overwrite an existing one.
 *
 * Note the timing: createRenderer() resolves its style once, at creation, so a
 * theme defined after a renderer exists will not reach that renderer. Define
 * themes during module setup, before you build anything.
 *
 * @param {string} name
 * @param {object} theme Partial style object; unknown keys are rejected.
 * @returns {object} the frozen theme, for chaining
 */
export function defineTheme(name, theme) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('defineTheme: name must be a non-empty string');
  }
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    throw new TypeError(`defineTheme: theme "${name}" must be an object`);
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(theme)) {
    if (!(key in BASE_STYLE)) {
      throw new TypeError(
        `defineTheme: theme "${name}" has unknown option "${key}". ` +
          `Known options: ${Object.keys(BASE_STYLE).join(', ')}`,
      );
    }
    cleaned[key] = value;
  }

  validateStyle(cleaned, `theme "${name}"`);
  const frozen = Object.freeze(cleaned);
  themes.set(name, frozen);
  return frozen;
}

/**
 * Look up a registered theme.
 *
 * @param {string} name
 * @returns {object} frozen partial style
 * @throws {Error} when the theme is not registered
 */
export function getTheme(name) {
  const theme = themes.get(name);
  if (!theme) {
    throw new Error(
      `sparkline: unknown theme "${name}". Known themes: ${listThemes().join(', ')}`,
    );
  }
  return theme;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function hasTheme(name) {
  return themes.has(name);
}

/**
 * Every registered theme name, built-in and user-defined, sorted.
 *
 * @returns {string[]}
 */
export function listThemes() {
  return [...themes.keys()].sort();
}

/**
 * Drop user-defined themes and restore the built-ins. Mostly for tests.
 *
 * @returns {void}
 */
export function resetThemes() {
  themes.clear();
  for (const [name, theme] of Object.entries(BUILT_IN_THEMES)) {
    themes.set(name, Object.freeze({ ...theme }));
  }
}

/**
 * @param {string} name
 * @returns {boolean} true when the name is one we ship
 */
export function isBuiltInTheme(name) {
  return BUILT_IN_THEME_NAMES.includes(name);
}

/* ------------------------------------------------------------------ *
 * Style resolution
 * ------------------------------------------------------------------ */

function validateStyle(style, where) {
  for (const key of NUMERIC_OPTIONS) {
    const value = style[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`sparkline: ${where} option "${key}" must be a finite number`);
    }
    if (value < 0) {
      throw new TypeError(`sparkline: ${where} option "${key}" must not be negative`);
    }
  }

  if (style.type !== undefined && !VALID_TYPES.has(style.type)) {
    throw new TypeError(
      `sparkline: ${where} option "type" must be one of ${[...VALID_TYPES].join(', ')}`,
    );
  }
  if (style.curve !== undefined && !VALID_CURVES.has(style.curve)) {
    throw new TypeError(
      `sparkline: ${where} option "curve" must be one of ${[...VALID_CURVES].join(', ')}`,
    );
  }
  if (style.gaps !== undefined && !VALID_GAPS.has(style.gaps)) {
    throw new TypeError(
      `sparkline: ${where} option "gaps" must be one of ${[...VALID_GAPS].join(', ')}`,
    );
  }
  if (style.downsampleMethod !== undefined && !VALID_DOWNSAMPLE.has(style.downsampleMethod)) {
    throw new TypeError(
      `sparkline: ${where} option "downsampleMethod" must be one of ` +
        `${[...VALID_DOWNSAMPLE].join(', ')}`,
    );
  }
  if (style.normalize !== undefined) {
    const ok =
      VALID_NORMALIZE.has(style.normalize) ||
      (Array.isArray(style.normalize) &&
        style.normalize.length === 2 &&
        style.normalize.every((n) => typeof n === 'number' && Number.isFinite(n)));
    if (!ok) {
      throw new TypeError(
        `sparkline: ${where} option "normalize" must be ` +
          `${[...VALID_NORMALIZE].join(' | ')} or a [min, max] pair`,
      );
    }
  }
}

/**
 * Normalise the `markers` option into a list of names.
 * Accepts an array, a comma-separated string, or false/null for none.
 *
 * @param {string[] | string | false | null | undefined} markers
 * @returns {string[]}
 */
export function normalizeMarkerList(markers) {
  if (!markers) return [];
  const list = Array.isArray(markers)
    ? markers
    : String(markers).split(',');
  return list
    .map((name) => String(name).trim())
    .filter(Boolean);
}

/**
 * Merge BASE_STYLE <- theme <- explicit options into one frozen style object.
 * Explicit options always win; that is the contract themes rely on.
 *
 * @param {object} [opts] Caller options. May include `theme: 'name'`.
 * @returns {Readonly<object>} resolved style
 */
export function resolveStyle(opts = {}) {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new TypeError('sparkline: options must be an object');
  }

  const { theme: themeName, ...explicit } = opts;

  for (const key of Object.keys(explicit)) {
    if (!(key in BASE_STYLE)) {
      throw new TypeError(
        `sparkline: unknown option "${key}". ` +
          `Known options: ${Object.keys(BASE_STYLE).sort().join(', ')}`,
      );
    }
  }
  validateStyle(explicit, 'option');

  const theme = themeName ? getTheme(themeName) : themes.get('default');

  const style = { ...BASE_STYLE, ...theme };
  for (const [key, value] of Object.entries(explicit)) {
    if (value !== undefined) style[key] = value;
  }

  // gutter defaults to strokeWidth so the stroke is never clipped at the
  // edges of the box. Half of it would be enough geometrically, but a full
  // stroke width also leaves room for round caps and for markers.
  if (style.gutter === null || style.gutter === undefined) {
    style.gutter = style.strokeWidth;
  }

  style.markers = normalizeMarkerList(style.markers);
  style.markerColors = {
    ...(theme.markerColors || BASE_STYLE.markerColors || {}),
    ...(explicit.markerColors || {}),
  };
  style.themeName = themeName || 'default';

  return Object.freeze(style);
}

/* ------------------------------------------------------------------ *
 * Accessibility defaults
 * ------------------------------------------------------------------ */

function formatNumber(n, precision) {
  if (!Number.isFinite(n)) return 'no value';
  const rounded = Number(n.toFixed(precision));
  return String(rounded);
}

/**
 * Build the aria-label used when the caller does not supply one.
 *
 * A sparkline with no label is an unlabelled image to a screen reader, which
 * is worse than useless in a table of numbers. So we always emit something,
 * and callers who want silence have to ask for it with `ariaLabel: false`.
 *
 * @param {{min: number, max: number, first: number, last: number, count: number}} stats
 * @param {number} [precision]
 * @returns {string}
 */
export function defaultAriaLabel(stats, precision = 2) {
  if (!stats || !Number.isFinite(stats.count) || stats.count === 0) {
    return 'Sparkline with no data';
  }
  const direction =
    stats.last > stats.first ? 'up' : stats.last < stats.first ? 'down' : 'flat';
  return (
    `Sparkline of ${stats.count} values, ` +
    `from ${formatNumber(stats.first, precision)} to ${formatNumber(stats.last, precision)} ` +
    `(${direction}), ` +
    `low ${formatNumber(stats.min, precision)}, high ${formatNumber(stats.max, precision)}`
  );
}

/**
 * Report any resolved colour pair that falls below the WCAG 3:1 threshold for
 * graphical objects. Deferred colours are skipped, so a default-theme chart
 * reports nothing: we cannot know what `currentColor` will be.
 *
 * @param {object} style resolved style
 * @param {string} [background] page background to compare against
 * @returns {Array<{what: string, ratio: number}>}
 */
export function auditContrast(style, background = '#ffffff') {
  const problems = [];
  const check = (what, color) => {
    if (isDeferredColor(color)) return;
    const ratio = contrastRatio(color, background);
    if (ratio !== null && ratio < 3) {
      problems.push({ what, ratio: Number(ratio.toFixed(2)) });
    }
  };
  check('stroke', style.stroke);
  for (const [name, color] of Object.entries(style.markerColors || {})) {
    if (style.markers.includes(name)) check(`marker:${name}`, color);
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * Marker registry
 * ------------------------------------------------------------------ */

/**
 * A marker receives a context and returns shape descriptors. Supported shapes:
 *
 *   {type: 'circle', cx, cy, r, fill?, stroke?, strokeWidth?}
 *   {type: 'rect',   x, y, width, height, fill?, stroke?, strokeWidth?}
 *   {type: 'line',   x1, y1, x2, y2, stroke?, strokeWidth?, dash?}
 *   {type: 'path',   d, fill?, stroke?, strokeWidth?}
 *   {type: 'text',   x, y, text, fill?, fontSize?, anchor?}
 *
 * The context is:
 *
 *   {values, gaps, points, stats, style, box, scale}
 *
 * where `points` is [{index, value, x, y, gap}], `box` is the plot rectangle
 * in pixels, and `scale.y(value)` maps a value to a y coordinate.
 *
 * @typedef {(ctx: object) => object[] | object | null} MarkerFn
 */

/** @type {Map<string, MarkerFn>} */
const markers = new Map();

function markerColor(ctx, name) {
  const colors = ctx.style.markerColors || {};
  return colors[name] || ctx.style.stroke;
}

function dot(ctx, point, name) {
  if (!point || point.gap) return null;
  return {
    type: 'circle',
    cx: point.x,
    cy: point.y,
    r: ctx.style.markerSize,
    fill: markerColor(ctx, name),
    stroke: 'none',
    className: `sparkline-marker sparkline-marker-${name}`,
  };
}

const BUILT_IN_MARKERS = {
  min: (ctx) => dot(ctx, ctx.points[ctx.stats.minIndex], 'min'),
  max: (ctx) => dot(ctx, ctx.points[ctx.stats.maxIndex], 'max'),
  first: (ctx) => dot(ctx, ctx.points.find((p) => !p.gap), 'first'),
  last: (ctx) => {
    const visible = ctx.points.filter((p) => !p.gap);
    return dot(ctx, visible[visible.length - 1], 'last');
  },
  all: (ctx) => ctx.points.filter((p) => !p.gap).map((p) => dot(ctx, p, 'all')),

  // A dashed rule at the mean. Useful on its own; also the shortest example of
  // a marker that is not a dot.
  mean: (ctx) => {
    const y = ctx.scale.y(ctx.stats.mean);
    return {
      type: 'line',
      x1: ctx.box.left,
      y1: y,
      x2: ctx.box.right,
      y2: y,
      stroke: markerColor(ctx, 'mean'),
      strokeWidth: Math.max(0.5, ctx.style.strokeWidth * 0.5),
      dash: '2 2',
      className: 'sparkline-marker sparkline-marker-mean',
    };
  },

  // Only drawn when zero is actually inside the visible range, which under the
  // default normalize: 'extent' it usually is not.
  zero: (ctx) => {
    if (ctx.domain[0] > 0 || ctx.domain[1] < 0) return null;
    const y = ctx.scale.y(0);
    return {
      type: 'line',
      x1: ctx.box.left,
      y1: y,
      x2: ctx.box.right,
      y2: y,
      stroke: markerColor(ctx, 'zero'),
      strokeWidth: Math.max(0.5, ctx.style.strokeWidth * 0.5),
      className: 'sparkline-marker sparkline-marker-zero',
    };
  },
};

for (const [name, fn] of Object.entries(BUILT_IN_MARKERS)) {
  markers.set(name, fn);
}

const BUILT_IN_MARKER_NAMES = Object.freeze(Object.keys(BUILT_IN_MARKERS));

/**
 * Register a marker under `name`, or overwrite an existing one.
 *
 * The function is called once per render with the context described above and
 * should return shape descriptors (or null to draw nothing). Because it
 * returns data rather than DOM nodes, the same marker works in the browser,
 * in `toSVGString()`, and in the CLI.
 *
 * @param {string} name
 * @param {MarkerFn} fn
 * @returns {MarkerFn} the registered function
 */
export function registerMarker(name, fn) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('registerMarker: name must be a non-empty string');
  }
  if (typeof fn !== 'function') {
    throw new TypeError(`registerMarker: marker "${name}" must be a function`);
  }
  markers.set(name, fn);
  return fn;
}

/**
 * @param {string} name
 * @returns {MarkerFn}
 * @throws {Error} when no marker is registered under that name
 */
export function getMarker(name) {
  const fn = markers.get(name);
  if (!fn) {
    throw new Error(
      `sparkline: unknown marker "${name}". Known markers: ${listMarkers().join(', ')}`,
    );
  }
  return fn;
}

/**
 * Every registered marker name, sorted.
 *
 * @returns {string[]}
 */
export function listMarkers() {
  return [...markers.keys()].sort();
}

/**
 * Drop user-defined markers and restore the built-ins. Mostly for tests.
 *
 * @returns {void}
 */
export function resetMarkers() {
  markers.clear();
  for (const [name, fn] of Object.entries(BUILT_IN_MARKERS)) {
    markers.set(name, fn);
  }
}

/**
 * @param {string} name
 * @returns {boolean} true when the name is one we ship
 */
export function isBuiltInMarker(name) {
  return BUILT_IN_MARKER_NAMES.includes(name);
}

/**
 * Run the requested markers and flatten their output into one shape list.
 * A marker that throws is not allowed to take the chart down with it: the
 * line is more important than the dot on top of it.
 *
 * @param {string[]} names
 * @param {object} ctx marker context
 * @returns {object[]} shape descriptors
 */
export function runMarkers(names, ctx) {
  const shapes = [];
  for (const name of names) {
    const fn = getMarker(name);
    let result;
    try {
      result = fn(ctx);
    } catch (err) {
      // Swallowed on purpose, and noisily: a broken custom marker should not
      // blank the chart, but it should not be invisible either.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`sparkline: marker "${name}" threw and was skipped`, err);
      }
      continue;
    }
    if (!result) continue;
    for (const shape of Array.isArray(result) ? result : [result]) {
      if (shape) shapes.push(shape);
    }
  }
  return shapes;
}
