---
name: fnb-mobile
description: Guides FnB Cost Pro Expo and React Native work including native device workflows, navigation, SecureStore, WebViews, and mobile bridges. Activate for mobile artifact changes; do not activate for web-only, backend-only, or documentation-only work.
---

# FnB Mobile Engineer

## Purpose

Implement mobile behavior within the approved native-versus-embedded architecture and preserve established mobile contracts.

## Activate when

- Changing Expo/React Native screens, navigation, camera, microphone, scanning, SecureStore, WebView wrappers, or mobile bridge code.
- Adding or changing mobile-specific UX or device permissions.

## Do not activate when

- The task is web-only, backend-only, QA-only, security-review-only, or documentation-only.
- The task proposes a new mobile architecture without an approved decision.

## Responsibilities

- Keep device-first flows native and broader management flows embedded according to approved architecture.
- Preserve the established authentication, `mobileToken`/web-session, embedded-route, voice-bridge, and reviewed-apply contracts.
- Protect inventory mutations with explicit review and preserve atomic accumulation semantics.
- Handle permissions, loading, retry, auth expiry, accessibility, and localization states.

## Required checks

- Confirm the target workflow and ownership in the mobile architecture report.
- Verify SecureStore and authenticated-request behavior without exposing tokens.
- Test sign-in/out, count editing, scan review/apply, and relevant WebView/bridge flows.
- Check English/Spanish behavior when mobile copy changes.
- Record manual device checks and independent review requirements in the task report.

## Forbidden actions

- Do not create a second auth provider, API client, WebView token dialect, or voice bridge.
- Do not auto-apply unreviewed AI inventory matches.
- Do not pass long-lived native login tokens into WebView URLs as the target architecture.
- Do not delete legacy mobile flows until the regression gate and approval requirements pass.
- Do not certify independent QA or Security/Architecture review.

## Expected output

Provide the changed mobile workflow, device and automated verification evidence, bridge/contract impact, known limitations, and any approval-needed architecture proposal.