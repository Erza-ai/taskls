# Migration Plan: Neo-Brutalism → shadcn-svelte

## Overview

Migrate `taskls-erza` from custom neo-brutalist design to **shadcn-svelte** components while preserving all existing functionality (employee form, task input, Discord webhook, live status board).

---

## Phase 1 — Initialize shadcn-svelte

| Step | Command / Action |
|------|-----------------|
| 1.1 | `bun x shadcn-svelte@latest init` |
| 1.2 | Answer prompts: CSS at `src/routes/layout.css`, base color `slate`, aliases `$lib/components/ui` |
| 1.3 | Generates: `components.json`, `src/lib/utils.ts`, `src/lib/components/ui/` folder, CSS variables in `layout.css` |
| 1.4 | `bun install` to resolve new deps |

## Phase 2 — Install Required Components

```
bun x shadcn-svelte@latest add button
bun x shadcn-svelte@latest add card
bun x shadcn-svelte@latest add input
bun x shadcn-svelte@latest add textarea
bun x shadcn-svelte@latest add badge
bun x shadcn-svelte@latest add progress
bun x shadcn-svelte@latest add radio-group
bun x shadcn-svelte@latest add label
bun x shadcn-svelte@latest add command
bun x shadcn-svelte@latest add popover
bun x shadcn-svelte@latest add alert
bun x shadcn-svelte@latest add separator
```

## Phase 3 — Strip Neo-Brutalist Styles

Remove from `layout.css`:
- Custom `@theme` block (brand colours)
- `.neo-border`, `.neo-shadow`, `.neo-shadow-lg`, `.neo-shadow-sm`, `.neo-btn` classes
- `body` and `h1-h6` font-family overrides
- Keep `@import "tailwindcss"` and shadcn CSS variables

Add custom accent colours that match original brand if desired.

## Phase 4 — Component Map

| Current (neo-brutalist) | Replace With |
|---|---|
| Header yellow card | `<Card>` with `<CardHeader>` / `<CardTitle>` |
| Progress bar div | `<Progress value={percentProgress} />` |
| Discord banners | `<Alert>` with custom variant styling |
| Employee dropdown | `<Popover.Root>` + `<Command.Root>` (Combobox pattern) |
| Task textarea | `<Textarea />` |
| Status radio buttons | `<RadioGroup.Root>` + `<RadioGroup.Item>` |
| Add/Remove buttons | `<Button variant="outline/ghost">` |
| Submit button | `<Button size="lg" class="w-full">` |
| Employee cards | `<Card>` + `<Badge>` for status tags |
| Not-submitted skeleton | `<Card class="border-dashed">` |
| Footer | `<Separator />` + text |

## Phase 5 — File Changes

| File | Action |
|---|---|
| `components.json` | Create (shadcn init) |
| `src/lib/utils.ts` | Create (shadcn init — `cn()` helper) |
| `src/lib/components/ui/**/*` | Create (via CLI `add`) |
| `src/routes/layout.css` | Rewrite — shadcn theme |
| `src/routes/+page.svelte` | Major rewrite — shadcn components |
| `src/routes/+page.server.ts` | No changes |
| `src/lib/server/store.ts` | No changes |

## Phase 6 — Verification

- [ ] `bun run check` — 0 errors, 0 warnings
- [ ] Page loads without console errors
- [ ] Employee dropdown works (open, filter, select)
- [ ] Task add/remove works
- [ ] Status radio group works
- [ ] Git log paste parsing works
- [ ] Form submits correctly
- [ ] Progress bar updates
- [ ] Submission board shows submitted/non-submitted
- [ ] Discord webhook integration works
- [ ] Mobile responsive layout
- [ ] All `.neo-*` CSS classes removed
