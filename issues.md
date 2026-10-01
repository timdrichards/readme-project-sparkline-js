# Recent issues

---

**#44 -- Nothing renders**
opened by dmitri-b

```js
import sparkline from '@northwall/sparkline';
sparkline('#chart', [1,4,2,8]);
```
Nothing appears. No error in the console.

> **ah** commented:
> Two things. It's a named export, so `import { sparkline }`. And the first
> argument is an element, not a selector -- pass
> `document.querySelector('#chart')`. The default import is silently
> `undefined`, which is why you get no error.
>
> We get this one about once a week.

> **dmitri-b** commented:
> Fixed both, still nothing, still no error. My markup is
> `<svg id="chart"></svg>` and I'm charting a single reading for now.

> **ah** commented:
> Two more. Under two points we return without drawing -- a one-reading
> dashboard cell shouldn't throw. And an `<svg>` with no width, no height and
> no CSS measures 0x0, so we fall back to the `width`/`height` options, which
> default to 100x20. Give the element a size. We don't create or size it.

---

**#51 -- Charts look different after upgrading to 2.0**
opened by s-pereira

Our sparklines used to sit on a zero baseline. After the upgrade small
variations look like huge swings. Nothing in the changelog mentions it.

> **ah** commented:
> That's the `normalize` default changing from `'zero'` to `'extent'`. Pass
> `{ normalize: 'zero' }` to get the old look. Sorry -- this should have been
> in the release notes.

---

**#58 -- Does this work with React?**
opened by kwan-l

We're in Next.js. Should I use the hook? Is there a hook?

> **ah** commented:
> There's a wrapper component at `@northwall/sparkline/react`. No hook. React
> is an optional peer dependency, so nothing breaks if you don't use it.
>
> `<Sparkline data={...} />` creates its own `<svg>` -- it's the one place in
> the package where an element is made for you. There's also `SparklineSSR`
> if you need the markup in the first response.

---

**#61 -- My custom theme is ignored**
opened by rtoyama

```js
const chart = createRenderer({ theme: 'brand' });
defineTheme('brand', { stroke: '#6d28d9' });
chart.render(el, data);   // still currentColor
```

> **ah** commented:
> `createRenderer()` resolves the style once, when you call it. Move the
> `defineTheme` above it. Swap those two lines and it works.
>
> (If `defineTheme` ran second in your real code because it's in another
> module, import order is doing this to you.)

---

**#63 -- render() eats the `<title>` I put in my svg**
opened by s-pereira

We hand-write `<title>` inside the `<svg>` for a tooltip. It's gone after the
first render.

> **ah** commented:
> We empty the element before drawing, so anything you put in there goes.
> Use the `title` and `desc` options instead -- we write those ourselves, and
> we generate an `aria-label` from the data if you don't pass one.
