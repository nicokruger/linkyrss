const _ = require('lodash');
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

async function parseAndStoreFeed(feed, n) {
  const queues = await index.getQueues(client);

  const {url,name} = feed;
  try {
    const articles = await feedparser.parse(url, {
      addmeta: true,
    });

    const latestArticles = _.shuffle(articles.slice(0, n));
    logger.info(`[REFEED] ${name} ${latestArticles.length} articles`);

    if (!latestArticles.length) {
      logger.warn('there are no jobs for feed ' + feed.name);
      return;
    }


    const children = [];
    let first = true;
    let i = 0;
    for (const article of latestArticles) {
      const index = ((article.pubDate ?? article.pubdate ?? article.date).toISOString() + ':' + (article.guid ?? article.id)).replace(/:/g,'');
      const articleKey = `article:${feed.name}:${index}`;
      const alreadyDoneKey = `done:${articleKey}`;
      const alreadyDone = await client.exists(alreadyDoneKey);
      if (alreadyDone) {
        logger.debug('article already exists', articleKey);
        continue;
      }

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
      data: { feed: feed.name, time: new Date().toISOString(), total: latestArticles.length },
      children
    });

  } catch (error) {
    console.error('Error parsing and storing feed:', error);
  }
}


function refeedArticles(articles) {
  const latestArticles = articles.map( ({article,summary}) => {
    if (summary) {
      //const newContent = summary.summary + "<br/><br/>" + article.content;
      //article.content = newContent;
      //article.summary = `<![CDATA[${summary.summary}<br/><br/>${article.summary}]]>`;
      //article.summary = "cheese";
      const summaryHtml = `<hr/><h3>AI Summary</h3><p>${summary.summary}</p>`;
      article.content = summaryHtml + "<hr/><br/><br/>" + article.description;
      return article;
    } else {
      return null;
    }
  }).filter( article => article !== null);
  return latestArticles;
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
  const feedArticles = refeedArticles(await feeds.getFeed(client, req.params.name));
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
if (require.main === module) {
  app.listen(PORT, async () => {
    await client.connect();
    logger.info(`Listening on port ${PORT}`);
    const queues = await index.getQueues(client);

    const config = JSON.parse(require('fs').readFileSync(configFile, 'utf8'));
    const scheduleTimeSeconds = 1 * 60 * 60;

    await Promise.all([
      (async () => {
        while (true) {
          await summary.startSummariseFeeds(client);
          await new Promise( (resolve) => setTimeout(resolve, 1 * 60 * 60 * 1000) );
        }
      })(),
      (async () => {
        while (true) {

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
  });

}



module.exports.parseAndStoreFeed = parseAndStoreFeed;
