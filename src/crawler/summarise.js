const { ChatOpenAI } = require('langchain/chat_models/openai');
const { PromptTemplate }  = require( "langchain/prompts");
const { LLMChain }  = require( "langchain/chains");
const { Configuration, OpenAIApi } = require('openai');
const createLogger = require('./logger');
const logger = createLogger(module);
const _ =  require('lodash');
const feeds = require('./feeds.js');
const aifunctions = require('./aifunctions.js');

function formatGroupedPost({summary,article}) {
  //return `### ${article.title}\nArticle url: ${article.link}\n${summary.summary}\n\n`;
  return `### ${article.title}\nArticle url: ${article.link}\n\n`;
}
function formatIncomingPost({summary,article}) {
  return `### ${article.title} [${article.link}]\n\n${summary.summary}\n\n\n`;
}
function formatPostNoUrl({summary,article}) {
  return `### ${article.title}\n\n${summary.summary}\n\n`;
}
function formatTagPost({summary,article}) {
  const title = article.title;
  const link = article.link;
  const tags = summary.tags
    .filter( t => t.confidence > 0.7)
    .map(t => `#${t.tag}`).join(' ');
  return `### ${title} ${tags}\n${link}\n\n`;
}


const template = `You are an expert news reporter. Within the block below is the content of a page I am interested in. The url is {my_url}.

\`\`\`
{content}
\`\`\`

Please summarise the contents of the provided page. The page may be an article or a user submitted post. Provide a summary of discussions and comments if applicable. Try to focus mainly on the content, ignore things like sidebars, footers and so forth. Do not start your summary with "The provided HTML page" or "The page" etc. or something similair, just write out the summary from the perspective of an expert news reporter.

`

async function get_llm_summary(chain, inputs) {
  let sleep = 4;
  let num_tries = 2;
  let content = ""
  let last_error;

  while ((!content.trim() || content == "") && num_tries > 0) {
    try {
      const chain_output = await chain.call(inputs);
      //console.log(JSON.stringify(chain_output, null, 2));
      content = chain_output['text'];
      num_tries -= 1;
    } catch (e) {
      if (e.response?.data) {
        console.error(e.response.data);
      } else {
        console.error(e);
      }
      num_tries -= 1;
      last_error = e;
      await new Promise(r => setTimeout(r, sleep * 1000));
      sleep *= 1.1;
    }
  }

  if (last_error) {
    // print the error stack trace
      if (last_error.response?.data) {
        throw new Error(last_error.response.data.message ?? last_error.response.data);
      } else {
        throw last_error;
      }
  }

  return content.trim();
}

async function get_llm_raw(
  functiondata,
  system,
  in_template,
  examples,
  inputs,
  history = [],
  function_call = "auto"
) {
  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);

  // replace the template with the inputs
  let prompt = in_template;
  for (const k in inputs) {
    prompt = prompt.replace(`{${k}}`, inputs[k]);
  }
  //console.log('prompt', prompt);

  let sleep = 4;
  let num_tries = 4;
  let slowtime = 30 * 1000;
  let content = ""
  let last_error;
  let finish_reason;

  let messages = [];

  if (system) {
    messages.push({role: "system", content: system});
  }
  for (const example of examples) {
    messages.push({
      role: "system",
      name: "example_user",
      content: example.user,
    });
    messages.push({
      role: "system",
      name: "example_assistant",
      content: example.assistant,
    });
  }
  for (const h of history) {
    messages.push({
      role: "user",
      content: h.user
    });
    messages.push({
      role: "assistant",
      content: h.assistant
    });
  }
  messages.push({role: "user", content: prompt});
  //console.log('prompt', prompt);


  while ((!finish_reason || finish_reason === 'error' || finish_reason === 'function_call') && (num_tries > 0)) {
    try {
      last_error = null;
      const functions = functiondata.functions;
      const available_functions = functiondata.available_functions;
      const timeouters = new Promise( (resolve) => {
        setTimeout(() => {
          resolve({timeout: true});
        }, slowtime);
      });
      const chatCompletionPromise = openai.createChatCompletion({
        model: "gpt-3.5-turbo-16k",
        //stream: true,
        //model: "gpt-3.5-turbo-0613",
        messages,
        functions,
        function_call
      });

      const resp = await Promise.race([chatCompletionPromise, timeouters]);
      if (resp.timeout) throw new Error('timeout after ' + slowtime + 'ms');


      const chatCompletion = resp;
      const firstChoice = chatCompletion.data.choices[0];
      const response_message = firstChoice.message;
      const assistant = response_message.content;
      content = assistant ?? 'flezbar';
      finish_reason = firstChoice.finish_reason;
      if (response_message.function_call) {

          const function_name = response_message.function_call.name;
          const function_to_call = await available_functions[function_name];
          const function_args = JSON.parse(response_message.function_call.arguments);
          const function_response = await function_to_call(function_args);

          messages.push(response_message);
          messages.push({
              role: 'function',
              name: function_name,
              content: function_response,
          });
        
          content = '';
        //console.log('pls continue', finish_reason);


        /*
              openai.ChatCompletion.create({
                  model: 'gpt-3.5-turbo-0613',
                  messages: messages,
              }).then((second_response) => {
                  // Do something with the second response
              });
              */
      } else {
        //console.log(chatCompletion.data);

        //console.log('finish_reason', finish_reason);
        //console.log('assistant', assistant);



        if (finish_reason === 'length') {
          messages.push({role: 'assistant', content: assistant});
          messages.push({role: "user", content: 'continue'});
        }
      //throw new Error("stop");
      }

    } catch (e) {
      logger.error('openai error', e);
      if (e.response?.data) {
        console.error(e.response.data);
      } else {
        console.error(e);
      }
      num_tries -= 1;
      last_error = e;
      logger.info(`[get_llm_raw] (${num_tries}) sleeping for ${sleep} seconds`);
      finish_reason = 'error';
      await new Promise(r => setTimeout(r, sleep * 1000));
      sleep *= 1.1;
      logger.info('wtf', ((!finish_reason || finish_reason === 'error' || finish_reason === 'function_call') && (num_tries > 0)));
  //while ((!finish_reason || finish_reason === 'error' || finish_reason === 'function_call') && (num_tries > 0)) {
    }
  }

  console.log(`  function called ${aifunctions.group_called} times`);
  aifunctions.group_called = 0;

  if (last_error) {
    // print the error stack trace
      if (last_error.response?.data) {
        throw new Error(last_error.response.data.message ?? last_error.response.data);
      } else {
        throw last_error;
      }
  }

  return content.trim();
}


async function get_llm_tags(url, content) {
  const template = `You are a bot that suggests appropriate wikipedia style news and tags for a piece of content:

{content}`;
  const functiondata = { functions: [], available_functions: {} };
  const tags = [];
  aifunctions.setup_tags_creator( tags )(functiondata.functions, functiondata.available_functions);

  const inputs = {
    content
  }

  const output = await get_llm_raw(
    functiondata,
    "",
    template,
    [],
    inputs,
    [],
    {"name":"tags_creator"}
  );

  return tags;

}

async function summarise_url(url, content) {
  logger.debug(`[summarise_url] ${url}`);
  const prompt = PromptTemplate.fromTemplate(template, {my_url: url, content: content});
  const llm = new ChatOpenAI({
    modelName:'gpt-3.5-turbo-16k',
    openAIApiKey: process.env.OPENAI_API_KEY,
  });
  const chain = new LLMChain({llm, prompt});

  const data = {};
  const inputs = {
    url,
    my_url: url,
    content,
  }
  data.summary = await get_llm_summary(chain, inputs);

  const tags = await get_llm_tags(url, content);
  data.tags = tags;

  const tagsStr = tags.map(t => `${t.tag}=${t.confidence}` ).join(', ');
  logger.debug(`[summarise_url] ${url} summary: ${data.summary} tags: ${tagsStr}`);

  return data;
}

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

async function prepareAiArticle(client, group, articles) {
  let content = '';
  content = '<h3>' + group + '</h3>\n';
  for (const article of articles) {
    //console.log('article', article);
    const summaryKey = `summary:${article.article.link}`;
    const summary = JSON.parse(await client.get(summaryKey));
    if (summary) {
      content += `<h4>${article.article.title}</h4>
<a href="${article.article.link}">${article.article.link}</a>
<p>
${summary.summary}
</p>`;
      //content += `### ${article.article.title}\nArticle url: ${article.article.link}\n${summary.summary}\n\n`;
    } else {
      return null;
    }
  }
  content += '\n\n<hr/>\n\n';
  return content;


};
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

module.exports.summarise_url = summarise_url;
module.exports.summariseFeeds = summariseFeeds;
module.exports.prepareAiArticle = prepareAiArticle;
module.exports.get_llm_raw = get_llm_raw;
module.exports.get_llm_tags = get_llm_tags;
  
