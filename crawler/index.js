const fs = require('fs');
const { Crawler, RedisCrawler } = require('./crawler');
const redis = require('redis');
const client = redis.createClient();
const limit = require('p-limit')(4);

async function test_crawl(url) {
  const crawler = new Crawler(url);
  const page = await crawler.crawl();
  return page;
}

async function crawl(url) {
  const client = redis.createClient();
  await client.connect();
  const redisCrawler = new RedisCrawler(client);

  await redisCrawler.crawl(url);

}

async function start() {
  let processing = 0;
  // subscribe to redis topic "crawl"
  client.subscribe('crawl', async (message) => {
    processing++;
    console.log(`[${processing}] received message: ${message}`);
    limit(async () => {
      const url = message;
      console.log('url', url);
      await crawl(url);
      console.log(`[${processing}/${limit.activeCount}] finished ${url}`);
      processing--;
    });
  });

  await client.connect();
}

start().then( () => {
  console.log('started');
});





if (false && require.main === module) {
  //const url = 'https://www.nytimes.com/2023/06/16/us/daniel-ellsberg-dead.html';
  //const url = 'https://lemmy.ninja/post/19617';
  //const url = 'https://www.inmytree.co.za'
  //const url = 'https://franklinetech.com/rss-feeds-benefits-and-how-to-use-them/';
  const url = 'https://old.reddit.com/r/rss/comments/14b26vr/i_made_an_rss_based_ai_bookmarker/';
  test_crawl(url).then( (page) => {
    console.log('page', page);
    //console.log('content', page.content);
    //console.log('content', page.readableArticle.content);
    //fs.writeFileSync('content.html', page.readableArticle.content ?? '');
    //console.log('title', page.readableArticle.title);
    console.log('textContent', page.readableArticle.textContent);
    console.log('md5', page.pandocCrawl);
    console.log('readable', page.pandocCrawl.readableArticle.textContent);
    //console.log('media', page.media);
  });
}
