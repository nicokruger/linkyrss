const fs = require('fs');
const { Crawler } = require('./crawler');
const express = require('express');
const app = express();

async function crawl(url) {
  const crawler = new Crawler(url);
  await crawler.crawl();

  await crawler.saveContentToFile();
  await crawler.saveMediaToFile();

  return crawler;
}

app.get('/', async (req, res) => {
  const url = req.query.url;
  const crawler = await crawl(url);
  res.send(crawler.readableArticle.content);
});

app.listen(8081, () => console.log('Listening on port 8081'));

if (require.main === module) {
  //const url = 'https://www.nytimes.com/2023/06/16/us/daniel-ellsberg-dead.html';
  //const url = 'https://lemmy.ninja/post/19617';
  //const url = 'https://www.inmytree.co.za'
  //const url = 'https://franklinetech.com/rss-feeds-benefits-and-how-to-use-them/';
  const url = 'https://elektroelch.de/blog/wie-man-eine-anzahl-elemente-in-gleich-grosse-stuecke-aufteilt/';
  crawl(url).then( (page) => {
    //console.log('content', page.content);
    console.log('content', page.readableArticle.content);
    fs.writeFileSync('content.html', page.readableArticle.content ?? '');
    console.log('title', page.readableArticle.title);
    console.log('textContent', page.readableArticle.textContent);
    console.log('media', page.media);
  });
}
