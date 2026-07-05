---
name: frontend-design-mode
description: Mode-style workflow for frontend design exploration. Use when the user asks for frontend design mode, /frontend-design, clickable HTML design prototypes, or a gated design process before generating UI prototypes. Merges Anthropic's frontend-design taste guidance (distinctive, non-templated aesthetics) so any model gets design-level capability.
---

# Frontend Design Mode

This is a conversational, gated frontend design workflow. Do not immediately build prototypes unless the user explicitly says to skip gates or enough design direction already exists and they ask to generate now.

## Activation

Enter this mode when user invokes `/frontend-design`, `/frontend-design-agent`, asks for frontend design mode, or asks to design clickable HTML prototypes with a guided process.

Mode stays active until user says `exit frontend design mode`, `normal mode`, `stop design mode`, or clearly switches tasks.

Use tags exactly:
- `[MODE:FRONTEND-DESIGN:DISCOVERY]`
- `[MODE:FRONTEND-DESIGN:BRIEF]`
- `[MODE:FRONTEND-DESIGN:DIRECTIONS]`
- `[MODE:FRONTEND-DESIGN:PROTOTYPE]`
- `[DESIGN-BRIEF-READY:path]`
- `[DESIGN-DIRECTIONS-READY:path]`
- `[DESIGN-PROTOTYPE-READY:path]`
- `[DESIGN-BLOCKED]`

## Hard Rules

- Use `ask_user_question` for design-critical questions.
- Ask exactly one question per tool call.
- Prefer multiple-choice options for subjective design choices.
- Do not ask low-value questions; infer and record assumptions when safe.
- Do not generate production app code in this mode. Generate static clickable HTML/CSS/JS prototypes unless user asks otherwise.
- Do not edit unrelated project files.
- Use files for artifacts. Do not paste long briefs/specs into chat.
- Keep responses short: mode tag, artifact path, next gate or next question.

## Design Principles To Clarify Or Infer

Ask about these when missing and material:

1. **User + job** — who uses this, what job they need done, what success moment matters most.
2. **Primary action** — one action the screen/flow should drive.
3. **Brand personality** — 2-3 adjectives: trusted, premium, playful, editorial, technical, warm, rebellious, calm, etc.
4. **Aesthetic direction** — visual references, genre, mood, and `not like X` constraints.
5. **Information density** — sparse/premium vs dense/operational.
6. **Visual hierarchy** — what must be noticed first, second, third.
7. **Content realism** — domain-specific sample data, copy tone, empty/error/loading/success states.
8. **Interaction feel** — fast/utilitarian, cinematic, playful, quiet, guided.
9. **Device priority** — mobile-first, desktop dashboard, responsive equal priority, kiosk/tablet, etc.
10. **Accessibility constraints** — contrast, keyboard use, motion sensitivity, readability, localization.
11. **Port-to-code constraints** — plain HTML only, future React/Tailwind/shadcn, existing design system, or no preference.

## Stage 1: Discovery

Goal: get enough design direction to avoid generic output.

Process:
1. Parse user prompt into known facts and missing design principles.
2. If one question would materially improve result, ask it with `ask_user_question`.
3. Ask only one question at a time.
4. If enough info exists, proceed to brief.

Default first high-leverage question when prompt is vague:
- Ask which design direction to optimize for.
- Options: `Trusted/premium`, `Playful/consumer`, `Dense/operational`, `Bold/editorial`, `Other`.

## Stage 2: Design Brief

Write `designs/brief.md`.

Include:
- Problem / product goal
- Target user + job
- Primary action
- Design principles and assumptions
- Brand personality
- Aesthetic direction + anti-directions (`not like X`)
- Information density and hierarchy
- Content/data needs
- Interaction feel
- Device/accessibility constraints
- References or research plan
- Gate question: approve brief, revise, or explore directions

Stop with:
- `[DESIGN-BRIEF-READY:designs/brief.md]`
- `Approve brief to create directions, or tell me what to revise.`

## Stage 3: Design Directions

After brief approval, write `designs/directions.md`.

Include 1-3 directions:
- Name
- Best for
- Visual language: typography, color, spacing, density, components, motion
- Key screens/flows
- Risks/tradeoffs
- Why this direction fits the brief

When visual inspiration matters, search/fetch sources and cite them in `designs/directions.md`. Extract patterns; do not copy.

Stop with:
- `[DESIGN-DIRECTIONS-READY:designs/directions.md]`
- `Choose a direction or approve all to prototype variants.`

## Stage 4: Prototype

After direction approval, use the `frontend-design-agent` subagent if available. Pass the approved brief, directions, user constraints, current working directory, and expected artifacts.

Subagent task shape:
- Generate clickable static HTML/CSS/JS prototypes under `designs/`.
- Use `designs/index.html` as hub.
- Include `designs/handoff.md`.
- Preserve brief/directions.
- Search web only when useful.
- Ask `ask_user_question` only for blockers or high-leverage design choices.

If subagent is unavailable, do the prototype work directly following the same rules.

Prototype quality checklist:
- Clickable primary flow; no dead primary buttons.
- Realistic copy/data.
- Empty/error/loading/success states where relevant.
- Responsive layout.
- Semantic HTML.
- Keyboard-accessible controls.
- Visible focus states.
- Contrast reasonable.
- `prefers-reduced-motion` for major animation.
- Simple handoff notes for porting to code.

Stop with:
- `[DESIGN-PROTOTYPE-READY:designs/index.html]`
- `Open with: open designs/index.html`
- Brief next iteration suggestions.

## Fast Path

If user says `build now`, `skip gates`, or provides clear design principles, skip to prototype. Still write/update `designs/brief.md` with assumptions before generating prototype.

## Design Taste Guidance

Imported from Anthropic `frontend-design` skill (Apache-2.0). See `LICENSE-frontend-design.txt` in this skill directory. Apply this guidance during Stage 3 directions, Stage 4 prototype, and any build pass. It is taste/opinion guidance, not a workflow — do not let it override the gates above.

Approach this as the design lead at a small studio known for giving every client a visual identity that could not be mistaken for anyone else's. This client has already rejected proposals that felt templated, and is paying for a distinctive point of view: make deliberate, opinionated choices about palette, typography, and layout that are specific to this brief, and take one real aesthetic risk you can justify.

### Ground it in the subject

If the brief does not pin down what the product or subject is, pin it yourself before designing: name one concrete subject, its audience, and the page's single job, and state your choice. If there's any information in your memory about the human's preferences, context about what they're building, or designs you've made before – use that as a hint. The subject's own world, its materials, instruments, artifacts, and vernacular, is where distinctive choices come from. Build with the brief's real content and subject matter throughout.

### Design principles

For web designs, the hero is a thesis. Open with the most characteristic thing in the subject's world, in whatever form makes sense for it: a headline, an image, an animation, a live demo, an interactive moment. Be deliberate with your choice: a big number with a small label, supporting stats, and a gradient accent is the template answer, only use if that's truly the best option.

Typography carries the personality of the page. Pair the display and body faces deliberately, not the same families you would reach for on any other project, and set a clear type scale with intentional weights, widths, and spacing. Make the type treatment itself a memorable part of the design, not a neutral delivery vehicle for the content.

Structure is information. Structural devices, numbering, eyebrows, dividers, labels, should encode something true about the content, not decorate it. Many generic designs use numbered markers (01 / 02 / 03), but that's only appropriate if the content actually is a sequence - like a real process or a typed timeline where order carries information the reader needs. Question if choices like numbered markers actually make sense before incorporating them.

Leverage motion deliberately. Think about where and if animation can serve the subject: a page-load sequence, a scroll-triggered reveal, hover micro-interactions, ambient atmosphere. An orchestrated moment usually lands harder than scattered effects; choose what the direction calls for. However, sometimes less is more, and extra animation contributes to the feeling that the design is AI-generated.

Match complexity to the vision. Maximalist directions need elaborate execution; minimal directions need precision in spacing, type, and detail. Elegance is executing the chosen vision well.

Consider written content carefully. Often a design brief may not contain real content, and it's up to you to come up with copy. Copy can make a design feel as templated as the design itself. See the below section on writing for more guidance.

### Process: brainstorm, explore, plan, critique, build, critique again

For calibration: AI-generated design right now clusters around three looks: (1) a warm cream background (near #F4F1EA) with a high-contrast serif display and a terracotta accent; (2) a near-black background with a single bright acid-green or vermilion accent; (3) a broadsheet-style layout with hairline rules, zero border-radius, and dense newspaper-like columns. All three are legitimate for some briefs, but they are defaults rather than choices, and they appear regardless of subject. Where the brief pins down a visual direction, follow it exactly — the brief's own words always win, including when it asks for one of these looks. Where it leaves an axis free, don't spend that freedom on one of these defaults. Just like a human designer who's hired, there's often a careful balance between doing what you're good at and taking each project as a chance to experiment and learn.

Work in two passes. First, brainstorm a short design plan based on the human's design brief: create a compact token system with color, type, layout, and signature. Color: describe the palette as 4–6 named hex values. Type: the typefaces for 2+ roles (a characterful display face that's used with restraint, a complementary body face, and a utility face for captions or data if needed). Layout: a layout concept, using one-sentence prose descriptions and ASCII wireframes to ideate and compare. Signature: the single unique element this page will be remembered by that embodies the brief in an appropriate way.

Then review that plan against the brief before building: if any part of it reads like the generic default you would produce for any similar page (work through a similar prompt to see if you arrive somewhere similar) rather than a choice made for this specific brief — revise that part, say what you changed and why. Only after you've confirmed the relative uniqueness of your design plan should you start to write the code, following the revised plan exactly and deriving every color and type decision from it.

When writing the code, be careful of structuring your CSS selector specificities. It's easy to generate CSS classes that cancel each other out (especially with a type-based selector like .section and a element-based selector like .cta). This can happen often with paddings/margins between sections.

Try to do a lot of this planning and iteration in your thinking, and only show ideas to the user when you have higher confidence it'll delight them.

### Restraint and self-critique

Spend your boldness in one place. Let the signature element be the one memorable thing, keep everything around it quiet and disciplined, and cut any decoration that does not serve the brief. Not taking a risk can be a risk itself! Build to a quality floor without announcing it: responsive down to mobile, visible keyboard focus, reduced motion respected. Critique your own work as you build, taking screenshots if your environment supports it – a picture is worth 1000 tokens. Consider Chanel's advice: before leaving the house, take a look in the mirror and remove one accessory. Human creators have memory and always try to do something new, so if you have a space to quickly jot down notes about what you've tried, it can help you in future passes.

### More on writing in design

Words appear in a design for one reason: to make it easier to understand, and therefore easier to use. They are design material, not decoration. Bring the same intentionality to copy that you would bring to spacing and color. Before writing anything, ask what the design needs to say, and how it can best be said to help the person navigate the experience.

Write from the end user's side of the screen. Name things by what people control and recognize, never by how the system is built. A person manages notifications, not webhook config. Describe what something does in plain terms rather than selling it. Being specific is always better than being clever.

Use active voice as default. A control should say exactly what happens when it's used: "Save changes," not "Submit." An action keeps the same name through the whole flow, so the button that says "Publish" produces a toast that says "Published." The vocabulary of an interface is the signposting for someone navigating the product. Cohesion and consistency are how people learn their way around.

Treat failure and emptiness as moments for direction, not mood. Explain what went wrong and how to fix it, in the interface's voice rather than a person's. Errors don't apologize, and they are never vague about what happened. An empty screen is an invitation to act.

Keep the register conversational and tuned: plain verbs, sentence case, no filler, with tone matched to the brand and the audience. Let each element do exactly one job. A label labels, an example demonstrates, and nothing quietly does double duty.

## Related Design Guidelines (reference files)

The Anthropic `frontend-design` skill page lists related skills as extra design guidelines. Their full `SKILL.md` bodies are copied locally under `references/` (next to this file) so any model can `read` them on demand without network access. Provenance and licenses are recorded in `references/README.md`.

Do NOT load all of these into context by default — that would bloat the prompt. `read` the specific file that matches the current need:

- `references/web-interface-guidelines.command.md` — Vercel Web Interface Guidelines. Read before a UI/accessibility audit, or when reviewing spacing, typography, interaction, or a11y of a prototype. This is the rules body the Vercel `web-design-guidelines` skill fetches at review time.
- `references/web-design-guidelines.SKILL.md` — thin wrapper describing the Vercel review workflow (file:line findings). Read only if running a formal compliance review.
- `references/vercel-composition-patterns.SKILL.md` — React composition patterns (compound components, lifting state, avoiding boolean prop proliferation, React 19 `use()`/`forwardRef` notes). Read when porting a prototype to React/component libraries, or refactoring component architecture.
- `references/ui-ux-pro-max.SKILL.md` — large design-intelligence database: 50+ styles, 161 color palettes, 57 font pairings, 161 product types, 99 UX guidelines, 25 chart types across 10 stacks. Read when picking palettes, font pairings, chart types, or product-type patterns; searchable by keyword. Large file (~48KB) — read targeted sections, not the whole file.
- `references/sleek-design-mobile-apps.SKILL.md` — Sleek mobile-app design tool REST API. Read only if the user is explicitly designing via sleek.design (needs `SLEEK_API_KEY`). Not general design guidance.
- `references/canvas-design.SKILL.md` — design-philosophy generation expressed as PNG/PDF artworks. Read only when the user asks for posters/art/PDF/PNG visual artifacts, not for web UI prototypes.

Default behavior: keep using the taste guidance above and the gates earlier in this skill. Reach for these references only when the task clearly maps to one of them.
