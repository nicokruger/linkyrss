const redis = require('redis');
const fs = require('fs');
const redisClient = require('./redisClient');

async function findUrlFromIndex(redisClient, index) {
  const keyFilter = `page:*`

  const keys = await redisClient.keys(keyFilter);
  console.log(`keys: ${keys}`);
  const key = keys[index];

  if (!key) {
    return null;
  }

  return key.replace('page:', '');

}
exports.getArticle = async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    const url = await findUrlFromIndex(redisClient, index);
    console.log(`url: ${url}`);
    const urlKey = `page:${url}`;
    const screenshotKey = `screenshot:${url}`;

    const pageData = await redisClient.get(urlKey);
    const screenshotData = await redisClient.get(redis.commandOptions({returnBuffers:true}),screenshotKey);

    if (!pageData || !screenshotData) {
      return res.status(404).send('Page not found');
    }

    const article = JSON.parse(pageData);
    const screenshot = `data:image/png;base64,${new Buffer(screenshotData).toString('base64')}`;

    res.render('article', { index, article, screenshot });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
};

exports.getContent = async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    const url = await findUrlFromIndex(redisClient, index);
    console.log(`url: ${url}`);
    const urlKey = `page:${url}`;
    const pageData = await redisClient.get(urlKey);

    if (!pageData) {
      return res.status(404).send('Page not found');
    }

    const article = JSON.parse(pageData);

    res.render('content', { article, index });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal server error');
  }
};
