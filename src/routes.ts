import { createCheerioRouter } from 'crawlee';

export function buildRouter() {
    const router = createCheerioRouter();

    /* ── PLAYLIST JSON handler ─────────────────────────────────────── */

    // routes.ts  – PLAYLIST handler
router.addHandler('PLAYLIST', async ({ body, request, log, crawler }) => {
    const json = JSON.parse(
        Buffer.isBuffer(body) ? body.toString('utf-8') : (body as string),
    );

    const urls: string[] = (json.items ?? [])
        .map((it: any) => it.link as string)
        .filter((u) => u?.startsWith('https://www.marseille'));

    // add each Event page to the SAME queue with label EVENT_PAGE
    for (const url of urls) {
        await crawler.requestQueue!.addRequest({
            url,
            label: 'EVENT_PAGE',
        });
    }

    log.info(
        `[PLAYLIST] total=${json.playlist?.total ?? 'n/a'} ` +
        `enqueued=${urls.length} | ${request.url}`,
    );
});
    /* ── EVENT_PAGE handler ────────────────────────────────────────── */
    router.addHandler('EVENT_PAGE', async ({ $, request, pushData }) => {
        const title = $('title').first().text().trim() || null;
        await pushData({ url: request.url, title });
    });

    return router;
}
