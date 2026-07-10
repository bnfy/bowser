# Marketing Site Release 1 — Copy + Wireframe Brief

## Goal

Turn Blanc's existing one-page product demonstration into a small, coherent
marketing site that makes its real differentiators easy to understand, find,
and download. The primary conversion is a click to the appropriate installer;
supporter and custom-build links remain secondary.

This release is deliberately a content-and-discovery expansion, not a visual
rebrand. Keep the current light canvas, black type, restrained borders,
Inter/JetBrains Mono pairing, lowercase action language, and floating-Island
interaction. The home-page demo remains the centrepiece.

## Product truth and copy guardrails

Every marketable claim must point back to product behaviour in `README.md`,
`spec/features.md`, or the implementation before it is published.

- **Core promise:** a minimal desktop browser controlled from one small Island.
- **Blocking:** say "built-in ad and tracker blocking" or "fewer ads and less
  tracking." Do not promise that every ad, tracker, or video ad is blocked.
- **Private tabs:** say they are excluded from Blanc history, session restore,
  and reopen-closed. Do not call them anonymous, isolated, or a VPN: cookies
  and site storage are intentionally shared with regular tabs.
- **Platforms:** advertise macOS, Windows, and Linux only. The mobile build is
  not released and must not appear in a platform selector, structured data, or
  marketing copy.
- **Privacy:** the data stays on-device claim must preserve the existing
  disclosures about optional Profile Sync, update checks, block-list fetches,
  favicons, and opt-in analytics.
- **Tone:** precise, quiet, and concrete. Show a behaviour, then explain its
  benefit. Avoid superlatives, generic "private by design" language, and
  unsupported performance claims.

## Release scope and routes

Use the existing extensionless URL convention and direct-upload Cloudflare
Pages deployment. Implement the new static pages under `site/` with one shared
head/header/footer convention; confirm the deployed canonical URL for each
route before submitting it to the sitemap.

| Route | Job | Primary intent | Primary CTA |
| --- | --- | --- | --- |
| `/` | Explain Blanc in one scroll and direct people to the right proof. | minimal desktop browser | Download Blanc |
| `/features` | Let visitors choose the capability that matters to them. | browser features | Explore a feature |
| `/features/island` | Make the no-toolbar interface feel useful, not novel for novelty's sake. | minimal browser UI | See Blanc in action |
| `/features/ad-blocking` | Explain built-in blocking and exceptions accurately. | browser with built-in ad blocker | Download Blanc |
| `/features/private-tabs` | Clarify what Blanc private tabs protect and what they do not. | private tabs / private browsing | Open a private tab in Blanc |
| `/features/command-palette` | Sell fast navigation, commands, and switching. | browser command palette | Try Blanc |
| `/features/tab-groups` | Show calm organization for a busy session. | organize browser tabs | Keep tabs in Blanc |
| `/download` | Make platform choice and installation frictionless. | download browser for macOS, Windows, Linux | Download for this device |

The first release does not include a competitor-comparison page, a blog,
invented customer testimonials, or a new illustrated visual language.

## Shared shell

### Header

Use a compact, initially transparent header that becomes a white, bordered
surface after the hero. On narrow viewports it reduces to the mark, a
`features` control, and `download blanc` button.

- Mark link: `/`, accessible label `Blanc Browser home`.
- Links: `features`, `privacy`, `changelog` (only once it exists).
- Persistent action: `download blanc` → `/download`.
- Do not put the supporter or custom-build offer in primary navigation.

### Footer

Keep the present concise footer voice. Add links to Features and Download,
then Privacy, Terms, GitHub, Threads, and Instagram. Keep `zero bloat | fast
focus` as the brand sign-off.

### Page anatomy

Every page uses this rhythm:

1. Small mono eyebrow that states the category.
2. One descriptive H1.
3. A 1–2 sentence answer-first introduction.
4. A real product visual or interaction capture.
5. Three to four proof sections, each with a plain-language heading.
6. An honest "good to know" disclosure where the feature has meaningful
   limits.
7. Download call to action, followed by related feature links.

The screenshot/art direction below is a capture list, not a license to use
placeholder panels or CSS-drawn product facsimiles. Use the running Blanc app
and the existing `site/shots/` assets as the source of record.

## Page briefs

### `/` — Home

**SEO title:** `Blanc Browser — A minimal desktop browser with built-in ad blocking`

**Description:** `Blanc is a minimal desktop browser with one floating control
surface, built-in ad and tracker blocking, private tabs, and keyboard-first
commands for macOS, Windows, and Linux.`

**Section sequence and copy direction**

1. **Hero — retain the live Island demo.**
   - Eyebrow: `zero bloat | fast focus`
   - H1: `The browser that gets out of your way.`
   - Body: `Blanc is a minimal desktop browser with one small control surface,
     built-in ad and tracker blocking, private tabs, and slash commands.`
   - CTA: `download blanc`; beneath it: `free · macos · windows · linux`.
   - Keep the current rotating demo states; do not add a separate hero image.
2. **Proof rail.** `one island · built-in blocking · private tabs · keyboard
   first` with each item linking to its feature page.
3. **Section: `The web gets the room.`**
   - Copy: `No permanent tab strip. No toolbar taking a bite out of every page.
     Blanc keeps one quiet Island close when you need it and out of the way when
     you don't.`
   - Visual: resting Island over an existing real-page capture.
   - Link: `meet the Island`.
4. **Section: `Block the noise before it becomes a habit.`**
   - Copy: `Blanc blocks ads and known trackers with built-in lists, so you do
     not need to begin with an extension. The shield on the Island shows what
     was stopped on the page.`
   - Visual: a capture with a non-zero shield count and the site-exception
     command visible.
   - Link: `how blocking works`.
5. **Section: `Leave a private tab out of the record.`**
   - Copy: `Private tabs stay out of Blanc history, session restore, and
     reopen-closed. When you are finished, close the private chip and move on.`
   - Disclosure link: `what private tabs do — and do not — do`.
   - Visual: genuine private Island state with dashed outline and hollow dots.
6. **Section: `Find the tab. Run the command. Keep moving.`**
   - Copy: `Press Command or Control L to search open tabs, favorites, history,
     and named groups—or type / to run a browser command.`
   - Visual: command palette in a real populated state.
   - Links: `command palette` and `tab groups`.
7. **FAQ.** Use visible, crawlable answers:
   - `Is Blanc free?` — Yes; supporter purchase is optional and cosmetic.
   - `Does Blanc block ads?` — It includes ad and tracker blocking with a
     per-site exception; blocking is not guaranteed to remove every ad.
   - `What do private tabs do?` — State the precise history/session rule and
     link to the privacy page.
   - `Which systems does Blanc support?` — macOS, Windows, Linux; link Download.
8. **Close.** H2: `A browser with less in the way.` CTA: `download blanc`.

### `/features` — Feature hub

**SEO title:** `Blanc Browser Features — Minimal browsing, built in`

**Description:** `Explore the Blanc Island, built-in ad and tracker blocking,
private tabs, command palette, and tab groups in a minimal desktop browser.`

**Hero copy**

- Eyebrow: `the browser, reduced`
- H1: `Less browser. More of what you opened it for.`
- Body: `Blanc keeps the everyday browser tools close without building a
  dashboard around them.`

Follow with five full-width feature rows—not a generic card grid. Each row has
a real capture, a one-sentence outcome, and a text link. Order them Island,
blocking, private tabs, command palette, then tab groups. End with the Download
CTA and a small privacy link.

### `/features/island` — Blanc Island

**SEO title:** `A Minimal Browser UI That Stays Out of Your Way | Blanc`

**Description:** `Blanc replaces a traditional tab strip and toolbar with one
floating Island for tabs, navigation, blocking status, and page actions.`

**Hero copy**

- Eyebrow: `the blanc island`
- H1: `One small Island. The whole browser.`
- Body: `Tabs, navigation, the current site, and page controls live together—so
  the page stays in front.`

**Proof sections:** `See the page, not the chrome`; `Open your whole session in
one place`; `Controls when you need them, silence when you don't`. Use an
annotated sequence of real resting, expanded, and palette states. Explain dots,
domain, shield count, and the private chip in captions rather than decorative
callouts.

**Close CTA:** `see the rest of Blanc` → `/features` and `download blanc`.

### `/features/ad-blocking` — Built-in ad and tracker blocking

**SEO title:** `Built-in Ad and Tracker Blocking Browser | Blanc`

**Description:** `Blanc includes ad and tracker blocking in the browser, with a
live shield count and a per-site option when you want to allow ads.`

**Hero copy**

- Eyebrow: `built in`
- H1: `Fewer ads. Less tracking. No extension required.`
- Body: `Blanc uses built-in blocking lists to stop ads and known trackers at
  the browser level. The shield shows what was blocked on the page.`

**Proof sections:** `The blocker is part of the browser`; `See what changed on
this page`; `Let trusted sites through when you choose`. The last section shows
`/allow-ads` and explains that an exception is per site. Add a short factual
note naming EasyList and EasyPrivacy and linking to the privacy policy's
network-activity explanation.

**Good-to-know disclosure:** `Content blockers cannot promise to remove every
advertisement or tracker. Some sites may need an exception to work as intended.`

### `/features/private-tabs` — Private tabs

**SEO title:** `Private Tabs That Stay Out of Your History | Blanc Browser`

**Description:** `Open a Blanc private tab to keep pages out of browsing
history, session restore, and reopen-closed—then close the private tab when you
are done.`

**Hero copy**

- Eyebrow: `a clean trail`
- H1: `Private tabs that stay out of the record.`
- Body: `Pages opened in a private tab are not written to Blanc history and are
  not restored when you reopen the browser.`

**Proof sections:** `A private tab looks different`; `Nothing to reopen later`;
`One action to end the private session`. Use an authentic private Island capture
and private new-tab state.

**Mandatory disclosure, visibly on page:** `Private tabs keep activity out of
Blanc's local history and session restore. They do not create a separate web
identity: cookies and site storage are shared with regular tabs, and websites,
your network, or an employer may still observe activity.` Link to Privacy.

### `/features/command-palette` — Commands and Quick Switcher

**SEO title:** `Browser Command Palette and Quick Tab Switcher | Blanc`

**Description:** `Use Command or Control L in Blanc to switch tabs, search
history and favorites, open groups, or run slash commands without leaving the
page.`

**Hero copy**

- Eyebrow: `keyboard first`
- H1: `One shortcut to move through your whole session.`
- Body: `Press Command or Control L to jump to a tab, favorite, history item,
  or group. Type / when you want to run a browser command instead.`

**Proof sections:** `A few letters finds the right tab`; `Commands without a
settings hunt`; `The page never moves to make room`. Show populated switcher,
`/group work`, `/private`, `/find`, and `/allow-ads` states. Include a compact,
visible shortcut list; do not publish an exhaustive command table here.

### `/features/tab-groups` — Tab groups

**SEO title:** `Organize Browser Tabs with Named Tab Groups | Blanc`

**Description:** `Group Blanc tabs by name, keep the active group on the
Island, and switch between a quiet focused view and the rest of your session.`

**Hero copy**

- Eyebrow: `a little order`
- H1: `Keep the tabs you need. Tuck away the rest.`
- Body: `Name a group for the task in front of you. Blanc keeps that group on
  the Island and leaves the rest close, not constantly visible.`

**Proof sections:** `Groups have names, not colors`; `The active task stays on
the Island`; `Pins belong with their group`. Use a real grouped session with at
least two groups and an expanded panel. Explain `/group work`, `/ungroup`, and
the Quick Switcher in copy.

### `/download` — Download Blanc

**SEO title:** `Download Blanc Browser for macOS, Windows, and Linux`

**Description:** `Download the free Blanc desktop browser for macOS, Windows,
or Linux. Built-in ad and tracker blocking, private tabs, and a minimal Island
interface.`

**Hero copy**

- Eyebrow: `get blanc`
- H1: `Ready for a browser with less in the way?`
- Body: `Choose your desktop. Blanc is free, and installed builds keep
  themselves up to date.`

Provide three real installer actions, ordered with the detected platform first:
`download for macos`, `download for windows`, `download for linux`. Each button
uses the existing release-asset resolver with the GitHub Releases fallback.

Below the buttons, state the correct artifact and installation expectation:

- macOS: signed and notarized dmg/zip for Apple silicon and Intel where released.
- Windows: NSIS installer; show the publisher/signing note only if it is current.
- Linux: AppImage.

End with `What comes with Blanc` (one Island, built-in blocking, private tabs,
commands) and links to Privacy, GitHub releases, and support email. Do not
claim that an installer click equals a completed installation.

## Capture and social-asset list

Produce these before page assembly, at desktop and mobile crops where noted:

1. Resting Island over a real page with tab dots, domain, and non-zero shield.
2. Expanded tab switcher with real titles, favicons, and grouped tabs.
3. Slash-command state showing `/allow-ads` or `/group work`.
4. Private Island and private new-tab state.
5. Grouped session with an active named group plus a folded secondary group.
6. Platform-neutral Download social image, plus one 1200×630 Open Graph image
   for each feature page that pairs its exact feature state with the page title.

Use descriptive alt text that tells a non-visual visitor what the capture
proves, for example: `Blanc's floating Island over a web page, showing three
tabs and a shield count of two blocked items.` Empty alt text is appropriate
only for decorative marks.

## SEO, trust, and measurement requirements

- Put the page's exact topic in the title, H1, first paragraph, hero visual alt
  text where appropriate, and one internal-link anchor—without repeating it
  mechanically.
- Each new canonical page gets a unique description, Open Graph title,
  description, image, and `og:url`.
- Add `BreadcrumbList` markup only when the corresponding breadcrumb is visible.
  Retain truthful Organization, WebSite, and SoftwareApplication markup; do not
  invent an aggregate rating or review.
- Add every launch URL, and only those canonical URLs, to `sitemap.xml`; update
  its `lastmod` when the page materially changes.
- Preserve the opt-in analytics policy. Once GA has loaded, emit
  `download_click` with `platform`, `source_page`, and `cta_position`; also emit
  `feature_cta_click`, `supporter_click`, and `custom_build_contact_click`.
- Validate in the deployed environment: canonical and Open Graph URLs,
  extensionless route resolution, mobile navigation, keyboard focus states,
  no layout shift from captures, sitemap parse, structured-data validity, and
  consent-gated events.

## Build order

1. Establish the reusable static shell, route convention, metadata helper, and
   responsive feature-page layout with the existing tokens.
2. Capture the real product states and make the feature-specific social images.
3. Build the new Download page and upgrade Home, preserving the live demo.
4. Publish Features and the five feature pages with complete copy, visible
   disclosures, and contextual internal links.
5. Expand the sitemap, deploy, inspect every route in Search Console, and use
   the first month of impressions/CTR/download-click data to prioritize guides
   and comparison content.

## Definition of done

- Every page above is reachable through header, footer, and contextual links.
- No claim about privacy, blocking, platform support, or updates exceeds the
  product truth stated in this brief.
- Each page contains a unique real capture, one clear primary CTA, and a
  related-feature path.
- Installer buttons resolve to the appropriate current release asset with the
  existing GitHub Releases fallback.
- All new pages are canonicalized, indexed in the sitemap, and validated after
  deployment without consent bypass or console errors.
