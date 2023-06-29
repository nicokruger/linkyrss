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

module.exports.getFeedArticles = async function (client, feedName) {
  const key = `feed:${feedName}`;
  if (!await client.exists(key)) {
    res.status(404).send('Feed not found');
    return;
  }

  const feedArticles = await getFeed(client, feedName);
  return feedArticles;

}

