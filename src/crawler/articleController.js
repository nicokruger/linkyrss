const redis = require('redis');
const fs = require('fs');
const database = require('./database.js');
const db = new database.FilesystemDatabase("./work");

async function findUrlFromIndex(redisClient, index) {
  const keyFilter = `crawler:*`

  const keys = await redisClient.keys(keyFilter);
  console.log(`keys: ${keys}`);
  const key = keys[index];

  if (!key) {
    return null;
  }

  return key.replace('crawler:', '');

}
exports.getArticle = async (client, req, res) => {
  try {
    const keySearch = req.params.articleKey;
    let idx = 0;
    if (req.params.index) {
      idx = parseInt(req.params.index, 10);
    }

    const keys = await client.keys('summary:*' + keySearch + '*');
    if (!keys || keys.length < idx + 1) {
      return res.status(404).send(`Article for pattern and index: ${keySearch} ${idx}`);
    }

    const summaryKey = keys[idx];
    console.log(`key: ${summaryKey}`);
    if (!await client.exists(summaryKey)) {
      return res.status(404).send('Article not found');
    }

    const key = summaryKey.replace('summary:', '');
    if (!await client.exists(key)) {
      return res.status(404).send('Article not found');
    }

    const article = JSON.parse(await client.get(key));
    const summary = JSON.parse(await client.get(summaryKey));

    res.render('article', { article, summary });

  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
};

exports.getUrl = async (client, req, res) => {
  try {
    const url = req.params.url;
    console.log(`url: ${url}`);

    const statusKey = `crawler:${url}`;
    const status = await client.get(statusKey);
    if (status != 'DONE') {
      return res.render('error', { error:status, url });
    }

    const article = await db.getPage(url);
    const screenshotData = await db.getScreenshot(url);

    if (!article || !screenshotData) {
      return res.status(404).send('Page not found');
    }

    const screenshot = `data:image/png;base64,${new Buffer(screenshotData).toString('base64')}`;

    res.render('url', { article, screenshot });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
};


exports.getContent = async (client, req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    const url = await findUrlFromIndex(client, index);
    const article = await db.getPage(url);

    res.render('content', { article, index });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
};
