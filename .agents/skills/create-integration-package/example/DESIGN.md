Fedify example design system
============================

Visual theme & atmosphere
-------------------------

Clean, functional, and developer-friendly.  The aesthetic is minimal and
modern: a neutral canvas with a single bold gradient accent for profile
sections.  The overall feel is “documentation site meets social app” —-
sparse enough to read comfortably, colorful enough to feel alive.

Dark and light themes are mandatory.  The system detects
`prefers-color-scheme` and switches automatically; there is no manual
toggle.

**Key Characteristics:**

 -  Neutral canvas that inverts cleanly between light and dark
 -  Single gradient accent (purple) reserved for the profile header and
    primary actions
 -  Card-based content layout with subtle shadows
 -  Monospace typesetting for handles and federation addresses
 -  No framework-specific branding in UI chrome —- only the demo profile
    and Fedify logo


Color palette & roles
---------------------

### Surface & background

Two CSS custom properties control the entire theme inversion.
`--background` is `#ffffff` in light mode and `#0a0a0a` in dark mode.
`--foreground` is `#171717` in light mode and `#ededed` in dark mode.
All other surface colors derive from these two tokens through `rgba()`
or `color-mix()`.

### Accent & brand

Link text and input focus rings use `#3b82f6`.  The focus ring shadow is
`rgba(59, 130, 246, 0.3)`.  The profile gradient is
`linear-gradient(135deg, #667eea, #764ba2)` and applies exclusively to
the profile header background and the primary action button.

### Neutral & semantic

Handle badges and follower items use `#f3f4f6` background with `#000`
text.  Card borders use `rgba(0, 0, 0, 0.05)` for subtle dividers and
`rgba(0, 0, 0, 0.1)` for post cards and forms.  Textarea borders are
`rgba(0, 0, 0, 0.2)`.  Post avatar rings are `#e5e7eb`.  Text on
gradient backgrounds is always `white`.

### Shadow system

Four elevation levels.  Elevation 1 (`0 2px 8px rgba(0,0,0,0.05)`) for
post cards and forms.  Elevation 2 (`0 4px 20px rgba(0,0,0,0.08)`) for
info cards and detail cards.  Elevation 3
(`0 8px 32px rgba(0,0,0,0.1)`) for the profile header.  Hover lift
(`0 8px 24px rgba(0,0,0,0.1)`) for card hover states.


Typography rules
----------------

### Font family

Body text uses the system font stack:
`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif`.
No custom fonts or font loading.  Monospace (`monospace`) is reserved for
federation handles and follower addresses.

### Hierarchy

Base font size is `16px`.  Line height for readable content is `1.625`.

 -  **User name** (profile header): `2.25rem`, weight `700`
 -  **Section title** (card headings, posts title): `1.5rem`,
    weight `600`—`700`
 -  **User handle** (profile header): `1.25rem`, weight `500`
 -  **Body large** (bio, post detail content): `1.125rem`, weight `400`,
    line-height `1.625`
 -  **Body** (post content, forms): `1rem`, weight `400`,
    line-height `1.625`
 -  **Label** (info labels, metadata, timestamps): `0.875rem`,
    weight `600`

### Principles

Weight `600`—`700` for headings; `400`—`500` for body and subtext.
Opacity (`0.6`—`0.9`) creates text hierarchy on gradient backgrounds
instead of color changes.


Component stylings
------------------

### Profile header

Background is the profile gradient.  Text is `white`.  Padding `2rem`,
gap `2rem` between avatar and info.  Border radius `1rem`.  Shadow is
elevation 3.  Layout is `flex row`, collapsing to `column` on mobile.

### Avatar

Profile header avatar is `7.5rem` square, `border-radius: 50%`, with a
`4px solid rgba(255,255,255,0.2)` border.  Post card avatars are `3rem`
with a `2px solid #e5e7eb` border.  Post detail avatars are `4rem` with
the same border.

### Cards

Background is `var(--background)`.  Border is
`1px solid rgba(0,0,0,0.1)`.  Border radius is `0.75rem`.  Shadow is
elevation 1 or 2 depending on context.  Post cards gain
`translateY(-2px)` and hover-lift shadow on hover.  Transitions are
`transform 0.2s, box-shadow 0.2s`.

### Search input

Full-width text input with `border-radius: 0.5rem` and
`padding: 0.75rem`.  Border is `1px solid rgba(0,0,0,0.2)`.  On focus
the border becomes `#3b82f6` with a `0 0 0 2px` focus ring shadow.
Placeholder text reads “Search by handle (e.g. @user@example.com)”.

### Search result

Inline card below the search input.  Shows a row with the target's
avatar (`3rem`, rounded), display name, handle (monospace badge), and an
action button (follow or unfollow depending on current state).  Appears
only when a result is available; hidden otherwise.

### Compose form

Textarea is full width with `border-radius: 0.5rem` and
`padding: 0.75rem`.  On focus the border becomes `#3b82f6` with a
`0 0 0 2px` focus ring shadow.  Font inherits body font family.  Resize
is vertical only.  A submit button sits below the textarea, right-aligned.

### Buttons (primary)

Background is the profile gradient.  Text is `white`.
Padding `0.5rem 1.5rem`.  Border radius `0.5rem`.  Font weight `600`.
On hover the button lifts `translateY(-1px)` and the shadow intensifies.
Transition matches cards.

### Buttons (danger)

Used for unfollow actions.  Background is `#ef4444`.  Text is `white`.
Same padding, radius, weight, and hover behavior as primary buttons.

### Back link

Background is `color-mix(in srgb, var(--foreground) 10%, transparent)`.
Padding `0.5rem 1rem`.  Border radius `0.5rem`.  Hover increases the
foreground mix to 15%.

### Fedify badge

Background `#7dd3fc`, text `white`, height `1.5rem`,
border radius `0.375rem`.  A `::before` pseudo-element renders a 16x16
Fedify logo icon.


Layout principles
-----------------

### Spacing

Base unit is `1rem` (16px).  Common spacing values are `0.25rem`,
`0.5rem`, `0.75rem`, `1rem`, `1.5rem`, and `2rem`.  Section gaps range
from `1.5rem` to `2rem`.

### Containers

Profile, posts, and post detail containers max out at `56rem` with
`2rem` padding.  The home page container maxes at `780px` with `1rem`
padding.  Profile container stretches to `min-height: 100vh`.

### Grid

All grids are single-column.  Post grid gap is `1.5rem`.  Info grid gap
is `1rem`.  Home grid gap is `1rem`.  Profile content grid gap is `2rem`.

### Whitespace

Generous vertical breathing room between sections.  Card internal
padding is `1.5rem`—`2rem`.  Dividers are bottom borders on list items
(`1px solid rgba(0,0,0,0.05)`); the last item has no border.


Responsive behavior
-------------------

Single breakpoint at `768px`.

Below the breakpoint:

 -  Profile header switches to `flex-direction: column`,
    `align-items: center`, `text-align: center`
 -  User name shrinks from `2.25rem` to `1.875rem`
 -  Container padding reduces from `2rem` to `1rem`
 -  Post detail card padding: `2rem` to `1.5rem`
 -  Author avatar: `4rem` to `3.5rem`
 -  Author name: `1.5rem` to `1.25rem`
 -  Post detail content: `1.125rem` to `1rem`
 -  Info items stack vertically with `0.25rem` gap

No hover-dependent information.  Hover effects add visual polish only.
Tap targets meet at least `44px` effective height through padding.


Do's and don'ts
---------------

### Do

 -  Use CSS custom properties (`--background`, `--foreground`) for
    theme-dependent values.
 -  Detect theme via `prefers-color-scheme`; apply class (`light`/`dark`)
    on `<body>` at runtime.
 -  Keep all layout in a single static CSS file under *public/*.
 -  Use `rgba()` or `color-mix()` for transparent overlays rather than
    hard-coded gray values.
 -  Render handles and federation addresses in monospace with a light gray
    badge background.
 -  Provide *demo-profile.png* and *fedify-logo.svg* in *public/*.
 -  Maintain the gradient accent exclusively for profile headers and
    primary action buttons.

### Don't

 -  Don't add a CSS framework (Tailwind, Bootstrap).  The example must
    stay dependency-free on the styling side so that any framework
    integration can adopt it.
 -  Don't introduce custom fonts or font loading.
 -  Don't use JavaScript for layout or styling beyond the dark-mode class
    toggle.
 -  Don't create multiple themes or color schemes beyond light/dark.
 -  Don't use the gradient accent on secondary elements (back links, info
    cards, text).
 -  Don't add animations beyond the card hover lift and button press
    feedback.


Static assets
-------------

All visual assets live in *public/* and are served at the site root:

 -  *style.css* —- Complete stylesheet
 -  *theme.js* —- Dark/light class toggle script
 -  *demo-profile.png* —- Demo actor avatar
 -  *fedify-logo.svg* —- Fedify logo for badge and branding

### Following / followers list

Each list is a vertical stack of rows.  Each row contains an avatar
(`3rem`, rounded), display name, and handle (monospace badge).  Following
rows additionally include an unfollow button (danger style).  A count
label sits above each list (e.g. “Following (3)”).  When the list is
empty, show a single line of muted text.  Both lists update in real time
via SSE without page reload.


Page structure
--------------

Every example must implement these pages.  See *ARCHITECTURE.md* for the
full routing specification.

### Home (`/`)

Top to bottom:

1.  **Search** —- text input with debounced lookup; result card appears
    inline below
2.  **User info** —- profile header (gradient, avatar, name, handle,
    bio)
3.  **Following** —- count + account list with unfollow buttons
4.  **Followers** —- count + account list
5.  **Compose** —- textarea + submit button
6.  **Posts** —- reverse-chronological post cards, each linking to the
    detail page

### Actor profile (`/users/{identifier}`)

Profile header (gradient, avatar, name, handle, bio) followed by
following count and followers count.  Content-negotiated: serves HTML to
browsers and ActivityPub JSON to federation peers.

### Post detail (`/users/{identifier}/posts/{id}`)

Back link to home, then author profile section (same layout as the actor
profile page), then the post content and a formatted timestamp.
Content-negotiated like the actor profile.
