async function getFeed(client, name) {
  const latestArticlesKeys = await client.keys(`article:${name}:*`);
  const latestArticles = (await Promise.all(latestArticlesKeys.map( async (key, index) => {
    const article = JSON.parse(await client.get(key));
    const summaryKey = `summary:${article.link}`;
    const summary = JSON.parse(await client.get(summaryKey));
    if (summary) {
      return {article,summary};
    } else {
      return null;
    }
  }))).filter( article => article !== null);
  return latestArticles;
}

class FeedWriter {
  constructor(name, client) {
    this.name = name;
    this.client = client;
  }

  async writeArticle(idx, title, link, summary) {
    const article = {
      title,
      guid: title + '_summary',
      link: 'https://www.inmytree.co.za/' + link,
      description: 'My AI summary of ' + title,
      pubDate: new Date().toISOString(),
      content: summary,
      summary: summary,
      isSummary: true
    }
    const key = `article:${this.name}:${idx}`;
    console.log('write article', key, article);
    await this.client.set(key, JSON.stringify(article));
  }

  async writeFeedMeta(data) {
    const key = 'feed:' + this.name;
    console.log('write feed', key, data);
    await this.client.set(key, JSON.stringify(data));
  }
}

module.exports.getFeedArticles = async function (client, feedName) {
  const key = `feed:${feedName}`;
  if (!await client.exists(key)) {
    res.status(404).send('Feed not found');
    return;
  }

  const feedArticles = await getFeed(client, feedName);
  return feedArticles;

}

module.exports.FeedWriter = FeedWriter;

