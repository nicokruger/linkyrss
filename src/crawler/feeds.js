const { marked } = require('marked');
const _ = require('lodash');
const summarise = require('./summarise');
const { Feed, Category } = require('feed');


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

  async writeArticle(idx, title, content, links, theme) {
    const key = `aiarticle:${this.name}:${idx}`;
    await this.client.set(key, JSON.stringify({
      idx,
      date: new Date(),
      title,
      content,
      links,
      theme
    }));
  }

  async clearFeed() {
    const articleKeys = await this.client.keys(`aiarticle:${this.name}:*`);
    await Promise.all(articleKeys.map( async (key, index) => {
      await this.client.del(key);
    }));
  }

  async writeFeedMeta(data) {
    const key = 'feed:' + this.name;
    await this.client.set(key, JSON.stringify(data));
  }

  async getFeed() {
    const articleKeys = await this.client.keys(`aiarticle:${this.name}:*`);
    const aiArticles = (await Promise.all(articleKeys.map( async (key, index) => {
      const aiarticle = JSON.parse(await this.client.get(key));
      return aiarticle;
    })));
    const articles = (await Promise.all(aiArticles.map( async (aiarticle, index) => {
      const {title, content, date, links, theme} = aiarticle;
      const summary = content;
      return {title, summary, date, links, theme};
    }))).filter( article => article !== null);

    const updated = _.max(articles.map( article => article.date));
    const feed = new Feed({
      title: '[AI] ' + this.name,
      description: "AI for " + this.name,
      id: this.name,
      link: 'https://www.inmytree.co.za/' + this.name,
      updated: new Date(updated),
      generator: 'rss-atom-feed-processor',
    });


    articles.forEach(({title, summary, date, links, theme}) => {
      const md = `${summary}

## Theme
${theme}

## Links
${links.map( link => `- [${link.title}](${link.link})`).join('\n')}
`
      const html = marked.parse(md);
      console.log(html);
      const narticle = {
        title,
        guid: date + '_summary',
        link: 'https://www.inmytree.co.za/' + title,
        description: 'My AI summary of ' + title,
        date: new Date(date),
        content: html,
        summary: html,
        isSummary: true
      }

      feed.addItem(narticle);
    });

    return feed;
  }
}

module.exports.getFeedArticles = async function (client, feedName) {
  const key = `feed:${feedName}`;
  if (!await client.exists(key)) {
    return null;
  }

  const feedArticles = await getFeed(client, feedName);
  return feedArticles;

}

module.exports.FeedWriter = FeedWriter;
module.exports.getFeed = getFeed;
