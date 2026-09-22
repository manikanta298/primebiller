# PrimeBiller — Girder Login UI

A responsive React/Vite implementation of the supplied Girder login design.

## Included

- Split-screen desktop login layout matching the supplied reference.
- Separate warehouse background asset at `public/images/login-warehouse-bg.svg`.
- Responsive tablet and mobile layouts.
- Email/password fields, password visibility toggle, remember-me checkbox, forgot-password action, Google sign-in action, contact action, and legal links.
- No backend authentication is implemented in this UI-only change.

## Run

```bash
npm install
npm run dev
```

## Design QA completed before GitHub update

- JSX syntax checked with TypeScript (`tsc --noEmit`).
- Desktop, tablet, tablet-portrait, mobile and mobile-large breakpoints manually reviewed against the supplied reference.
- Responsive breakpoints explicitly cover <=1150px, <=900px, <=700px and <=420px.
- Checked semantic labels, keyboard-submit path, password visibility control, remember-me control and touch-friendly button heights.
- Checked for horizontal overflow risks in the responsive rules.
- Background image is stored as a separate production asset rather than embedded in the component.
