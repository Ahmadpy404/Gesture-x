import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

jest.setTimeout(30000);

describe('Gesture X E2E', () => {
  let browser;

  beforeAll(async () => {
    const extensionPath = path.resolve(__dirname, '../../');
    browser = await puppeteer.launch({
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  async function getExtensionId() {
    await new Promise(r => setTimeout(r, 1000));
    const targets = await browser.targets();
    const target = targets.find(t => t.type() === 'service_worker');
    if (!target) {
      throw new Error('Service worker target not found');
    }
    return target.url().split('/')[2];
  }


  async function openExtensionPage(urlPath) {
    const extensionId = await getExtensionId();
    const url = `chrome-extension://${extensionId}/${urlPath}`;
    
    const initialPage = await browser.newPage();
    await initialPage.goto('about:blank');
    
    const newTargetPromise = browser.waitForTarget(t => t.url() === url && t.type() === 'page', { timeout: 10000 });
    
    await initialPage.evaluate((targetUrl) => {
      window.open(targetUrl, '_blank');
    }, url);
    
    const newTarget = await newTargetPromise;
    const newPage = await newTarget.page();
    await initialPage.close();
    
    return newPage;
  }

  test('Service Worker registers and Extension loads successfully', async () => {
    const page = await browser.newPage();
    page.goto('about:blank').catch(() => {});
    
    const extensionId = await getExtensionId();
    expect(extensionId).toBeDefined();
    await page.close();
  });
});
