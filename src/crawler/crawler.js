const Readability = require('@mozilla/readability').Readability;
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const { JSDOM } = require('jsdom');
const pandoc = require('./pandoc.js');
const createLogger = require('./logger');
const logger = createLogger(module);

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
      waitUntil: 'load',
      timeout: 60000
    });
    await this.waitTillHTMLRendered(page);
    await new Promise ( (resolve) => setTimeout(resolve, 2000));

    const content = await page.content();

    await this.extractMedia(page);
    const links = await this.extractLinks(page);
    const readableArticle = await this.extractReadableContent(content);
    const pandocCrawl = await this.extractPandoc(page, content);

    const screenshotFilename = await this.takeScreenshot(page);
    const screenshot = await fs.readFile(screenshotFilename);

    await fs.unlink(screenshotFilename);

    await browser.close();

    return {
      url: this.url,
      content,
      media: this.media,
      readableArticle,
      pandocCrawl,
      screenshot,
      links
    };

  }

  async waitTillHTMLRendered(page, timeout = 60000) {
    const checkDurationMsecs = 1000;
    const maxChecks = timeout / checkDurationMsecs;
    let lastHTMLSize = 0;
    let checkCounts = 1;
    let countStableSizeIterations = 0;
    const minStableSizeIterations = 5;

    while(checkCounts++ <= maxChecks){
      let html = await page.content();
      let currentHTMLSize = html.length; 

      let bodyHTMLSize = await page.evaluate(() => document.body.innerHTML.length);

      logger.debug('last: ', lastHTMLSize, ' <> curr: ', currentHTMLSize, " body html size: ", bodyHTMLSize);

      if(lastHTMLSize != 0 && currentHTMLSize == lastHTMLSize) 
        countStableSizeIterations++;
      else 
        countStableSizeIterations = 0; //reset the counter

      if(countStableSizeIterations >= minStableSizeIterations) {
        logger.debug("Page rendered fully..");
        break;
      }

      lastHTMLSize = currentHTMLSize;
      await page.waitForTimeout(checkDurationMsecs);
    }  
  }

  async takeScreenshot(page) {
    const screenshotFileName = `${this.url.replace(/[:\/]/g, '_')}.screenshot.png`;
    await page.screenshot({path:screenshotFileName});
    return screenshotFileName;
  }

  async extractLinks(page) {
    const hrefs = [...(await page
      .$$eval('a', as => as.filter(a => !!a.href)
      .map( (a) => { return {
        href:a.href,
        content:a.textContent
      }}) 
      ))]
    .reduce((map, obj) => {
      if (!map[obj.href]) map[obj.href] = [];
      map[obj.href].push(obj.content);
      map[obj.href] = [...new Set(map[obj.href])];
      map[obj.href] = map[obj.href].filter((x) => x !== '');
      return map;
    }, {});

    const byhref = Object.keys(hrefs).map((href) => {
      return {
        href,
        content: hrefs[href]
      }
    });
    return byhref;
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

  cleanUrlForFilename(url) {
    const urlObj = new URL(url);
    const urlPath = urlObj.pathname;
    const urlPathParts = urlPath.split('/');
    const urlFilename = urlPathParts[urlPathParts.length - 1];
    if (urlFilename === '') {
      return 'slashslashslashindexb';
    }
    return urlFilename
  }

  async extractPandoc(page) {
    const tmpHtmlFilename = `${this.cleanUrlForFilename(this.url)}.tmp.html`;
    const content = await page.content();
    await fs.writeFile(tmpHtmlFilename, content);
    const tmpMdFilename = `${this.cleanUrlForFilename(this.url)}.tmp.md`;
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

      const alreadyCrawled = await this.client.get(this.getCrawlKey(url));
      if (alreadyCrawled === 'DONE') {
        //console.log('URL', url, 'ALREADY CRAWLED');

        await this.publishCrawlResult(url);

        const key = this.getPageKey(url);
        const page = await this.client.get(key);
        return JSON.parse(page);
      }

      await this.storeCrawlState(url, 'BUSY');
      const crawler = new Crawler(url);
      const page = await crawler.crawl();

      await this.savePage(page, url);
      await this.storeCrawlState(url, 'DONE');

      await this.publishCrawlResult(url);

      return page;

    } catch (e) {
      await this.storeCrawlState(url, 'ERROR');
      logger.error('URL', url, 'HAD AN ERROR');
      logger.error('ERROR', e);
      throw e;
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

  async publishCrawlResult(url) {
    //const page = await this.getPage(url);
    //const screenshotKey = this.getScreenshotKey(url);
    //const screenshot = await this.client.get(screenshotKey);
    //await this.client.publish('crawled', JSON.stringify({url, page, screenshot}));
    const pageKey = this.getPageKey(url);
    await this.client.publish('crawled', pageKey);
  }


}

if (require.main === module) {
  (async function () {
    const url = process.argv[2];
    if (!url) {
      console.error('URL required');
      process.exit(1);
    }
    const crawler = new Crawler(url);
    const page = await crawler.crawl();
    console.log(page);
  })().then(console.log);
}
module.exports = { RedisCrawler, Crawler };
