# 🧭 Scraper — Marseille Accessible Events

Crawlee + TypeScript actor that fetches the **accessible-events playlist** from the official
Marseille-Tourisme API, then visits every event page, parses its
`application/ld+json` schema and stores a clean, flat **Event** record to
an Apify dataset.

| Stack                          | Why                                                    |
| ------------------------------ | ------------------------------------------------------ |
| **Apify SDK v3**               | Cloud-ready actor runtime, key-value stores & datasets |
| **Crawlee 3 · CheerioCrawler** | Fast HTTP/HTML scraping with built-in queue            |
| **TypeScript**                 | Strong typing (see `src/types.ts → Event`)             |
| **dayjs**                      | Elegant date maths for the playlist facet              |

---

## ✨ Features

- **One-shot playlist POST** – size =`maxEvents`, start =`0`.
- Dynamic **date window facet**
  `start = today 00:00`, `end = today + monthsAhead (end of month)`.
- Only events with **wheelchair criteria** are requested.
- Extracts title, description, dates, venue, geo & images from the
  schema graph, **deduplicating** overlapping WebPage/Event fields.
- Output dataset contains tidy `Event` objects (see schema below).

---

## 📦 Project structure

```

src/
main.ts          ⇠ actor entry – seeds playlist POST & starts crawler
routes.ts        ⇠ Cheerio router (PLAYLIST  +  EVENT\_PAGE)
types.ts         ⇠ export interface Event
package.json
README.md          ⇠ you are here
apify.json         ⇠ actor manifest
INPUT\_SCHEMA.json  ⇠ UI + validation for actor input

```

---

## 🔧 Input

| Field           | Type    | Default | Prefill | Description                                          |
| --------------- | ------- | ------- | ------- | ---------------------------------------------------- |
| **maxEvents**   | integer | 1000    | 42      | Max number of events to request in the playlist POST |
| **monthsAhead** | integer | 3       | –       | Date-window length (today → today + N months)        |

`INPUT_SCHEMA.json` enforces both fields; `maxEvents` is **required**.

### Example `input.json`

```json
{
    "maxEvents": 42,
    "monthsAhead": 3
}
```

---

## ▶️ Run locally

```bash
# install deps
npm install

# optional: build once
npm run build

# run with the example input
apify run -i input.json    # or  npm start
```

Add `--purge` to clear previous datasets / queues:

```bash
apify run --purge -i input.json
```

---

## 🗂 Output dataset (Event)

```ts
interface Event {
    url: string; // canonical event URL
    name: string | null;
    description?: string;
    startDate?: string; // ISO YYYY-MM-DD
    endDate?: string;
    venue?: string;
    address?: string;
    city?: string;
    postalCode?: string;
    latitude?: string;
    longitude?: string;
    images?: string[];
}
```

Empty / duplicate fields are removed before the record is pushed.

---

## 🔑 Environment variables

None.
If you route traffic through the Apify proxy, set it in **`apify.json`**
or export `APIFY_PROXY_PASSWORD`.

---

## 🗺️ High-level flow

```text
Input → build POST body ─┐
                         │
        ┌─────────────── CheerioCrawler ────────────────┐
        │                                               │
   PLAYLIST handler                           EVENT_PAGE handler
  • parse JSON                                 • parse LD+JSON
  • enqueue https:// links (label:EVENT_PAGE)  • build typed Event
        │                                               │
        └─► RequestQueue 'playlist' ◄───────────────────┘
                         │
                    Apify Dataset  ←─── Event records
```

---

## 📝 License

MIT © 2025 yfe404
