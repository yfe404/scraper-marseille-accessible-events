import { createCheerioRouter } from 'crawlee';
import { Event } from './types.js';

export function buildRouter() {
    const router = createCheerioRouter();

    /* ── PLAYLIST JSON handler ─────────────────────────────────────── */

    // routes.ts  – PLAYLIST handler
    router.addHandler('PLAYLIST', async ({ body, request, log, crawler }) => {
        const json = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf-8') : (body as string));

        const urls = (json.items ?? [])
            .map((it: any) => it.link as string)
            .filter((u: string) => u?.startsWith('https://www.marseille'));

        // add each Event page to the SAME queue with label EVENT_PAGE
        for (const url of urls) {
            await crawler.requestQueue!.addRequest({
                url,
                label: 'EVENT_PAGE',
            });
        }

        log.info(`[PLAYLIST] total=${json.playlist?.total ?? 'n/a'} ` + `enqueued=${urls.length} | ${request.url}`);
    });

    // ────────────────────────────────────────────────────────────────
    // EVENT_PAGE  – parse <script type="application/ld+json">
    // ────────────────────────────────────────────────────────────────

    router.addHandler('EVENT_PAGE', async ({ $, request, pushData, log }) => {
        let eventNode: any = null;
        let webPageNode: any = null;

        // iterate over every <script type="application/ld+json">
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const raw = JSON.parse($(el).text());
                const graph: any[] = raw['@graph'] || [];

                // pick the first Event / WebPage we encounter
                for (const node of graph) {
                    if (!eventNode && node['@type'] === 'Event') eventNode = node;
                    if (!webPageNode && node['@type'] === 'WebPage') webPageNode = node;
                    if (eventNode && webPageNode) break;
                }
            } catch {
                /* ignore malformed JSON */
            }
        });

        if (!eventNode) {
            log.warning('No Event schema found', { url: request.url });
            return;
        }

        const rec: Event = {
            url: eventNode.url ?? webPageNode?.url ?? request.url,
            name: eventNode.name ?? webPageNode?.headline ?? null,
            description: eventNode.description ?? webPageNode?.description,
            startDate: eventNode.startDate,
            endDate: eventNode.endDate,
            venue: eventNode.location?.name,
            address: eventNode.location?.address?.streetAddress,
            city: eventNode.location?.address?.addressLocality,
            postalCode: eventNode.location?.address?.postalCode,
            latitude: eventNode.location?.geo?.latitude,
            longitude: eventNode.location?.geo?.longitude,
            images: eventNode.image,
        };

        // drop null / empty values
        (Object.keys(rec) as (keyof Event)[]).forEach((k) => {
            const v = rec[k];
            if (v == null || (Array.isArray(v) && v.length === 0)) {
                delete (rec as any)[k]; // 👈 cast lets TS accept dynamic delete
            }
        });
        await pushData(rec);
        log.info(`Saved event: ${rec.name}`, { url: request.url });
    });

    return router;
}
