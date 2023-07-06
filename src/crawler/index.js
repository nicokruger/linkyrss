
const path = require('path');
const fs = require('fs');
const { Crawler, RedisCrawler } = require('./crawler');
const summarise = require('./summarise.js');
const IORedis = require('ioredis');
const redis = require('redis');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
const client = redis.createClient({url:redisUrl});
const createLogger = require('./logger');
const logger = createLogger(module);
const database = require('./database.js');
const python = require('./python.js');
const refeed = require('./refeed.js');
const cluster = require('./cluster.js');
const feeds = require('./feeds.js');

const { FlowProducer, Queue, Worker, QueueScheduler, QueueEvents } = require('bullmq');
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
//const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const express = require('express');


async function crawl(db, url) {
  if (!db) throw new Error('db required');
  const redisCrawler = new RedisCrawler(client, db);

  const page = await redisCrawler.crawl(url);
  return page;

}

async function start() {
  await client.connect();
  const queues = await module.exports.getQueues(client);
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');
  /*const { addQueue, removeQueue, setQueues, replaceQueues } =*/
  createBullBoard({
    queues: [
      new BullAdapter(queues.rssFeedQueue),
      new BullAdapter(queues.pageCrawlerQueue),
      new BullAdapter(queues.summarizerQueue),
      new BullAdapter(queues.embeddingQueue),
      new BullAdapter(queues.clustererQueue),
      new BullAdapter(queues.aiWriterQueue),

      //new BullMQAdapter(queueMQ)
    ],
    serverAdapter: serverAdapter,
  });

  const app = express();

  app.use('/admin/queues', serverAdapter.getRouter());

  // other configurations of your server

  //const port = parseInt(process.env.PORT ?? 3000);
  const port = 8080;
  console.log('starting on port', port);
  app.listen(port, () => {
    console.log('Running on port', port);
    console.log(`For the UI, open http://localhost:${port}/admin/queues`);
  });
}

if (require.main == module) {
	start().then( async () => {
	  logger.info('started');
	});
}

let __queues = null;

module.exports.getQueues = async (client) => {
  if (__queues) return __queues;

  const opts = {
    connection:new IORedis(redisUrl),
    removeOnComplete: {
      age: 60 * 60 * 16, // 16 hours
    }
  }

  const db = new database.FilesystemDatabase("./work");

  const rssFeedQueue = new Queue('feed', opts);
  const pageCrawlerQueue = new Queue('pageCrawler', opts);
  const summarizerQueue = new Queue('summarizer', opts);
  const embeddingQueue = new Queue('embedding', opts);
  const clustererQueue = new Queue('clusterer', opts);
  const aiWriterQueue = new Queue('aiWriter', opts);
  const flowProducer = new FlowProducer(opts);

  __queues = {
    rssFeedQueue,
    pageCrawlerQueue,
    summarizerQueue,
    flowProducer,
    embeddingQueue,
    clustererQueue,
    aiWriterQueue
  }


  // Setup the workers
  new Worker('feed', async (job) => {
    const { feed, total } = job.data;
    logger.info(`[${feed}] ${total} articles`);
    /*
    const { feed, n } = job.data;
    console.log('rssFeed', job.data);

    await refeed.parseAndStoreFeed(feed, n);
    */

  }, opts);

  new Worker('pageCrawler', async (job) => {
    const { article, feed, index } = job.data;

    const url = article.link;
    await crawl(db, url);

    //await summarizerQueue.add('summarize', { url, article });
  }, {
    ...opts,
    concurrency: 6,
  });

  new Worker('summarizer', async (job) => {
    //console.log('summarizer', job.data);
    const { url, article } = job.data;

    const page = await db.getPage(url);
    const key = `summary:${page.url}`;
    const alreadyExists = await client.exists(key);
    if (alreadyExists) return article;

    const summary = await summarise.summarise_url(
      article.link,
      page.pandocCrawl.readableArticle.textContent
    );

    await client.set(key, JSON.stringify(summary));

  }, {
    ...opts,
    concurrency: 10,
    attempts: 5,
    backoff: {
      type: 'exponential', // or 
      delay: 1200,
    }
  });

  new Worker('embedding', async (job) => {
    const {inFileName, outFileName} = job.data;
    logger.debug(`embedding ${inFileName} -> ${outFileName}`);
    const relativeToRoot = path.join(__dirname, '..');
    const clustererDir = path.join(relativeToRoot, 'clusterer');
    await python.runPython(clustererDir, 'embeddings.py', [inFileName, outFileName]);
  }, {
    ...opts,
  });

  new Worker('clusterer', async (job) => {
    const {inFileName, outPostsName} = job.data;
    logger.debug(`clustering ${inFileName} -> ${outPostsName}`);
    const relativeToRoot = path.join(__dirname, '..');
    const clustererDir = path.join(relativeToRoot, 'clusterer');
    await python.runPython(clustererDir, 'cluster.py', [inFileName, outPostsName]);
  }, {
    ...opts,
  });

  new Worker('aiWriter', async (job) => {
    const { articles, feed, outPostsName } = job.data;
    logger.debug(`aiWriter: ${articles.length} articles, ${feed} -> ${outPostsName}`);

    const feedwriter = new feeds.FeedWriter(feed, client);
    await feedwriter.clearFeed();

    const clusteredPosts = JSON.parse(fs.readFileSync(outPostsName, 'utf8').toString());
    await summarise.aiWriter(
      clusteredPosts,
      feedwriter,
      client
    );
    await feedwriter.writeFeedMeta({
      summary:true,
      meta:{
        title:'Test',
        description:'Test',
      }
    });


  }, {
    ...opts,
  });

  return __queues;


}





if (false && require.main === module) {
  //const url = 'https://www.nytimes.com/2023/06/16/us/daniel-ellsberg-dead.html';
  //const url = 'https://lemmy.ninja/post/19617';
  //const url = 'https://www.inmytree.co.za'
  //const url = 'https://franklinetech.com/rss-feeds-benefits-and-how-to-use-them/';
  const url = 'https://old.reddit.com/r/rss/comments/14b26vr/i_made_an_rss_based_ai_bookmarker/';
  test_crawl(url).then( (page) => {
    logger.info('page', page);
    //console.log('content', page.content);
    //console.log('content', page.readableArticle.content);
    //fs.writeFileSync('content.html', page.readableArticle.content ?? '');
    //console.log('title', page.readableArticle.title);
    //console.log('textContent', page.readableArticle.textContent);
//    console.log('md5', page.pandocCrawl);
    //console.log('readable', page.pandocCrawl.readableArticle.textContent);
    //console.log('media', page.media);
  });
}
