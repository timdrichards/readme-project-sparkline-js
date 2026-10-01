# Start here — sparkline

## What this project is

**sparkline** is a small JavaScript library that draws sparklines: tiny
inline charts with no axes or labels, the kind that sit next to a number in a
dashboard. There is an optional React wrapper for teams that want one, and a
command-line tool that turns a CSV or JSON file into an SVG.

It recently went from version 1 to version 2. Some things changed. The
documentation did not.

**Your job:** write the README.

## Who you are writing for

Not a user — an *evaluator*. Someone comparing this against three other charting
libraries, who needs to answer "is this the right tool for us?" before they will
spend a minute installing anything. They will try the first code snippet they
see, and if it doesn't work, they will close the tab.

That makes this a harder audience than a user who has already committed. You
have to explain *and* make the case.

## What's in this folder

| File | What it is |
|---|---|
| `package.json` | The npm manifest: entry points, the CLI binary, peer dependencies, what ships |
| `src/sparkline.js` | The core. The public API, the element handling, the scales, the path building |
| `src/theme.js` | Every option and its default, the built-in themes, the accessibility defaults, the marker registry |
| `src/data.js` | Input handling: what counts as data, CSV and JSON parsing, missing values, downsampling |
| `src/cli.js` | The Node command-line tool: commands, flags, error messages, exit codes |
| `src/react.js` | The optional React wrapper |
| `issues.md` | Five issue threads, with maintainer replies |
| `dev-chat.md` | A team conversation about why people keep filing the same issue |
| `user-email.md` | An email from Kwan, who is evaluating the library for a team |

The source is plain ESM with no build step, so you can read it top to bottom.
It is about 3,700 lines. You are not expected to read all of it — see below.

## A reading order that works

1. **`user-email.md` first**, unusually. Kwan asks five specific questions. They
   are the questions your README has to answer, and having them in mind changes
   what you notice in everything else.
2. **`package.json`.** Small and dense. Entry points, what's optional, what
   ships to users, and what command gets installed on your PATH.
3. **`src/sparkline.js`** — the header comment, the export list at the top, and
   the JSDoc on the exported functions near the bottom. That is the API. The
   comments explain design decisions and mark the places where it is easy to
   misuse. Note what changed in 2.0.
4. **`src/theme.js`** — the `BASE_STYLE` object. It is the complete list of
   options with their defaults, in one place. Then skim the built-in themes and
   `registerMarker`.
5. **`src/cli.js`** — the `USAGE` string is the flag list, and the code below it
   is what actually happens. Check that they agree.
6. **`src/react.js`** — short. Read the header comment and the props.
7. **`src/data.js`** — skim. What it accepts as input, and what it does with a
   hole in the data.
8. **`issues.md`.** Some of these are filed over and over. Work out why,
   because preventing them is your README's job.
9. **`dev-chat.md`.** The team names the problem directly and says what they
   wish the page led with.

## Before you start writing

- What is the correct way to import this, and what happens if you get it wrong?
- What does the library expect you to have already done before you call it?
- Why would someone choose this over a larger charting library — and is that
  reason stated anywhere in the material?
- What would you need to tell someone upgrading from version 1?
- Someone wants a colour scheme or a marker the library doesn't ship. What do
  you tell them?
- The CLI and the library are the same renderer behind two front doors. Does
  your README treat them as one project or two?

## What the README has to include

**Follow the [Standard Readme spec](https://github.com/RichardLitt/standard-readme).**
That means the required sections, in its order: Title, Short Description, an
optional Long Description, Table of Contents, Install, Usage, API, Contributing,
License. Read the spec before you start; it is short, and it settles most of the
arguments about what goes where.

**Include worked examples of both halves of this project.**

- **The CLI.** Several real invocations with the output they produce. Not only
  the happy path — show at least one case where the command does not simply
  work, and what the user does about it.
- **The library API.** A copy-pasteable example that runs in a browser or
  through a bundler; the React wrapper; and one example of extending the
  library, either a custom theme or a custom marker.

Every command, flag, option name and export you write down has to match the
code in `src/`. If you cannot find it there, it does not go on the page.

## Two rules

**Use only what is in this folder.** If the material doesn't say it, you don't
know it. Where the material leaves a real gap, say so on the page rather than
inventing a number or a feature.

**Your first code snippet is the most important thing on the page.** Most
readers will paste it before reading a word of prose. Make sure it runs.

## Where your README goes

This repository is your own copy of the project, made from the course template. Write your README as a file named `README.md` at the top level of this repository, next to this `START.md`, not inside `src/`.

Commit it to the `main` branch. GitHub shows `README.md` on the repository's front page, so open your repository in a browser after you commit and check that it reads the way you meant it to. Leave every other file as it is: your README describes this code, it does not change it.

Your instructor will tell you when drafts are due, and who to add as collaborators so they can read your work.
