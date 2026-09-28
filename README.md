# Virna — virna.in

Online store for Virna's sustainable pooja products: agarbatti, dhoop, flowers, diyas and gift boxes.

- **Backend:** Node.js + Express (`server/`)
- **Database:** SQLite, a single file at `data/virna.db`, created automatically. It uses Node's built-in driver, so there is nothing to install.
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

## Deploying

This needs a host that runs Node and keeps files on disk, because SQLite lives on disk. Good options:

- **Render** (web service + persistent disk)
- **Railway** (service + volume)
- A small **VPS**

Set `NODE_ENV=production`, the same variables as `.env`, and `DATABASE_PATH` pointing at the persistent disk. Put HTTPS in front, which Render and Railway do automatically. Netlify alone can't run this, because it only serves static files.

**Back up `data/virna.db` regularly.** It holds every order and customer.
