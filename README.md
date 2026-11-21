# POKHAR'S — Ecommerce Storefront

A functionality-first ecommerce website for POKHAR'S, a premium roasted makhana brand rooted in Bihar.

## Build approach

The storefront is being built in two stages:

1. **Functional foundation:** accessible shopping UI, product catalogue, flavour filters, cart and responsive layouts.
2. **Visual redesign:** replace the presentation layer with the brand's Figma-designed Mithila-inspired identity without rewriting commerce logic.

## Planned stack

- Next.js (App Router) + TypeScript
- Firebase Authentication, Firestore and Cloud Functions
- Razorpay (server-side order creation, signature verification and webhooks)
- ImageKit for product media
- Vercel for hosting and Git-based deployments

## Planned storefront capabilities

- Homepage, shop/collection and product details
- Flavour filtering and product cards
- Cart with quantity controls
- Customer sign-in, profile and saved addresses
- Secure checkout, payment and order tracking
- Admin product, inventory and order management

## Design direction

The current prototype uses a playful snack-brand visual direction based on the supplied reference: green canvas, cream rounded cards, bright yellow type, pink shapes and colour-coded flavour packs. The later brand layer will draw on Mithila visual motifs such as fish, peacock, lotus, vines and geometric borders. Artwork will live separately from commerce logic so it can be swapped from Figma exports.

## Firebase setup

The app's Firebase Web SDK uses the registered **POKHAR'S Storefront** app in project `pokhars-store`.

For local development, copy `.env.example` to `.env.local`. The `.firebaserc` file selects `pokhars-store` for Firebase CLI commands. Firebase client settings are public browser configuration; keep payment and ImageKit private keys server-only. `firebase.json` points to the Firestore rules and indexes, which should be reviewed before deployment.

Google is enabled as a sign-in provider. `localhost` and `pokhars-store.vercel.app` are authorized; add any custom production domain under **Authentication → Settings → Authorized domains** in the Firebase Console.

## Security principles

- Never expose payment secrets in browser code.
- Verify payment signatures and webhooks on the server.
- Recalculate prices and stock on the server before creating orders.
- Enforce customer ownership and admin permissions in backend rules/functions.
- Keep Firebase configuration and third-party keys in environment variables.

## Status

Project setup and implementation are in progress. Backend services and payment integrations are not configured yet.
