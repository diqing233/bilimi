# Xiao Mi Pet Icons Design

## Goal

Make Bilimi feel like the blue-white chibi pet shown in the reference: the pet introduces herself as bilimi, can be called 小mi, and appears on the app icon plus the main navigation and action buttons.

## Scope

- Use existing `blue-white-maid` PNG assets instead of adding a new asset family.
- Add pet icons to prominent controls: app window icon, floating seal, sidebar collapse, workspace tabs, and four review action buttons.
- Keep dense utility buttons text-first so notes, archive, edit, copy, delete, and timestamp workflows remain compact.
- Replace palace/servant-facing copy in the pet shell and floating seal with the 小mi persona.

## Behavior

- The Electron main window uses a packaged local PNG icon.
- Key controls expose decorative pet images with empty alt text and preserve accessible labels.
- Pet state bubbles use concise 小mi status copy:
  - idle: 小mi待机
  - hint: 小mi提示
  - working: 小mi忙碌中
  - error: 小mi遇到问题
- Review actions retain their current automation actions and disabled/busy behavior.

## Tests

- Render tests assert tab icons, action icons, collapse icon, floating seal pet image, and 小mi persona text.
- Main-process option tests assert the window icon path.
