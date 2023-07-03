
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
const refeed = require('./refeed.js');

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

start().then( async () => {
  logger.info('started');
});

let __queues = null;

module.exports.getQueues = async (client) => {
  if (__queues) return __queues;

  const opts = {
	  connection:new IORedis(redisUrl)
  }

  const db = new database.FilesystemDatabase("./work");

  const rssFeedQueue = new Queue('feed', opts);
  const pageCrawlerQueue = new Queue('pageCrawler', opts);
  const summarizerQueue = new Queue('summarizer', opts);
  const clustererQueue = new Queue('clusterer', opts);
  const aiWriterQueue = new Queue('aiWriter', opts);
  const flowProducer = new FlowProducer(opts);

  __queues = {
    rssFeedQueue,
    pageCrawlerQueue,
    summarizerQueue,
    flowProducer
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
    //console.log('pageCrawler', job.data);
    const { article, name, index } = job.data;
    await client.set(`article:${name}:${index}`, JSON.stringify(article));

    const url = article.link;
    await crawl(db, url);

    //await summarizerQueue.add('summarize', { url, article });
  }, {
    concurrency: 4,
    connection: opts.connection
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
    connection: opts.connection,
    concurrency: 10,
    attempts: 5,
    backoff: {
      type: 'exponential', // or 
      delay: 1200,
    }
  });

	console.log('LAL');
  return __queues;

  /*
  queue.on('task:progress', async (data) => {

    //console.log('progress', data);
    const jobIdKey = `jobid:${data.id}`;
    let jobUrl = await client.get(jobIdKey);
    if (jobUrl) {
      const percent = data.progress / data.total * 100;
      const last50Chars = jobUrl.slice(-50);
      logger.info(`[${last50Chars}] ${percent.toFixed(2)}%`);
    } else {
      jobUrl = await client.get(`jobid:${data.uid}`);
      if (jobUrl) {
        logger.info('task progress2', data.progress/ data.total);
      } else {
      //console.log('cannot find', jobIdKey, data.id, data.uid);
      }

    }
  });

  queue.registerTask('crawl', async ({name, article,index}) => {
    await client.set(`article:${name}:${index}`, JSON.stringify(article));

    const url = article.link;
    await crawl(db, url);

    return {url,article};
  });

  queue.registerTask('summary', async ({url,article}) => {
    const page = await db.getPage(url);
    const key = `summary:${page.url}`;
    const alreadyExists = await client.exists(key);
    if (alreadyExists) return article;

    const summary = await summarise.summarise_url(
      article.link,
      page.pandocCrawl.readableArticle.textContent
    );

    await client.set(key, JSON.stringify(summary));

    return article;
  });

  queue.on('error',  err => {   // Split task errors and internal errors
    if (err instanceof Queue.Error) {
      logger.error(`Error in task "process" function: ${err}`);
    } else {
      logger.error(`idoit internal error: ${err}`);
    }
  });

  await queue.start();

  return {q:queue};
  */

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
