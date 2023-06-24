const Readability = require('@mozilla/readability').Readability;
console.log('ok', Readability);
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const { JSDOM } = require('jsdom');

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
    console.log('GOTO', this.url);
    await page.goto(this.url, {
      //waitUntil: 'networkidle2',
      waitUntil: 'networkidle2',
    });
    await new Promise ( (resolve) => setTimeout(resolve, 2000));
    console.log('WENT');

    await this.fetchPageContent(page);
    await this.extractMedia(page);
    await this.extractReadableContent(page);
    await this.takeScreenshot(page);

    await browser.close();
  }
  async fetchPageContent(page) {
    this.content = await page.content();
  }

  async takeScreenshot(page) {
    await page.screenshot({path: 'screenshot.png'});
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

  async extractReadableContent(page) {
    const content = await page.content();
    console.log('content', content);
    const jsdom = new JSDOM(content, {url: this.url});
    console.log('document', jsdom.window.document.body);
    const article = new Readability(jsdom.window.document).parse();
    this.readableArticle = article ?? {content:'',title:'',textContent:''};
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

module.exports = { Crawler };
