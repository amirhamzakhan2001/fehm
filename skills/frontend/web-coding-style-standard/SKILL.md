---
name: web-coding-style-standard
description: Web Coding Style. Use this standard for web coding style standard.
category: frontend
sources:
- repository: ecc
  original_path: rules/web/coding-style.md
  sha256: a1ff88858d73c943ebd2145b7aff40b1adabbc3a083529eeae888acb7aa79863
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

> This file extends [common/coding-style.md](../../core/common-coding-style-standard/SKILL.md) with web-specific frontend content.

# Web Coding Style

## File Organization

Organize by feature or surface area, not by file type:

```text
src/
├── components/
│   ├── hero/
│   │   ├── Hero.tsx
│   │   ├── HeroVisual.tsx
│   │   └── hero.css
│   ├── scrolly-section/
│   │   ├── ScrollySection.tsx
│   │   ├── StickyVisual.tsx
│   │   └── scrolly.css
│   └── ui/
│       ├── Button.tsx
│       ├── SurfaceCard.tsx
│       └── AnimatedText.tsx
├── hooks/
│   ├── useReducedMotion.ts
│   └── useScrollProgress.ts
├── lib/
│   ├── animation.ts
│   └── color.ts
└── styles/
    ├── tokens.css
    ├── typography.css
    └── global.css
```

## CSS Custom Properties

Define design tokens as variables. Do not hardcode palette, typography, or spacing repeatedly:

```css
:root {
  --color-surface: oklch(98% 0 0);
  --color-text: oklch(18% 0 0);
  --color-accent: oklch(68% 0.21 250);

  --text-base: clamp(1rem, 0.92rem + 0.4vw, 1.125rem);
  --text-hero: clamp(3rem, 1rem + 7vw, 8rem);

  --space-section: clamp(4rem, 3rem + 5vw, 10rem);

  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}
```

## Animation-Only Properties

Prefer compositor-friendly motion:
- `transform`
- `opacity`
- `clip-path`
- `filter` (sparingly)

Avoid animating layout-bound properties:
- `width`
- `height`
- `top`
- `left`
- `margin`
- `padding`
- `border`
- `font-size`

## Semantic HTML First

```html
<header>
  <nav aria-label="Main navigation">...</nav>
</header>
<main>
  <section aria-labelledby="hero-heading">
    <h1 id="hero-heading">...</h1>
  </section>
</main>
<footer>...</footer>
```

Do not reach for generic wrapper `div` stacks when a semantic element exists.

## Naming

- Components: PascalCase (`ScrollySection`, `SurfaceCard`)
- Hooks: `use` prefix (`useReducedMotion`)
- CSS classes: kebab-case or utility classes
- Animation timelines: camelCase with intent (`heroRevealTl`)

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/web/coding-style.md`
