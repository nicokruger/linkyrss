import json
import requests
import urllib
import time
import os
import pprint
import langchain
import redis
#import opengraph
from langchain.chains import LLMChain, LLMRequestsChain
from langchain.chat_models import ChatOpenAI
from langchain.prompts import PromptTemplate
from langchain.llms import VertexAI
from langchain import PromptTemplate, LLMChain
import logging
logger = logging.getLogger(__name__)

langchain.debug = True

template = """Within the block below is the full content of a page I am interested in. The url is {my_url}.

```html
{content}
```

Please summarise the contents of the provided HTML page. The page may be an article or a user submitted post. Provide a summary of discussions and comments if applicable. Try to focus mainly on the content, ignore things like sidebars, footers and so forth.
"""


def get_llm_summary(chain, inputs):
    sleep = 1
    num_tries = 2
    content = ""
    last_error = None
    while (not content.strip() or content == "") and num_tries > 0:
        try:
            chain_output = chain(inputs)
            content = chain_output['text']
            pprint.pprint(content)
            num_tries -= 1
        except Exception as e:
            num_tries -= 1
            last_error = e
            time.sleep(sleep)
            sleep *= 1.1

    if last_error:
        raise last_error
    return content.strip()

def get_summary(url):
    # call LLM to provide the summary
    return summarise_url(url)

def summarise_url(url, content):
    logger.debug(f"Summarising {url}")
    PROMPT = PromptTemplate(
        input_variables=["content", "my_url"],
        template=template,
    )

    # setup langchain
    llm = ChatOpenAI(model_name='gpt-3.5-turbo-16k')
    #llm = VertexAI(max_output_tokens=1024)
    chain = LLMChain(llm=llm, prompt=PROMPT)

    data = {}
    inputs = {
        "url": url,
        "my_url": url,
        "content": content
    }
    data['summary'] = get_llm_summary(chain, inputs)

    return data

def test():
    logging.basicConfig(level=logging.DEBUG)
    logging.getLogger('botocore').setLevel(logging.WARNING)
    logging.getLogger('boto3').setLevel(logging.WARNING)
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logging.getLogger('werkzeug').setLevel(logging.WARNING)
    logging.getLogger('openai').setLevel(logging.WARNING)

    for url in [x.strip() for x in open("urls.txt").readlines()]:
        data = get_summary(url)
        print("---------")
        print(url)
        pprint.pprint(data)
        print("------------------")


def event_handler(message):
    print('Handler received message: ', message)
    key = message['data']
    r = redis.StrictRedis(host='localhost', port=6379, db=0)
    page = r.get(key)

    if page:
        page = page.decode('utf-8')
        page = json.loads(page)

        readable = page['pandocCrawl']['readableArticle']['textContent']
        #readable = page['pandocCrawl']['readableArticle']['content']
        summary = summarise_url(page['url'], readable)

        #pprint.pprint(summary)

        # set key summary:{url} to the summary
        r.set(f"summary:{page['url']}", json.dumps(summary))

    #data = get_summary(message['

def main():
    r = redis.StrictRedis(host='localhost', port=6379, db=0)
    p = r.pubsub()

    # Subscribe to a topic (channel)
    p.subscribe('crawled')

    for message in p.listen():
        if message is not None and message['type'] == 'message':
            event_handler(message)

if __name__ == "__main__":
    main()




#from langchain.embeddings import VertexAIEmbeddings
#
#embeddings = VertexAIEmbeddings()
#text = "This is a test document."
#query_result = embeddings.embed_query(text)
#doc_result = embeddings.embed_documents([text])
#print(query_result)
