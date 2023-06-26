const Readability = require('@mozilla/readability').Readability;
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const { JSDOM } = require('jsdom');
const pandoc = require('./pandoc.js');

class Crawler {
  constructor(url) {
    this.url = url;
    this.content = '';
    this.media = [];
  }

  async crawl() {
    const browser = await puppeteer.launch({headless: 'new', args: ['--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3312.0 Safari/537.36"'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/110.0');

    await page.goto(this.url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    await new Promise ( (resolve) => setTimeout(resolve, 2000));

    const content = await page.content();
    await this.extractMedia(page);
    const readableArticle = await this.extractReadableContent(content);
    const pandocCrawl = await this.extractPandoc(page, content);

    const screenshotFilename = await this.takeScreenshot(page);
    const screenshot = await fs.readFile(screenshotFilename);

    await browser.close();

    return {
      url: this.url,
      content,
      media: this.media,
      readableArticle,
      pandocCrawl,
      screenshot,
    };

  }

  async takeScreenshot(page) {
    const screenshotFileName = `${this.url.replace(/[:\/]/g, '_')}.screenshot.png`;
    await page.screenshot({path:screenshotFileName});
    return screenshotFileName;
  }

  async extractMedia(page) {
    this.media = await page.evaluate(() => {
      const mediaList = [];

      const images = document.querySelectorAll('img');
      const videos = document.querySelectorAll('video');

      images.forEach((img) => {
        mediaList.push({
          type: 'image',
          url: img.src,
          alt: img.alt,
        });
      });

      videos.forEach((video) => {
        mediaList.push({
          type: 'video',
          url: video.src,
        });
      });

      return mediaList;
    });
  }

  async extractPandoc(page) {
    const tmpHtmlFilename = `${this.url.replace(/[:\/]/g, '_')}.tmp.html`;
    const content = await page.content();
    await fs.writeFile(tmpHtmlFilename, content);
    const tmpMdFilename = `${this.url.replace(/[:\/]/g, '_')}.tmp.md`;
    await pandoc.pandocToMd('123123', tmpHtmlFilename, tmpMdFilename);

    let contents = await fs.readFile(tmpMdFilename);
    contents = contents.toString().replace(/^:::.*$/gm, '');
    await fs.writeFile(tmpMdFilename, contents);

    await pandoc.pandocToHtml(tmpMdFilename, tmpHtmlFilename);
    contents = await fs.readFile(tmpHtmlFilename);
    const readableArticle = await this.extractReadableContent(contents);

    const md5Contents = (await fs.readFile(tmpMdFilename)).toString();
    const pandocCrawl = {
      md5Contents,
      contents: contents.toString(),
      readableArticle,
    }

    await fs.unlink(tmpHtmlFilename);
    await fs.unlink(tmpMdFilename);


    return pandocCrawl;
  }

  async extractReadableContent(content) {
    const jsdom = new JSDOM(content, {url: this.url});
    const article = new Readability(jsdom.window.document).parse();
    return article ?? {content:'',title:'',textContent:''};
  }

  async saveContentToFile() {
    const fileName = `${this.url.replace(/[:\/]/g, '_')}.content.html`;
    await fs.writeFile(fileName, this.content);
  }

  async saveMediaToFile() {
    const fileName = `${this.url.replace(/[:\/]/g, '_')}.media.json`;
    await fs.writeFile(fileName, JSON.stringify(this.media, null, 2));
  }
}

class RedisCrawler {
  constructor(client) {
    this.client = client;
  }

  async crawl(url) {
    try {
      await this.storeCrawlState(url, 'BUSY');
      const crawler = new Crawler(url);
      const page = await crawler.crawl();

      await this.savePage(page, url);
      await this.storeCrawlState(url, 'DONE');
    } catch (e) {
      await this.storeCrawlState(url, 'ERROR');
      console.error('ERROR', e);
      console.log('URL', url, 'HAD AN ERROR');
      throw new Error('Z');
    }
  }

  getCrawlKey(url) { return `crawler:${url}`; }
  getPageKey(url) { return `page:${url}`; }
  getScreenshotKey(url) { return `screenshot:${url}`; }

  async savePage(page, url) {
    const screenshotBinaryContents = page.screenshot;
    delete page.screenshot;

    const key = this.getPageKey(url);
    await this.client.set(key, JSON.stringify(page));

    const screenshotKey = this.getScreenshotKey(url);
    await this.client.set(screenshotKey, screenshotBinaryContents);
  }

  async getPage(url) {
    const key = this.getPageKey(url);
    const page = await this.client.get(key);
    if (!page) {
      return null;
    }
    return JSON.parse(page);
  }

  async storeCrawlState(url, state) {
    const key = this.getCrawlKey(url);
    await this.client.set(key, state);
  }


}

module.exports = { RedisCrawler, Crawler };
