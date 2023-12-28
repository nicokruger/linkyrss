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

function shorten_prompt(in_template, inputs, opts) {

  function replaceVariables(n = -1) {
    // trim the longest variable
    if (n > 0) {
      const keys = Object.keys(inputs);
      const longest = keys.reduce((a,b) => (inputs[a]?.length ?? 0) > (inputs[b]?.length ?? 0) ? a : b);
      if (inputs[longest]) {
        inputs[longest] = inputs[longest].slice(0,inputs[longest].length - n);
      } else {
        throw new Error("cannot shorten input variable: " + longest);
      }
      //throw new Error('blorper');
    }
    let prompt = in_template;
    for (const k in inputs) {
      prompt = prompt.replace(`{${k}}`, inputs[k]);
    }
    return prompt;
  }

  let prompt = replaceVariables();
  const enc = encoding_for_model("gpt-3.5-turbo");
  const tokens = enc.encode(prompt);

  let current_tokens = tokens.length;
  let shortened = false;
  while (current_tokens > opts.max_tokens) {
    shortened = true;
    const diff = current_tokens - opts.max_tokens;
    const n = Math.max(diff,20);
    // slice of the last n chars
    prompt = replaceVariables(n);
    //prompt = prompt.slice(0,prompt.length - parseInt(n));
    //console.log('================');
    //console.log(prompt);
    //console.log('=================');
    const tokens = enc.encode(prompt);
    current_tokens = tokens.length;
    logger.warn(`Shortening prompt by ${n} chars to ${current_tokens} tokens, current char length ${prompt.length}`);
  }
  enc.free();

  console.log(prompt);
  return prompt;

}

function prepare_prompt(in_template,
  inputs
) {
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
  model = "gpt-3.5-turbo-1106",
  temperature = undefined,
  opts = {}
) {
  const configuration = {
    apiKey: process.env.OPENAI_API_KEY,
  };
  const openai = new OpenAI(configuration);


  // replace the template with the inputs
  const shorten_opts = {
    max_tokens: 10000,
    model
  }
  prompt = shorten_prompt(in_template, inputs, shorten_opts);
  if (out_prompt) out_prompt.push(prompt);
  console.log('==============');
  console.log(prompt);
  console.log('==============');

  fs.appendFileSync('prompt.txt', `=== ${new Date().toISOString()} ===\n`);
  fs.appendFileSync('prompt.txt', prompt);
  fs.appendFileSync('prompt.txt', '==============\n');

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
        temperature,
        ...opts
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


const summarisers = {
// key, priority - lower is first
'Article':[summarise_article,0,'Article'],
'Link':[summarise_article,0,'Article'],
'default':[summarise_article,0,'Article'],
'Comment':[summarise_comments,1,'Comments'],
'Discussion':[summarise_comments,1,'Comments']
}
function findSummariser(linkText, linkUrl, content) {
  for (const summariser of Object.keys(summarisers)) {
    if (linkText.includes(summariser)) {
      logger.debug(`[find_summariser] ${linkText} ${linkUrl} use summariser ${summariser}`);
      return summarisers[summariser];
    }
  }
  logger.debug(`[find_summariser] ${linkText} ${linkUrl} use summariser default`);
  return summarisers['default'];
}

async function summarise(db, article, urls) {

  let jobs = [];
  const _urls = [];
  for (const url of urls) {
    if (_urls.includes(url.link)) continue;
    const summariser = findSummariser(url.heading, url.link, article.content);
    jobs.push({
      summariser,
      url,
    });
    _urls.push(url.link);
  }

  jobs = jobs.sort( (a,b) => a.summariser[1] - b.summariser[1] );
  logger.debug(`[summarise] ${article.title} ${article.link} ${JSON.stringify(jobs.map)}`);

  const pageSummaries = [];
  const pageSummaryMap = {
    'Article': article.description,
  };
  for (const {summariser,url} of jobs) {
    logger.debug('============= url', url.heading, url.link);
    const page = await db.getPage(url.link);
    const debug = {};
    const pageSummary = await summariser[0](
      article.title,
      url.link,
      page,
      pageSummaryMap,
      debug
    );
    console.log('======= summary contents =====');
    console.log(pageSummary.contents);
    console.log('\n\n');
    pageSummaries.push({url,pageSummary,debug});
    pageSummaryMap[pageSummary.title] = pageSummary.summary;
    pageSummaryMap[summariser[2]] = pageSummary.summary;
  }

  const summary = {
    pageSummaries,
    tags: [],
  }
  return summary;
}

async function summarise_article(article_heading, article_link, page, summaryMap, debug) {
  const content = page.pandocCrawl.readableArticle.content.trim();
  const title = page.readableArticle.title;
  logger.debug(`[summarise_article] ${content.length} chars`);

  const data = {};
  const inputs = {
    article_heading,
    article_link,
    content,
  }
  const template = `Create a concise, engaging summary about an article titled [${title}], suitable for a link-summarising and sharing platform. Include relevant follow-up exploratory <a data-explore="..."> links to help the user explore related topics (these will be processed afterwards). Focus on key technical details and current relevance. Include suggestions for relevant source links and ensure the tone is suited to a knowledgeable, tech-oriented audience. Aim to spark interest and discussion within the community.

{article_link}
\`\`\`article
{content}
\`\`\`
`;

  const out_prompt = [];
  data.summary = await get_llm_raw(
	  {},
	  "",
	  template,
	  [],
	  inputs,
	  [],
	  "auto",
	  out_prompt,
          model="ft:gpt-3.5-turbo-1106:digitata::8ah0EcBz",
	  0.05,
	  {
      frequency_penalty: 1.1,
      presence_penalty: 1.1
	  }
  );
  debug.out_prompt = out_prompt;

  data.title = title;

  //const tags = await get_llm_tags(content);
	const tags = [];
  data.tags = tags;

  const tagsStr = tags.map(t => `${t.tag}=${t.confidence}` ).join(', ');
  logger.debug(`[summarise_article] summary: ${data.summary} tags: ${tagsStr}`);

  return data;
}
async function summarise_comments(article_heading, article_link, page, summaryMap, debug) {
  const content = page.pandocCrawl.readableArticle.content.trim();
  logger.debug(`[summarise_comments] ${content.length} chars`);

  const data = {};
  const inputs = {
    article_heading,
    article_link,
    content,
  }
  for (const k of Object.keys(summaryMap)) {
    inputs['summary_'+k] = summaryMap[k];
  }
  const system = `The user is going to ask you to generate discussion summaries given an article summary. Create a concise, engaging summary about COMMENTS URL. Focus on capturing the overall sentiment, key observations, and any humorous comments. Highlight diverse opinions and provide a concise overview of how the community has engaged with the topic.  Use the same output format as the initial summary.

Example:
User: Users are discussing the following the following generated summary of an article:
\`\`\`
<div class="body" id="fhbody-172347761">
	

	
		
		<div id="text-172347761" class="p">
			
		 	
				An anonymous reader shares a report: <i>Prepend any arxiv.org link with 'talk2' to load the paper into a responsive RAG chat application (e.g. <a href="https://www.talk2arxiv.org/pdf/1706.03762.pdf">www.arxiv.org/pdf/1706.03762.pdf</a> -&gt; <a href="https://www.talk2arxiv.org/pdf/1706.03762.pdf">www.talk2arxiv.org/pdf/1706.03762.pdf</a>). Talk2Arxiv is an open-source RAG (Retrieval-Augmented Generation) system specially built for academic paper PDFs. Powered by talk2arxiv-server. <a href="SEARCH:Talk2Arxiv GitHub repository">The project is available on GitHub</a>.</i><br>
		 	
		</div>

		

		

		
	</div>
\`\`\`

Format the comments section provided below of the post. Focus on capturing the overall sentiment, key observations, and any humorous comments. Highlight diverse opinions and provide a concise overview of how the community has engaged with the topic. What insights or unique perspectives do the comments offer about the article?


<h1>Comments URL</h1>
\`\`\`article
pushfoo 0 minutes ago | next []

You might be able to drop the PDF backend since they're close to getting HTML running well: <https://news. ycombinator.com/item?id=38713215>

Using that might be easier than a multi-modal approach. Bonus points for:

* Multiple papers at once

* Comparing PDF and HTML output with the LLM as input for it correcting similar converter code

reply

		
Aachen 2 minutes ago | prev | next []

I thought this would be for contacting authors or chatting about the paper with other readers, but apparently RAG here is a new important TLA to take note of, meaning chat bot. You need to enter an API key from "Open"AI to use the service and it's about it answering your questions about the paper

reply

		
gorkish 11 minutes ago | prev | next []

Very nice; appears to work well. Just an FYI that I did get a couple errors where the max context length was exceeded, one using the demo summarization task as the first query. I was using my own API key when the error occured.

reply

		
evanhu_ 6 minutes ago | parent | next []

Thank you! Thanks for pointing that out, since the underlying RAG is rather naive (simple embedding cosine similarity lookup, as opposed to knowledge graph / advanced techniques), I opted to embed both "small" (512 character and below) chunks as well as entire section chunks (embedding the entire introduction) in order to support questions such as "Please summarize the introduction". Since I also use 5 chunks for each context, I suspect this can add up to a massive amount on papers with huge sections.

reply

		
katella 15 minutes ago | prev | next []

Idk where this changing the url thing started but I really like it.

reply

		
Reac tiveJelly 9 minutes ago | parent | next []

It bugs me cause it's kinda true but kinda misleading, I don't know if casual web users realize it's a whole different domain. Sometimes it's not important, sometimes it is.

reply

		
Aachen 8 minutes ago | parent | prev | next []

The oldest instance of it that I know is putting something like download before or after the youtube domain. This must have been 2008±2. I very much doubt that's the first instance ever but I wasn't around online in the 90s

reply

		
zzleeper 16 minutes ago | prev | next []

Looks great! It would be very interesting to understand a bit they why/how of some of the steps, such as the reranking and how you arrived at your chunking algo.

reply

		
evanhu_ 3 minutes ago | parent | next []

Thank you :). I updated the README to have some more explanation of the steps.

The chunking algorithm chunks by logical section (intro, abstract, authors, etc.) and also utilizes recursive subdivision chunking (chunk at 512 characters, then 256, then 128...). It is quite naive still but it works OK for now. An improvement would perhaps involve more advanced techniques like knowledge graph precomputation.

Reranking works by instead of embedding each text chunk as a vector and performing cosine similarity nearest neighbor search, you use a Cross-Encoder model that compares two texts and outputs a similarity score. Specifically, I chose Cohere's Reranker that specializes in comparing Query and Answer chunk pairs.

reply

		
skeptrune 57 minutes ago | prev | next []

This is the first time I have seen someone use GROBID. It seems like an incredibly cool solution

reply

		
pugio 10 minutes ago | parent | next []

I've spent the last couple weeks diving into various PDF parsing solutions for scientific documents. GROBID is pretty cool, but it made some mistakes when trying to parse (I think arxiv) papers which removed some of the text.

Even though it gave a lot of great structured options, missing even a single sentence was unforgivable to me. I went with Nougat instead, for arxiv papers.

(Also check out Marker (mentioned on hn in the last month) for pretty high fidelity paper conversion to markdown. Does reasonable job with equations too.)

reply

		
evanhu_ 33 minutes ago | parent | prev | next []

I spent forever looking at various PDF parsing solutions like Unstructured, and eventually stumbled across GROBID, which was an absolute perfect fit since it's entirely made for scientific papers and has header/section level segmentation capabilities (splitting the paper into Abstract, Introduction, References, etc.) It's lightweight and fast too!

reply

		
aendruk 33 minutes ago | prev []

Any plans for bioRxiv?

reply

		
evanhu_ 30 minutes ago | parent []

Yes! I'll set up talk2biorxiv.org very soon as it would be simple to port over. I also plan on making the underlying research PDF RAG framework available as an independent module

reply

Assistant:
\`\`\`html
<div class="discussion-summary">

  <p>The comments on the Talk2Arxiv tool reveal a mix of curiosity, technical insights,
	and suggestions for improvement.  <a href="https://news.ycombinator.com/item?id=38713215">Link to discussion</a>.</p>
	
  <div class="discussion">
    <pUser pushfoo suggests dropping the PDF backend in favor of HTML, which is close to running well. Mentions the potential for handling multiple papers at once and comparing PDF and HTML output.
    </p>
  </div>
  
  <div class="discussion">
    <p>
		Aachen initially expected a platform for discussion with authors and readers but found the RAG (Retrieval-Augmented Generation) chatbot 
	interesting, though it requires an API key from OpenAI.</p>
  </div>
  
  <div class="discussion">
    <p>Gorkish and evanhu_ (the author of Talk2Arxiv) discuss technical challenges and solutions, such as context length errors and chunking algorithms. </p>
  </div>
  
  <div class="discussion">
    <p>	Katella expresses fondness for the URL-changing feature, while ReactiveJelly and Aachen 
	debate its potential for confusion among casual web users.</p>
  </div>
  
  <div class="discussion">
    <p>	Zzleeper and evanhu_ delve into the technicalities of reranking and chunking algorithms, with evanhu_ 
	providing updates to the README for clarity.</p>
  </div>
  
  <div class="discussion">
    <p>	Skeptrune and pugio share experiences with PDF parsing tools like 
	GROBID, with pugio preferring Nougat for its accuracy. Evanhu_ praises GROBID for its fit with 
	scientific papers and plans to expand the service to bioRxiv with talk2biorxiv.org. </p>
  </div>	
  `;
  const template = `Users are discussing the following generated summary of an article:
\`\`\`
{summary_Article}
\`\`\`


Format the comments section provided below of the post. Focus on capturing the overall sentiment, key observations, and any humorous comments. Highlight diverse opinions and provide a concise overview of how the community has engaged with the topic. What insights or unique perspectives do the comments offer about the article?

<a href="{article_link}"><h1>{article_title}</h1></a>
\`\`\`article
{content}
\`\`\`
`;

  const out_prompt = [];
  data.summary = await get_llm_raw(
	  {},
	  system,
	  template,
	  [],
	  inputs,
	  [],
	  "auto",
	  out_prompt,
	  model="gpt-4-1106-preview",
	  0.05
  );
  debug.out_prompt = out_prompt;

  //const tags = await get_llm_tags(content);
	const tags = [];
  data.tags = tags;
  data.title = 'Discussion';

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

module.exports.summarise = summarise;
module.exports.summarise_article = summarise_article;
module.exports.aiWriter = aiWriter;
module.exports.startSummariseFeeds = startSummariseFeeds;
module.exports.prepareAiArticle = prepareAiArticle;
module.exports.get_llm_raw = get_llm_raw;
module.exports.get_llm_tags = get_llm_tags;
module.exports.get_urls_comments_and_votes = get_urls_comments_and_votes;

 
function cleanTitle(title) {
  title = title.trim();
  title = title.replace(/^"/,'');
  title = title.replace(/"$/,'');
  title = title.replace(/^Title: /, '');
  title = title.replace(/^"/,'');
  return title;
}

if (require.main == module) {
  (async function () {
    const template = `
      Create a concise, engaging summary about an article titled [Commonroom: Terms & Conditions], suitable for a link-summarising and sharing platform. Include relevant follow-up exploratory <a data-explore="..."> links to help the user explore related topics (these will be processed afterwards). Focus on key technical details and current relevance. Include suggestions for relevant source links and ensure the tone is suited to a knowledgeable, tech-oriented audience. Aim to spark interest and discussion within the community.

https://www.commonroom.chat/
\`\`\`article
<div id="readability-page-1" class="page"><div>
<p>📄 Terms &amp; Conditions</p>
<h2 id="welcome-to-commonroom">Welcome to Commonroom!</h2>
<p>Each chat here is a transient journey, echoing the ephemeral nature of hostel common rooms. Our platform offers a space for serendipitous and fleeting group connections.</p>
<p>As you begin making anonymous friends on Commonroom, we ask that you navigate with respect and consideration. In this shared space, we uphold a few simple rules to ensure that everyone enjoys their time in our rooms:</p>
<ol type="1">
<li><strong>Acceptance of Terms:</strong> By accessing or using Commonroom, you agree to be bound by these terms and conditions. If you do not agree with any part of these terms, please do not use our platform.</li>
<li><strong>User Conduct:</strong> We believe in the power of respectful and positive interactions. Any form of harassment, hate speech, or disrespectful behavior will not be tolerated.</li>
<li><strong>Age Requirement:</strong> Users must be 18 years or older to use Commonroom. Minors are not permitted to use our platform.</li>
<li><strong>Content Guidelines:</strong> Share content that is appropriate and respectful. Any content deemed offensive, harmful, or inappropriate will be removed, and may result in an IP ban.</li>
</ol>
<p>Embark on your Commonroom adventure with an open heart and a curious mind. Happy chatting!</p>
<p><em>PS: Nothing lasts forever.</em></p>
<p>I Accept the Terms &amp; Conditions. Let me Join the Chat!</p>
</div></div>
\`\`\`
`
;
    const d = await get_llm_raw(
	    {},
	    "",
	    template,
	    [],
	    {},
	    [],
	    "auto",
	    null,
	    model="ft:gpt-3.5-turbo-1106:digitata::8ah0EcBz",
	    0.05,
	    {
        frequency_penalty: 1,
        presence_penalty: 1.1
	    }
    );
    console.log(d);
  })().then(console.log);

}
