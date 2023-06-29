const { ChatOpenAI } = require('langchain/chat_models/openai');
const { PromptTemplate }  = require( "langchain/prompts");
const { LLMChain }  = require( "langchain/chains");
const createLogger = require('./logger');
const logger = createLogger(module);



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

module.exports.summarise_url = summarise_url;
  
