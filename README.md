# Insulin Dose Calculator

A small iPhone web app that follows the *Flexible Insulin Dose Plan 2026* and works out the dose the same way as the Excel calculator.
The calculator runs on the phone: no accounts, no tracking, nothing saved or sent anywhere.
Two optional extras get the reading from Libre: **live Libre readings** (the calculator asks your own small
relay for the latest LibreLinkUp reading about once a minute while it is open) and the **Libre Shortcut**
(an iPhone Shortcut that signs in to LibreLinkUp and opens the calculator with the reading).
After the first visit it works offline (the Libre extras need internet).

**Libre readings are a guide only – not a go-ahead to inject.** Before every dose check the reading in the Libre app
(or do a finger-prick check) and the dose against the written plan. The person giving the insulin is always
responsible for the final dose.

**Helper tool only – always check against the written plan and follow the care team’s advice.**

## Files

| File | What it is |
|---|---|
| `index.html` | The screens (Calculator, Plan, Instructions) |
| `style.css` | Look and layout (one screen, no scrolling) |
| `app.js` | The dose plan numbers (`DOSE_PLAN` at the top) and all calculations |
| `manifest.json` | Name and icon for the Home Screen |
| `service-worker.js` | Keeps a copy of the app on the phone so it works offline |
| `icons/` | App icons |
| `libre-relay/worker.js` | The Libre relay for live Libre readings (runs on Cloudflare, not on the phone) |
| `tests/calc.test.js`, `tests/relay.test.mjs` | Automated tests (not needed on the phone) |

## Put it online for free (GitHub Pages)

Do this on a computer – it is much easier than on a phone.

1. Create a free account at <https://github.com> and sign in.
2. Click **+** (top right) → **New repository**. Name it, for example, `dose-calc`.
   Leave it **Public** (free GitHub Pages only works with public repositories).
   Turn on **Add README** then click **Create repository**.
3. Unzip `insulin-dose-calculator.zip` on your computer.
4. In the new repository click **Add file** → **Upload files**. Drag in everything from inside the unzipped
   folder: `index.html`, `style.css`, `app.js`, `manifest.json`, `service-worker.js` and the
   `icons` folder (the `tests` folder is optional). Click **Commit changes**.
   The files must sit at the top level of the repository, not inside another folder.
5. Open **Settings** → **Pages** (left side, under “Code and automation”).
   Under **Build and deployment** → **Source** choose **Deploy from a branch**.
   Choose branch **main** and folder **/ (root)** then click **Save**.
6. Wait a few minutes (GitHub says up to 10). Refresh the Pages settings: the address appears at the top,
   for example `https://YOUR-USERNAME.github.io/dose-calc/`.

Because the repository is public, anyone who finds it can see the plan numbers.
The files contain no name or other personal details.

## Add it to the iPhone Home Screen

1. Open the address in **Safari** while online. Let it load fully (this stores the offline copy).
2. Tap the **Share** button. On iOS 26 and newer it is inside the **•••** menu next to the address bar
   (tap **•••** → **Share**). On older iOS it is the square with an arrow in the toolbar.
3. Scroll down and tap **Add to Home Screen**.
4. Keep **Open as Web App** switched on. Keep the name “Insulin Dose” (or change it) then tap **Add**.
5. Open it once from the Home Screen while online. To check offline use: turn on Airplane Mode,
   open the app and type a reading.

## Using it

- The meal time is picked from the phone’s clock (05:00–10:59 Breakfast, 11:00–15:59 Lunch,
  16:00–20:59 Dinner, otherwise Bedtime). Tap another meal time to change it.
- The arrow buttons look like the FreeStyle Libre arrows (↑ rising quickly, ↗ rising, → changing slowly,
  ↘ falling, ↓ falling quickly). The **Plan** tab shows each one next to the arrow used in the written plan
  (Libre ↑ = plan ↑↑, ↗ = ↑, ↘ = ↓, ↓ = ↓↓) and its units.
- The message (for example “Above 180 …”) sits right under the yellow Total.
- A food row only counts when it has both a name and carbs. An orange dashed box shows which part is missing.
- While the keypad is open the iPhone may slide the screen up. If that hides the Total, the reading or the
  message, a strip at the top shows all three.
- Tap **Clear** before the next reading. The app also clears itself after 30 minutes in the background
  so an old reading is never shown as if it were new.

## Live Libre readings (optional): the calculator keeps the reading up to date

While the calculator is open and online it asks **your own Libre relay** for the latest LibreLinkUp reading about
once a minute. When the sensor sends a new reading (or it is scanned), the Blood Sugar box, the arrow and the
Total update by themselves and the box flashes blue. A line at the top (where the title was) shows the Libre reading,
its arrow and how old it is; tap it to check again now.

- It fills the box when the box is empty and keeps it up to date. **A reading typed by hand is never changed** –
  the line then offers the Libre reading (“tap to use”). An arrow chosen by hand is kept; the line says
  “check arrow” when Libre shows a different one.
- **After Clear the box stays empty until the Libre line is tapped**, so a dose that was just given is not worked
  out again by itself (the same when the box is emptied by hand). After 30 minutes in the background the app starts
  afresh and fills the box again.
- While the keypad is open for the Blood Sugar box nothing in it changes; a newer reading waits on the Libre line.
- Readings older than 10 minutes, LO and HI are never used. If Libre stops sending readings, the last one is
  removed once it is more than 10 minutes old.
- The first time, the phone shows a reminder that the reading is a guide only and asks for the relay key.

Why a relay? The phone cannot talk to LibreLinkUp directly (LibreLinkUp does not allow web pages to call it),
and the LibreLinkUp password must not go into the app files, because the GitHub repository is public.
The relay is a tiny program on Cloudflare's free plan. It keeps the LibreLinkUp email and password as encrypted
secrets, signs in for you, stops if the account ever follows someone else and answers **only** the calculator,
**only** with the relay key and **only** with the latest reading, its time and its arrow (no names, no history).

This uses LibreLinkUp in an unofficial way. It can stop working whenever Abbott changes LibreLinkUp. LibreLinkUp
can also be a few minutes behind the Libre app. If it stops working, type the reading as before.

### 1. Before you start

You need a LibreLinkUp account that follows **only the child** – the same kind of account as for the Shortcut
(see “Before you start” in the Shortcut section below; you can use the same account). Check that the LibreLinkUp app
shows the child's reading with that account.

### 2. Make the relay (on a computer, about 15 minutes)

The Cloudflare screens change from time to time, so the names below may differ slightly.

1. Create a free account at <https://dash.cloudflare.com/sign-up> and confirm your email.
2. Open **Workers & Pages** (under **Compute** on the left) → **Create** → **Start with Hello World!** →
   name it `libre-relay` → **Deploy**. If asked, pick your `workers.dev` name.
   The relay's address is shown, for example `https://libre-relay.YOUR-NAME.workers.dev`. Write it down.
3. Click **Edit code**. Delete everything in the editor, then copy the whole of `libre-relay/worker.js`
   (open it on GitHub, click **Raw**, then **Ctrl+A**, **Ctrl+C** – or open the file in Notepad) and paste it in.
   Click **Deploy**.
4. Open the relay's address in a new browser tab. It says “Not set up yet” and shows a new random key.
   Copy that key into a note – it is your **RELAY_KEY**. (It shows a different key every time; use one of them.)
5. Back in Cloudflare open the Worker → **Settings** → **Variables and Secrets** → **Add**. Add three, each with
   type **Secret**, names exactly as written (no space before or after what you paste):
   - `LLU_EMAIL` = the LibreLinkUp account email
   - `LLU_PASSWORD` = its password
   - `RELAY_KEY` = the key from step 4

   Click **Deploy** (or **Save**).
6. **Storage & Databases** → **Workers KV** → **Create** → name it `libre-kv`. Then open the Worker →
   **Bindings** (or **Settings** → **Bindings**) → **Add binding** → **KV namespace** → variable name `LIBRE_KV`,
   namespace `libre-kv` → **Add binding** / **Deploy**. This is needed: it keeps the LibreLinkUp sign-in, the
   10-minute pause after a refused sign-in (so the account is not locked) and whom the account follows.
7. Open the relay's address again. It should say **Running** and “KV binding LIBRE_KV: yes”.
   It never shows a reading there.

If the calculator is on a different GitHub account, also add a **Text** variable `ALLOWED_ORIGIN` =
`https://YOUR-USERNAME.github.io` (without the folder name).

### 3. Point the calculator at the relay

1. On GitHub open `app.js` and click the pencil icon. Near the top find `relayUrl: '',`
2. Put the relay's address between the two quotes, for example
   `relayUrl: 'https://libre-relay.YOUR-NAME.workers.dev',` (no `/` at the end). Click **Commit changes**.
3. Open `service-worker.js` the same way and raise `CACHE_VERSION` by one (for example `v10` to `v11`).
   Commit. Without this step phones keep the old version.

(If you upload the files from your computer instead, make the same change in `app.js` with Notepad before uploading.)

The address must end in `.workers.dev`. (The page only allows that kind of address. To use another address,
add it to `connect-src` in the security line at the top of `index.html`.)

### 4. Connect the phone

1. Put the RELAY_KEY on the phone so it can be pasted (for example in a note).
2. Open the calculator from its Home Screen icon while online. The top line says
   **“Libre: tap to connect live readings”**. Tap it.
3. Read the reminder, paste the key and tap **I understand – connect**. Within a few seconds the line shows the
   Libre reading and the box is filled.

The key is saved on that phone only (Home Screen app and Safari keep separate copies, so connect each one you use).
To change the key or turn it off: **Instructions** tab → **Change the key or turn off**.
If the phone is lost, change `RELAY_KEY` in Cloudflare and connect the other phones again.

### 5. What the top line means

| The line says | What to do |
|---|---|
| Libre 142 ↗ · 1 min ago · in use | That reading is in the calculator. Still check it against the Libre app. |
| … · tap to use | A Libre reading is ready but the box has your own reading (or was cleared). Tap to use it. |
| … · check arrow | The arrow chosen by hand differs from the Libre arrow. Check which is right. |
| … min old – scan the sensor | The newest reading is more than 10 minutes old. Scan the sensor or type the reading. |
| Libre shows LO / HI | Do a finger-prick check and type the reading. |
| Phone clock is wrong | The phone's clock is more than 2 minutes off, so the age of a reading cannot be checked. Set it to automatic (**Settings** → **General** → **Date & Time**). |
| no internet | No connection, the relay address in `app.js` is wrong, or Cloudflare had a problem. Type the reading. |
| key not accepted | Tap the line and paste the RELAY_KEY again. |
| relay settings missing | One of `LLU_EMAIL`, `LLU_PASSWORD`, `RELAY_KEY` or the `LIBRE_KV` binding is missing in Cloudflare (or the key is shorter than 16 characters). Open the relay's address to see which. |
| relay refused this address | `ALLOWED_ORIGIN` in Cloudflare does not match the calculator's address (see the end of step 2). |
| sign-in refused | Wrong LibreLinkUp email or password in Cloudflare. Fix the secret, then tap the line (a changed password is tried straight away; the same one only after a 10-minute pause, so the account is not locked). |
| accept the terms in LibreLinkUp | Open the LibreLinkUp app, sign in with that account and accept. Tap the line after 2 minutes. |
| the account follows nobody yet | Accept the invitation in the LibreLinkUp app. |
| account follows several people | Use an account that follows only the child (or add a Text variable `LLU_PATIENT_ID`). |
| account follows someone new | The account now follows a different person than before, so the relay stopped. If that is really right, in Cloudflare open **Workers KV** → `libre-kv` and delete the entry `llu-patient-v1`. |
| busy – trying again in … min | LibreLinkUp asked for a pause. It tries again by itself. |
| Libre not answering | LibreLinkUp is down or has changed. Type the reading. If it lasts, LibreLinkUp may want a newer app version: add a Text variable `LLU_VERSION` with the version shown in the LibreLinkUp app (**Menu** → **About**). |

Cloudflare's free plan allows 100,000 requests a day; the calculator asks at most once a minute while it is open.
When LibreLinkUp does not answer as expected, the relay pauses for a few minutes before asking again.

## Libre Shortcut (optional): open the calculator with the latest Libre reading

An iPhone Shortcut on the child's phone signs in to **LibreLinkUp** (Abbott's caregiver service), gets the latest
reading and opens the calculator. A box shows the reading and when it was taken; nothing is used until
**Use this reading** is tapped. Readings older than 10 minutes, LO and HI are refused, and a used reading is
removed from the calculator once it is more than 10 minutes old. **Use this reading** also selects the Libre arrow
in the calculator; check it and tap another arrow to change it.

This uses LibreLinkUp in an unofficial way. It can stop working whenever Abbott changes LibreLinkUp, and it needs
internet when it runs. LibreLinkUp can be a few minutes behind the Libre app. If it stops working, open the
calculator from its own icon and type the reading as before.

### 1. Before you start

1. You need a LibreLinkUp account that follows **only this child** (the Shortcut takes the first person the
   account follows, so an account that also follows someone else could show the wrong person's reading).
   Making a new LibreLinkUp account just for this is best: it also keeps your main password off the child's phone.
   In the child's **Libre** app: **Menu** → **Connected Apps** → **LibreLinkUp** → **Add Connection**, then enter
   that account's email. Accept the invitation in the **LibreLinkUp** app.
2. Sign in to the LibreLinkUp app once with that account and accept any terms it shows. Check it shows the child's reading.
3. The steps below use the UAE server `api-ae.libreview.io`. If your LibreLinkUp account was made for another
   country, see "If it does not work".

### 2. Build the Shortcut (on the child's iPhone)

Open **Shortcuts** → tap **+**. Tap the name at the top and call it **Libre Dose**. Add these actions in this order
(search for each one in the search bar at the bottom). Type everything exactly as shown.

1. **Get Contents of URL**
   - URL: `https://api-ae.libreview.io/llu/auth/login`
   - Tap **›** to show more. **Method**: `POST`
   - **Headers** → **Add new header** twice: `product` = `llu.ios` and `version` = `4.16.0`
   - **Request Body**: `JSON` → **Add new field** → **Text** twice: `email` = the LibreLinkUp email and
     `password` = the LibreLinkUp password
2. **Get Dictionary Value** – Get **Value** for key `data.authTicket.token` in **Contents of URL**
3. **Set Variable** – name `Token`
4. **Get Dictionary Value** – key `data.user.id`. Tap the blue input after "in" → **Select Variable** →
   tap **Contents of URL** under action 1.
5. **Generate Hash** – tap the type and choose **SHA256**
6. **Change Case** – **lowercase**
7. **Set Variable** – name `AccountID`
8. **Get Contents of URL**
   - URL: replace whatever is in the URL field with `https://api-ae.libreview.io/llu/connections`
   - **Method**: `GET`
   - **Headers** → four headers: `product` = `llu.ios`, `version` = `4.16.0`,
     `Authorization` = `Bearer ` (with a space after it) followed by the **Token** variable
     (tap **Variables** above the keyboard), and `account-id` = the **AccountID** variable
9. **Get Dictionary Value** – key `data` (in the Contents of URL from action 8)
10. **Get Item from List** – **First Item**
11. **Get Dictionary Value** – key `glucoseMeasurement`
12. **Set Variable** – name `Reading`
13. **Get Dictionary Value** – key `ValueInMgPerDl` in **Reading**
14. **Set Variable** – name `BG`
15. **Get Dictionary Value** – key `FactoryTimestamp`. Change the input after "in" to the **Reading** variable.
16. **URL Encode** – **Encode**
17. **Set Variable** – name `Time`
18. **Get Dictionary Value** – key `TrendArrow`. Change the input after "in" to the **Reading** variable.
19. **Set Variable** – name `Trend`
20. **URL** – type the calculator's address followed by `?libre=1&bg=`
    (for this copy: `https://markwendelllontocdotcom.github.io/Insuline_Dose_Calc_2026_V2/?libre=1&bg=`), then insert
    **BG**, type `&ts=` then insert **Time**, type `&trend=` then insert **Trend**
21. **Open URLs**

Before running it, check every typed item letter by letter, including capital letters: `email`, `password`,
`product`, `llu.ios`, `version`, the email address and the password. The keyboard can change the first letter to a
capital, and then the sign-in fails.

Tap **Done**. Run it once. Whenever iPhone asks whether the Shortcut may connect to `api-ae.libreview.io`
(it can ask more than once), tap **Always Allow**. The calculator opens in Safari with the reading box.

To put it on the Home Screen: open the Shortcut, tap its name at the top (or **ⓘ**) → **Add to Home Screen**.
You can use the calculator icon: save `icons/icon-512.png` to Photos first and choose it as the picture.

### 3. If it does not work

The calculator says **"Could not get a reading from Libre"** when anything goes wrong. To see why, add a
**Quick Look** action straight after action 1, run the Shortcut and read what it shows (remove it afterwards):

- `"redirect":true` and `"region":"xx"`: your account is on another server. Change `ae` to that region
  (for example `eu`) in the addresses of actions 1 and 8.
- `"status":2`: wrong email or password.
- `"step"` with `"tou"` or `"pp"`: open the LibreLinkUp app, sign in and accept the terms.

If action 1 looks fine, move the Quick Look to straight after action 8:

- `"status":920` or a message about the version: change `4.16.0` in actions 1 and 8 to the version shown in the
  LibreLinkUp app (**Menu** → **About**).
- `"data":[]`: the follow invitation has not been accepted yet.

If the Shortcut stops with an error (for example no internet), open the calculator from its own icon and type the reading.

## Changing the plan later

1. On GitHub open `app.js`, click the pencil icon and change the numbers in `DOSE_PLAN`
   (and `planTitle` if the plan has a new name or year). Also update `version` and `date` in `APP_INFO`
   (shown under **Instructions** → **About**). Click **Commit changes**.
2. Open `service-worker.js` the same way and raise `CACHE_VERSION` by one (for example `v4` to `v5`).
   Commit. Without this step phones keep the old version.
3. On the iPhone open the app while online. It updates itself when nothing has been typed yet;
   otherwise a blue bar says “A new version is ready – tap here to reload”.
4. Check the **Plan** tab shows the new numbers. The **Instructions** tab shows which offline copy is in use (v1, v2 …).

## Running the tests (optional, needs Node.js 18 or newer)

```
node --test
```

Run it from this folder. The tests cover the required cases, every correction band boundary in every column,
the arrows, the rounding, the colours, the messages, the clock-based meal time, the Libre reading checks,
the live Libre rules (fill, update, never change a typed reading, nothing by itself after Clear, LO/HI removed)
and the relay (sign-in, region, headers, key, refused sign-in pause, one child only) against a pretend LibreLinkUp.

## About

**Insulin Dose Calculator** – Version 2.1 · 17 Oct 2026

What is new in 2.1:
- Live Libre readings (optional; they need the Libre relay described above).
- An **About** section with the credits at the end of the **Instructions** tab.
- The Libre Shortcut address now points at the V2 site.

The version and date shown in the app come from `APP_INFO` near the top of `app.js`.

FreeStyle Libre, LibreLinkUp and LibreView are trademarks of Abbott. This app is not made by or connected with Abbott.

Developed by Mark Lontoc | Dubai, United Arab Emirates

© 2026 MLWorks. All rights reserved | Version 2.1 · 17 Oct 2026
