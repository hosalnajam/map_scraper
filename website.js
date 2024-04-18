const playwright = require("playwright");
const csv = require("csv-parser");
const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const baseURL = "homecare_in_Nassau_County.csv";
const delayTime = 1000;
const emailFilter = [
    "@sentry-next.wixpress.com",
    ".png",
    "sentry.io",
    "@sentry.wixpress.com",
    "@wix.com",
];
async function scrapeEmails(url) {
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage();
    try {
        await page.goto(url, { timeout: delayTime });
        await page.waitForLoadState("networkidle");
        const content = await page.content();
        const emailRegex =
            /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
        let emailMatches = content.match(emailRegex);
        if (emailMatches) {
            emailMatches = emailMatches.filter(
                (email) =>
                    !emailFilter.some((filterItem) =>
                        email.includes(filterItem)
                    )
            );
        }
        return emailMatches ? Array.from(new Set(emailMatches)) : [];
    } catch (error) {
        if (error.name === "TimeoutError") {
            console.warn(`Timeout when accessing: ${url}`);
            return [];
        } else {
            throw error;
        }
    } finally {
        await browser.close();
    }
}
async function processCsv() {
    const rows = [];
    const headersSet = new Set();
    const batchSize = 5;
    const readStream = fs.createReadStream(baseURL).pipe(csv());
    const allRows = [];
    for await (const row of readStream) {
        allRows.push(row);
    }
    for (let i = 0; i < allRows.length; i += batchSize) {
        const batch = allRows.slice(i, i + batchSize);
        const batchPromises = batch.map(async (row) => {
            const newRow = { ...row };
            const website = row.Website || "";
            if (website) {
                console.log(`Scraping: ${website}`);
                const emails = await scrapeEmails(website);
                emails.forEach((email, index) => {
                    const emailHeader = `Email${index + 1}`;
                    newRow[emailHeader] = email;
                    headersSet.add(emailHeader);
                });
            }
            return newRow;
        });
        const batchResults = await Promise.allSettled(batchPromises);
        batchResults.forEach((result) => {
            if (result.status === "fulfilled") {
                rows.push(result.value);
            }
        });
    }
    const headers = Object.keys(rows[0]).concat(Array.from(headersSet));
    return { rows, headers };
}
async function writeCsv({ rows, headers }) {
    const outputFileName = baseURL.replace(".csv", "_emails.csv");
    const csvWriter = createCsvWriter({
        path: outputFileName,
        header: headers.map((header) => ({ id: header, title: header })),
    });
    await csvWriter.writeRecords(rows);
    console.log(`CSV file written successfully to ${outputFileName}`);
}
processCsv().then(writeCsv);
