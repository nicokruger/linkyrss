const express = require('express');
const app = express();
const path = require('path');
const articleController = require('./articleController');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/article/:index', articleController.getArticle);
app.get('/content/:index', articleController.getContent);

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
