# 小咪 Pet Icons Design

## Goal

Make Bilimi feel like the blue-white chibi pet shown in the reference: the pet introduces herself as bilimi, can be called 小咪, and appears on the app icon plus the main navigation and action buttons.

## Scope

- Use existing `blue-white-maid` PNG assets instead of adding a new asset family.
- Add pet icons to prominent controls: app window icon, floating seal, sidebar collapse, workspace tabs, and four review action buttons.
- Keep dense utility buttons text-first so notes, archive, edit, copy, delete, and timestamp workflows remain compact.
- Replace palace/servant-facing copy in the pet shell and floating seal with the 小咪 persona.

## Behavior

- The Electron main window uses a packaged local PNG icon.
- Key controls expose decorative pet images with empty alt text and preserve accessible labels.
- Pet state bubbles use concise 小咪 status copy:
  - idle: 小咪待机
  - hint: 小咪提示
  - working: 小咪忙碌中
  - error: 小咪遇到问题
- Review actions retain their current automation actions and disabled/busy behavior.

## Tests

- Render tests assert tab icons, action icons, collapse icon, floating seal pet image, and 小咪 persona text.
- Main-process option tests assert the window icon path.
