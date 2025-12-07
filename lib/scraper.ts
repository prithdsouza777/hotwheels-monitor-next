import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { store, Alert, ProductData } from './store';

const URL = "https://www.firstcry.com/hotwheels/5/0/113?sort=popularity&q=ard-hotwheels&ref2=q_ard_hotwheels&asid=53241";

// Types
export interface Product {
    name: string;
    in_stock: boolean;
    link: string;
    image: string;
}

// Minimal args for speed
chromium.setGraphicsMode = false; // default
const minimalArgs = [
    "--autoplay-policy=user-gesture-required",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-client-side-phishing-detection",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-domain-reliability",
    "--disable-extensions",
    "--disable-features=AudioServiceOutOfProcess",
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-notifications",
    "--disable-offer-store-unmasked-wallet-cards",
    "--disable-popup-blocking",
    "--disable-print-preview",
    "--disable-prompt-on-repost",
    "--disable-renderer-backgrounding",
    "--disable-setuid-sandbox",
    "--disable-speech-api",
    "--disable-sync",
    "--hide-scrollbars",
    "--ignore-gpu-blacklist",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-first-run",
    "--no-pings",
    "--no-sandbox",
    "--no-zygote",
    "--password-store=basic",
    "--use-gl=swiftshader",
    "--use-mock-keychain",
];

let isRunning = false;
let seenProducts: Record<string, ProductData> = {};
let firstRun = true;

const formatTime = () => new Date().toLocaleTimeString('en-US', { hour12: false });

export async function startScraper() {
    if (isRunning) return;

    // On Vercel, we can't rely on setInterval staying alive forever. 
    // But we can start the check if it's not running.
    // The state will assume to be "scraping" until finished.

    // Race condition to prevent hanging
    const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Scrape timeout")), 25000)
    );

    try {
        await Promise.race([checkProducts(), timeout]);
    } catch (e) {
        console.error("Scrape timed out or failed:", e);
        store.update({ is_scraping: false });
    }
}

async function checkProducts() {
    if (isRunning) return;
    isRunning = true;
    store.update({ is_scraping: true, last_updated: "Checking..." }); // Immediate feedback
    console.log(`Scraping... ${formatTime()}`);

    let browser;
    try {
        let executablePath = await chromium.executablePath();
        if (process.env.NODE_ENV === 'development') {
            executablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
        }

        browser = await puppeteer.launch({
            args: process.env.NODE_ENV === 'production' ? chromium.args : minimalArgs,
            defaultViewport: { width: 1920, height: 1080 },
            executablePath: executablePath || undefined, // undefined lets puppeteer look if not provided
            headless: process.env.NODE_ENV === 'production' ? chromium.headless : true, // Use chromium.headless for prod
        });

        const page = await browser.newPage();

        await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        await autoScroll(page);

        // Parse page
        const products: Record<string, ProductData> = await page.evaluate(() => {
            const results: Record<string, ProductData> = {};
            const blocks = document.querySelectorAll('.list_block');

            blocks.forEach((block) => {
                try {
                    const linkTag = block.querySelector('a[href]') as HTMLAnchorElement;
                    if (!linkTag) return;
                    const href = linkTag.href;

                    const titleTag = block.querySelector('a[title]') as HTMLAnchorElement;
                    let name = titleTag ? titleTag.title : linkTag.innerText.trim();

                    if (!name) {
                        const img = block.querySelector('img[alt]') as HTMLImageElement;
                        if (img) name = img.alt;
                    }

                    const addToCartBtn = block.querySelector('.ga_bn_btn_addcart');
                    const blockText = (block as HTMLElement).innerText.toLowerCase();
                    const textIndicatesOOS = blockText.includes('out of stock') || blockText.includes('sold out') || blockText.includes('notify me');

                    const isInStock = !!addToCartBtn && !textIndicatesOOS;

                    const imgTag = block.querySelector('img[src]') as HTMLImageElement;
                    const imageUrl = imgTag ? imgTag.src : '';

                    results[href] = {
                        name,
                        in_stock: isInStock,
                        link: href,
                        image: imageUrl
                    };
                } catch (e) {
                    // Ignore
                }
            });
            return results;
        });

        // Process Updates
        const currentAlerts = [...store.state.alerts];
        const currentMonitored = [...store.state.monitored_products];
        const newProducts = products;

        Object.entries(newProducts).forEach(([pid, data]) => {
            if (!seenProducts[pid]) {
                // NEW Item
                if (!firstRun && data.in_stock) {
                    // Check dupes
                    const isDuplicate = currentAlerts.some(a => a.link === data.link && a.type === 'NEW');
                    if (!isDuplicate) {
                        const alert: Alert = {
                            type: 'NEW',
                            message: `New Product: ${data.name}`,
                            link: data.link,
                            time: formatTime()
                        };
                        currentAlerts.unshift(alert);
                        if (currentAlerts.length > 50) currentAlerts.pop();

                        if (!currentMonitored.some(p => p.link === data.link)) {
                            currentMonitored.unshift({
                                ...data,
                                alert_type: 'NEW',
                                alert_time: formatTime()
                            });
                            if (currentMonitored.length > 20) currentMonitored.pop();
                        }
                    }
                }
                seenProducts[pid] = data;
            } else {
                const oldData = seenProducts[pid];
                if (!oldData.in_stock && data.in_stock) {
                    const isDuplicate = currentAlerts.some(a => a.link === data.link && a.type === 'STOCK');
                    if (!isDuplicate) {
                        const alert: Alert = {
                            type: 'STOCK',
                            message: `Back in Stock: ${data.name}`,
                            link: data.link,
                            time: formatTime()
                        };
                        currentAlerts.unshift(alert);
                        if (currentAlerts.length > 50) currentAlerts.pop();

                        if (!currentMonitored.some(p => p.link === data.link)) {
                            currentMonitored.unshift({
                                ...data,
                                alert_type: 'STOCK',
                                alert_time: formatTime()
                            });
                            if (currentMonitored.length > 20) currentMonitored.pop();
                        }
                    }
                }
                seenProducts[pid] = data;
            }
        });

        const filteredMonitored = currentMonitored.filter(p => {
            return newProducts[p.link] && newProducts[p.link].in_stock;
        });

        store.update({
            current_products: newProducts,
            alerts: currentAlerts,
            monitored_products: filteredMonitored,
            last_updated: new Date().toLocaleString(),
            is_scraping: false
        });

        firstRun = false;

    } catch (error) {
        console.error("Error in scraper:", error);
        store.update({ is_scraping: false });
    } finally {
        if (browser) await browser.close();
        isRunning = false;
    }
}

async function autoScroll(page: any) {
    // Limited scroll for performance
    await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 300; // Faster scroll
            const maxScrolls = 20; // Limit depth to avoid timeouts
            let scrolls = 0;

            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                scrolls++;

                if (totalHeight >= scrollHeight || scrolls >= maxScrolls) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}
