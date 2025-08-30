import { createCheerioRouter } from 'crawlee';

import type { Event } from './types.js';

function extractObjectLiteral(scriptText: string, varName: string): string | null {
    // Find "const HwSheet ="
    const assignIdx = scriptText.indexOf(`const ${varName} =`);
    if (assignIdx === -1) return null;

    // Find the first '{' after the assignment
    const start = scriptText.indexOf('{', assignIdx);
    if (start === -1) return null;

    // Walk forward to find the matching closing brace '}' (handles nested braces)
    let i = start;
    let depth = 0;
    let inStr = false;
    let strQuote = '';
    let prev = '';

    while (i < scriptText.length) {
        const ch = scriptText[i];

        // rudimentary string skipping so braces inside strings don't break us
        if (!inStr) {
            if (ch === '"' || ch === "'" || ch === '`') {
                inStr = true;
                strQuote = ch;
            } else if (ch === '{') {
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    // include the closing brace
                    const jsonLike = scriptText.slice(start, i + 1);
                    return jsonLike;
                }
            }
        } else if (ch === strQuote && prev !== '\\') {
            inStr = false;
            strQuote = '';
        }
        prev = ch;
        i++;
    }
    return null;
}

export function buildRouter() {
    const router = createCheerioRouter();

    // routes.ts – PLAYLIST handler (paginate until total)
    router.addHandler('PLAYLIST', async ({ body, request, log, crawler }) => {
        const json = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf-8') : (body as string));
        const items: any[] = json.items ?? [];
        const totalFromApi = Number(json.playlist?.total);
        const total = Number.isFinite(totalFromApi) ? totalFromApi : items.length;

        // read original POST to get requested size (= maxEvents)
        let orig: any = {};
        try {
            orig = JSON.parse((request.payload as string) ?? '{}');
        } catch {}
        const start = Number(orig?.start ?? 0) || 0;
        const requestedSize = Number(orig?.size);
        const cap = Number.isFinite(requestedSize) ? Math.min(total, requestedSize) : total;

        // how many we still want from THIS page
        const remaining = Math.max(cap - start, 0);

        // take only up to `remaining` items from this page
        const pageSlice = remaining > 0 ? items.slice(0, remaining) : [];

        // enqueue EVENT pages (normalize + dedupe)
        const base = new URL(request.url);
        const urls = [
            ...new Set(
                pageSlice
                    .map((it: any) => it?.link)
                    .filter(Boolean)
                    .map((u: string) => new URL(u, base).toString()),
            ),
        ];

        await crawler.addRequests(urls.map((url) => ({ url, label: 'EVENT_PAGE' })));

        log.info(
            `[PLAYLIST] total=${total} requested=${requestedSize ?? 'all'} start=${start} received=${items.length} ` +
                `enqueuedThisPage=${urls.length} cap=${cap} | ${request.url}`,
        );

        // paginate: advance by what the server returned, but stop when we reach `cap`
        const nextStart = start + items.length;
        if (items.length > 0 && nextStart < cap) {
            const nextPayload = { ...orig, start: nextStart };
            await crawler.requestQueue!.addRequest({
                url: request.url,
                method: 'POST',
                payload: JSON.stringify(nextPayload),
                headers: { 'Content-Type': 'application/json' },
                label: 'PLAYLIST',
                useExtendedUniqueKey: true,
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
        let accessibility: string;

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

        const scriptText = $('script[type="text/javascript"]')
            .map((_, el) => $(el).html() || '')
            .get()
            .find((s) => s.includes('const HwSheet ='));

        const objLiteral = extractObjectLiteral(scriptText ?? '', 'HwSheet');
        const hwSheet = JSON.parse(objLiteral ?? '{}');
        accessibility = hwSheet.servicesOffers;

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
            accessibility, // contains info about accessibility options for various disabilities
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
