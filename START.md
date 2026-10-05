# Start here — sparkline

## What a README is for

A README is the first file anyone reads in a repository. GitHub shows it on the repository's front page, under the list of files, so it is the project's front door: it tells a visitor what the project is, whether it is for them, how to install it, and how to use it. Most people who find a project never read its code. They read the README, and they decide in a minute or less whether to keep going. A project with no README, or a confusing one, gets closed in a browser tab, however good the code behind it is.

That is why the writing matters as much as the content. A README written in clear, precise, well-organized prose tells the reader that the project is cared for and can be trusted; one that is vague, padded, or wrong tells them the opposite, and they will assume the code is the same. The words you choose shape how a visitor understands the project: what they think it does, who they think it is for, and whether they think it is worth their time. Good writing is not decoration on top of the documentation. For most visitors, it is the project.

## Before you start: learn GitHub Markdown

A README is written in **Markdown**, a simple way of formatting plain text: a `#` at the start of a line makes a heading, `**bold**` makes **bold**, a line starting with `-` makes a bullet point, and text between backticks becomes `code`. GitHub uses its own version, called GitHub Flavored Markdown, which adds tables, task lists and a few other features.

**Before you write anything, read GitHub's guide:** [Basic writing and formatting syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax). Pay particular attention to headings, links (including links to sections of the same page, which you need for the Table of Contents), code blocks, and tables. If you want the full detail, the complete rules are in the [GitHub Flavored Markdown specification](https://github.github.com/gfm/), but the guide is enough for this assignment.

You can try Markdown out as you go: GitHub's editor has a **Preview** tab that shows how your text will look.

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
| `SPEC.md` | The README specification for this assignment: the sections your README needs, in order |
| `PEER.md` | Phases 2 to 6: how your README is peer reviewed, revised, merged, and submitted |

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

**Follow [SPEC.md](SPEC.md).** It is this assignment's README specification,
adapted from the [Standard Readme spec](https://github.com/RichardLitt/standard-readme).
It lists the sections, in order: Title, an optional Banner, Description, Table
of Contents, Install, Usage, optional extra sections, API (required: this
project has one), Maintainers, and Credits. Read it before you start. It is
short, and it settles most of the arguments you would otherwise have with
yourself about what goes where.

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

## How the assignment runs

You do everything on the GitHub website, in your browser. Do not clone the repository or use another editor: every step is explained inside GitHub, so everyone works the same way, and course staff can only help with problems that happen there.

| Phase | Who | What happens | Where it is explained |
|---|---|---|---|
| 0. Set up | You | Add your reviewers, instructor and course staff to your repository | Below, in this file |
| 1. Draft | You | Write `README.md` on a new branch and open a pull request | Below, in this file |
| 2. Review | Your reviewers | Comment on your README, line by line | [PEER.md](PEER.md) |
| 3. Revise | You | Make changes, answer every comment, ask for another review | [PEER.md](PEER.md) |
| 4. Approve | Your reviewers | Check the changes and approve | [PEER.md](PEER.md) |
| 5. Merge | You | Merge the pull request into `main` | [PEER.md](PEER.md) |
| 6. Submit | You | Convert `README.md` to a PDF and submit it on Canvas | [PEER.md](PEER.md) |

Phases 0 and 1 are below. When your pull request is open, continue with [PEER.md](PEER.md). You will also be a reviewer for two classmates, so read phases 2 and 4 of [PEER.md](PEER.md) before your first review.

Your instructor will tell you when drafts are due, who your reviewers are, and the GitHub usernames of the instructor and course staff.

### A few words you will see

- **Repository:** your copy of the project on GitHub: all its files and their history.
- **Commit:** a saved change. Every time you click **Commit changes**, GitHub saves a new version and keeps the old ones.
- **Branch:** a separate draft copy of your files, inside the same repository. Your repository starts with one branch, called `main`: think of it as the finished, published version. You will write your README on a second branch, called `readme-draft`. Nothing you do on `readme-draft` changes `main` until you choose to bring it across.
- **Pull request:** a request to bring the changes on your draft branch into `main`. It is also the place where reviewers read your changes and comment on them, line by line. The pull request is the review.
- **Merge:** bringing the draft into `main`, once your reviewers approve. After merging, your README is part of `main`.

### Phase 0: Set up

#### Add your reviewers, instructor and course staff

Your repository is private, so only the people you add can see it.

1. Go to your repository on GitHub.
2. Click **Settings** (the tab with the gear icon, at the top of the repository).
3. In the left sidebar, under **Access**, click **Collaborators**. GitHub may ask for your password.
4. Click **Add people**.
5. Type the person's GitHub username, choose them from the list, and click **Add to this repository**.
6. Repeat for each person: your two reviewers, your instructor, and each member of course staff.

Each person gets an invitation by email and on GitHub. They cannot see your repository until they accept it.

#### Accept invitations you receive

When a classmate adds you as a reviewer, you get an email from GitHub. Open it and click **View invitation**, then **Accept invitation**. You can also find invitations under the bell icon (top right of any GitHub page).

### Phase 1: Draft

#### Create README.md on a new branch

Do this once, to start the README.

1. Go to the front page of your repository (the **Code** tab). Check that the branch button near the top left says `main`.
2. Click **Add file**, then **Create new file**.
3. In the name box, type exactly `README.md`. It goes at the top level, next to this `START.md`, not inside `src/`. Leave every other file as it is: your README describes this code, it does not change it.
4. Write in the editor. Click the **Preview** tab at any time to see how it will look. Follow [SPEC.md](SPEC.md) for what goes in it, and the requirements in [What the README has to include](#what-the-readme-has-to-include) above.
5. Click the green **Commit changes...** button (top right).
6. In the box that opens:
   - Leave the commit message as it is, or write a short one such as "First draft of README".
   - **Choose "Create a new branch for this commit and start a pull request."** This is the important step: do not choose "Commit directly to the `main` branch".
   - In the branch name box, type `readme-draft`.
7. Click **Propose changes**.

GitHub now shows the **Open a pull request** page. Continue below.

#### Open the pull request

1. **Title:** something clear, such as "README for tempo".
2. **Description:** write it yourself, in a few sentences: what this README covers, anything you are unsure of, and what you would most like your reviewers to look at. See [Write the description yourself](#write-the-description-yourself) below.
3. On the right, click **Reviewers** (or the gear next to it) and choose your two reviewers. Only people who have accepted your invitation appear.
4. Click **Create pull request**.

Your pull request now has its own page, with tabs for **Conversation**, **Commits** and **Files changed**. Your reviewers get a notification.

#### Keep working on the draft

You can keep editing until your reviewers start, and you will edit again in phase 3. Always edit on the `readme-draft` branch:

1. Open your pull request: click the **Pull requests** tab of your repository, then your pull request.
2. Click the **Files changed** tab.
3. On the `README.md` box, click the **...** button (top right of the box), then **Edit file**.
4. Make your changes, then click **Commit changes...**.
5. Check that the box says **Commit directly to the `readme-draft` branch**, then click **Commit changes**.

The pull request updates on its own. You never need to open a second pull request.

#### Write the description yourself

GitHub may offer to write the pull request description for you with Copilot, its AI assistant, through a Copilot button or suggested text that appears as you type in the description box. **Do not use it.**

The description is your message to your reviewers: it tells them what you did and where to look. They take it on trust, so it has to say what you actually did, in your words. An AI summary of your changes can sound right while describing them wrongly, and your reviewers would then look in the wrong place.

- If suggested text appears as you type, you can switch it off: click the Copilot icon above the description box and choose **Disabled** under **Autocomplete**.
- If Copilot text ends up in your description anyway, read it against what you actually did, rewrite anything that is wrong or vague, and add a line at the end saying "Part of this description was written by Copilot and checked by me."

#### If you committed to main by mistake

If `README.md` went onto `main` instead of a new branch, there is nothing for your reviewers to review. Fix it like this:

1. Open `README.md` on `main`, select all the text in it, and copy it somewhere safe.
2. Click the **...** button (top right of the file), then **Delete file**, and commit directly to `main`.
3. Start again at [Create README.md on a new branch](#create-readmemd-on-a-new-branch) and paste your text back in.

When your pull request is open and your reviewers are requested, continue with phase 2 in [PEER.md](PEER.md).
