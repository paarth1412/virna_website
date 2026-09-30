# Virna — virna.in

Online store for Virna's sustainable pooja products: agarbatti, dhoop, flowers, diyas and gift boxes.

- **Backend:** Node.js + Express (`server/`)
- **Database:** SQLite through `@libsql/client`. Locally it's a file at `data/virna.db`; in production it's a free hosted [Turso](https://turso.tech) database.
- **Frontend:** plain HTML, CSS and JS (`public/`), no build step
- **Payments:** Razorpay (online) and cash on delivery
- **Sign-in:** email + password, plus "Continue with Google"

## Run it locally

Needs Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env    # then fill in the admin emails/passwords
npm start               # http://localhost:4390
```

On first start the server creates the database, loads the sample catalogue and creates the admin accounts listed in `.env`.

`npm test` runs the API tests against a throwaway database.

## What's where

| Path | What it does |
| --- | --- |
| `server/index.js` | Starts the server, seeds data, runs the cleanup job for unpaid orders |
| `server/db.js` | Database schema (users, products, variants, orders, stock log, …) |
| `server/catalog.js` | Sample products, used only when the database is empty |
| `server/routes/auth.js` | Sign up, sign in, Google sign-in, account, password |
| `server/routes/orders.js` | Checkout, Razorpay verification, Razorpay webhook |
| `server/routes/admin.js` | Admin API: stock, prices, product visibility, orders, messages |
| `server/store.js` | Order and stock logic (reserve, release, mark paid) |
| `public/js/app.js` | The whole storefront, account and admin UI |
| `public/js/art.js` | Illustrated product placeholders until real photos arrive |
| `preview/virna-preview.html` | The original single-file design preview |

## How selling works

- Anyone can browse and add to cart. Sign-in is only asked for at **Checkout**. The person icon in the header opens sign-in or the account page.
- Prices and stock are always checked on the server. The browser's cart is never trusted.
- Placing an order **reserves stock immediately**. Stock goes back if:
  - the customer closes the Razorpay window,
  - an admin cancels the order, or
  - an online order stays unpaid for 30 minutes.
- Order statuses: `pending_payment` → `paid` (online) or `placed` (COD) → `shipped` → `delivered`. Any order can also be `cancelled`.

## Admin

Admin accounts come from `ADMIN_n_EMAIL` / `ADMIN_n_PASSWORD` in `.env`. They are created on first start with the password hashed. Changing `.env` later does **not** change an existing password; use *My account → Change password* instead. An admin can also sign in with Google if the Google account has the same email.

The admin panel is at `/#/admin`. It shows an **Admin** button in the header for admins.

- **Overview:** today's and this month's sales, orders to ship, low-stock list
- **Inventory:** edit stock (with +/−), price and MRP per size, and hide or show products. Every stock change is logged with who made it.
- **Orders:** filter and search orders, see the address and gift message, mark orders shipped, delivered or cancelled. Cancelling restocks the items.
- **Messages:** contact-form messages and newsletter sign-ups

## Turning on Google sign-in

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **OAuth consent screen**. Set it up as External and give it the app name "Virna".
2. Go to Credentials → **Create credentials → OAuth client ID** → Web application.
3. Under **Authorised JavaScript origins**, add `http://localhost:4390` and later `https://virna.in`.
4. Put the client ID in `.env` as `GOOGLE_CLIENT_ID=` and restart. The Google button appears in the sign-in box.

## Turning on Razorpay

1. In the Razorpay Dashboard, go to Account & Settings → **API Keys**. Start with **Test mode** keys.
2. Put them in `.env` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, then restart.
3. In Webhooks, add `https://virna.in/api/webhooks/razorpay` with the events `payment.captured` and `order.paid`. Put the webhook secret in `RAZORPAY_WEBHOOK_SECRET`.

Without keys, online payment is **simulated** when running locally (a banner says so). With `NODE_ENV=production` and no keys, online payment is switched off and only COD is offered.

## Deploying (free: Render + Turso)

**1. Database on Turso (free)**
- Sign up at turso.tech and create a database in the region closest to your server (Mumbai or Singapore).
- Copy its URL (`libsql://…`) and create an auth token for it.

**2. Server on Render (free web service)**
- New → Web Service → connect this repo.
- Build command: `npm install`. Start command: `npm start`. Plan: Free.
- Environment variables:
  - `NODE_ENV=production`
  - `TURSO_DATABASE_URL`
  - `TURSO_AUTH_TOKEN`
  - `ADMIN_1_EMAIL` / `ADMIN_1_PASSWORD`, `ADMIN_2_EMAIL` / `ADMIN_2_PASSWORD`
  - later: `GOOGLE_CLIENT_ID` and the Razorpay keys

On first start the server creates the tables in Turso, loads the sample catalogue and creates the admin accounts.

**Free-plan note:** Render's free server sleeps after 15 minutes without visitors, and the next visit takes about 30–50 seconds to wake it. To keep it awake, add a free monitor (for example UptimeRobot) that requests `https://<your-site>/api/health` every 5 minutes. Your data is safe either way, because it lives in Turso, not on the server.

When you push new code, open the service on Render and click **Manual Deploy → Deploy latest commit**. If you connect GitHub to Render instead, this happens automatically.
