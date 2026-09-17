---
name: Sticky section navigation
description: Reliable programmatic navigation for scroll containers with sticky section headings.
---

Use a non-sticky, zero-height marker at each section’s true content position as the programmatic scroll target. Keep the visible sticky heading separate and move focus to it after scrolling.

**Why:** Once a sticky heading has crossed the container edge, its rendered rectangle is clamped to the sticky position. Calculations based on that rectangle cannot recover the heading’s original content position, so backward jumps may not move.

**How to apply:** For category or location jumps inside an overflow container, calculate the marker’s position relative to the container using both rectangles and the current `scrollTop`. Test forward and backward navigation separately.