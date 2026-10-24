# Apex Chimney

A private, single-user web app for building focused chimney repair estimates from a reusable
catalog of findings, repair recommendations, and standard sizes. No accounts and no backend. Prices are optional and
stay private unless you choose to show them.

## Use it on your phone without a computer

**Hosted copy (works now):** <https://claude.ai/artifact/RJ1iAWwS5r5MhZE9NN5t1f>

This is a private page on claude.ai. Open it on your iPhone while signed in to your Claude account (Safari or the
Claude app); your computer doesn't need to be on. It isn't public — only you, and people you share it with from the
page's Share menu, can open it. Inside this hosted page the browser sandbox blocks a few things, so:

| Works in the hosted copy | Not available in the hosted copy |
|---|---|
| Estimates, system type, guided problems, measurements, repairs | **Save PDF** (file downloads are blocked; use *Copy customer text*) |
| Photos and videos from the camera or library | |
| Title and proposed-work writing, preview, copying | **Photo analysis** (outside network calls are blocked) |
| Private copy to WhatsApp (opens WhatsApp in a new tab) | **Share internal PDF** (the share sheet is blocked) |
| Catalog and size editing, settings | **Export backup** (file downloads are blocked); restoring a backup works |

**Full-featured hosting (recommended for everyday use; about 10 minutes, free):** publish this folder to a static HTTPS
host. Simplest: sign in at <https://app.netlify.com/drop> and drag the app folder (with `index.html`, `styles.css`,
`sw.js`, `manifest.webmanifest`, `icon.svg`, and `js/`) onto the page. You get an address like
`https://your-name.netlify.app`; open it in Safari on your iPhone and use Share → **Add to Home Screen**. That copy has
every feature, including Save PDF and photo analysis, and after the first visit it opens
without a signal (the app's files are cached on the phone). GitHub Pages or Cloudflare Pages work the same way.
This needs your own account, so it can't be done from here.

**Your data on the phone:** estimates, photos, and videos are stored in the phone's browser storage for whichever copy you
use (hosted page or Netlify address — each starts empty and keeps its own data). Nothing is uploaded or synced, so no
backend or cloud storage is needed for one person on one phone. To move data between devices, use Settings → Export
backup on one and Restore from backup on the other. Syncing between phone and computer would need a backend with
cloud storage, which this app doesn't have.

## Run it

It's a static site with no build step and no dependencies.

- **Simplest:** open `index.html` in Chrome, Edge, Safari, or Firefox.
- **More dependable:** serve the folder locally and open <http://127.0.0.1:8765>:

  ```bash
  ruby -run -e httpd . -b 127.0.0.1 -p 8765
  ```

  (Any static server works, e.g. `python3 -m http.server 8765` if Python is installed.)

Pick one way and stick with it: the browser keeps data separately for `file://`, `localhost`, `127.0.0.1`,
and any other address, so switching between them looks like an empty app.

### On iPhone

The whole workflow — photos, forms, repair choices, preview, copying — is laid out for phone screens
(large tap targets, a fixed **next step** button at the bottom, 16 px inputs so Safari doesn't zoom).

To open it on your iPhone from your Mac, serve it on your Wi-Fi network and visit the Mac's address:

```bash
ruby -run -e httpd . -b 0.0.0.0 -p 8765
```

Then on the iPhone open `http://<your-mac's-IP>:8765` (System Settings → Wi-Fi → Details shows the IP), and use
Share → **Add to Home Screen** for an app-like icon. Notes:

- The iPhone keeps **its own** copy of the data. Move data between devices with Settings → Export / Restore backup.
- Over plain `http://` on the network, copying uses a fallback method. Hosting the app on HTTPS removes that limit.
- The Mac must be on and serving for the iPhone to load the app this way.

## Where data is stored

Everything is in the browser's **IndexedDB** on each device (database `chimney-estimator`):

| Store       | Contents |
|-------------|----------|
| `estimates` | One self-contained snapshot per estimate (client, system, components, findings, repairs, sizes chosen, title, description, notes, photo captions) |
| `findings`  | Finding catalog |
| `repairs`   | Repair recommendation catalog |
| `photos`    | Resized photos (max 2000 px, JPEG) and thumbnails |
| `meta`      | Settings, size library (`sizes`), estimate counter, migration markers, photo-analysis key (`ai`, never exported) |

The app asks the browser to mark storage as persistent. Still, clearing site data or switching devices won't carry
data over, so use **Settings → Export backup** regularly. Restoring a backup replaces all current data (this browser's
photo-analysis key is kept).

## Workflow

The editor shows four numbered steps — **Client · System · Problems · Wording** — with a check mark as each is done,
and one main button that always names the next thing to do (on iPhone it sits at the bottom of the screen).
Duplicate, Delete, and Mark as presented live under **More**.

1. **New estimate** (or press `N`): client name, contact details, job address, date.
2. **System type:** *Wood* continues straight on. *Gas* asks for the manufacturer and model first — type them, or use
   **Read label from photo**.
3. **What's wrong?** — **+ Add a problem** walks through four short steps, each with **← Back**:
   1. **Component** — tap one (only components with problems for this system type are shown).
   2. **Problem** — tap one, or describe something else; optional status.
   3. **Repair** — the repairs linked to that problem first; more options stay folded away. If exactly one repair is linked
      to the problem it starts checked (labelled as such) — you still confirm by adding it, and you can uncheck it.
   4. **Measurements** — at most two up front: the ones the chosen problem and repair use (e.g. flue size for a chimney cap, area for tuck
      pointing). Anything else for that component — chimney height, cap size, firebox depth — waits behind
      **More measurements**. Tap a common size, type an unusual one under *Other*, or **Skip measurements**. A measurement
      you already entered earlier in this estimate is offered again, labelled "from earlier in this estimate". Nothing is
      filled in otherwise. **Add to estimate** finishes.
   Chosen sizes are written onto the matching measurement and repair rows. **📷 Take photo / ⬆ Upload photo** runs the same
   flow starting from a photo (see Photo analysis).
4. Each item (a finding and its repairs) shows as one row: its title and a one-line summary of status, repairs, key
   sizes, and photo count, so the whole estimate can be scanned at a glance. Tap a row to expand it, or use
   **Expand all** / **Collapse all**. Newly added items open automatically. Component details (location, appliance,
   manufacturer, model) sit under **Component details** below each component's items.
5. Adjust details in an expanded item if needed. Measurement and detail rows that match a standard size show a
   **Select size…** list with **Other…** for manual entry; **More measurements** adds the component's other sizes. Each repair has
   an editable **Why it matters** line, and each finding and repair has its own **📷 Add photos or videos**.
6. **✎ Write title & description**, then review and edit both. The description has a live character count and no length
   limit.
7. **Preview** shows the customer estimate; **Done** brings you back to **After the preview** (Save PDF, Copy customer
   text, private WhatsApp copy). **Mark as presented** is in the **More** menu.

Edits autosave about a second after you stop typing (`Ctrl/⌘+S` saves immediately); adding a problem or photo saves at once.
Estimates can be searched, reopened, duplicated (photos are copied), and deleted (photos are removed too).

## Standard sizes

**Catalog → Sizes** lists the size choices by component and measurement type (name, unit, comma-separated choices,
and optional other names a measurement row might use, e.g. "Approx. area" for "Area"). The starter list covers common
US sizes for caps (flue size, cap size, round flue diameter), flue liners (diameter, length, flue size, approximate
chimney height), crowns, chase covers, dampers, connectors, gas vents, masonry, fireboxes (opening, depth, brick count),
and flashing — edit, extend, or restore it any time. Estimates store the chosen size as text, so editing the list never
changes saved estimates.

## Masonry: tuck pointing

Two editable repair options are in the catalog under Masonry and are suggested for *Deteriorated mortar joints*:

- **Standard tuck pointing** (`MAS-FIX-04`) — remove loose and deteriorated mortar from the affected joints and install
  new mortar compatible with the existing masonry.
- **Major tuck pointing** (`MAS-FIX-05`) — grind out the deteriorated mortar from the joints throughout the repair area,
  then apply new mortar to fully repoint those joints.

Both carry Area (sq ft) and Mortar color fields. The existing *Repoint mortar joints* entry is unchanged.

## Title and proposed-work description

The **project title** is named from the selected repairs in customer-friendly terms. One repair gives titles such as
*Chimney Crown Restoration*, *Stainless Steel Flue Liner Installation*, or *Major Masonry Tuck Pointing*; two give
*Chimney Cap Installation & Chase Cover Replacement*; several give *Chimney Flashing, Crown & Masonry Restoration*.
Custom repairs are named from their own wording ("Replace cleanout door" becomes *Cleanout Door Replacement*). Edit it freely.


The **proposed-work description** is written in the browser by fixed rules from what is in the estimate, in plain,
warm wording for a homeowner, organized **by repair item**:

1. **Opening.** "Thank you for considering Apex Chimney. This estimate describes five repairs we recommend for the
   wood-burning chimney at 12 Elm St, Columbus, OH 43215: sealing of the crown cracks, major tuck pointing, … For each
   one, we explain what we found, why it matters, exactly what the work includes, and what it will accomplish, so you
   have the full picture before deciding. This estimate covers only these items; it isn’t a full inspection of the
   chimney." In package mode it names the repairs included in the package; the package section of the estimate carries
   the offer itself.
2. **One block per repair**, headed by the repair's name (*Chimney Crown Restoration*), containing everything
   customer-facing that the estimate holds for that item:
   - **About the chimney crown** (or flashing, damper, and so on): a plain, general explanation of what the part is and
     what it does. It appears the first time each part comes up, so a homeowner can follow the rest.
   - **What we found**: the condition and your note. A suspected finding reads "(to be confirmed)"; one needing more
     evaluation reads "(needs a closer look)".
   - **Measurements**: every measurement you entered, such as "Approx. crack length 18 in."
   - **Equipment**: the manufacturer and model, if you chose to show them.
   - **Why it matters**: the risk, for Confirmed findings only.
   - **What we’ll do**: the full repair description, meaning the steps and materials as worded in your catalog.
   - **Work details**: every repair detail you entered, such as cap size or materials.
   - **How this helps**: the expected result of the work.
   - **Note**: your note on the repair.
3. **Closing.** "Taken together, these repairs address every condition described above. Completing the work helps protect
   your home and gives you peace of mind about these parts of your chimney."

**Why it matters** explains the risk of a finding, and it is used **only for findings you mark Confirmed**. A suspected
finding never gets a risk statement. The starter findings have one-sentence, general risk lines (for example "Cracks in
the crown can let water into the chimney, where freeze-thaw cycles can widen them and damage the masonry below"); edit
or clear them in the catalog, or per item in the editor. Starter findings got this line only if you hadn't changed
their wording. Nothing else is added: no diagnosis, cause, code requirement, material, measurement, timeline, warranty,
or guarantee.

There is **no length limit**: nothing is condensed or dropped, and the estimate runs to as many pages as the selected
work needs (five repairs came to about 4,000 characters and a three-page PDF in testing). The box still shows a live
character count. Internal-only measurements and private notes are never included. Customer-facing text never uses the word "scope"; the section is headed **Proposed Work**.

## Pricing, packages, and discounts (optional)

The **Pricing & discount** card (after Title & proposed work) stays folded until you need it. Nothing in it reaches the
customer unless you turn on its **Show** switch, and the card shows a live "Customer will see …" line.

- **Present the work as** *Individual items* or *One package*. A package is presented as one coordinated project: the
  customer document says "The selected work represents a substantial project. Apex Chimney is offering a special package
  for this job," lists every included repair under **Included in this package**, and labels each repair "Included in the
  package." The description opens the same way. The wording comes only from the repairs you selected. No price, discount,
  savings, or offer amount is claimed; a price appears only if you enter one and turn on **Show prices**.
- **Repair prices** (private): type a price for each repair and the item total is added up. In package mode these stay
  private, and **Use item total** copies the sum into the package price, which you can change.
- **Package price**, **package name**, and private **pricing notes** (materials, labor, how you reached the number).
- **Show prices on the customer estimate** is off by default. When on, the estimate shows the package price, or each
  item's price and their total.
- **Discount**: pick a category (Senior, Veteran, Review customer; edit the list in Settings). An amount in $ or % is
  optional and only what you type; nothing is assumed. **Show discount on the customer estimate** is off by default.
  With both prices and the discount shown, the estimate shows the discount line and the resulting total.

The amounts are yours; the app only adds and subtracts them.

## Private client notes

Step 1 has a yellow **Private note** box for things that help in later conversations: family names, preferences, access
details. It is never shown to the customer and never included in copied text or photos, and it goes into a PDF only if
you tick **Include private notes** when saving. It is part of your private WhatsApp copy. A note stays
with its estimate, and when you open another estimate for the same client (matched by name or phone number), notes from
their other estimates appear under **Private notes from other estimates**. Estimates with a note show a *Private note*
tag in the list, and the list search includes note text. Edit a note any time, or use **Delete note**.

## Preview: the customer estimate

**Preview** shows the final customer estimate exactly as the customer will see it, and nothing else. It has no
editing, copying, PDF, print, download, save, sharing, or status buttons; **Done** returns to the editor. The layout is
a conventional estimate:

1. **Letterhead**: Apex Chimney (or your business name from Settings) with your address, phone, email, website, and license.
2. **Estimate** heading with the estimate number and date ("Date: October 24, 2026").
3. **Customer** (name, phone, email), **Job address**, and **System**.
4. **Project** title, then one plain sentence on what the estimate covers. That sentence is in Settings → Wording; the
   earlier default was reworded automatically, and a sentence you wrote yourself is kept.
5. In package mode, the **package** section: the offer and the list of included repairs.
6. **Proposed Work**, one block per repair: About the part, What we found, Measurements, Why it matters, What we’ll do,
   Work details, How this helps.
7. **Photos** marked "Show to customer", each with its caption. A photo without a caption is captioned with the problem
   or repair it belongs to.
8. **Package Price** or **Price**, only if you turned on Show prices. Otherwise the estimate says "Pricing is not
   included in this estimate."
9. **Next Steps**: how to approve the estimate and schedule the work, using the phone and email from Settings. It has
   no dates or promises.
10. Any assumptions and exclusions you selected, then **Terms Used in This Estimate**: plain meanings of other trade
   terms in the estimate (tuck pointing, flue, and so on) that an "About" line hasn't already explained.

Private notes, internal measurements, identification research, hidden media, item prices in package mode, and internal
pricing never appear. Dates use the U.S. format and prices are in dollars.

## After the preview: your records

When you return from the preview, the editor opens the **After the preview** card, which has:

- **What the customer will see**: format, prices, discount, media count, private notes.
- **Save PDF** creates a PDF on this device for your records (on iPhone it goes to Files → Downloads). Nothing is sent
  to anyone. Two boxes, both unticked by default: **Include private notes** and **Include internal pricing**. If you tick
  either, those details go on a separate last page and every page is marked "Internal copy".
- **Copy customer text** copies the customer document as plain text.
- **Private copy to WhatsApp** (next section).
- **Mark as presented** is in the editor's **More** menu.

## Private copy to WhatsApp

The private copy is the complete estimate followed by **all internal details**: status, the private client note,
internal notes, access notes, each item's private notes and internal-only measurements, identification details and
lookup notes, risk lines held back from unconfirmed findings, hidden media counts, and internal pricing (each repair
price, item total, package price, discount, what the customer sees, pricing notes). It is built separately from the
customer document, and nothing in it goes into the preview, copied customer text, or customer PDF.

It goes to one fixed number: **+1 (614) 496-3246**. That number is set in the code (`js/private.js`), not in Settings,
so nothing can send it anywhere else.

**How it is delivered, and what "sent" means:**

- **Open WhatsApp with private copy** opens `https://wa.me/16144963246` with the full text already typed (on iPhone, in
  the WhatsApp app). **You tap Send.** If that number is your own, WhatsApp opens your "Message yourself" chat.
- **Share internal PDF…** (iPhone and other devices with a share sheet, not in the hosted claude.ai copy) creates the
  internal PDF with notes and pricing and opens the share sheet; pick WhatsApp and your own chat.
- The card shows exactly what happened: *opened, not confirmed sent*; *handed to the share sheet*; *cancelled, nothing
  was sent*; *failed*, with the error; or, after you tap **I sent it**, *you confirmed it was sent*. **Not sent** records
  that it wasn't. The app never says a message was delivered, because it cannot see inside WhatsApp.
- The text copy leaves out photos and videos. The internal PDF includes the customer-visible ones.

**Why it isn't automatic, and what that would take.** A web page on your phone can't send WhatsApp messages by itself.
Sending automatically, with real delivery confirmation, needs the **WhatsApp Business Platform (Cloud API)**:

1. A Meta Business account and a WhatsApp Business app in Meta for Developers.
2. A business phone number registered to the Cloud API (its *phone number ID*). It must be a different number from the
   one receiving the copy.
3. A permanent access token (a system-user token). It must be kept on a server or serverless function, never in this
   app, since anyone with the page could read it.
4. An approved **message template** for business-initiated messages. Free-form text is allowed only within 24 hours of
   your last message to the business number.
5. Your number's opt-in to receive messages from that business number.
6. A small backend endpoint that receives the private text from the app, calls the Cloud API, and returns its message ID
   and delivery status.

None of these exist in this project, and this app has no server, so automatic sending is not implemented. The
**Open WhatsApp** link was tested to build the right address and text; no message was sent during testing.

## Photos and videos

- **Add:** every finding and repair has **📷 Add photos or videos** (on iPhone: take a photo, record video, or choose from
  the library). The *What's wrong?* step also has Take photo / Upload photo, which starts a new problem from a photo.
- **Attach / move:** each file has an **Attached to** menu listing every finding and repair (plus General), so you can move
  it to the right item, e.g. from the masonry finding to *Major tuck pointing*.
- **Caption, Show to customer, Replace, Remove** on every file.
- **Sizes and formats:** photos are resized to 2000 px JPEG. Videos up to 250 MB are stored as-is. If this browser can't
  play a format (for example some iPhone HEVC `.mov` files in Chrome), the card says so and shows the file name; the file
  is still saved and plays in browsers that support it (Safari on iPhone and Mac plays iPhone video).
- **Storage:** media live in this browser's storage on this device only. Large videos use a lot of space and make
  backups big.
- There is no inspection-limitations section, and the estimate states that only the listed items are covered. Unless you
  show prices, it also says pricing is not included.
- A **What the customer will see** panel above the estimate lists the format (items or package), whether prices and a
  discount are shown, how many photos and videos are included, and that private notes stay out. Check it before you
  copy or save the PDF.

Never shown or copied: private client notes and other yellow private fields, pricing notes, individual repair prices in
package mode, any price or discount you haven't switched on, detail fields marked **Internal**, internal notes,
identification research, photo-analysis results, old access notes, hidden photos, and anything from other estimates.

## Photo analysis (optional)

**Settings → Photo analysis**: paste an Anthropic API key to turn it on. The app then calls the Claude API directly from
the browser (model `claude-opus-5-5` by default). For each photo it suggests the component, manufacturer/model (gas
labels), visible condition, and a matching problem, each with a confidence level and short explanation. You must
confirm, correct, or ignore every suggestion; only confirmed values are used, and only to pre-select choices. Unclear
photos are flagged and you choose manually. Each analysis sends the photo plus your catalog's component and finding
names — no customer details. The key stays in this browser and is left out of backups; usage is billed to your
Anthropic account. Without a key, photos are attached and you identify everything manually.

## Catalog

**Catalog** has three tabs — Findings, Repair recommendations, and Sizes — searchable, grouped by component, and
filterable by component and system type. Each finding/repair has an identifier (e.g. `CRN-FND-01`), name,
customer-facing description, category, optional model/system type, the system types it applies to (wood, gas, or both),
optional measurement/detail fields with units, assumptions, exclusions, private notes, and links between findings and
repairs (kept in sync both ways). Estimates copy catalog text when an item is added, so editing or deleting catalog
entries never changes saved estimates.

## Updating from earlier versions

No setup is needed: open the app as before. On first load it migrates data in place without deleting or rewording anything.

- **Version 10 (this update):** the 2,000-character limit is removed. Descriptions include every measurement, repair
  detail, risk, and expected result, with plain explanations of each part and a Next Steps section. Existing descriptions
  keep their wording until you choose **Rewrite from selections**.
- **Version 9:** the customer estimate uses a conventional U.S. layout (Estimate heading, customer details,
  project, proposed work by repair item, photos with captions, price only when shown, plain-language terms). The default
  coverage sentence is reworded only if you never changed it. Existing descriptions keep their wording until you choose
  **Rewrite from selections**; older wording still displays correctly.
- **Version 8:** starter findings whose wording you hadn't changed get a general "Why it matters" risk
  line, used only when a finding is Confirmed. Estimates gain an optional private-copy status. The preview is now the
  customer document only; Save PDF and copying moved to the editor's **After the preview** card. Existing estimates and
  their wording are unchanged until you choose **Rewrite from selections**.
- **Version 7:** no data changes. The print action and customer share links are removed (old share links
  no longer open); Save PDF replaces them. Items in the editor collapse to a summary row.
- **Version 6:** renamed to Apex Chimney (the letterhead shows Apex Chimney until you enter your business
  name in Settings). Adds optional pricing and discount fields and a private client note to each estimate, all empty and
  hidden from customers until you use them. Existing estimates, wording, and catalog entries are unchanged.
- **Version 5:** fuller wording for starter repairs whose description you hadn't changed (including the two
  tuck-pointing entries). Confirmations now appear inside the app instead of as browser pop-ups. Nothing else changes in
  your data.
- **Version 4:** adds the two tuck-pointing repairs (only if those codes are free) and links them to
  *Deteriorated mortar joints*; adds a "Why it matters" line to starter repairs whose wording you hadn't changed; adds cap
  size, approximate chimney height, and firebox depth to the size list where missing. Repairs can now hold photos and
  videos. Existing wording, estimates, and size choices are untouched.
- **Version 3:** added the starter size library (only if you didn't have one); the preview always lists the selected items.
- **Version 2:** catalog entries got a system type (starter firebox, damper, smoke chamber, connector, and sweep entries
  marked wood-only); gas starter options were added where their codes were missing; estimates gained a system type and
  title/description record; old access-limitation notes became a private field.
- Backups from any version can be restored; migrations run after restore.

## Identification lookup

From a component's *System identification* section, **Look up / confirm identification** opens a web search for
manuals and specifications in a new tab (the app fetches nothing), lets you paste source links (store and price pages
are rejected), record what they indicate, and — only after you confirm the match — copy chosen values into the
component. Lookup never touches findings or repairs.

## Limitations

- One device and one browser per copy of the data; no sync. Use export/restore to move data.
- The hosted claude.ai copy has been published but not opened on an iPhone in testing; it can't save PDFs, export backups, or
  run photo analysis (see the table at the top).
- Videos are stored, not converted; whether one plays depends on the viewing browser. Tested here with a WebM clip in
  Chrome; iPhone `.mov` playback has not been tested on a real iPhone.
- Photo analysis needs your own Anthropic API key and an internet connection; it has not been run against the live API
  in testing here. A photo can suggest but never establishes a diagnosis.
- The title and description are rule-based, not AI-written: accurate to your selections; edit as needed.
- WhatsApp delivery isn't automatic: the app opens WhatsApp with the message ready, and you send it. It can't confirm
  delivery. It hasn't been tried on a real iPhone, and no test message was sent.
- HEIC photos import only in browsers that can decode them (Safari, including iPhone).
- PDFs use the standard PDF fonts (Helvetica and Times) rather than the app's on-screen fonts. Characters outside
  Western European text (for example emoji) are left out of the PDF.
- Keyboard: `/` focuses search, `N` starts a new estimate from the list, `Esc` closes dialogs, `Ctrl/⌘+S` saves.
