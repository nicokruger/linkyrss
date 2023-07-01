const createLogger = require('./logger');
const logger = createLogger(module);

module.exports.group_called = 0;
async function group_or_regroup_article(articles, groups, {article_url, topic}) {
  if (article_url.trim() == '') {
    return "Invalid empty article url";
  }
  const group_name = topic;
  console.log('group_or_regroup_article', article_url, group_name);
  // find article by url / link
  //console.log('articles', articles.slice(0,3));
  let moved = false;
  const article = articles.find( (a) => a.article.link == article_url);
  //console.log('article', article);
  if (!article) {
    logger.error('Could not find article: ' + article_url);
    //logger.error('Urls were: ' + articles.map( (a) => a.article.link).join('\n'));
    return 'Stop making up urls: ' + article_url + ' does not exist.';
  }
  // check if the item exists anywhere else and remove it
  for (const group in groups) {
    const index = groups[group].findIndex( (a) => a.article.link == article_url);
    if (index > -1) {
      moved = true;
      groups[group].splice(index, 1);
      // if the group is empty, remove it
      if (groups[group].length == 0) {
        delete groups[group];
      }
    }
  }
  if (!groups[group_name]) {
    groups[group_name] = [];
  }
  groups[group_name].push(article);
  
  module.exports.group_called += 1;

  if (!moved) {
    return `${article.article.link} added to group ${group_name} from now on.`;
  } else {
    return `${article.article.link} has been moved to group ${group_name}. Note: this is an expensive operation.`;
  }
}

module.exports.assign_article_to_topic = function (allArticles, article_groups) {
  return function (functions, available_functions) {
    functions.push({
      name: "assign_article_to_topic",
      description: "Assigns an article to a topic",
      parameters: {
        type: "object",
        properties: {
          article_url: {
            type: "string",
            description: "The url of the article to assign to a topic",
          },
          topic: {
            type: "string",
            description: "The topic to assign the article to",
          }
        },
        required: ["article_url", "topic"],
      }
    });

    available_functions['assign_article_to_topic'] =  group_or_regroup_article.bind(null, allArticles, article_groups)
  }

}

module.exports.setup_categories_creator = function (in_categories) {
  return function (functions, available_functions) {
    functions.push({
      name: "set_topics",
      description: "Sets the list of topics",
      parameters: {
        type: "object",
        properties: {
          topics: {
            type: "string",
            description: "A | separated list of the full set of the new topics, e.g. 'People complaining about stuff|Cool Programming Things|Amazing Astronomy|... 10 more'",
          }
        },
        required: ["topics"],
      }
    });

    available_functions['set_topics'] =  function ({topics}) {
      console.log('set topics', topics);
      in_categories.length = 0;
      in_categories.push(...topics.split('|'));
      console.log('in_categories', in_categories);
      return `Categories replaced`;
    }
  }

}

