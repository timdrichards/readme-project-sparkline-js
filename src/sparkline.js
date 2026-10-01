// src/sparkline.js
//
// Draws a sparkline into an existing <svg> or <canvas>. We do NOT create the
// element for you -- the host page owns layout. This is deliberate; see #44.
//
// Two entry points, and this is the part people trip over:
//   sparkline(el, data, opts)        <- imperative, works anywhere
//   <Sparkline data={...} />         <- optional React wrapper, separate import
//
// The React wrapper lives at '@northwall/sparkline/react'. Importing React
// from the main entry would drag it into every bundle, so it is a subpath.
//
// There is no default export from this module, and there never will be: a
// default export means a second copy of every name in the bundle for anyone
// using a bundler that cannot tree-shake through it. The cost of that decision
// is that `import sparkline from '@northwall/sparkline'` gives you `undefined`
// with no error at import time. Issue #44, every week. -- ah

import { downsample, normalizeData, statsOf, toBlocks } from './data.js';

import { defaultAriaLabel, resolveStyle, runMarkers } from './theme.js';

// The public surface of the package, in full. Everything else in src/ is an
// implementation detail: the exports map only publishes this module and
// ./react, so reaching past them means reaching into the package's guts.
//
// Re-exported here so the extension points live at the package root next to
// the thing they extend. Named exports only.
export {
  VERSION,
  defineTheme,
  getMarker,
  getTheme,
  listMarkers,
  listThemes,
  registerMarker,
} from './theme.js';

export { normalizeData, parseSeries } from './data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------------ *
 * Element handling
 * ------------------------------------------------------------------ */

/**
 * Duck-typed element check. `instanceof Element` fails across iframes and in
 * any environment where the DOM is a shim, both of which real users have.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isElement(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.nodeType === 1 &&
      typeof value.tagName === 'string',
  );
}

/**
 * Which renderer an element wants: 'svg', 'canvas', or null for neither.
 *
 * @param {object} el
 * @returns {'svg'|'canvas'|null}
 */
function elementKind(el) {
  const tag = String(el.tagName).toLowerCase();
  if (tag === 'svg') return 'svg';
  if (tag === 'canvas') return 'canvas';
  return null;
}

function describeTarget(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  if (isElement(value)) return `<${String(value.tagName).toLowerCase()}>`;
  return typeof value;
}

/**
 * Validate the render target and explain the two mistakes people actually
 * make: passing a selector string, and passing a <div>.
 *
 * @param {unknown} el
 * @returns {{el: object, kind: 'svg'|'canvas'}}
 */
function requireTarget(el) {
  if (!el) throw new Error('sparkline: first argument must be an element');

  if (typeof el === 'string') {
    throw new TypeError(
      `sparkline: first argument must be an element, not a selector ` +
        `(received ${JSON.stringify(el)}). ` +
        `Pass document.querySelector(${JSON.stringify(el)}).`,
    );
  }

  if (!isElement(el)) {
    throw new TypeError(
      `sparkline: first argument must be an element, received ${describeTarget(el)}`,
    );
  }

  const kind = elementKind(el);
  if (!kind) {
    throw new TypeError(
      `sparkline: target must be an <svg> or <canvas>, received ` +
        `<${String(el.tagName).toLowerCase()}>. ` +
        'The library does not create the element for you.',
    );
  }

  return { el, kind };
}

/**
 * Work out the drawing box in CSS pixels.
 *
 * Because we never create the element, its size is the host page's problem --
 * and an <svg> with no width, no height and no CSS measures 0x0. Rather than
 * draw an invisible chart we fall back to the `width`/`height` options and
 * write a viewBox, so the thing scales with whatever CSS shows up later.
 *
 * @param {object} el
 * @param {object} style resolved style
 * @returns {{width: number, height: number, measured: boolean}}
 */
function measureTarget(el, style) {
  let width = 0;
  let height = 0;

  if (typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect();
    width = rect && Number.isFinite(rect.width) ? rect.width : 0;
    height = rect && Number.isFinite(rect.height) ? rect.height : 0;
  }

  if (width < 1 || height < 1) {
    const attrWidth = Number(el.getAttribute && el.getAttribute('width'));
    const attrHeight = Number(el.getAttribute && el.getAttribute('height'));
    if (Number.isFinite(attrWidth) && attrWidth > 0) width = attrWidth;
    if (Number.isFinite(attrHeight) && attrHeight > 0) height = attrHeight;
  }

  const measured = width >= 1 && height >= 1;
  return {
    width: measured ? width : style.width,
    height: measured ? height : style.height,
    measured,
  };
}

/* ------------------------------------------------------------------ *
 * Scales
 * ------------------------------------------------------------------ */

/**
 * The y domain for a series, before any pixel maths.
 *
 * 'extent'    min..max of the data. Default since 2.0.
 * 'zero'      0..max (or min..0 for all-negative data). The 1.x default.
 * 'symmetric' -m..+m where m is the largest magnitude. For deltas.
 * [lo, hi]    fixed, for making several sparklines comparable.
 *
 * A flat series has no extent, so we pad it by one unit and let it draw down
 * the middle of the box. Dividing by zero here is how you get NaN in a path.
 *
 * @param {object} stats from statsOf()
 * @param {'extent'|'zero'|'symmetric'|[number, number]} normalize
 * @returns {[number, number]}
 */
function computeDomain(stats, normalize) {
  if (Array.isArray(normalize)) {
    const [lo, hi] = normalize;
    return lo === hi ? [lo - 0.5, hi + 0.5] : [Math.min(lo, hi), Math.max(lo, hi)];
  }

  let lo = stats.min;
  let hi = stats.max;

  if (normalize === 'zero') {
    lo = Math.min(0, stats.min);
    hi = Math.max(0, stats.max);
  } else if (normalize === 'symmetric') {
    const extreme = Math.max(Math.abs(stats.min), Math.abs(stats.max)) || 1;
    lo = -extreme;
    hi = extreme;
  }

  if (lo === hi) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.5 : 0.5;
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}

/**
 * Build the x/y pixel mappings for a plot box.
 *
 * y is inverted, as always: domain low goes to the bottom of the box.
 *
 * @param {[number, number]} domain
 * @param {{left: number, top: number, right: number, bottom: number,
 *   width: number, height: number}} box
 * @param {number} count number of points
 * @returns {{x: (i: number) => number, y: (v: number) => number}}
 */
function makeScales(domain, box, count) {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const steps = Math.max(1, count - 1);

  return {
    x: (i) => box.left + (box.width * i) / steps,
    y: (value) => box.bottom - ((value - lo) / span) * box.height,
  };
}

/**
 * The rectangle we are allowed to draw in, after the gutter is taken out.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} gutter
 * @returns {object}
 */
function plotBox(width, height, gutter) {
  // Never let the gutter eat the whole box; a 20px-tall chart with a 3px
  // stroke should still draw something.
  const gx = Math.min(gutter, Math.max(0, width / 2 - 0.5));
  const gy = Math.min(gutter, Math.max(0, height / 2 - 0.5));
  return {
    left: gx,
    top: gy,
    right: width - gx,
    bottom: height - gy,
    width: Math.max(0, width - gx * 2),
    height: Math.max(0, height - gy * 2),
  };
}

/* ------------------------------------------------------------------ *
 * Path building
 * ------------------------------------------------------------------ */

function rounder(precision) {
  const factor = 10 ** Math.max(0, Math.min(10, Math.round(precision)));
  return (n) => {
    const rounded = Math.round(n * factor) / factor;
    // -0 serialises as "-0", which is noise in a diff and in a snapshot test.
    return Object.is(rounded, -0) ? 0 : rounded;
  };
}

/**
 * Split points into runs of consecutive non-gap points.
 * Each run becomes its own subpath, which is what makes a break look like a
 * break instead of a straight line across the hole.
 *
 * @param {Array<{gap: boolean}>} points
 * @returns {Array<Array<object>>}
 */
function segmentsOf(points) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (point.gap) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

/**
 * Fritsch-Carlson monotone cubic tangents.
 * Chosen over a plain Catmull-Rom because a sparkline that overshoots its own
 * maximum is lying about the data.
 *
 * @param {Array<{x: number, y: number}>} pts
 * @returns {number[]} tangent per point
 */
function monotoneTangents(pts) {
  const n = pts.length;
  const slopes = new Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    const dx = pts[i + 1].x - pts[i].x || 1e-9;
    slopes[i] = (pts[i + 1].y - pts[i].y) / dx;
  }

  const tangents = new Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];

  for (let i = 1; i < n - 1; i += 1) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents[i] = 0;
    } else {
      const dxPrev = pts[i].x - pts[i - 1].x;
      const dxNext = pts[i + 1].x - pts[i].x;
      const common = dxPrev + dxNext;
      tangents[i] =
        (3 * common) /
        ((common + dxNext) / slopes[i - 1] + (common + dxPrev) / slopes[i]);
    }
  }
  return tangents;
}

/**
 * One subpath for a run of points, in the requested curve style.
 *
 * @param {Array<{x: number, y: number}>} pts
 * @param {'linear'|'step'|'monotone'} curve
 * @param {(n: number) => number} r rounding function
 * @returns {string}
 */
function subpath(pts, curve, r) {
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    // A single point still needs to be visible: draw a zero-length line and
    // let strokeLinecap 'round' turn it into a dot.
    return `M${r(pts[0].x)} ${r(pts[0].y)}L${r(pts[0].x)} ${r(pts[0].y)}`;
  }

  if (curve === 'step') {
    let d = `M${r(pts[0].x)} ${r(pts[0].y)}`;
    for (let i = 1; i < pts.length; i += 1) {
      const midX = (pts[i - 1].x + pts[i].x) / 2;
      d += `H${r(midX)}V${r(pts[i].y)}H${r(pts[i].x)}`;
    }
    return d;
  }

  if (curve === 'monotone' && pts.length > 2) {
    const tangents = monotoneTangents(pts);
    let d = `M${r(pts[0].x)} ${r(pts[0].y)}`;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const dx = (pts[i + 1].x - pts[i].x) / 3;
      const c1x = pts[i].x + dx;
      const c1y = pts[i].y + tangents[i] * dx;
      const c2x = pts[i + 1].x - dx;
      const c2y = pts[i + 1].y - tangents[i + 1] * dx;
      d += `C${r(c1x)} ${r(c1y)},${r(c2x)} ${r(c2y)},${r(pts[i + 1].x)} ${r(pts[i + 1].y)}`;
    }
    return d;
  }

  let d = `M${r(pts[0].x)} ${r(pts[0].y)}`;
  for (let i = 1; i < pts.length; i += 1) {
    d += `L${r(pts[i].x)} ${r(pts[i].y)}`;
  }
  return d;
}

/**
 * The stroked line, as a single `d` string with one subpath per run.
 *
 * @param {Array<object>} points
 * @param {'linear'|'step'|'monotone'} curve
 * @param {number} precision
 * @returns {string}
 */
function buildLinePath(points, curve, precision = 2) {
  const r = rounder(precision);
  return segmentsOf(points)
    .map((segment) => subpath(segment, curve, r))
    .join('');
}

/**
 * The filled area under the line, closed down to `baselineY`.
 *
 * @param {Array<object>} points
 * @param {'linear'|'step'|'monotone'} curve
 * @param {number} baselineY
 * @param {number} precision
 * @returns {string}
 */
function buildAreaPath(points, curve, baselineY, precision = 2) {
  const r = rounder(precision);
  return segmentsOf(points)
    .map((segment) => {
      const line = subpath(segment, curve, r);
      if (!line) return '';
      const first = segment[0];
      const last = segment[segment.length - 1];
      return `${line}L${r(last.x)} ${r(baselineY)}L${r(first.x)} ${r(baselineY)}Z`;
    })
    .join('');
}

/**
 * Bar geometry. Bars grow from the baseline, which is zero when zero is in
 * range and the bottom of the box otherwise.
 *
 * @param {Array<object>} points
 * @param {object} box
 * @param {number} baselineY
 * @param {object} style resolved style
 * @returns {object[]} rect shape descriptors
 */
function buildBars(points, box, baselineY, style) {
  const count = points.length;
  if (count === 0) return [];

  const slot = box.width / count;
  const gap = Math.min(style.barGap, Math.max(0, slot - 0.5));
  const barWidth = Math.max(0.5, slot - gap);

  const bars = [];
  for (const point of points) {
    if (point.gap) continue;
    const x = box.left + slot * point.index + gap / 2;
    const top = Math.min(point.y, baselineY);
    const height = Math.max(0.5, Math.abs(baselineY - point.y));
    bars.push({
      type: 'rect',
      x,
      y: top,
      width: barWidth,
      height,
      rx: style.barRadius || undefined,
      fill: style.fill === 'none' ? style.stroke : style.fill,
      className: 'sparkline-bar',
    });
  }
  return bars;
}

/**
 * Tick geometry: one vertical stroke per value, centred on the midline. Reads
 * as a barcode rather than a chart, which suits binary-ish series.
 *
 * @param {Array<object>} points
 * @param {object} box
 * @param {object} style
 * @returns {object[]}
 */
function buildTicks(points, box, style) {
  const count = points.length;
  if (count === 0) return [];
  const slot = box.width / count;
  const shapes = [];
  for (const point of points) {
    if (point.gap) continue;
    const x = box.left + slot * point.index + slot / 2;
    const half = Math.max(0.5, (box.bottom - point.y) / 2);
    const mid = (box.top + box.bottom) / 2;
    shapes.push({
      type: 'line',
      x1: x,
      y1: mid - half,
      x2: x,
      y2: mid + half,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      className: 'sparkline-tick',
    });
  }
  return shapes;
}

/* ------------------------------------------------------------------ *
 * Scene assembly
 * ------------------------------------------------------------------ */

/**
 * Turn data plus a resolved style into a list of shape descriptors and the
 * metadata the renderers need. This is the only place the chart is decided;
 * the SVG, canvas and string outputs are all just walks over `shapes`.
 *
 * Returns null when there is nothing to draw -- fewer than two points, or a
 * box with no area. Callers treat null as "no-op".
 *
 * @param {Array<unknown>} data
 * @param {object} style resolved style
 * @param {{width: number, height: number}} size
 * @returns {object|null}
 */
function buildScene(data, style, size) {
  const series = normalizeData(data, { gaps: style.gaps });

  let { values, gaps } = series;
  if (style.maxPoints && values.length > style.maxPoints) {
    ({ values, gaps } = downsample(values, gaps, style.maxPoints, style.downsampleMethod));
  }

  // A single point is not a trend, and an empty array is not a chart. Both
  // return quietly rather than throwing: a dashboard cell with one reading in
  // it so far should render nothing, not crash the page. The cost is that a
  // wrong-shaped array also renders nothing, silently. See #44.
  if (values.length < 2) return null;

  const width = Math.max(0, size.width);
  const height = Math.max(0, size.height);
  const box = plotBox(width, height, style.gutter);
  if (box.width <= 0 || box.height <= 0) return null;

  const stats = statsOf(values, gaps);
  const domain = computeDomain(stats, style.normalize);
  const scale = makeScales(domain, box, values.length);

  const points = values.map((value, index) => ({
    index,
    value,
    gap: gaps[index],
    x: scale.x(index),
    y: scale.y(value),
  }));

  // Bars and areas need something to sit on. Zero if it is visible, the floor
  // of the box otherwise -- an area chart hanging off a non-zero baseline is
  // the honest rendering of normalize: 'extent'.
  const baselineY = domain[0] <= 0 && domain[1] >= 0 ? scale.y(0) : box.bottom;

  const shapes = [];

  if (style.background && style.background !== 'none') {
    shapes.push({
      type: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      fill: style.background,
      className: 'sparkline-background',
    });
  }

  if (style.type === 'bar') {
    shapes.push(...buildBars(points, box, baselineY, style));
  } else if (style.type === 'tick') {
    shapes.push(...buildTicks(points, box, style));
  } else {
    if (style.type === 'area' && style.fill !== 'none') {
      shapes.push({
        type: 'path',
        d: buildAreaPath(points, style.curve, baselineY, style.precision),
        fill: style.fill,
        fillOpacity: style.fillOpacity,
        stroke: 'none',
        className: 'sparkline-area',
      });
    }
    shapes.push({
      type: 'path',
      d: buildLinePath(points, style.curve, style.precision),
      fill: 'none',
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      strokeLinecap: style.strokeLinecap,
      strokeLinejoin: style.strokeLinejoin,
      className: 'sparkline-line',
    });
  }

  const markerContext = {
    values,
    gaps,
    points,
    stats,
    style,
    box,
    scale,
    domain,
    baselineY,
  };
  shapes.push(...runMarkers(style.markers, markerContext));

  return {
    shapes,
    points,
    values,
    gaps,
    stats,
    domain,
    box,
    baselineY,
    width,
    height,
    style,
  };
}

/* ------------------------------------------------------------------ *
 * SVG output
 * ------------------------------------------------------------------ */

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/**
 * Escape a string for use in XML text or an attribute value.
 *
 * @param {unknown} value
 * @returns {string}
 */
function escapeXML(value) {
  return String(value).replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

const SHAPE_ATTRS = {
  circle: ['cx', 'cy', 'r'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  path: ['d'],
  text: ['x', 'y'],
};

const PAINT_ATTRS = [
  ['fill', 'fill'],
  ['fillOpacity', 'fill-opacity'],
  ['stroke', 'stroke'],
  ['strokeWidth', 'stroke-width'],
  ['strokeLinecap', 'stroke-linecap'],
  ['strokeLinejoin', 'stroke-linejoin'],
  ['dash', 'stroke-dasharray'],
  ['opacity', 'opacity'],
  ['fontSize', 'font-size'],
  ['fontFamily', 'font-family'],
  ['anchor', 'text-anchor'],
  ['className', 'class'],
];

function shapeAttributes(shape, precision) {
  const r = rounder(precision);
  const attrs = [];

  for (const name of SHAPE_ATTRS[shape.type] || []) {
    const value = shape[name];
    if (value === undefined || value === null) continue;
    attrs.push([name, typeof value === 'number' ? r(value) : value]);
  }

  for (const [key, attr] of PAINT_ATTRS) {
    const value = shape[key];
    if (value === undefined || value === null) continue;
    if (key === 'fillOpacity' && value === 1) continue;
    attrs.push([attr, value]);
  }

  return attrs;
}

/**
 * Serialise one shape descriptor to an SVG element string.
 *
 * @param {object} shape
 * @param {number} precision
 * @returns {string}
 */
function shapeToMarkup(shape, precision) {
  const attrs = shapeAttributes(shape, precision)
    .map(([name, value]) => `${name}="${escapeXML(value)}"`)
    .join(' ');

  if (shape.type === 'text') {
    return `<text ${attrs}>${escapeXML(shape.text)}</text>`;
  }
  return `<${shape.type} ${attrs}/>`;
}

function accessibilityMarkup(scene, style) {
  const parts = [];
  const label = resolveAriaLabel(scene, style);

  if (style.title) parts.push(`<title>${escapeXML(style.title)}</title>`);
  else if (label) parts.push(`<title>${escapeXML(label)}</title>`);
  if (style.desc) parts.push(`<desc>${escapeXML(style.desc)}</desc>`);

  return parts.join('');
}

function resolveAriaLabel(scene, style) {
  if (style.ariaLabel === false || style.ariaLabel === '') return null;
  if (typeof style.ariaLabel === 'string') return style.ariaLabel;
  if (typeof style.ariaLabel === 'function') return style.ariaLabel(scene.stats);
  return defaultAriaLabel(scene.stats, style.precision);
}

/**
 * Render a series to a standalone `<svg>` string.
 *
 * Useful on the server, in a test snapshot, and in an email template -- and it
 * is what the CLI writes out. Returns an empty string when there is nothing to
 * draw, for the same reasons sparkline() no-ops.
 *
 * @param {Array<unknown>} data
 * @param {object} [opts] same options as sparkline(), plus `theme`
 * @returns {string} SVG markup, or '' when the series is too short to draw
 */
export function toSVGString(data, opts = {}) {
  const style = resolveStyle(opts);
  const scene = buildScene(data, style, { width: style.width, height: style.height });
  if (!scene) return '';

  const body = scene.shapes.map((shape) => shapeToMarkup(shape, style.precision)).join('');
  const label = resolveAriaLabel(scene, style);

  const attrs = [
    `xmlns="${SVG_NS}"`,
    `width="${style.width}"`,
    `height="${style.height}"`,
    `viewBox="0 0 ${style.width} ${style.height}"`,
    'preserveAspectRatio="none"',
  ];
  if (style.className) attrs.push(`class="${escapeXML(style.className)}"`);
  if (style.role) attrs.push(`role="${escapeXML(style.role)}"`);
  if (label) attrs.push(`aria-label="${escapeXML(label)}"`);
  if (!style.focusable) attrs.push('focusable="false"');

  return `<svg ${attrs.join(' ')}>${accessibilityMarkup(scene, style)}${body}</svg>`;
}

/* ------------------------------------------------------------------ *
 * DOM painting
 * ------------------------------------------------------------------ */

function createSVGNode(doc, shape, precision) {
  const node = doc.createElementNS(SVG_NS, shape.type);
  for (const [name, value] of shapeAttributes(shape, precision)) {
    node.setAttribute(name, String(value));
  }
  if (shape.type === 'text') node.textContent = String(shape.text);
  return node;
}

/**
 * Replace the contents of an <svg> with the scene.
 *
 * Note "replace": every child of the target is removed first. If you hand-wrote
 * a <title> or a <defs> inside that <svg>, it is gone after the first render.
 * Use the `title`, `desc` and `background` options instead, or wrap the chart
 * in its own <svg>.
 *
 * @param {object} el
 * @param {object} scene
 * @param {object} style
 * @returns {void}
 */
function paintSVG(el, scene, style) {
  const doc = el.ownerDocument;

  while (el.firstChild) el.removeChild(el.firstChild);

  if (!el.getAttribute('viewBox')) {
    el.setAttribute('viewBox', `0 0 ${scene.width} ${scene.height}`);
    el.setAttribute('preserveAspectRatio', 'none');
  }
  if (style.role) el.setAttribute('role', style.role);
  if (!style.focusable) el.setAttribute('focusable', 'false');

  const label = resolveAriaLabel(scene, style);
  if (label) el.setAttribute('aria-label', label);
  else el.removeAttribute('aria-label');

  if (style.title || label) {
    const title = doc.createElementNS(SVG_NS, 'title');
    title.textContent = style.title || label;
    el.appendChild(title);
  }
  if (style.desc) {
    const desc = doc.createElementNS(SVG_NS, 'desc');
    desc.textContent = style.desc;
    el.appendChild(desc);
  }

  for (const shape of scene.shapes) {
    el.appendChild(createSVGNode(doc, shape, style.precision));
  }
}

function applyCanvasPaint(ctx, shape, style) {
  ctx.lineWidth = shape.strokeWidth ?? style.strokeWidth;
  ctx.lineCap = shape.strokeLinecap ?? style.strokeLinecap;
  ctx.lineJoin = shape.strokeLinejoin ?? style.strokeLinejoin;
  ctx.setLineDash(shape.dash ? String(shape.dash).split(/[\s,]+/).map(Number) : []);
  ctx.globalAlpha = shape.fillOpacity ?? 1;
}

/**
 * Paint the scene onto a <canvas>.
 *
 * `currentColor` cannot be resolved by a canvas context, so we read the
 * element's computed colour and use that. Without this the default theme
 * paints nothing at all on canvas, which is a confusing way to find out.
 *
 * @param {object} el
 * @param {object} scene
 * @param {object} style
 * @returns {void}
 */
function paintCanvas(el, scene, style) {
  const ctx = el.getContext('2d');
  if (!ctx) {
    throw new Error('sparkline: could not get a 2d context from the <canvas>');
  }

  const view = el.ownerDocument && el.ownerDocument.defaultView;
  const ratio = (view && view.devicePixelRatio) || 1;

  let inherited = '#000000';
  if (view && typeof view.getComputedStyle === 'function') {
    const computed = view.getComputedStyle(el);
    if (computed && computed.color) inherited = computed.color;
  }
  const resolve = (color) =>
    !color || color === 'none' ? null : color === 'currentColor' ? inherited : color;

  el.width = Math.round(scene.width * ratio);
  el.height = Math.round(scene.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);

  for (const shape of scene.shapes) {
    applyCanvasPaint(ctx, shape, style);
    const fill = resolve(shape.fill);
    const stroke = resolve(shape.stroke);

    ctx.beginPath();
    switch (shape.type) {
      case 'path':
        if (typeof Path2D === 'function') {
          const path = new Path2D(shape.d);
          if (fill) {
            ctx.fillStyle = fill;
            ctx.fill(path);
          }
          if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.stroke(path);
          }
          continue;
        }
        // Path2D is everywhere we support, but node-canvas shims sometimes
        // lack it; a straight polyline is a reasonable degradation.
        replayPolyline(ctx, scene, shape);
        break;
      case 'rect':
        ctx.rect(shape.x, shape.y, shape.width, shape.height);
        break;
      case 'circle':
        ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
        break;
      case 'line':
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        break;
      case 'text':
        ctx.fillStyle = fill || inherited;
        ctx.font = `${shape.fontSize || 10}px sans-serif`;
        ctx.textAlign = shape.anchor === 'middle' ? 'center' : shape.anchor || 'start';
        ctx.fillText(String(shape.text), shape.x, shape.y);
        continue;
      default:
        continue;
    }

    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

function replayPolyline(ctx, scene, shape) {
  const first = scene.points.find((p) => !p.gap);
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  let pen = false;
  for (const point of scene.points) {
    if (point.gap) {
      pen = false;
      continue;
    }
    if (!pen) {
      ctx.moveTo(point.x, point.y);
      pen = true;
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.strokeStyle = shape.stroke === 'currentColor' ? '#000000' : shape.stroke;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Draw a sparkline into an existing element.
 *
 * The element is yours: create it, size it with CSS, and pass it in. We only
 * paint. An <svg> gets SVG children; a <canvas> gets a 2d context.
 *
 * @param {SVGElement|HTMLCanvasElement} el an existing <svg> or <canvas>
 * @param {Array<number|string|null|{value: number}>} data at least two points
 * @param {object} [opts] see BASE_STYLE in theme.js for every option
 * @returns {object|null} the scene that was drawn, or null when nothing was
 * @throws {TypeError} when `el` is not an <svg>/<canvas>, or an option is invalid
 */
export function sparkline(el, data, opts = {}) {
  const target = requireTarget(el);
  const style = resolveStyle(opts);
  const size = measureTarget(target.el, style);

  const scene = buildScene(data, style, size);
  if (!scene) return null;

  if (target.kind === 'canvas') paintCanvas(target.el, scene, style);
  else paintSVG(target.el, scene, style);

  return scene;
}

/**
 * Pre-resolve a set of options once and reuse them.
 *
 * Worth it when you are drawing the same shape of chart many times -- a table
 * with one sparkline per row resolves its theme once instead of per row.
 *
 * The catch: the style is resolved here, at creation. A theme registered with
 * defineTheme() *after* this call will not reach this renderer, and neither
 * will a change to an existing one. Define your themes at module load.
 *
 * @param {object} [opts] baseline options, including `theme`
 * @returns {{options: object, render: Function, renderAll: Function,
 *   toString: Function, clear: Function}}
 */
export function createRenderer(opts = {}) {
  const style = resolveStyle(opts);

  return {
    /** The frozen, fully resolved style this renderer will use. */
    options: style,

    /**
     * Draw into one element, optionally overriding a few options.
     *
     * Overrides are merged on top of the *resolved* style, so a renderer
     * created with a theme keeps that theme's values unless you replace them.
     *
     * @param {SVGElement|HTMLCanvasElement} el
     * @param {Array<unknown>} data
     * @param {object} [overrides]
     * @returns {object|null}
     */
    render(el, data, overrides) {
      const target = requireTarget(el);
      const effective = overrides
        ? resolveStyle({ ...stripInternal(style), ...overrides })
        : style;
      const size = measureTarget(target.el, effective);
      const scene = buildScene(data, effective, size);
      if (!scene) return null;
      if (target.kind === 'canvas') paintCanvas(target.el, scene, effective);
      else paintSVG(target.el, scene, effective);
      return scene;
    },

    /**
     * Draw one series per element. Lengths must match.
     *
     * @param {Iterable<SVGElement|HTMLCanvasElement>} elements
     * @param {Array<Array<unknown>>} datasets
     * @returns {Array<object|null>}
     */
    renderAll(elements, datasets) {
      const list = Array.from(elements);
      if (list.length !== datasets.length) {
        throw new RangeError(
          `sparkline: renderAll got ${list.length} elements and ${datasets.length} series`,
        );
      }
      return list.map((el, i) => this.render(el, datasets[i]));
    },

    /**
     * Same options, but as an SVG string instead of a DOM mutation.
     *
     * @param {Array<unknown>} data
     * @returns {string}
     */
    toString(data) {
      return toSVGString(data, stripInternal(style));
    },

    /**
     * Empty a target without drawing anything into it.
     *
     * @param {SVGElement|HTMLCanvasElement} el
     * @returns {void}
     */
    clear(el) {
      const target = requireTarget(el);
      if (target.kind === 'canvas') {
        const ctx = target.el.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, target.el.width, target.el.height);
        return;
      }
      while (target.el.firstChild) target.el.removeChild(target.el.firstChild);
      target.el.removeAttribute('aria-label');
    },
  };
}

/**
 * Strip the keys resolveStyle() adds but does not accept back, so a resolved
 * style can be fed through resolution a second time.
 *
 * @param {object} style
 * @returns {object}
 */
function stripInternal(style) {
  const { themeName, ...rest } = style;
  return rest;
}

/**
 * Render a series as a line of Unicode block characters.
 *
 * The same series, in a terminal or a commit message. Honours `normalize`;
 * everything to do with pixels is ignored, because there are none.
 *
 * @param {Array<unknown>} data
 * @param {object} [opts]
 * @returns {string}
 */
export function toTextString(data, opts = {}) {
  const style = resolveStyle(opts);
  const series = normalizeData(data, { gaps: style.gaps });

  let { values, gaps } = series;
  if (style.maxPoints && values.length > style.maxPoints) {
    ({ values, gaps } = downsample(values, gaps, style.maxPoints, style.downsampleMethod));
  }
  if (values.length < 2) return '';

  return toBlocks(values, gaps, {
    normalize: Array.isArray(style.normalize) ? 'extent' : style.normalize,
  });
}

/**
 * Summarise a series without drawing it: the numbers behind the picture.
 *
 * Handy for the label next to the chart, and for deciding whether a chart is
 * worth drawing at all.
 *
 * @param {Array<unknown>} data
 * @param {object} [opts]
 * @returns {object} stats plus the resolved domain
 */
export function describe(data, opts = {}) {
  const style = resolveStyle(opts);
  const series = normalizeData(data, { gaps: style.gaps });
  const stats = statsOf(series.values, series.gaps);
  return {
    ...stats,
    missing: series.gaps.filter(Boolean).length,
    domain: computeDomain(stats, style.normalize),
    label: defaultAriaLabel(stats, style.precision),
  };
}

// Deliberately not exported: `export default sparkline`. See the note at the
// top of this file, and issue #44.
