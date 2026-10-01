From: kwan-l@example.com
To: hello@northwall.dev
Subject: evaluating sparkline -- a few questions before we commit

Hi,

We're picking a chart library for a dashboard and sparkline looks like the
right size for us. Before I put it in front of my team I need to answer a few
things and I couldn't find them on the site or in the repo.

1. What's the actual bundle cost? The README doesn't say and this is the main
   reason we're not using a bigger library.
2. Does it need React? package.json lists React under peerDependencies, which
   made our build warn on install. We're half React, half plain TypeScript.
3. Do I create the SVG element, or does the library? The examples all show an
   existing element but never say that's required.
4. Is there a v1 to v2 migration note anywhere? We have an older internal app
   pinned to 1.4 and I'd like to know what I'm walking into.
5. There's a `sparkline` command in the `bin` field. Our nightly job produces a
   CSV and we'd rather render it there than ship the numbers to the browser.
   Is that supported, or is it a dev tool you happened to publish?

I got a demo working in the end by reading the source, which was fine for me,
but I can't ask the rest of the team to do that.

Thanks,
Kwan
