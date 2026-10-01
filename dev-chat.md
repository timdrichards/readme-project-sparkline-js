# Thread from the team channel

**ah** 14:31
we've now answered "why is nothing rendering" four times this month and it's
the default-import thing every time

**tmb** 14:33
because the first line of the docs site is `import sparkline from ...`

**ah** 14:33
the docs site is a copy of the 1.x readme. 2.0 changed the export shape, the
normalize default, and split the react wrapper into a subpath

**tmb** 14:35
so three breaking changes and the install snippet still shows the old import

**ah** 14:36
yes. i'd rather have one honest readme than the docs site tbh. someone
evaluating this spends about ten seconds before they try npm install and then
paste the first snippet they see

**tmb** 14:37
+1. and put the bundle size in it, that's the reason anyone picks this over
the big charting libs

**tmb** 14:41
separate thing: is the cli documented anywhere? `sparkline render x.csv -o
x.svg` is genuinely the nicest part of 2.x and i only found it because i read
package.json

**ah** 14:42
nowhere. `sparkline --help` is the documentation

**ah** 14:43
also nobody knows about defineTheme/registerMarker. rtoyama filed #61 which
means at least one person found them by reading src/theme.js

**tmb** 14:45
that's two people reading source to use a library whose whole pitch is that
it's small enough not to have to
