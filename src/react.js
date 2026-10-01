// src/react.js
//
// The optional React wrapper, published at '@northwall/sparkline/react'.
//
// It is a separate entry point because this is the only file in the package
// that imports React. Importing it from the main entry would put React in the
// dependency graph of every bundle, including the ones that do not use it.
// React is an optional peerDependency, which is also why `npm install` prints
// a peer warning for projects that do not have React: npm mentions optional
// peers too. Nothing is broken; nothing needs installing.
//
// There is no hook. People ask (#58). A hook would have to own the element to
// be worth anything, and owning elements is the thing this library does not
// do. The component below creates its own <svg> -- that is the *only* place in
// the package where an element is created for you -- and hands it to the same
// sparkline() everyone else calls.
//
// Named export only, matching the main entry: `import { Sparkline } from ...`.

import { createElement, useEffect, useMemo, useRef } from 'react';

import { createRenderer, describe, toSVGString } from './sparkline.js';

/**
 * Options that belong to the chart rather than to the DOM node.
 * Anything not in here is forwarded to the <svg> as a normal React prop, so
 * `onClick`, `data-testid`, `tabIndex` and friends all work.
 */
const CHART_PROPS = new Set([
  'data',
  'theme',
  'type',
  'curve',
  'normalize',
  'gaps',
  'maxPoints',
  'downsampleMethod',
  'stroke',
  'strokeWidth',
  'strokeLinecap',
  'strokeLinejoin',
  'fill',
  'fillOpacity',
  'background',
  'barGap',
  'barRadius',
  'gutter',
  'markers',
  'markerSize',
  'markerColors',
  'ariaLabel',
  'title',
  'desc',
  'role',
  'focusable',
  'precision',
  'onRender',
  'as',
]);

function splitProps(props) {
  const chart = {};
  const dom = {};
  for (const [key, value] of Object.entries(props)) {
    if (CHART_PROPS.has(key)) chart[key] = value;
    else dom[key] = value;
  }
  return { chart, dom };
}

/**
 * Stable-ish identity for the option bag, so the effect does not re-run on
 * every parent render just because an object literal was passed inline --
 * which, for a component whose whole API is option literals, is every render.
 *
 * Arrays are compared by contents. That is fine for sparkline-sized data and
 * would not be for a real chart library.
 */
function optionsKey(chart) {
  const keys = Object.keys(chart).filter((k) => k !== 'onRender').sort();
  return JSON.stringify(keys.map((k) => [k, chart[k]]));
}

/**
 * Render a sparkline as a React component.
 *
 * ```jsx
 * import { Sparkline } from '@northwall/sparkline/react';
 *
 * <Sparkline data={[3, 1, 4, 1, 5, 9, 2, 6]} width={120} height={24} />
 * ```
 *
 * Every option `sparkline()` accepts is available as a prop. Unrecognised
 * props are forwarded to the underlying <svg>.
 *
 * @param {object} props
 * @param {Array<number|string|null|{value: number}>} props.data
 * @param {number} [props.width] CSS pixels; also the viewBox width
 * @param {number} [props.height]
 * @param {string} [props.theme]
 * @param {'svg'|'canvas'} [props.as] element to create, default 'svg'
 * @param {(scene: object|null) => void} [props.onRender] called after each paint
 * @returns {object} a React element
 */
export function Sparkline(props) {
  const { chart, dom } = splitProps(props);
  const {
    data,
    as: tag = 'svg',
    onRender,
    ...options
  } = chart;

  const width = props.width ?? 100;
  const height = props.height ?? 20;

  const ref = useRef(null);
  const onRenderRef = useRef(onRender);
  onRenderRef.current = onRender;

  const key = optionsKey({ ...options, width, height });

  // The renderer resolves the theme once per distinct option set. Same caveat
  // as createRenderer() itself: a theme defined after this runs will not be
  // picked up until the options change.
  const renderer = useMemo(
    () => createRenderer({ ...options, width, height }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  const dataKey = useMemo(() => {
    if (!Array.isArray(data)) return String(data);
    return data.length <= 512 ? JSON.stringify(data) : `len:${data.length}:${data[0]}:${data[data.length - 1]}`;
  }, [data]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let scene = null;
    if (Array.isArray(data) && data.length >= 2) {
      scene = renderer.render(el, data);
    } else {
      // Fewer than two points is a no-op in the core, but the component may be
      // re-rendering over an older chart, so clear rather than leave a stale
      // picture on screen.
      renderer.clear(el);
    }

    if (onRenderRef.current) onRenderRef.current(scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, dataKey]);

  const common = {
    ref,
    width,
    height,
    ...dom,
  };

  if (tag === 'canvas') {
    return createElement('canvas', common);
  }

  return createElement('svg', {
    ...common,
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
  });
}

Sparkline.displayName = 'Sparkline';

/**
 * Server-rendered variant: produces the SVG markup during render instead of
 * painting in an effect.
 *
 * Use this when the chart has to exist in the first HTML response -- an email,
 * a static export, a Next.js server component. It does no work on the client
 * and never touches a ref, so it cannot react to a resize.
 *
 * @param {object} props same props as Sparkline
 * @returns {object} a React element wrapping the generated markup
 */
export function SparklineSSR(props) {
  const { chart, dom } = splitProps(props);
  const { data, onRender, as: _as, ...options } = chart;

  const width = props.width ?? 100;
  const height = props.height ?? 20;

  const markup = useMemo(
    () => toSVGString(Array.isArray(data) ? data : [], { ...options, width, height }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optionsKey({ ...options, width, height }), Array.isArray(data) ? data.join(',') : ''],
  );

  if (!markup) return null;

  // The markup is generated here from numbers, not supplied by a caller, so
  // there is no untrusted string going into the DOM. Titles and descriptions
  // are escaped by toSVGString().
  const inner = markup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

  return createElement('svg', {
    ...dom,
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    role: options.role ?? 'img',
    'aria-label': options.ariaLabel === false ? undefined : describe(Array.isArray(data) ? data : [], options).label,
    dangerouslySetInnerHTML: { __html: inner },
  });
}

SparklineSSR.displayName = 'SparklineSSR';
