# Emerald Lost Generation: Friend Portal

## Palette

Ratios below are WCAG relative-luminance contrast ratios, rounded to two decimals. Ratios identify the specified foreground/background pair; interactive labels use the same text and surface tokens unless noted. Normal text target: 4.5:1. Large text target: 3:1.

### Dark theme

| Token | Hex | Use | Contrast checked |
|---|---|---|---|
| `--page` | `#08130F` | Page background | — |
| `--surface` | `#10231B` | Cards and header | — |
| `--surface-raised` | `#173126` | Raised controls and panels | — |
| `--border` | `#315344` | Borders and separators | — |
| `--text` | `#F1F7F3` | Main text | 17.42:1 on page; 15.13:1 on surface |
| `--muted` | `#B4C8BD` | Secondary text | 10.75:1 on page; 9.34:1 on surface |
| `--emerald` | `#00A86B` | Primary button, active ownership | 5.22:1 dark text on emerald |
| `--emerald-strong` | `#007B4E` | Deep emerald state | 5.33:1 white on emerald |
| `--gold` | `#F2C14E` | Highlights, gold button | 10.47:1 dark ink on gold |
| `--gold-ink` | `#211800` | Text on gold button | 10.47:1 on gold |
| `--danger` | `#FF8D87` | Error text | 8.48:1 on page; 7.36:1 on surface |
| `--danger-bg` | `#421F20` | Error panel background | — |
| `--success` | `#8CE0AD` | Approved/open badge text | 10.47:1 on surface |
| `--focus` | `#72D9F0` | Keyboard focus ring | 11.62:1 on page |
| `--accent` | `#68B7C9` | Secondary accent, links, idea posts | 8.29:1 on page |

### Light theme

| Token | Hex | Use | Contrast checked |
|---|---|---|---|
| `--page` | `#F5FAF6` | Page background | — |
| `--surface` | `#FFFFFF` | Cards and header | — |
| `--surface-raised` | `#EAF4ED` | Raised controls and panels | — |
| `--border` | `#9BB8A5` | Borders and separators | — |
| `--text` | `#15251D` | Main text | 15.13:1 on page; 15.98:1 on surface |
| `--muted` | `#435D4E` | Secondary text | 6.82:1 on page; 7.21:1 on surface |
| `--emerald` | `#087443` | Primary button, active ownership | 5.85:1 white on emerald |
| `--emerald-strong` | `#075A35` | Deep emerald state | 8.32:1 white on emerald |
| `--gold` | `#765400` | Gold button / highlight text | 6.91:1 white on gold |
| `--gold-ink` | `#FFFFFF` | Text on gold button | 6.91:1 on gold |
| `--danger` | `#A52D2D` | Error text | 6.60:1 on page; 6.97:1 on surface |
| `--danger-bg` | `#FFF0ED` | Error panel background | — |
| `--success` | `#17663B` | Approved/open badge text | 7.00:1 on surface |
| `--focus` | `#075F79` | Keyboard focus ring | 6.81:1 on page |
| `--accent` | `#17677A` | Secondary accent, links, idea posts | 6.11:1 on page |

Type chips use individually tuned light type colors and `#171915` text in both themes; their foreground contrast stays above 4.5:1. Disabled buttons are visibly dimmed and remain labeled; focus uses a high contrast outline. Ratios are calculated using the WCAG 2.x sRGB relative-luminance method.

## Secondary accent proposal

Use sea-glass blue: `#68B7C9` in dark mode and `#17677A` in light mode. It nods to Hoenn's ocean routes and gives links, focus-adjacent ideas, and occasional informational emphasis a distinct role beside emerald and gold. Each theme-specific shade remains readable on its page background.

## Typography

Display face: Barlow Condensed, for compact Pokédex-like headings. Text face: Nunito Sans, for friendly, legible UI copy. Both fall back to `system-ui`.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Nunito+Sans:wght@400;600;700;800;900&display=swap" rel="stylesheet">
```

Scale: 12px micro labels, 14px helper/navigation, 16px body, 20px section titles, 28–40px page titles, 36–56px hero headings. Layout uses a 4px base spacing scale: 4, 8, 12, 16, 24, 32, 48px.

## Voice

Keep copy warm, brief, and specific. Buttons say what happens (“Claim this slot”, “Save team”, “Approve post”); labels use the project’s game language without making core actions cryptic. Statuses are plain and calm: “Open”, “Reserved”, “Needs review”.
