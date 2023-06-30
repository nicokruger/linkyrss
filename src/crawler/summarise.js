const { ChatOpenAI } = require('langchain/chat_models/openai');
const { PromptTemplate }  = require( "langchain/prompts");
const { LLMChain }  = require( "langchain/chains");
const { Configuration, OpenAIApi } = require('openai');
const createLogger = require('./logger');
const logger = createLogger(module);
const _ =  require('lodash');
const feeds = require('./feeds.js');
const aifunctions = require('./aifunctions.js');



const template = `Within the block below is the full content of a page I am interested in. The url is {my_url}.

\`\`\`html
{content}
\`\`\`

Please summarise the contents of the provided HTML page. The page may be an article or a user submitted post. Provide a summary of discussions and comments if applicable. Try to focus mainly on the content, ignore things like sidebars, footers and so forth.

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
      throw new Error("stop");
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
  inputs) {
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
  messages.push({role: "user", content: prompt});


  while ((!finish_reason || finish_reason === 'function_call')) {
    try {
      //console.log('send msges', messages);
      const functions = functiondata.functions;
      const available_functions = functiondata.available_functions;
      const chatCompletion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo-16k",
        //model: "gpt-3.5-turbo-0613",
        messages,
        functions,
        function_call: "auto"
      });

      const firstChoice = chatCompletion.data.choices[0];
      const response_message = firstChoice.message;
      const assistant = response_message.content;
      content = assistant ?? 'flezbar';
      finish_reason = firstChoice.finish_reason;
      if (response_message.function_call) {

          const function_name = response_message.function_call.name;
          const function_to_call = await available_functions[function_name];
          const function_args = JSON.parse(response_message.function_call.arguments);

          const function_response = await function_to_call({
              article_url: function_args.article_url,
              group_name: function_args.group_name,
          })
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
      logger.info(`[get_llm_raw] sleeping for ${sleep} seconds`);
      await new Promise(r => setTimeout(r, sleep * 1000));
      sleep *= 1.1;
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
  logger.debug(`[summarise_url] ${url} summary: ${data.summary}`);
  return data;
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
  const template = `I have too many unread articles in my RSS fead. It is impossible for me to keep up. I need your help to group the folowing articles together using heuristics around similairity, category, topics, trends and so forth:

# Posts from my RSS feeds
{markdowns}

# Candiate New Grouped Posts by Trend/Category
{new_posts}

Provide the markdown containing new candidate posts as markdown, grouped related articles together under appropriate categories/trends. You may change existing headings if new information arrives:`;

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

  const allArticles = [];
  for (const feed of feedsdata) {
    //console.log('feed', feed);
    const feedArticles = await feeds.getFeedArticles(client, feed.name);

    allArticles.push(...feedArticles);

  }

  console.log('total articles', allArticles.length);
  const chunkedArticles = _.chunk(allArticles, 3);
  let article_groups = {};
  let i = 0;
  let totalProcessed = 0;

  function formatGroupedPost({summary,article}) {
    //return `### ${article.title}\nArticle url: ${article.link}\n${summary.summary}\n\n`;
    return `### ${article.title}\nArticle url: ${article.link}\n\n`;
  }
  function formatIncomingPost({summary,article}) {
    return `### ${article.title}\nArticle url: ${article.link}\n${summary.summary}\n\n`;
  }
  for (const chunk of chunkedArticles) {
    const progress = Math.round((i / chunkedArticles.length) * 100);
    console.log(`(${progress}%) chunk ${i} of ${chunkedArticles.length}`);
    markdowns = '';
    //markdowns += `## ${feed.name}\n\n`;
    markdowns += chunk.map(formatIncomingPost)
      .join('\n\n');

    //console.log('markdowns', markdowns);
    const inputs = {
      markdowns,
      new_posts
    }

    const functiondata = {
      functions: [],
      available_functions: {}
    };
      aifunctions.setup_group_or_regroup_article(
        allArticles,
        article_groups
      )(functiondata.functions, functiondata.available_functions);

    const output = await get_llm_raw(
      functiondata,
      system,
      template,
      examples,
      inputs);
    //console.log('article_groups', article_groups);

    new_posts = '';
    let idx = 0;
    for (const group of Object.keys(article_groups)) {
      new_posts += `## ${group}\n\n`;
      for (const article of article_groups[group]) {
        //new_posts += `### ${article.article.title}\nArticle url: ${article.article.link}\n${article.summary.summary}\n\n`;
        new_posts += formatGroupedPost(article);
      }

      await feedwriter.writeArticle(
        idx,
        group,
        JSON.stringify(article_groups[group])
      );

      idx += 1;

    }
    //console.log('new_posts', new_posts);
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
  
