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
- Secure checkout, payment and customer order tracking with courier AWB/details
- Admin product, inventory and order management

## Design direction

The current prototype uses a playful snack-brand visual direction based on the supplied reference: green canvas, cream rounded cards, bright yellow type, pink shapes and colour-coded flavour packs. The later brand layer will draw on Mithila visual motifs such as fish, peacock, lotus, vines and geometric borders. Artwork will live separately from commerce logic so it can be swapped from Figma exports.

## Firebase setup

The app's Firebase Web SDK uses the registered **POKHAR'S Storefront** app in project `pokhars-store`.

For local development, copy `.env.example` to `.env.local`. The `.firebaserc` file selects `pokhars-store` for Firebase CLI commands. Firebase client settings are public browser configuration; keep payment and ImageKit private keys server-only. `firebase.json` points to the Firestore rules and indexes, which should be reviewed before deployment.

### Authentication domains

Use the Firebase default auth domain locally and the same-origin Vercel auth domain on every Vercel target:

| Environment | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` |
| --- | --- |
| Local `.env.local` | `pokhars-store.firebaseapp.com` |
| Vercel Development, Preview, Production | `pokhars-store.vercel.app` |

The `.env.example` value is for local development. Keep the Vercel value separate for Development, Preview, and Production; do not copy the local value over it. `next.config.ts` serves Firebase's `/__/auth/` helper on the storefront origin by rewriting it to `https://pokhars-store.firebaseapp.com/__/auth/`; keep this rewrite in place.

Google is enabled as a sign-in provider. `localhost` and `pokhars-store.vercel.app` are authorized; add any custom production domain under **Authentication → Settings → Authorized domains** in the Firebase Console.

## Development catalogue mode

Keep `NEXT_PUBLIC_CATALOGUE_DEMO_MODE=true` while the site uses sample product names, prices, pack photos or placeholder food-label details. In this mode:
- Active/published sample products remain visible in the storefront and product detail pages.
- The storefront and admin clearly mark the catalogue as **DEMO · NOT FOR SALE**.
- Admin can save and publish sample data without the production food-label checks.
- Cart interactions are available for UI testing, but the checkout API and Razorpay test-payment configuration are disabled server-side.
- No sample product may be used to create a customer order or payment.

Before launch, replace every sample field/image with final approved product information, verify the actual pack photo and FSSAI details, then set `NEXT_PUBLIC_CATALOGUE_DEMO_MODE=false` (or remove it) in Vercel and redeploy. Strict publication checks automatically resume. Never use demo mode to accept customer orders.

## Security principles

- Never expose payment secrets in browser code.
- Verify payment signatures and webhooks on the server.
- Recalculate prices and stock on the server before creating orders.
- Enforce customer ownership and admin permissions in backend rules/functions.
- Keep Firebase configuration and third-party keys in environment variables.

## Admin dashboard setup

The private admin dashboard is available at `/admin`. It uses the existing Google sign-in and does not grant access to any account by default. A Firebase ID token is verified on every `/api/admin/*` request, including revocation checks. The server then allows either (a) a UID in the server-only `ADMIN_UIDS` list, (b) a verified email in `ADMIN_EMAILS`, or (c) the trusted Firebase custom claim `admin: true`. A browser-provided email or Firestore profile is never used as an authorization signal.

### One-time owner setup

1. In Firebase Authentication, identify the owner's intended account and copy its exact UID. Do not use an email until it is verified in Firebase Authentication.
2. Create a service account for the `pokhars-store` Firebase project with only the access needed to read/write Firestore and verify Firebase Auth tokens. Keep its JSON private.
3. In the existing Vercel project, add these server-only variables for the environments where the dashboard should work:
   - `FIREBASE_PROJECT_ID=pokhars-store`
   - `FIREBASE_SERVICE_ACCOUNT_JSON=<the service account JSON on one line>`
   - `ADMIN_UIDS=<the exact owner UID>`
4. Redeploy the project. Sign in at `/admin` using that owner account. Other signed-in customers will receive an access denied response.

Use `ADMIN_EMAILS` with a comma-separated list of verified addresses only if you prefer email bootstrapping. Avoid setting both allowlists broadly. Remove a UID/email from Vercel and redeploy to revoke this bootstrap role. Alternatively, a trusted Admin SDK operator can set the custom claim on the exact intended UID (`setCustomUserClaims(uid, { admin: true })`); never expose that operation in a public route. The dashboard does not promote the current user or set claims automatically.

The Admin SDK bypasses Firestore Security Rules, so every route performs server-side authorization and input validation before touching Firestore. Admin order fulfilment only allows paid, non-test orders to move confirmed → processing → shipped → delivered. Marking an order shipped requires a courier name and tracking/AWB number; optional tracking links must use HTTPS. Each fulfilment change and tracking edit is recorded in a status-history array and returned only to the authenticated order owner through /api/account/orders. Customer account pages show a delivery progress timeline and courier details; the customer can refresh the status manually. Email/WhatsApp notifications are not configured yet and require a separate provider/sender setup. Client Firestore writes remain denied by the current rules. Product deletion archives by setting the product inactive and draft; only non-test paid orders can move confirmed → processing → shipped → delivered, and payment/refund state is not changed. Coupon records can be created and deactivated, but cannot be activated or applied by checkout. Images currently use the existing single `imageUrl` field; uploading files and multi-image galleries need a storage/schema milestone.

Sales are calculated only from non-test order documents returned by the admin API and marked `paymentStatus: "paid"`. Test orders are labeled and excluded from sales and fulfilment. The current dashboard loads the latest 200 orders, so the overview is a recent loaded-order view, not a lifetime accounting ledger.

### Product image uploads with ImageKit

The Admin → Products form supports JPG, PNG and WebP pack photos up to 8 MB. Uploads are sent to the ImageKit folder `/pokhars/products`. The server checks the Firebase admin role before issuing a short-lived upload signature; the ImageKit private key never reaches the browser. The signed upload response fills the product image URL field. Press **Save product** to persist that URL in Firestore.

In Vercel → Project Settings → Environment Variables, add the following server-side values to Development, Preview and Production, then redeploy:

- `IMAGEKIT_PUBLIC_KEY` — ImageKit public API key
- `IMAGEKIT_PRIVATE_KEY` — ImageKit private API key (secret; never add a `NEXT_PUBLIC_` prefix)
- `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` — optional delivery endpoint for future image transformations

Do not paste private keys into ChatGPT or GitHub. The application returns a clear setup error until the required ImageKit keys have been added.

## Test checkout setup

Checkout is deliberately **test-only**. The server rejects live Razorpay keys and disables checkout on Vercel Production, always tags test orders with `paymentMode: "test"`, and the dashboard excludes them from live sales and fulfilment. A test payment records an explicitly labeled test order but never changes storefront stock. Do not add live Razorpay credentials. Shipping and tax policy is undecided: test shipping defaults to ₹0 and tax is not included.

To enable a test purchase after reviewing this change:

1. In the Razorpay Dashboard, switch to **Test Mode** and create a test API key. The key ID must begin with `rzp_test_`.
2. For a safe test, create a separate Firebase staging project first, then add its Firebase Admin credentials and these Razorpay variables to the Vercel **Preview** environment only (or use a local `.env.local` connected to staging):
   - `RAZORPAY_MODE=test`
   - `RAZORPAY_KEY_ID=<Razorpay test key ID>`
   - `RAZORPAY_KEY_SECRET=<matching Razorpay test key secret>`
   - `RAZORPAY_WEBHOOK_SECRET=<a webhook secret you choose in Razorpay>`
   - Optional `CHECKOUT_TEST_SHIPPING_PAISE=0` (for example, `5000` means ₹50.00)
3. In Razorpay Test Mode, add a webhook pointing to the Preview deployment URL shown by Vercel, followed by `/api/payments/razorpay/webhook`. Use the same webhook secret and subscribe to `payment.captured` and `payment.failed`.
4. Redeploy the Preview deployment after adding the variables. Sign in to that preview, add a saved delivery address under `/account/addresses`, and use Razorpay's test payment details.

Never put Razorpay keys in `NEXT_PUBLIC_*` variables or in chat. If the test variables are missing, checkout remains disabled and the site says that live payments are disabled. Vercel Production always keeps checkout disabled, even if someone adds test credentials there. Shipping, tax calculation, refunds, coupon redemption, payment settlement and live payment support remain out of scope. Orders are written through server-only Admin SDK routes; test checkouts do not change inventory, and Firestore client writes remain denied by the existing rules. No Firestore rules or indexes were changed or deployed for checkout.

### Rules and indexes review

The repository's existing rules already restrict product reads to published active products (or admins with the `admin` custom claim), restrict order reads to the owner or that claim, and deny all client writes to products, orders and coupons. The new dashboard uses the server Admin SDK behind its own explicit role check, so changing rules to allow browser admin writes would weaken the customer boundary and is not needed. `firestore.rules` and `firestore.indexes.json` are intentionally unchanged; the orders query uses Firestore's automatic single-field `createdAt` index. Review these files before any separate rules deployment. No rules or indexes were deployed by this change.

## Status

The dashboard and test-only checkout are implemented. Razorpay test credentials and the test webhook still need to be added by the owner before a test purchase can be completed.
