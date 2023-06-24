import requests
import urllib
import time
import os
import pprint
import langchain
import opengraph
from langchain.chains import LLMChain, LLMRequestsChain
from langchain.chat_models import ChatOpenAI
from langchain.prompts import PromptTemplate
from langchain.llms import VertexAI
from langchain import PromptTemplate, LLMChain
import logging
logger = logging.getLogger(__name__)

default_request_headers = requests.utils.default_headers()
default_request_headers.update({
    'User-Agent': 'LinkyAI/0.1'
})
#langchain.debug = True

template = """Within the markdown block below is the full content of a website I am interested in. The url is {my_url} . For single page applications (SPAs), this may be empty or incomplete.

```html
{requests_result}
```

Additionally, here is some (optional) opengraph data about the website:
```
{og_string}
```

Answer the user's question using a combination of the content and opengraph data. If there is not enough information from the content (such as for SPA) just provide your best guess from the headers and info that is provded:
{query}?"""


def get_llm_summary(chain, inputs):
    sleep = 1
    num_tries = 2
    content = ""
    last_error = None
    while (not content.strip() or content == "") and num_tries > 0:
        try:
            content = chain(inputs)['output']
            num_tries -= 1
        except Exception as e:
            num_tries -= 1
            last_error = e
            time.sleep(sleep)
            sleep *= 1.1

    if last_error:
        raise last_error
    return content.strip()

def get_opengraph_string(url):
    og_string = "No opengraph data found"
    try:
        logger.debug(f"Opengraph {url}")
        og_data = opengraph.OpenGraph(url=url)
        if og_data.is_valid():
            ignore_attrs = ['scrape' , '_url', 'image', 'image:width', 'image:height']
            og_string = ""
            for key, value in og_data.items():
                if key not in ignore_attrs:
                    og_string += f"\n{key}: {value}"
        return og_string
    except urllib.error.HTTPError as e:
        if e.code == 404 or e.code == 403 or e.code == 406:
            return og_string
        else:
            logger.exception(e)
            raise e
    except Exception as e:
        logger.exception(e)
        return og_string

def get_summary(url):
    # gather opengraph data
    og_string = get_opengraph_string(url)

    # call LLM to provide the summary
    return summarise_url(url, og_string)

def summarise_url(url, og_string):
    logger.debug(f"Summarising {url}")
    PROMPT = PromptTemplate(
        input_variables=["query", "requests_result", "og_string", "my_url"],
        template=template,
    )

    # setup langchain
    llm = ChatOpenAI(model_name='gpt-3.5-turbo')
    #llm = VertexAI(max_output_tokens=1024)
    chain = LLMRequestsChain(llm_chain = LLMChain(llm=llm, prompt=PROMPT))

    data = {}
    inputs = {
        "query": 'What is the article about in a paragraph?',
        "og_string": og_string,
        "url": url,
        "my_url": url
    }
    data['summary'] = get_llm_summary(chain, inputs)

    inputs = {
        "query": 'Provide a short title for the article. Just provide the title. Suitable for a newspaper headline. Just the title please, dont put quotes around the title.',
        "og_string": og_string,
        "url": url,
        "my_url": url
    }
    data['title'] = get_llm_summary(chain, inputs)
    # if starts with a quote
    if data['title'].startswith('"'):
        data['title'] = data['title'][1:]
    # if ends with a quote
    if data['title'].endswith('"'):
        data['title'] = data['title'][:-1]


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

#print(a)

if __name__ == "__main__":
    test()




#from langchain.embeddings import VertexAIEmbeddings
#
#embeddings = VertexAIEmbeddings()
#text = "This is a test document."
#query_result = embeddings.embed_query(text)
#doc_result = embeddings.embed_documents([text])
#print(query_result)
