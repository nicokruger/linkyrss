const os = require('os');
const fs = require('fs');
const { OpenAI } = require('openai');
const createLogger = require('./logger');
const logger = createLogger(module);
const _ =  require('lodash');
const feeds = require('./feeds.js');
const jobs = require('./jobs.js');
const aifunctions = require('./aifunctions.js');
const pLimit = require('p-limit');
const limit = pLimit(3);
const { get_encoding, encoding_for_model } = require("@dqbd/tiktoken");


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


const template = `You are an expert post summariser. Within the block below is the content of a page I am interested in.

\`\`\`html
{article_content}
\`\`\`

\`\`\`md
{content}
\`\`\`

Please summarise the contents of the provided content. The page may be an article or a user submitted post. Provide a summary of discussions and comments if applicable. Try to focus mainly on the content, ignore things like sidebars, footers and so forth. Do not start your summary with "The provided HTML page" or "The page" etc. or something similair, just write out the summary from the perspective of an expert news reporter.

Split your output into four sections: "Article", "Comments", "Related" and "References". Provide simple Markdown formatting. Try to include links in the "References" section and Related topics in the "Related" section.


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

function shorten_prompt(prompt, opts) {
  const enc = encoding_for_model("gpt-3.5-turbo");
  const tokens = enc.encode(prompt);

  let current_tokens = tokens.length;
  while (current_tokens > opts.max_tokens) {
    const diff = current_tokens - opts.max_tokens;
    const n = Math.max(diff * 3.2,5);
    // slice of the last n chars
    prompt = prompt.slice(0,prompt.length - parseInt(n));
    const tokens = enc.encode(prompt);
    current_tokens = tokens.length;
    logger.warn(`Shortening prompt by ${n} chars to ${current_tokens} tokens`);
  }
  enc.free();

  return prompt;

}

async function get_llm_raw(
  functiondata,
  system,
  in_template,
  examples,
  inputs,
  history = [],
  function_call = "auto",
  out_prompt = null,
  model = "gpt-3.5-turbo-16k",
  temperature = undefined
) {
  const configuration = {
    apiKey: process.env.OPENAI_API_KEY,
  };
  const openai = new OpenAI(configuration);

  // replace the template with the inputs
  let prompt = in_template;
  for (const k in inputs) {
    prompt = prompt.replace(`{${k}}`, inputs[k]);
  }

  const shorten_opts = {
    max_tokens: 13000,
    model
  }
  prompt = shorten_prompt(prompt, shorten_opts);
  if (out_prompt) out_prompt.push(prompt);
  //console.log('==============');
  //console.log(prompt);
  //console.log('==============');

  let sleep = 2;
  let num_tries = 7;
  let slowtime = 90 * 1000;
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
      const functions = functiondata?.functions;
      const available_functions = functiondata?.available_functions;
      const timeouters = new Promise( (resolve) => {
        setTimeout(() => {
          resolve({timeout: true});
        }, slowtime);
      });
      const chatCompletionPromise = openai.chat.completions.create({
        model,
        //stream: true,
        //model: "gpt-3.5-turbo-0613",
        messages,
        functions,
        function_call: functions ? function_call : undefined,
        temperature
      });

      const resp = await Promise.race([chatCompletionPromise, timeouters]);
      if (resp.timeout) throw new Error('timeout after ' + slowtime + 'ms');


      const chatCompletion = resp;
      const firstChoice = chatCompletion.choices[0];
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


async function get_llm_tags(content) {
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

  return tags.filter( (t) => t.confidence >= 0.7);

}

async function get_urls_comments_and_votes(content) {
  const template = `from the following html:

\`\`\`html
{content}
\`\`\`


identify:
 - all links plus contextual text describing the links
 - the number of votes, if applicable
 - the number of comments, if applicable
`;
  const functiondata = { functions: [], available_functions: {} };
  const data = {
    links:[],
    comments:0,
    votes:0,
  };
  aifunctions.setup_link_vote_comment_extractors( data )(functiondata.functions, functiondata.available_functions);

  const inputs = {
    content
  }

  const dprompt = [];
  const output = await get_llm_raw(
    functiondata,
    "",
    template,
    [],
    inputs,
    [],
    "auto",
    temperature = 0
  );

  //console.log('===================');
  //console.log(dprompt);
  //console.log('===================');

  return data;

}


async function summarise_article(article_content, content) {
  logger.debug(`[summarise_article] ${content.length} chars`);

  const data = {};
  const inputs = {
    article_content,
    content,
  }
  //get_llm_raw({}, "", content, []).then(console.log);
  data.summary = await get_llm_raw({}, "", template, [], inputs);

  const tags = await get_llm_tags(content);
  data.tags = tags;

  const tagsStr = tags.map(t => `${t.tag}=${t.confidence}` ).join(', ');
  logger.debug(`[summarise_article] summary: ${data.summary} tags: ${tagsStr}`);

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

async function startSummariseFeeds(client, aifeed) {
  const queues = await jobs.getQueues(client);
  const dateFrom = new Date(new Date().getTime() - aifeed.postsHistoryMinutes * 60 * 1000);

  let articles = [];
  for (const source of aifeed.sources) {
    let theseArticles = await client.keys(`article:${source}:*`);
    logger.info(`ai writer: feed ${source} has ${theseArticles.length} articles`);
    // filter out articles that are too old
    theseArticles = theseArticles.filter(a => a.split(':').slice(2,4) > dateFrom.toISOString());
    theseArticles = theseArticles.map( a => a.replace('article:', '') );

    articles = articles.concat(theseArticles);
  }
  logger.info(`ai writer: feed ${aifeed.name} has ${articles.length} articles for the last ${aifeed.postsHistoryMinutes} minutes`);

  if (articles.length === 0) {
    logger.info(`ai writer: feed ${aifeed.name} has no articles for the last ${aifeed.postsHistoryMinutes} minutes`);
    return;
  }
  const inFileName = os.tmpdir() + '/clustered_posts_' + (new Date()).getTime() + '.keys';
  fs.writeFileSync(inFileName, articles.join("\n"));
  const outFileName = os.tmpdir() + '/clustered_posts_' + (new Date()).getTime() + '.csv';
  const outPostsName = os.tmpdir() + '/clustered_posts_' + (new Date()).getTime() + '.json';

  const flow = await queues.flowProducer.add({
    name: 'aiWriter',
    queueName: queues.aiWriterQueue.name,
    data: { feed: aifeed.name, articles, outPostsName },
    children: [
      {
        name: 'cluster',
        queueName: queues.clustererQueue.name,
        data: { feed: aifeed.name, inFileName:outFileName, outPostsName },
        children: [
          {
            name: 'embedding',
            queueName: queues.embeddingQueue.name,
            data: { feed: aifeed.name, inFileName, outFileName },
          }
        ]
      }
    ]
  });

}
async function aiWriter(posts, feedwriter, client) {
  const config = JSON.parse(fs.readFileSync('config.json').toString());
  const feedsdata = config.feeds;
  const clusteredPosts = posts;

  const template = `Given the following article contents:

{markdowns}


I want you to write a Wikipedia "In the news" section.
Include references and links to the original content.

For example:
\`\`\`
## In the news - News and more

### A Slack clone in 5 lines of bash
A minimalist chat system called Suc, built with only five lines of bash, is gaining attention. Suc offers core features like real-time chat, file sharing, access control, automation, integration, data encryption, and user authentication. The simplicity and efficiency of Suc are highlighted compared to other chat systems like Slack and Mattermost. [source](example.com)

### Midweek Movie Free Talk
Users on Tildes discuss various movies, including "The Gangster, The Cop, The Devil," where Sylvester Stallone is reportedly planning a US version. Additionally, disappointment with recent Pixar films, particularly "Elemental," is expressed due to weak storytelling and uninspired themes. [source](example.com)

### Injection of kidney protein improves working memory in monkeys
A recent study published in the journal Nature Aging reveals that a single injection of the klotho protein improves cognitive function in older monkeys. The protein, naturally produced by the kidney, has been associated with health benefits and better performance in thinking and memory tests in humans. This study paves the way for potential advancements in rejuvenating brain function in older adults. [source](example.com)

### Lossy Image Formats
A comprehensive page explores various lossy image formats as alternatives to the de-facto standard JPEG. The examined formats include JPEG 2000, JPEG XR, JPEG XS, JPEG XL, WEBP, FLIF, BPG, HEIF/HEIC, and AVIF. The article discusses their development, features, and patent uncertainties. AVIF is recommended as the best option due to its performance, despite some limitations on mobile browsers. [source](example.com)source
....
one for each article
\`\`\`


The theme is "{theme}".

Provide simple markdown: `;



  let allArticles = [];
  for (const feed of feedsdata) {
    const feedArticles = await feeds.getFeedArticles(client, feed.name);
    if (!feedArticles) {
      logger.info(feed.name, 'no feed articles');
      continue;
    }

    allArticles.push(...feedArticles);
  }
  if (!allArticles.length) {
    throw new Error('no articles');
  }

  await Promise.all(clusteredPosts.map(async (cluster) => {
    return limit( async () => {

      const {theme,posts:linksonly} = cluster;
      let markdowns = '';

      //console.log('links', linksonly);
      const posts = allArticles.filter(a => linksonly.includes(a.article.link));
      logger.info(`incoming links: ${linksonly.length}, found links: ${posts.length}`);
      //console.log('posts', posts);
      if (!posts.length) {
        throw new Error('no posts for cluster');
      }
      //console.log('PLOX');
      if (posts.length < linksonly.length) {
        let missingLinks = linksonly.filter( l => !posts.map( a => a.article.link ).includes(l) );
        //console.log('ML0', missingLinks);
        missingLinks = missingLinks.join("\n");
        //console.log('ML', missingLinks);
        throw new Error(`not all posts found: ${linksonly.length} vs ${posts.length}: ${missingLinks}`);
      }
      markdowns += posts.map(formatIncomingPost).join("\n\n");

      const links = posts.map( p => {
        return {
          link:p.article.link,
          title:p.article.title
        }
      });
      //console.log('links', links);
      
      const inputs = {
        theme,
        markdowns,
      }
      const debug_prompt = [];
      const new_article = await get_llm_raw(
        null,
        "",
        template,
        [],
        inputs,
        [],
        "auto",
        debug_prompt,
        'gpt-4'

        //{"name":"group_or_regroup_article"}
      );
      //console.log(debug_prompt[0]);
      //console.log('--------------------------');
      //console.log(new_article);

      const title = cleanTitle(await get_llm_raw(
        null, "",
        "Provide a suitable title for this article that is written around a theme: {theme}\n\n{article}",
        [],
        {article: new_article, theme},
        []
      ));

      const idx = new Date().toISOString();

      //console.log('write article', title);
      //const articleContents = new_article + "<br/><pre>" + debug_prompt[0] + "</pre>";
      const articleContents = new_article;
      await feedwriter.writeArticle(
        idx,
        title,
        articleContents,
        links,
        theme
      );





    });
  }));
  //for (const cluster of clusteredPosts) {
  //}

}

module.exports.summarise_article = summarise_article;
module.exports.aiWriter = aiWriter;
module.exports.startSummariseFeeds = startSummariseFeeds;
module.exports.prepareAiArticle = prepareAiArticle;
module.exports.get_llm_raw = get_llm_raw;
module.exports.get_llm_tags = get_llm_tags;
module.exports.get_urls_comments_and_votes = get_urls_comments_and_votes;

if (require.main == module) {
  //const redis = require('redis');
  //const p = JSON.parse(fs.readFileSync('/tmp/clustered_posts_1688749525576.json').toString());
  //const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
  //const client = redis.createClient({url:redisUrl});

  /*
  console.log('hi');
  client.connect().then( async () => {
    console.log('connected');

    //const feedwriter = new feeds.FeedWriter('Test', client);
    //await feedwriter.clearFeed();

    //await aiWriter(p, feedwriter, client);
  });
  */

  const content = `<p>Link URL: <a href="https://www.techspot.com/news/99326-youll-need-appointment-head-scan-prescription-data-buy.html" rel="noopener noreferrer" target="_blank">https://www.techspot.com/news/99326-youll-need-appointment-head-scan-prescription-data-buy.html</a></p>
                <p>Comments URL: <a href="https://tildes.net/~tech/17t6/apple_vision_pro_headset_to_require_head_scan_and_vision_perscription" rel="noopener noreferrer" target="_blank">https://tildes.net/~tech/17t6/apple_vision_pro_headset_to_require_head_scan_and_vision_perscription</a></p>
                <p>Votes: 5</p>
                <p>Comments: 10</p>

  `;
  //get_urls_comments_and_votes(content).then(console.log);
  //const enc = encoding_for_model("gpt-3.5-turbo");
  //const tokens = enc.encode(content);
  //console.log('TOKENS', tokens.length);
  //enc.free();

  get_llm_raw({}, "", content, []).then(console.log);

}
  
function cleanTitle(title) {
  title = title.trim();
  title = title.replace(/^"/,'');
  title = title.replace(/"$/,'');
  title = title.replace(/^Title: /, '');
  title = title.replace(/^"/,'');
  return title;
}
