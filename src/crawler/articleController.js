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
    const index = parseInt(req.params.index, 10);
    const url = await findUrlFromIndex(client, index);
    console.log(`url: ${url}`);

    const statusKey = `crawler:${url}`;
    const status = await client.get(statusKey);
    if (status != 'DONE') {
      return res.render('error', { index, error:status, url });
    }

    const article = await db.getPage(url);
    const screenshotData = await db.getScreenshot(url);

    if (!article || !screenshotData) {
      return res.status(404).send('Page not found');
    }

    const screenshot = `data:image/png;base64,${new Buffer(screenshotData).toString('base64')}`;

    res.render('article', { index, article, screenshot });
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
