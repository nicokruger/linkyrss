module.exports.group_called = 0;
async function group_or_regroup_article(articles, groups, {article_url, group_name}) {
  //console.log('group_or_regroup_article', article_url, group_name);
  // find article by url / link
  //console.log('articles', articles.slice(0,3));
  let moved = false;
  const article = articles.find( (a) => a.article.link == article_url);
  //console.log('article', article);
  if (!article) {
    throw new Error('whoops');
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

module.exports.setup_group_or_regroup_article = function (allArticles, article_groups) {
  return function (functions, available_functions) {
    functions.push({
      name: "group_or_regroup_article",
      description: "Puts or moves an article into a specific group",
      parameters: {
        type: "object",
        properties: {
          article_url: {
            type: "string",
            description: "The url of the article to group or regroup",
          },
          group_name: {
            type: "string",
            description: "The name of the group to put or move the article in. Group will be created if it doesn't exist",
          }
        },
        required: ["article_url", "group_name"],
      }
    });

    available_functions['group_or_regroup_article'] =  group_or_regroup_article.bind(null, allArticles, article_groups)
  }

}

module.exports.setup_create_category = function () {
  return function (functions, available_functions) {
    functions.push({
      name: "create_category",
      description: "Creates a new category",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the category to create",
          },
          description: {
            type: "string",
            description: "A short description of the category",
          }
        },
        required: ["name", "description"],
      }
    });

    available_functions['create_category'] =  function ({name}) {
      return `Category ${name} created.`;
    }
  }

}

