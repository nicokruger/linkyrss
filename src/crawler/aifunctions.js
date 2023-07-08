const createLogger = require('./logger');
const logger = createLogger(module);

module.exports.group_called = 0;
async function group_or_regroup_article(articles, groups, {article_url, tag_name}) {
  console.log('group_or_regroup_article', article_url, '|', tag_name);
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
  if (!groups[tag_name]) {
    groups[tag_name] = [];
  }
  groups[tag_name].push(article);
  
  module.exports.group_called += 1;

  if (!moved) {
    return `${article.article.link} added to group ${tag_name} from now on.`;
  } else {
    return `${article.article.link} has been moved to group ${tag_name}. Note: this is an expensive operation.`;
  }
}

module.exports.assign_article_to_topic = function (allArticles, article_groups) {
  return function (functions, available_functions) {
    functions.push({
      name: "group_or_regroup_article",
      description: "Group an article into a group, or move it from one group to another",
      parameters: {
        type: "object",
        properties: {
          article_url: {
            type: "string",
            description: "The article link URL"
          },
          tag_name: {
            type: "string",
            description: "The group name to assign the article to. Should be a wikipedia-style tag. One tag per article."
          },
        },
        required: ["article_url", "tag_name"]
      }
    });

    available_functions['group_or_regroup_article'] =  group_or_regroup_article.bind(null, allArticles, article_groups)
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



module.exports.setup_tags_creator = function (in_tags) {
  return function (functions, available_functions) {
    functions.push({
      name: "tags_creator",
      description: "Assigns wikipedia-style tags and confidence levels to a piece of content",
      parameters: {
        "type": "object",
        "properties": {
          "tags": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "tag": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                }
              },
              "required": ["tag", "confidence"]
            }
          }
        },
        "required": ["tags"]
      }
    });

    available_functions['tags_creator'] =  function ({tags}) {
      in_tags.length = 0;
      in_tags.push(...tags);
      return `Set tags`;
    }
  }

}

module.exports.setup_link_vote_comment_extractors = function (data) {
  return function (functions, available_functions) {
    functions.push({
      name: "link_extractor",
      description: "Extracts a link and contextual text from a HTML",
      parameters: {
        "type": "object",
        "properties": {
          "link": {
            "type": "string",
            "description":"The URL of the article"
          },
          "text": {
            "type": "string",
            "description": "The contextual text describing what the URL points to, suitable for a document heading, for example 'Comments'"
          }
        },
        "required": ["link", "text"]
      }
    });
    functions.push({
      name: "vote_and_comment_extractor",
      description: "Extracts the number of votes and comments from HTML",
      parameters: {
        "type": "object",
        "properties": {
          "votes": {
            "type": "number"
          },
          "comments": {
            "type": "number"
          }
        },
        "required": ["votes", "comments"]
      }
    });


    available_functions['link_extractor'] =  function ({link, text}) {
      data.links.push({link, text});
      return `Set link and text`;
    }

    available_functions['vote_and_comment_extractor'] =  function ({votes, comments}) {
      data.votes = votes;
      data.comments = comments;
      return `Set votes and comments`;
    }
  }

}



module.exports.setup_post_voter = function (vote) {
  return function (functions, available_functions) {
    functions.push({
      name: "set_post_score_and_comment",
      description: "Sets the number of upvotes, downvotes and comment for a post in a subreddit",
      parameters: {
        type: "object",
        properties: {
          replies: {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                subreddit: {
                  type: "string",
                  description: "The subreddit"
                },
                comment: {
                  type: "string",
                  description: "The comment the poster made"
                },
                upvotes: {
                  "type": "number",
                  "description": "The total upvotes the post received in the subreddit (if any)",
                },
                downvotes: {
                  "type": "number",
                  "description": "The total downvotes the post received in the subreddit (if any)",
                }
              },
              required: ["comment", "upvotes", "downvotes", "subreddit"],
            }
          },
        },
        required: ["replies"],
      }
    });

    available_functions['set_post_score_and_comment'] =  function ({replies}) {
      console.log('replies', replies);
      for (const r of replies) {
        const {subreddit, comment, upvotes, downvotes} = r;
        vote[subreddit] = vote[subreddit] || {};
        vote[subreddit].upvotes = upvotes;
        vote[subreddit].downvotes = downvotes;
        vote[subreddit].score = upvotes - downvotes;
        vote[subreddit].comment = comment;
      }
      //console.log('score', , 'comment', comment);
      return `Upvotes and comment set in the subreddit`;
    }
  }

}

