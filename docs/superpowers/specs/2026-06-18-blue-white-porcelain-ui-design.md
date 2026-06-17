# Blue-White Porcelain UI Design

## Goal

Update Bilimi's global UI from the current brown-gold palace palette to a blue-white porcelain palette that matches the existing blue-white maid desktop pet.

The selected direction is "gentle recolor": keep layout, density, workflows, and component structure stable while changing the visual language.

## Scope

- Main app shell, browser tab bar, browser stack background, and assistant sidebar.
- Floating assistant workspace, floating menu, floating seal button, and pet speech/status surfaces.
- Memorial, favorite ledger, video notes, and video note archive panels.
- Shared buttons, tabs, selected states, feedback messages, inputs, textareas, progress accents, chips, and list items.

The Bilibili webview content itself is out of scope. The webview remains a neutral browsing area.

## Visual Direction

Use porcelain white and pale blue as the dominant surfaces. Use cobalt blue for selected states, primary action surfaces, sidebar boundary controls, and progress color. Use light cyan as a secondary accent for hover, panel depth, and subtle glows.

The UI should feel aligned with the pet's white hair, blue ornaments, porcelain clothing, and light blue highlights. It should still feel like a compact desktop tool, not a decorative landing page.

## Palette

- App dark edge: `#071a33`
- Cobalt primary: `#1f63b5`
- Deep porcelain blue: `#174577`
- Mid blue: `#2d86c7`
- Light cyan accent: `#74c7df`
- Pale ice blue: `#dceeff`
- Porcelain surface: `#f7fbff`
- Warm white highlight: `#fffefd`
- Body text: `#18375f`
- Muted text: `#54749b`
- Error text: `#9b3642`
- Success text: `#2f7f6d`

## Component Treatment

### App Shell And Tabs

The main shell should move away from black and brown. The tab bar uses pale ice blue with subtle white highlights. Selected tabs use stronger porcelain blue borders and a slightly brighter white-blue fill.

Browser-stack backgrounds can remain dark enough to frame the webview, but should be deep blue rather than black.

### Assistant Sidebar

The sidebar background becomes pale blue-white. The collapsed state must not preserve a vertical rail; it uses only the floating browser/sidebar boundary control. The control should share the porcelain surface treatment, with crisp cobalt borders and legible selected or focus states.

The sidebar workspace should share the same surface treatment as floating workspaces so embedded and floating modes feel related.

### Floating Surfaces

Floating menu, assistant workspace, dialogs, prompts, and status pills use porcelain white surfaces, ice-blue borders, and soft blue shadows. Pet bubbles use the same family with compact text and no new illustrations.

Floating seal and older round button surfaces should no longer read as red wax seals. They should become blue porcelain controls unless a component is explicitly the rendered maid pet.

### Panels

Memorial, favorite ledger, video notes, and archive panels use the same porcelain surface and pale blue inset cards. Section dividers, list items, and input borders switch to low-opacity blue. Selected rows and active tabs use cobalt blue with light text.

### Feedback States

Success keeps a green-blue tone. Error keeps a restrained red tone so it remains legible and semantically distinct from the blue theme.

## Testing

Add a focused renderer style regression test that reads `styles.css` and verifies the old brown-gold palette tokens are no longer present in global UI styles. This is intentionally narrow because the implementation is CSS-only and existing component tests already cover rendering behavior.

After implementation, run:

- `npm test`
- `npm run build`

## Non-Goals

- No layout redesign.
- No new pet assets.
- No heavy blue-and-white pattern background.
- No new navigation or assistant features.
- No changes to Bilibili automation behavior.
- No visual changes inside the Bilibili webview.
