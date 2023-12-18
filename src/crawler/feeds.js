const { marked } = require('marked');
const _ = require('lodash');
const summarise = require('./summarise');
const { Feed, Category } = require('feed');
const config = require('./config.js');

async function getFeed(client, name) {
  const latestArticlesKeys = await client.keys(`article:${name}:*`);
  const latestArticles = (await Promise.all(latestArticlesKeys.map( async (key, index) => {
    const article = JSON.parse(await client.get(key));
    const summaryKey = `summary:${article.articleKey}`;
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
      updated: new Date(updated ?? 0),
      generator: 'rss-atom-feed-processor',
    });


    articles.forEach(({title, summary, date, links, theme}) => {
      const md = `${summary}

## Theme
${theme}

## Links
${links.map( link => `- [${link.title}](${link.link})`).join('\n')}
`
      const html = marked.parse(cleanMarkdown(md));
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

function refeedArticles(articles) {
  const latestArticles = articles.map( ({article,summary}) => {
    if (summary) {


      //const html = marked.parse(cleanMarkdown(summary.summary));
      const html = cleanHtml(summary.summary);
      const summaryHtml = `<hr/><h3>AI Summary</h3>${html}`;
      article.content = summaryHtml + "<hr/><br/><br/>" + article.description;

      //const debugArticle = config.baseUrl + '/article/' + encodeURIComponent(article.guid ?? article.id);
      const debugArticle = config.baseUrl + '/article/' + encodeURIComponent(article.articleKey);
      const debugLink = config.baseUrl + '/url/' + encodeURIComponent(article.link);
      article.content += `<br/><br/><a href="${debugArticle}">Debug Article</a>`;
      article.content += `<br/><br/><a href="${debugLink}">Debug Link</a>`;

      article.category = summary.tags?.map( ({tag,confidence}) => {
        return {
          name: tag,
          scheme: 'https://ttrss.inmytree.co.za/category/' + tag,
          domain: 'https://ttrss.inmytree.co.za/',
          term: tag,
        }
      });
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
      category: article.category,
    });
  });

  //feed.addCategory('Technology');

  return feed;
}


module.exports.FeedWriter = FeedWriter;
module.exports.getFeed = getFeed;
module.exports.refeedArticles = refeedArticles;
module.exports.createNewFeed = createNewFeed;


function cleanHtml(html) {
	return html.replace('|Slashdot|','').replace('|/Slashdot|','');
}
function cleanMarkdown(md) {
  md = md.trim()
  /// remove ```markdown, ```md, from the start of the contents
  md = md.replace(/^```(markdown|md)?\n/g,'').replace(/^```\n/g,'');
  /// remove ``` from the end of the contents
  md = md.replace(/```$/g,'');
  return md;
}

