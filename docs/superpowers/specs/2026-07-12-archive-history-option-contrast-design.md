# Archive History Option Contrast Design

## Problem

The archive history control intentionally makes the collapsed native `select` text transparent so the 32px control displays only its custom arrow. On Windows, the opened native `option` rows inherit that transparent foreground, leaving unhighlighted rows unreadable on the white popup background.

## Design

Keep the native `select`, current arrow-only collapsed state, layout, and behavior unchanged. Add a selector scoped to the archive history control that gives `option` rows the existing deep-blue text color and a white background. Windows remains responsible for the highlighted-row colors.

## Verification

Extend the stylesheet regression test to require the scoped `option` foreground and background colors, then run the stylesheet test and the full test suite.
