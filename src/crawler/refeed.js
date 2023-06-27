const feedparser = require('feedparser-promised');
const { Feed, Category } = require('feed');
const redis = require('redis');
const client = redis.createClient();
const express = require('express');
const app = express();
const index = require('./index.js');

// Function to parse the given RSS/Atom feed URL, store the latest n articles in Redis, and create a new Atom feed from the stored articles.
async function parseAndStoreFeed(queues, url, n = 100) {
  try {
    const articles = await feedparser.parse(url);
    const latestArticles = articles.slice(0, n);

    const children = [];
    const {q,wq} = queues;

    const queue = q;
    latestArticles.forEach( async (article, index) => {

      console.log('add article', index);

      const chain = queue.chain([
        queue.refeed({article, index}),
        queue.crawl(),
        queue.summary()
      ]);
      children.push(chain);

    });

    //for (const c of children) {
    //  c.run();
    //}
    const id = await queue.group(children).run();
    console.log('id', id);

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
function createNewFeed(feedUrl, articles) {
  const feed = new Feed({
    title: 'New Atom Feed',
    description: 'A new Atom feed created from the latest articles of the original feed.',
    id: feedUrl,
    link: feedUrl,
    updated: new Date(),
    generator: 'rss-atom-feed-processor',
  });

  articles.forEach((article) => {
    feed.addItem({
      title: article.title,
      id: article.guid,
      link: article.link,
      description: article.description,
      content: article.content,
      author: article.author,
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

app.get('/', async (req, res) => {

  const newFeedUrl = 'http://localhost:3000';
  const latestArticlesKeys = await client.keys('article:*');
  const latestArticles = (await Promise.all(latestArticlesKeys.map( async (key) => {
    const article = JSON.parse(await client.get(key));
    const summaryKey = `summary:${article.link}`;
    const summary = JSON.parse(await client.get(summaryKey));
    if (summary) {
      //const newContent = summary.summary + "<br/><br/>" + article.content;
      //article.content = newContent;
      //article.summary = `<![CDATA[${summary.summary}<br/><br/>${article.summary}]]>`;
      //article.summary = "cheese";
      console.log(article.summary);
      article.content = summary.summary + "<br/><br/>" + article.summary;
      return article;
    } else {
      return null;
    }
  }))).filter( article => article !== null);
  const newFeed = createNewFeed(newFeedUrl, latestArticles);
  const atomXml = newFeed.atom1();


  res.header('Content-Type', 'application/atom+xml');
  res.send(atomXml);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await client.connect();
  console.log(`Listening on port ${PORT}`);
  const queues = await index.getQueues(client);
  parseAndStoreFeed(queues, '<url>').catch(console.log);
});



