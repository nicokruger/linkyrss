async function getCategories(articles) {

  const template = `Prepare a daily digest of the latest posts on the site. Identify topics and trends.

There are ${articles.length} posts.
# Posts under consideration (there are ${articles.length} posts in total)
{markdowns}

Using the existing list of topics and the new posts under consideration, provide a list of 5 topics.
`;

  const template2 = `Given the provided headlines for a Daily Digest letter:

{categories_str}

Provide a list of 15 topics that encompass the provided headlines and trends.`;

  const system = "";
  const examples = []
  const history = [];

  let categories = [];

  const chunkedArticles = _.chunk(articles, 25);
  let i = 0;
  for (const chunk of chunkedArticles) {
    const progress = Math.round((i / chunkedArticles.length) * 100);
    console.log(`(${progress}%) chunk ${i} of ${chunkedArticles.length}`);
    i += 1;
    //console.log('chunk size?!?!?!?!', chunk.length);

    const functiondata = { functions: [], available_functions: {} };
    const these_categories = [];
    aifunctions.setup_categories_creator( these_categories )(functiondata.functions, functiondata.available_functions);
    //console.log('functiondata', functiondata);

    let markdowns = '';
    //markdowns += `## ${feed.name}\n\n`;
    markdowns += chunk.map(formatPostNoUrl)
      .join('\n\n');

    const categories_str = categories.map(c => `- ${c}`).join('\n');


    //console.log('categories_str', categories_str);
    const inputs = {
      markdowns,
      categories_str
    }

    const output = await get_llm_raw(
      functiondata,
      system,
      template,
      examples,
      inputs,
      history,
      {"name":"set_topics"}
    );

    //history.push({
    //  user: chunk.map(formatGroupedPost).join('\n\n'),
    //  assistant: these_categories.join(', '),
    //});
    

    categories = categories.concat(these_categories);
    console.log('categories', categories);

  }

  const functiondata = { functions: [], available_functions: {} };
  const these_categories = [];
  aifunctions.setup_categories_creator( these_categories )(functiondata.functions, functiondata.available_functions);
  const categories_str = categories.map(c => `- ${c}`).join('\n');
  const inputs = { categories_str }
  await get_llm_raw(
    functiondata,
    system,
    template2,
    examples,
    inputs,
    history,
    {"name":"set_topics"}
  );

  categories.length = 0;
  categories = categories.concat(these_categories);

  console.log('categories', categories);

  return categories;

}

async function getAiVotes(articles) {

  const personalities = [
    'r/technology',
    'r/programming',
    'r/askscience',
    'r/askhistorians',
    'r/askphilosophy',
    'r/politics',
    'r/news',
    'r/memes'
  ];

  const personalityStr = ' - ' + personalities.join(' - ')
  const template = `For each of the following subreddits, provide the number of updoots as the post score and the top comment. Take the relevance of the post to the subreddit into account when predicting the number of upvotes:
{personalityStr}


Read the following article and provide a comment a post score:

{markdowns}
`;

  const system = "";
  const examples = []
  const history = [];

  const all_votes = {};

  const chunkedArticles = _.chunk(articles, 1);
  let i = 0;
  for (const chunk of chunkedArticles) {

    const progress = Math.round((i / chunkedArticles.length) * 100);
    console.log(`(${progress}%) chunk ${i} of ${chunkedArticles.length}`);
    i += 1;

    const votes = {};

    const functiondata = { functions: [], available_functions: {} };
    aifunctions.setup_post_voter( votes )(functiondata.functions, functiondata.available_functions);

    const markdowns = chunk.map(formatPostNoUrl)
      .join('\n\n');

    const inputs = {
      personalityStr,
      markdowns,
    }

    await get_llm_raw(
      functiondata,
      system,
      template,
      examples,
      inputs,
      history,
      "auto"
    );



    const article = chunk[0].article;

    all_votes[article.link] = votes;
    console.log('=== ', article.title, ' ===', votes);
  }

  return all_votes;

}


async function summariseFeeds(feedwriter, client, feedsdata) {
  /*
  const template = `I am interested in technology, games, and music. Given the following article summaries from the last 24 hours as seperate markdown blocs:

{markdowns}

You are a News expert, researcher and blogger. What are the trends and topics discussed in these articles? Provide a markdown output block with each trend or topic as a heading and a short sentence describing the subject matter and titles of posts discussing it. `
*/
  const template = `Group all of the following posts into relevant sections based on tags provided:

## Existing Topics
{new_posts}

## Incoming Posts to analyze
{markdowns}`;

//Provide a grouping of post and topic. Choose the most appropriate topic from the list of available topics for each post.`;

  const system = "";
  //const system = "The user is going to provide a list of markdown article summaries. You are CmdrTaco, the editor of slashdot. you know when slasdhot summaries multiple related articles? You're doing that.";

  const examples = [
    /*
    {
      "user":`# An article about the new iPhone

Apple has released a new iPhone. It is the best iPhone ever. It has a new camera and a new screen. It is the best iPhone ever.

# An article about a new Android phone

Google has released a new Android phone. It is the best Android phone ever. It has a new camera and a new screen. It is the best Android phone ever.

# An article about a new Windows phone

Microsoft has released a new Windows phone. It is the best Windows phone ever. It has a new camera and a new screen. It is the best Windows phone ever.

`,
      "assistant": `# Many companies release new phones

Apple, Google, and Microsoft have all released new phones. They are all the best phones ever. They all have new cameras and new screens. Good stuff!`
    }
    */
  ];

  let markdowns = '';
  let new_posts = '';

  let allArticles = [];
  for (const feed of feedsdata) {
    
    //console.log('feed', feed);
    const feedArticles = await feeds.getFeedArticles(client, feed.name);
    if (!feedArticles) {
      logger.info(feed.name, 'no feed articles');
      continue;
    }

    allArticles.push(...feedArticles);

  }
  allArticles = _.shuffle(allArticles);

  //const categories = await getCategories(allArticles);
  //const categories = ['Cheese'];
  const categories = [];

  const votes = await getAiVotes(allArticles.slice(0,30));
  console.log('votes', votes);

  // calculate the total scores for all the personalities
  const total_scores = {};
  for (const article_link in votes) {
    const article_votes = votes[article_link];
    //console.log('pls', article_votes);
    let total_score = 0;
    for (const personality in article_votes) {
      const vote = article_votes[personality].score;
      //console.log('plss', article_votes[personality], vote);
      total_score += vote;
      //console.log('fff', total_score);
    }
    total_scores[article_link] = total_score;
    //console.log('k', total_scores[article_link]);
  }
  //console.log('total_scores', total_scores);

  const articlesWithScore = allArticles.map((article) => {
    return {
      article,
      score: total_scores[article.article.link] ?? 0
    };
  });
  // sort the articles by total score
  const sorted_articles = _.sortBy(articlesWithScore, 'score').reverse();

  // group the articles by personality
  for (const aa of sorted_articles.slice(0,20)) {
    //console.log('AA', aa);
    const article = aa.article;
    const score = aa.score;

    console.log(' # ', article.article.title);
    console.log('score', score);
    console.log(article.summary.summary);
    console.log("\n\n\n")
  }

  /*
  const categories = [
    'Artificial Intelligence',
    'Machine Learning',
    'Programming',
    'Technology',
    'Social Media',
    'Video Games',
    'Super Cool Wildcard'
  ];
  */
  console.log('categories', categories);

  logger.info('total articles', allArticles.length);

  const chunkedArticles = _.chunk(allArticles, 4);
  let article_groups = {};
  let i = 0;
  let totalProcessed = 0;

  for (const chunk of chunkedArticles) {
    const progress = Math.round((i / chunkedArticles.length) * 100);
    console.log(`(${progress}%) chunk ${i} of ${chunkedArticles.length}`);
    markdowns = '';
    //markdowns += `## ${feed.name}\n\n`;
    markdowns += chunk.map(formatTagPost)
      .join('\n\n');

    const categories_str = categories.map(c => `- ${c}`).join('\n');
    const inputs = {
      markdowns,
      categories: categories_str,
      digests: new_posts
    }

    const functiondata = {
      functions: [],
      available_functions: {}
    };
    aifunctions.assign_article_to_topic(
      allArticles,
      article_groups
    )(functiondata.functions, functiondata.available_functions);

    const output = await get_llm_raw(
      functiondata,
      system,
      template,
      examples,
      inputs,
      [],
      //{"name":"group_or_regroup_article"}
    );
    //console.log('article_groups', article_groups);

    new_posts = '';
    let idx = 0;
    for (const group of Object.keys(article_groups)) {
      new_posts += `## ${group}\n\n`;
      for (const article of article_groups[group]) {
        //new_posts += `### ${article.article.title}\nArticle url: ${article.article.link}\n${article.summary.summary}\n\n`;
        new_posts += formatTagPost(article);
      }

      await feedwriter.writeArticle(
        idx,
        group,
        JSON.stringify(article_groups[group])
      );

      idx += 1;

    }
    console.log('new_posts', new_posts);

    //new_posts += output;

    totalProcessed += chunk.length;
    let totalGrouped = 0;
    for (const group of Object.keys(article_groups)) {
      totalGrouped += article_groups[group].length;
    }
    console.log(`totalProcessed: ${totalProcessed} totalGrouped: ${totalGrouped}`);


    i += 1;
  }

  //console.log('output', output);

}

