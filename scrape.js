const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
    const nameSheet = "charlottesville_marketing_agency.csv";
    const googleUrl =
        "https://www.google.com/maps/search/charlottesville+marketing+agency/@38.5349049,-82.7797161,6.42z?entry=ttu&g_ep=EgoyMDI1MDYxNy4wIKXMDSoASAFQAw%3D%3D";

    console.time("Execution Time");

    const browser = await chromium.launch({ headless: false, slowMo: 50 });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(googleUrl, { waitUntil: "domcontentloaded" });

    await page.waitForSelector('div[role="feed"]');

    // ✅ Smart Scroll Logic — Wait for new cards each time
    async function autoScrollListings(page) {
        const scrollContainer = await page.$('div[role="feed"]');
        if (!scrollContainer) throw new Error("Scrollable listings container not found");

        let lastCount = 0;
        let sameCountTimes = 0;

        for (let i = 0; i < 50; i++) {
            await page.evaluate(el => el.scrollBy(0, 1000), scrollContainer);
            await page.waitForTimeout(2000); // Give it time to load

            const currentCount = await page.$$eval('div[role="article"]', els => els.length);
            console.log(`Scroll ${i + 1}: ${currentCount} items loaded.`);

            if (currentCount === lastCount) {
                sameCountTimes++;
            } else {
                sameCountTimes = 0;
                lastCount = currentCount;
            }

            if (sameCountTimes >= 5) {
                console.log("No new items loaded. Scrolling done.");
                break;
            }
        }
    }

    // 🌀 Scroll until all listings load
    await autoScrollListings(page);

    // 🌍 Extract business URLs
    const urls = await page.$$eval('a[href*="/maps/place/"]', links => {
        const seen = new Set();
        return links
            .map(a => a.href.split("?")[0])
            .filter(href => {
                if (!seen.has(href)) {
                    seen.add(href);
                    return true;
                }
                return false;
            });
    });

    console.log(`Found ${urls.length} business URLs.`);

    // 🛠 Scraping Function
    const scrapePageData = async (url) => {
        try {
            const newPage = await context.newPage();
            await newPage.goto(url, { waitUntil: "domcontentloaded" });
            await newPage.waitForTimeout(3000); // wait for page to settle

            const getText = async (selector) => {
                try {
                    const el = await newPage.$(selector);
                    return el ? (await el.textContent()).trim().replace(/\s+/g, " ") : "";
                } catch {
                    return "";
                }
            };

            const getAttr = async (selector, attr) => {
                try {
                    const el = await newPage.$(selector);
                    return el ? await el.getAttribute(attr) : "";
                } catch {
                    return "";
                }
            };

            const name = `"${await getText("h1")}"`;
            const rating = `"${await getText('[aria-label*="stars"]')}"`;
            const reviews = `"${(await getText('[role="img"] + span'))?.replace(/\(|\)/g, "")}"`;
            const category = `"${await getText('[class*="fontBodyMedium"] span')}"`;
            const address = `"${await getText('[data-item-id*="address"]')}"`;
            const website = `"${await getAttr('a[data-item-id*="authority"]', "href")}"`;
            const phone = `"${await getText('[data-tooltip*="phone"]')}"`;

            await newPage.close();

            return {
                name,
                rating,
                reviews,
                category,
                address,
                website,
                phone,
                url: `"${url}"`,
            };
        } catch (err) {
            console.error("Scrape error for:", url, err);
            return {
                name: '""',
                rating: '""',
                reviews: '""',
                category: '""',
                address: '""',
                website: '""',
                phone: '""',
                url: `"${url}"`,
            };
        }
    };

    // 📦 Scrape URLs in batches
    const results = [];
    const batchSize = 5;
    for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(scrapePageData));
        results.push(...batchResults);
        console.log(`Processed batch ${i / batchSize + 1}`);
    }

    // 📝 Save to CSV
    const csvHeader = "Name,Rating,Reviews,Category,Address,Website,Phone,Url\n";
    const csvRows = results.map(r =>
        `${r.name},${r.rating},${r.reviews},${r.category},${r.address},${r.website},${r.phone},${r.url}`
    ).join("\n");

    fs.writeFileSync(nameSheet, csvHeader + csvRows);
    await browser.close();
    console.timeEnd("Execution Time");
})();
