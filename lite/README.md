# menyo lite

A stripped-down ordering page you can drop onto an iPad in an afternoon.

It does exactly four things:

1. **Reads an uploaded menu** — photograph, screenshot or PDF — and turns it into
   structured, orderable items.
2. **Shows a proper ordering page** where a guest signs in, picks items (with
   sizes, sides and notes) and taps **Submit**.
3. **Shows the submitted order on screen**, with an order code, a QR code and a
   share link.
4. **Sends that order to the restaurant** by email or SMS. The email carries
   every line of the order plus a CSV block and a machine-readable JSON block,
   so the restaurant can re-key it — or import it — into whatever they already
   use.

There is **no GloriaFood, no POS, no payment and no database**. Nothing is
charged; the guest pays in person. Everything the app knows lives in the
browser's own storage on that device.

It is a separate, self-contained app. It does not touch the main menyo React
app, its Supabase schema, or any of the `api/` routes other than the one
optional relay described below.

---

## Try it in 30 seconds

```bash
npm run lite:serve      # serves lite/ at http://localhost:8787
```

Open it, tap **Load the sample menu**, and order something.

---

## Getting it onto an iPad

### The normal way: host it, then add it to the home screen

The `lite/` folder is plain static files — no build step, no bundler, no server
code. Any static host works: Vercel, Netlify, GitHub Pages, Cloudflare Pages, an
S3 bucket, or a spare Mac on the restaurant's Wi-Fi.

```bash
# Vercel, from the repo root
npx vercel deploy lite --prod

# or anything that serves a directory
npx http-server lite
```

Then on the iPad:

1. Open the address in **Safari** — not inside another app's browser.
2. Tap the **Share** button in the toolbar.
3. Choose **Add to Home Screen**, then **Add**.

It now has its own icon, opens full screen with no browser chrome, and keeps
working if the Wi-Fi drops — a service worker caches the app shell, and the menu
lives in local storage.

For a table kiosk, also turn on **Settings → Accessibility → Guided Access** so
the iPad stays pinned to this one app.

> HTTPS (or `localhost`) is required for the home-screen install and the offline
> cache. Plain `http://192.168.x.x` still runs, it just does not install as
> nicely.

### The other way: one file you can AirDrop

```bash
npm run lite:build      # writes lite/dist/menyo-lite.html
```

That is the entire app — HTML, CSS, JavaScript, icons and the sample menu — in a
single ~125 KB file. AirDrop or email it, open it from **Files**, and it runs.

Two things you give up, because both need a real web address: there is no
offline cache and no home-screen icon, and the QR code is hidden (a `file://`
link means nothing on anyone else's device). Email and SMS still carry the full
order, so the app is perfectly usable this way.

---

## Setting up a restaurant

Open **Admin** from the top right.

### 1. Restaurant

Name, tagline, address, phone, and an accent colour that runs through the whole
app.

### 2. Menu

Upload menu pages (images or a PDF, up to 15 MB at a time) and tap **Read the
menu**. Gemini reads them and returns sections, items, descriptions, prices,
dietary tags, and choice groups such as sizes and sides. Review what came back
in the editor underneath, fix anything it misread, and tap **Save menu**.

You need a Gemini API key, free from
[aistudio.google.com](https://aistudio.google.com/apikey). It is stored on that
device only and used solely for reading menus.

**On a customer-facing iPad, do not put the key there.** Read the menu on your
own iPad or laptop, then **Device → Export setup** and import that file on the
kiosks. The exported file deliberately leaves the key out.

No key, or no signal? Paste the menu as text and use **Read pasted text without
AI** — a rough line-by-line parser that you then tidy in the editor. Or edit the
menu entirely by hand; the editor works on its own.

### 3. Ordering

Which services you offer (dine in / pickup / delivery), whether to ask for a
table number or a requested time, tax and service-charge percentages, a minimum
order, and **kiosk mode** — which never remembers a guest and resets the screen
after a few idle minutes, for an iPad that sits on a table.

### 4. Sending

Where submitted orders go. Set the restaurant's email address, mobile number, or
both, then choose how they get sent:

- **From this iPad** (the default, and nothing to set up). Submitting opens Mail
  or Messages with the whole order already filled in; staff tap send. No API
  keys, no per-message cost, works on any host.
- **Automatically, through a relay.** One tap and the order goes out on its own.
  This needs the optional endpoint below.

**Send a test order** checks the whole path before a real guest does.

If guests will scan the QR code with their own phones, set **Public address of
this app** to the address you deployed to — otherwise the link points at
whatever address this iPad happens to be using.

### 5. Device

A staff PIN for Admin, setup export/import for copying a configured iPad onto
others, and the reset button.

---

## What the restaurant actually receives

Every submitted order produces:

- **An order code** like `4PV-D2T`, shown in large type on the iPad.
- **An email** with the customer, service type, table or address, requested
  time, every line with its options and notes, subtotal/service/tax/total, a
  loud "no payment has been taken" banner, a **CSV block** to paste into a
  spreadsheet, and a **JSON block** for anyone wiring up an import later.
- **An SMS** with the order code, who it is for, the items, the total and the
  link. Long orders are summarised as "+N more items"; the link always has
  everything.
- **A share link** that renders the full order on any device.

### How the share link works

The whole order is compressed and packed into the URL's fragment — the part
after `#`. That means the link resolves with no database behind it, works on any
static host, and the order details are never sent to the web server at all.
Anyone with the link can read that one order, so treat it like a paper ticket.

A self-contained link runs to a few hundred characters, which makes an SMS two
to four segments. That is the cost of not running a server; the content of the
message is kept lean so the link is the only long part.

---

## The optional relay

`api/lite/send-order.ts` is a Vercel function that sends the email (via Resend)
and the SMS (via Twilio) so nobody has to tap send.

```
LITE_RELAY_TOKEN     shared secret; must match the relay token in Admin → Sending
LITE_ORDER_EMAIL     the restaurant address that receives orders
LITE_ORDER_SMS       the restaurant number that receives the text
RESEND_API_KEY       Resend key
RESEND_FROM_EMAIL    a verified sending address
TWILIO_ACCOUNT_SID   Twilio SID
TWILIO_AUTH_TOKEN    Twilio auth token
TWILIO_FROM_NUMBER   Twilio sending number, e.g. +15550100100
LITE_ALLOWED_ORIGIN  optional; restricts CORS to the host serving the kiosk
```

Recipients come from the server's own environment, never from the request body.
The only address a caller can influence is the guest's own, for their copy. A
leaked relay URL therefore cannot be turned into an open mail or SMS gateway.

---

## What is here

```
lite/
  index.html              app shell
  css/styles.css          the whole stylesheet
  js/app.js               router, ordering screens, receipt
  js/admin.js             admin console
  js/store.js             state and localStorage
  js/order.js             cart maths, share-link encoding, email/SMS/CSV rendering
  js/menu-ai.js           Gemini menu ingestion + an offline text fallback
  js/share.js             mailto / sms / Web Share / relay delivery
  js/qr.js                QR encoder (no dependencies, works offline)
  js/ui.js                toasts and modal sheets
  js/util.js              DOM, money and formatting helpers
  sw.js                   offline cache for the app shell
  manifest.webmanifest    home-screen install metadata
  sample-menu.json        a demo restaurant
  tools/build-single-file.mjs   the AirDroppable build
  tools/test-qr.mjs             decodes generated QR symbols and checks them
  tools/test-order.mjs          order maths and share-link round trips
```

No framework and no build step: the browser loads the ES modules as they are.

```bash
npm run lite:test       # 232 checks, no browser needed
```

---

## Known limits

- **Sign-in is an identity, not an account.** It collects a name and a way to
  reach the guest, and remembers it on that device. There are no passwords,
  because there is no server to hold them.
- **Storage is per device.** Two iPads do not share a menu; use
  **Device → Export setup** to copy one to the other.
- **Nothing is charged.** Totals are there so the printed order reads correctly.
- **Compressed links need Safari 16.4 or newer.** Older browsers still open
  uncompressed links.
- **A device's local storage can be cleared** by Safari's "Clear Website Data",
  which takes the menu with it. Keep an exported setup file.
