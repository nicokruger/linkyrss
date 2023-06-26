const FeedParser = require('feedparser');
const fetch = require('node-fetch'); // for fetching the feed
const redis = require('redis');
const client = redis.createClient(process.env.REDIS_URL ?? 'redis://localhost:6379');
const express = require('express');
const generate = require('./generate.js');
const app = express();

async function start() {
  let processing = 0;
  // subscribe to redis topic "crawl"
  client.subscribe('refeed', async (message) => {
    const url = message;
    console.log(`<refeed> [${processing} start ${url}`);
    await readFeed(client, url);
    console.log(`<refeed> [${processing} finished ${url}`);
    processing--;
  });

  await client.connect();

  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
  });
}

app.get('/refeed', async (req, res) => {
  const url = req.query.url;
  const redisItems = [];
  const feedAtomString = await generate.generateFeed(redisItems);
  res.set('Content-Type', 'application/atom+xml');
  res.send(feedAtomString);
})



if (require.main === module) {
  start().then(console.log);
}



async function readFeed(client, url) {

  const req = fetch(url);
  const feedparser = new FeedParser({
    normalize: false,
    addmeta: false,
  });

  req.then(function (res) {
    if (res.status !== 200) {
      throw new Error('Bad status code');
    }
    else {
      // The response `body` -- res.body -- is a stream
      res.body.pipe(feedparser);
    }
  }, function (err) {
    // handle any request errors
  });

  feedparser.on('error', function (error) {
    // always handle errors
  });

  feedparser.on('readable', function () {
    // This is where the action is!
    const stream = this; // `this` is `feedparser`, which is a stream
    const meta = this.meta; // **NOTE** the "meta" is always available in the context of the feedparser instance
    console.log(JSON.stringify(meta,null,2));
    let item;

    while (item = stream.read()) {
      //console.log(item);
    }
  });
}

