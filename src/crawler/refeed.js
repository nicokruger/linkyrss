const feedparser = require('feedparser-promised');
const { Feed, Category } = require('feed');
const redis = require('redis');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const client = redis.createClient({url:redisUrl});
const express = require('express');
const app = express();
const index = require('./index.js');
const summary = require('./summarise.js');
const feeds = require('./feeds.js');
const createLogger = require('./logger');
const logger = createLogger(module);

const configFile = process.argv[2];
if (!configFile) {
  console.error('Please specify a config file');
  process.exit(1);
}
// Function to parse the given RSS/Atom feed URL, store the latest n articles in Redis, and create a new Atom feed from the stored articles.
async function parseAndStoreFeed(queues, feed, n = 500) {
  const {url,name} = feed;
  try {
    const articles = await feedparser.parse(url, {
      addmeta: true,
    });

    const latestArticles = articles.slice(0, n);
    logger.info(`[REFEED] ${name} ${latestArticles.length} articles`);
    const children = [];
    const {q} = queues;

    const queue = q;


    latestArticles.forEach( async (article, index) => {

      if (index === 0) {
        const feedData = {
          meta: article.meta,
          ...feed,
        }
        await client.set(`feed:${name}`, JSON.stringify(feedData));
      }

      logger.info('add article', article.link);

      if (article.link === undefined
          || article.link === null
          || article.link === '') {
        logger.error(feed.name, 'article has no link', article);
        return;
      }

      //const a = await queue.refeed({name, article, index}).run();

      const chain = queue.chain([
        queue.refeed({name, article, index}),
        queue.crawl(),
        queue.summary()
      ]);
      children.push(chain);

    });

    //for (const c of children) {
    //  c.run();
    //}
    const id = await queue.group(children).run();

    await client.set(`jobid:${id}`, url);

    //const newFeedUrl = 'http://localhost:3000';
    //const newFeed = createNewFeed(newFeedUrl, latestArticles);
    //console.log(newFeed.atom1());
    //return newFeed.atom1();
  } catch (error) {
    console.error('Error parsing and storing feed:', error);
  }
}

// Function to create a new Atom feed from the given articles.
function createNewFeed(meta, feedUrl, articles) {
  const feed = new Feed({
    title: '[Refeed] ' + meta.title,
    description: meta.description ?? "Refeed for " + meta.title,
    id: feedUrl,
    link: feedUrl,
    updated: new Date(),
    generator: 'rss-atom-feed-processor',
  });

  articles.forEach((article) => {
    feed.addItem({
      title: article.title,
      id: article.guid + 'refeedy',
      link: article.link,
      description: article.description,
      content: article.content,
      //author: article['atom:author'] ?? article.author,
      date: new Date(article.pubDate),
      category: [
        {
          name: 'Cheese',
          scheme: 'https://example.com/category/cheese',
          domain: 'https://example.com/',
          term: 'cheese',
        }
      ]
    });
  });

  feed.addCategory('Technology');

  return feed;
}

app.get('/feed/:name', async (req, res) => {
  const newFeedUrl = req.url;
  const key = `feed:${req.params.name}`;
  if (!await client.exists(key)) {
    res.status(404).send('Feed not found');
    return;
  }

  const feedInfo = JSON.parse(await client.get(key));
  const feedArticles = await feeds.getFeed(req.params.name);
  const newFeed = createNewFeed(feedInfo.meta, newFeedUrl, feedArticles);
  const atomXml = newFeed.atom1();

  res.header('Content-Type', 'application/atom+xml');
  res.send(atomXml);
});

app.get('/ai_feed/:name', async (req, res) => {
  const ai = new feeds.FeedWriter(req.params.name, client);
  const feed = await ai.getFeed();

  const atomXml = feed.atom1();
  res.header('Content-Type', 'application/atom+xml');
  res.send(atomXml);

});

app.get('/', async (req, res) => {
  const feedKeys = await client.keys('feed:*');
  const feeds = await Promise.all(feedKeys.map( async (key) => {
    const feed = JSON.parse(await client.get(key));
    return feed;
  }));
  res.end(JSON.stringify(feeds,null,2));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await client.connect();
  logger.info(`Listening on port ${PORT}`);
  const queues = await index.getQueues(client);

  const config = JSON.parse(require('fs').readFileSync(configFile, 'utf8'));
  const scheduleTimeSeconds = 60 * 60;

  /*
  const feedwriter = new feeds.FeedWriter('Test', client, queues);
  await feedwriter.clearFeed();
  summary.summariseFeeds(feedwriter, client, config.feeds);
  feedwriter.writeFeedMeta({
    summary:true,
    meta:{
      title:'Test',
      description:'Test',
    }
  });
  */

  while (true) {

    for (const feed of config.feeds) {
      logger.info(`[REFEED] ${feed.name}`);
      parseAndStoreFeed(queues, feed).catch(logger.info, 1000);
    }
    await new Promise( (resolve) => setTimeout(resolve, scheduleTimeSeconds * 1000) );
  }
  //parseAndStoreFeed(queues, '<url>').catch(console.log);
});



