# HitchAgent Client Portal — Design System

This file is the **single reference for all visual decisions** in the client
portal. Any time HTML is generated for a portal route, every color, font, spacing,
and component decision derives from this file. It pairs with the portal sections
of [`CLAUDE.md`](CLAUDE.md).

Aesthetic: **Vanta + Rippling** — a dark header over a warm off-white body, clean
data density, generous whitespace, no decorative elements. The content is the design.

---

## Color System

```
/* Backgrounds */
--bg-primary:     #f1eee6   Warm off-white — page background
--bg-surface:     #ffffff   Card and panel backgrounds
--bg-surface-alt: #f7f5f0   Subtle alternating sections, submitted state blocks

/* Brand */
--header-bg:      #1a3a2e   Dark green — sticky header (Vanta signature move)
--brand-dark:     #1a3a2e   Primary brand color — headings, CTA backgrounds
--brand-accent:   #2db87a   Teal — active states, eyebrows, accents, links

/* Text */
--text-primary:   #1a1a1a   Near-black body copy
--text-secondary: #5a6370   Muted labels, metadata, helper text
--text-on-dark:   #ffffff   Text on dark header and brand-dark surfaces

/* Borders */
--border:         #e2ddd5   Standard card and section borders
--border-subtle:  #ece9e1   Intra-card dividers, fact separators

/* Verdict — feedback UI */
--verdict-yes:          #2db87a    --verdict-yes-bg:       #e8f8f1
--verdict-soft-yes:     #5ab88a    --verdict-soft-yes-bg:  #eef7f3
--verdict-soft-no:      #d4874a    --verdict-soft-no-bg:   #fdf0e6
--verdict-no:           #c94f4f    --verdict-no-bg:        #fdf0f0
```

---

## Typography

Load these Google Fonts in every portal HTML page:

```html
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

Usage rules:

```
Cormorant Garamond — Page-level headings, company names, candidate names,
                     role narrative (the editorial voice of the portal)
DM Sans            — All body copy, navigation labels, form elements,
                     bullet points, candidate titles, button text
IBM Plex Mono      — Eyebrow labels, Quick Facts data values, timestamps,
                     metadata tags, count badges, confidentiality text
```

---

## Type Scale

```
Display:     Cormorant Garamond 42px / weight 600 / line-height 1.1
             Used for: company name on Overview tab

Heading 1:   Cormorant Garamond 28px / weight 600 / line-height 1.2
             Used for: onboarding overlay headline

Heading 2:   Cormorant Garamond 22px / weight 500 / line-height 1.4
             Used for: role narrative (italic variant)

Heading 3:   Cormorant Garamond 18px / weight 500 / line-height 1.4
             Used for: candidate names, company names in cards

Body Large:  DM Sans 16px / weight 300 / line-height 1.75
             Used for: company overview narrative paragraphs

Body:        DM Sans 15px / weight 400 / line-height 1.65
             Used for: mandate bullets, general body copy

Body Small:  DM Sans 14px / weight 400 / line-height 1.6
             Used for: candidate titles, form labels, supporting copy

Caption:     DM Sans 13px / weight 400 / line-height 1.5
             Used for: helper text, secondary metadata

Eyebrow:     IBM Plex Mono 11px / weight 400 / letter-spacing 0.12em
             text-transform: uppercase / color: var(--brand-accent)
             Used for: ALL section labels throughout the portal

Data:        IBM Plex Mono 16px / weight 500
             Used for: Tier 1 Quick Facts values (funding, headcount, structure)

Meta:        IBM Plex Mono 12px / weight 400
             Used for: city tags, employee count, timestamps, secondary data
```

---

## Spacing

```
Page padding:        48px 32px (desktop) / 24px 16px (mobile)
Section gap:         56px between major sections on Overview tab
Card padding:        24px (standard) / 28px (meeting cards)
Card gap:            12px between stacked cards
Grid gap:            48px (two-column layouts) / 20px (three-card rows)
Max content width:   1100px, margin: auto
```

---

## Component Patterns

### Header

```
Position:   sticky, top: 0, z-index: 100
Height:     60px
Background: var(--header-bg) = #1a3a2e
Padding:    0 32px
Layout:     flex, justify-content: space-between, align-items: center

Left:    Client logo on rgba(255,255,255,0.12) pill
         border-radius: 6px, padding: 6px 10px, max-height: 36px
Center:  Search project name
         Cormorant Garamond 16px, color: rgba(255,255,255,0.7)
Right:   "HITCH PARTNERS" wordmark
         IBM Plex Mono 12px, letter-spacing: 0.1em, color: rgba(255,255,255,0.9)
```

The dark header (#1a3a2e) over a warm body (#f1eee6) is the Vanta signature and
must be preserved across every portal render. Never change the header to white.

### Navigation Tabs

```
Position:   sticky, top: 60px, z-index: 99
Background: var(--bg-surface)
Border:     border-bottom: 1px solid var(--border)
Height:     48px

Tab default:  DM Sans 14px 400, color: var(--text-secondary), padding: 0 24px
Tab active:   DM Sans 14px 500, color: var(--brand-dark),
              border-bottom: 2px solid var(--brand-accent)
Tab hover:    color: var(--brand-dark), transition: 150ms

Count badge:  Only shown when count > 0
              18px circle, background: var(--brand-accent), color: white
              IBM Plex Mono 11px, margin-left: 6px
```

**Four tabs in order:** Overview | Pipeline | Target Companies | My Interviews

The **Target Companies** tab is hidden entirely when zero Organization records
exist for the search.

### Card — Standard

```
background:    var(--bg-surface)
border:        1px solid var(--border)
border-radius: 8px
padding:       24px
transition:    border-color 150ms
hover:         border-color: var(--brand-accent)
```

Cards use a **border (not shadow)** for depth — Rippling aesthetic.

### Eyebrow Label

Applied to every section header, consistently:

```css
font-family: 'IBM Plex Mono', monospace;
font-size: 11px;
letter-spacing: 0.12em;
text-transform: uppercase;
color: var(--brand-accent);
margin-bottom: 12px;
display: block;
```

### Button — Primary

```
background:    var(--brand-dark)
color:         white
border:        none
border-radius: 4px
padding:       10px 28px
font-family:   DM Sans, 14px, weight 500
cursor:        pointer
hover:         background: var(--brand-accent)
transition:    background 150ms
```

### Button — Outline

```
background:    transparent
color:         var(--brand-accent)
border:        1px solid var(--brand-accent)
border-radius: 4px
padding:       8px 18px
font-family:   DM Sans, 13px, weight 500
hover:         background: var(--brand-accent), color: white
transition:    all 150ms
```

### Verdict Pills

```
Four options: Yes | Soft Yes | Soft No | No
border-radius: 20px
padding:       8px 20px
font-family:   DM Sans 14px 400
transition:    all 150ms

Unselected:
  border: 1.5px solid [verdict-color]
  color:  [verdict-color]
  background: transparent

Unselected hover:
  background: [verdict-color-bg]

Selected:
  background:   [verdict-color]
  color:        white
  font-weight:  500
  border-width: 2px
  prefix:       ✓ [space]
```

Verdict pills use **both color AND a checkmark** for the selected state. Color
alone fails for colorblind users and reads as ambiguous before interaction.

### Initials Avatar

```
width:         52px
height:        52px
border-radius: 50%
background:    var(--brand-dark)
color:         white
font-family:   Cormorant Garamond 20px
display:       flex, align-items: center, justify-content: center
flex-shrink:   0
```

Generate initials: first letter of first name + first letter of last name, uppercase.

### Empty State

Every tab must have a graceful empty state — never a blank page.

```
text-align:  center
padding:     80px 0

Placeholder circle:
  width: 64px, height: 64px, border-radius: 50%
  border: 2px dashed var(--border), margin: 0 auto 24px

Headline:  Cormorant Garamond 24px, color: var(--text-secondary)
Body:      DM Sans 14px, color: var(--text-secondary), max-width: 320px, margin: auto
```

---

## Mobile Breakpoints

```
< 768px:  Two-column layouts stack to single column
          Three-card rows stack to single column
          Page padding reduces to 24px 16px

< 480px:  Header client logo hidden (space constraint)
          Project name truncates with ellipsis
          Nav tabs: overflow-x: auto, no wrapping

All interactive elements: min touch target 44px height
Verdict pills: wrap to two rows if needed at narrow viewports
```

Minimum usable at **375px** viewport — magic links open from email on mobile as
often as desktop.

---

## Aesthetic Principles

1. **Dark header (#1a3a2e) over warm body (#f1eee6)** — this contrast is the Vanta
   signature and must be preserved across all portal renders.
2. **Eyebrow labels in brand-accent (#2db87a)** anchor every section — they are the
   rhythmic element that creates visual consistency across tabs.
3. **Cards use border (not shadow)** for depth — Rippling aesthetic.
4. **One accent color (teal)** used for: active states, eyebrows, CTAs, verdict-yes.
   It must not appear as decorative fill anywhere.
5. **Typography carries the personality:** Cormorant for gravitas, DM Sans for
   clarity, IBM Plex Mono for precision data.
6. **No decorative elements, no gradients, no illustrations.** The content is the design.
