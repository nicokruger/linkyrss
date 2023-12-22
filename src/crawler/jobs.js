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
const cluster = require('./cluster.js');
const feeds = require('./feeds.js');
const _ = require('lodash');
const feedparser = require('feedparser-promised');
const { Feed, Category } = require('feed');
const summary = require('./summarise.js');

const { FlowProducer, Queue, Worker, QueueScheduler, QueueEvents } = require('bullmq');

let __queues = null;

logger.info("START");

async function markArticleBusy(client, articleKey) {
  const busyKey = `busy:${articleKey}`;
  const alreadyBusy = await client.exists(busyKey);
  if (alreadyBusy) return false;

  await client.set(busyKey, new Date().toISOString());
  return true;
}
function clearArticleBusy(client, articleKey) {
  const busyKey = `busy:${articleKey}`;
  return client.del(busyKey);
}
function setupworkers(db, client, opts) {
  // Setup the workers
  new Worker('feed', async (job) => {
    const { feed, total,chunkNum } = job.data;
    logger.info(`Done [${feed}] chunk ${chunkNum}, ${total} articles`);

    const childrenValues = await job.getChildrenValues();


    // never mark it done ?
    //for (const articleKey of Object.values(childrenValues)) {
      //logger.debug('set done', articleKey);
      //clearArticleBusy(client, articleKey);
    //}

  }, opts);

  new Worker('pageCrawler', async (job) => {
    const { article, feed, index } = job.data;
    //console.log(article);

    const urls = [{heading:"Article",link:article.link}];

    let extra_data = {links:[]};
    if (article.description) {
      extra_data = await summarise.get_urls_comments_and_votes(article.description);
    }

    for (const link of extra_data.links) {
      urls.push({heading:link.text,link:link.link});
    }

    for (const url of urls) {
      logger.info(`Crawling [${url.heading}]: ${url.link}`);
      const redisCrawler = new RedisCrawler(client, db);
      await redisCrawler.crawl(url.link);
      logger.info(`Crawling Done [${url.heading}]: ${url.link}`);
    }

    return {urls,extra_data};

    //await summarizerQueue.add('summarize', { url, article });
  }, {
    ...opts,
    concurrency: 1,
  });

  new Worker('summarizer', async (job) => {
    const { article, articleKey } = job.data;
    const key = `summary:${articleKey}`;

    const alreadyExists = await client.exists(key);
    if (alreadyExists) return articleKey;

    const data = await job.getChildrenValues();
    const {urls,extra_data} = Object.values(data)[0];

    const summary = await summarise.summarise(db, article, urls);
    summary.extra_data = extra_data;

    console.log('STORE', key);
    await client.set(key, JSON.stringify(summary));

    throw new Error('stop');
    return articleKey;

  }, {
    ...opts,
    concurrency: 1,
    attempts: 10,
    /*
    backoff: {
      type: 'exponential', // or 
      delay: 1200,
    }
    */
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
        title:'[AI] ' + feed,
        update:new Date().toISOString(),
        description:'AI Summarised feed for ' + feed,
      }
    });


  }, {
    ...opts,
  });


}

module.exports.getQueues = async (client, workers = false) => {
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


  if (workers) {
    setupworkers(db, client, opts);
  }

  return __queues;


}


const configFile = process.argv[2];
if (!configFile) {
  console.error('Please specify a config file');
  process.exit(1);
}

async function parseAndStoreFeed(feed, n) {
  function makeArticleKey(article) {
    const index = ((article.pubDate ?? article.pubdate ?? article.date).toISOString() + '__' + (article.guid ?? article.id)).replace(/:/g,'');
    const articleKey = `article:${feed.name}:${index}`;
    return {articleKey,index};
  }
  const queues = await module.exports.getQueues(client);

  const {url,name} = feed;
  const articleAgeMinutes = feed.articleAgeMinutes ?? 0;
  try {
    let articles = await feedparser.parse(url, {
      addmeta: true,
    });
    articles = articles.filter(article => {
      const articleDate = article.pubDate ?? article.pubdate ?? article.date;
      if (!articleDate) {
        logger.debug(`[REFEED] ${name} including article with no date`);
        return true;
      }
      const age = (new Date() - articleDate) / 1000 / 60;
      if (age < articleAgeMinutes) {
        logger.debug(`[REFEED] ${name} skipping article ${age} minutes old`);
        return false;
      }
      return true;
    });


    const latestArticles = _.shuffle(articles.slice(0, 3));
    logger.info(`[REFEED] ${name} ${latestArticles.length} articles`);


    if (!latestArticles.length) {
      logger.warn('there are no jobs for feed ' + feed.name);
      return;
    }

    // first, filter out articles that are busy and/or stuck somewhere
    const filteredArticles = [];
    for (const article of latestArticles) {
      const {articleKey,index} = makeArticleKey(article);
      if (!(await markArticleBusy(client, articleKey))) {
        logger.debug('article already busy', articleKey);
        continue;
      }
      filteredArticles.push(article);
    };

    let first = true;
    let i = 0;
    const chunkedArticles = _.chunk(filteredArticles, 20);
    for (const chunk of chunkedArticles) {
      const children = [];
      for (const article of chunk) {
        //console.log('article');
        //console.log('===========================')
        //console.log(JSON.stringify(article,null,2));
        //console.log('===========================')

        const {articleKey,index} = makeArticleKey(article);
        article.articleKey = articleKey;

        if (first) {
          const feedData = {
            meta: article.meta,
            ...feed,
          }
          await client.set(`feed:${name}`, JSON.stringify(feedData));
          first = false;
        }

        if (article.link === undefined
            || article.link === null
            || article.link === '') {
          logger.error(feed.name, 'article has no link', article);
          return;
        }

        const url = article.link;

        await client.set(articleKey, JSON.stringify(article));

        children.push({
          name: 'summarize',
          queueName: queues.summarizerQueue.name,
          data: { feed: feed.name, article, index, url, articleKey },
          children: [
            {
              name: 'pageCrawler',
              queueName: queues.pageCrawlerQueue.name,
              data: { feed: feed.name, article, index, url },
            },
          ]
        });


      };

      await queues.flowProducer.add({
        name: feed.name,
        queueName: queues.rssFeedQueue.name,
        data: {
          feed: feed.name,
          time: new Date().toISOString(),
          chunkNum:i,
          total: chunk.length
        },
        children
      });
      i++;


    }

  } catch (error) {
    console.error('Error parsing and storing feed:', error);
  }
}



async function start() {
  logger.info("Queues start.");

  await client.connect();
  const queues = await module.exports.getQueues(client, true);

  const config = JSON.parse(require('fs').readFileSync(configFile, 'utf8'));
  const scheduleTimeSeconds = 1 * 60 * 60;

  await Promise.all([
    (async () => {
      await Promise.all( config.aifeeds.map( async (aifeed) => {
        while (true) {
          logger.info(`[AIFEED] ${aifeed.name}`);
          await summary.startSummariseFeeds(client, aifeed);
          await new Promise( (resolve) => setTimeout(resolve, aifeed.scheduleTimeMinutes * 60 * 1000) );
        }
      }));
    })(),
    (async () => {
      while (true) {

        logger.info('Look for feeds.');
        for (const feed of config.feeds) {
          logger.info(`[REFEED] ${feed.name}`);
          parseAndStoreFeed(feed, 1000);
          //queues.rssFeedQueue.add('rssFeed', { feed, n: 10 });
        }
        await new Promise( (resolve) => setTimeout(resolve, scheduleTimeSeconds * 1000) );
      }
    })()
  ]);
  //parseAndStoreFeed(queues, '<url>').catch(console.log);
}

if (require.main === module) {
  start().then(console.log);

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
