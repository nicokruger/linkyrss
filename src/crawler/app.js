const express = require('express');
const app = express();
const path = require('path');
const articleController = require('./articleController');
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
//const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const redis = require('redis');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
const client = redis.createClient({url:redisUrl});
const index = require('./index.js');


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/article/:index', articleController.getArticle);
app.get('/content/:index', articleController.getContent);

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

async function start() {
  await client.connect();
  const queues = await index.getQueues(client);
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

  app.use('/admin/queues', serverAdapter.getRouter());

  // other configurations of your server

  //const port = parseInt(process.env.PORT ?? 3000);
  const port = PORT;
  console.log('starting on port', port);
  app.listen(port, () => {
    console.log('Running on port', port);
    console.log(`For the UI, open http://localhost:${port}/admin/queues`);
  });
}

if (require.main === module) {
  start();
}

