const Queue = require('idoit');

const fs = require('fs');
const { Crawler, RedisCrawler } = require('./crawler');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
const redis = require('redis');
const client = redis.createClient(redisUrl);
const queue = new Queue({
  redisURL: redisUrl,
  concurrency:2,
  ns: 'rssai2',
  pool: 'rssai'
});

async function crawl(url) {
  const redisCrawler = new RedisCrawler(client);

  await redisCrawler.crawl(url);

}

async function start() {
  await client.connect();
}

start().then( () => {
  console.log('started');
});

module.exports.getQueues = async (client) => {
  queue.registerTask('refeed', async ({article,index}) => {
    console.log('ok');
    await client.set(`article:${index}`, JSON.stringify(article));
    console.log('ok2');

    return article;
  });
  queue.registerTask('crawl', async (article) => {
    console.log('crawl', article.link);
    const url = article.link;
    await crawl(url);
    return article;
  });

  queue.on('error',  err => {   // Split task errors and internal errors
    if (err instanceof Queue.Error) {
      console.error(`Error in task "process" function: ${err}`);
    } else {
      console.error(`idoit internal error: ${err}`);
    }
  });

  queue.options({concurreny: 2});
  await queue.start();
  queue.options({concurreny: 2});

  return {q:queue};


}





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
