import { createCheerioRouter } from 'crawlee';

import type { Event } from './types.js';

export function buildRouter() {
    const router = createCheerioRouter();

    // routes.ts – PLAYLIST handler (paginate until total)
    router.addHandler('PLAYLIST', async ({ body, request, log, crawler }) => {
        const json = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf-8') : (body as string));
        const items: any[] = json.items ?? [];
        const totalFromApi = Number(json.playlist?.total);
        const total = Number.isFinite(totalFromApi) ? totalFromApi : items.length;

        // enqueue EVENT pages
        const base = new URL(request.url);
        const urls = [
            ...new Set(
                (items.map((it: any) => it?.link).filter(Boolean) as string[]).map((u) => new URL(u, base).toString()),
            ),
        ];
        await crawler.addRequests(urls.map((url) => ({ url, label: 'EVENT_PAGE' })));

        // read original POST
        let orig: any = {};
        try {
            orig = JSON.parse((request.payload as string) ?? '{}');
        } catch {}

        const start = Number(orig?.start ?? 0) || 0;
        const nextStart = start + items.length; // advance by what we actually received
        const cap = total; // 👈 fetch everything reported by the API

        log.info(
            `[PLAYLIST] total=${total} received=${items.length} start=${start} cap=${cap} enqEvents=${urls.length} | ${request.url}`,
        );

        if (items.length > 0 && nextStart < cap) {
            const nextPayload = { ...orig, start: nextStart };
            await crawler.requestQueue!.addRequest({
                url: request.url,
                method: 'POST',
                payload: JSON.stringify(nextPayload),
                headers: { 'Content-Type': 'application/json' },
                label: 'PLAYLIST',
                useExtendedUniqueKey: true, // dedupe by URL+payload+headers
            });
            log.info(`[PLAYLIST] Paginating: next start=${nextStart}/${cap}`);
        } else {
            log.info(`[PLAYLIST] Pagination done (start=${start}, items=${items.length}).`);
        }
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
