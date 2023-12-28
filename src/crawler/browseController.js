const feeds = require('./feeds.js');
const cheerio = require('cheerio');

exports.browseFeed = async (client, req, res) => {
  const key = `feed:${req.params.name}`;
  if (!await client.exists(key)) {
    res.status(404).send('Feed not found');
    return;
  }

  const feedInfo = JSON.parse(await client.get(key));
  let feedArticles = await feeds.getFeed(client, req.params.name);
  // sort by pubDate desc
  feedArticles = feedArticles.sort((a, b) => {
    return new Date(b.article.pubDate).getTime() - new Date(a.article.pubDate).getTime();
  });

  res.render('browse', { cheerio, feedArticles, feedInfo });

};

