import os

import langchain
from langchain.chains import LLMChain, LLMRequestsChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
from langchain.llms import VertexAI
from langchain import PromptTemplate, LLMChain

#langchain.debug = True

#template = """Question: {question}
#
#Answer: Let's think step by step."""
#
#prompt = PromptTemplate(template=template, input_variables=["question"])
#
#llm = VertexAI()
#llm_chain = LLMChain(prompt=prompt, llm=llm)
#
#question = "What NFL team won the Super Bowl in the year Justin Beiber was born?"
#
#a = llm_chain.run(question)
#print(a)


template = """Within the markdown block below is the full content of a website I am interested in.


```
{requests_result}
```

{query}?"""


#"http://feeds.hanselman.com/~/676711904/0/scotthanselman~Using-Home-Assistant-to-integrate-a-Unifi-Protect-G-Doorbell-and-Amazon-Alexa-to-announce-visitors",
#"http://feeds.hanselman.com/~/673288256/0/scotthanselman~NET-Hot-Reload-and-Refused-to-connect-to-ws-because-it-violates-the-Content-Security-Policy-directive-because-Web-Sockets",
#"http://feeds.hanselman.com/~/673288256/0/scotthanselman~NET-Hot-Reload-and-Refused-to-connect-to-ws-because-it-violates-the-Content-Security-Policy-directive-because-Web-Sockets",
#"https://www.theverge.com/2023/6/2/23746354/apple-vr-headset-rumors-metaverse-potential",
#"https://lifehacker.com/30-of-the-best-queer-movies-of-the-last-century-1850471612",
#"https://slashdot.org/story/23/06/02/1039236/fidelity-cuts-reddit-valuation-by-41?utm_source=atom1.0mainlinkanon&utm_medium=feed",
#"https://tech.slashdot.org/story/23/06/02/1237215/meta-requires-office-workers-to-return-to-desks-three-days-a-week?utm_source=atom1.0mainlinkanon&utm_medium=feed",
#"https://browse.feddit.de/",
#"https://fedia.io/",
#"https://blurha.sh/",
#"https://www.inmytree.co.za",
#"https://generalrobots.substack.com/p/dimension-hopper-part-1",
#"https://aws.amazon.com/blogs/machine-learning/technology-innovation-institute-trains-the-state-of-the-art-falcon-llm-40b-foundation-model-on-amazon-sagemaker/"

for url in [x.strip() for x in open("urls.txt").readlines()]:
    llm = VertexAI(max_output_tokens=1024)
    PROMPT = PromptTemplate(
        input_variables=["query", "requests_result"],
        template=template,
    )

    chain = LLMRequestsChain(llm_chain = LLMChain(llm=llm, prompt=PROMPT))
    inputs = {
        "query": "What is the article about?",
        "url": url
    }
    a = chain(inputs)

#print(a)
    print("---------")
    print(url)
    print(a['output'])
    print("------------------")






#from langchain.embeddings import VertexAIEmbeddings
#
#embeddings = VertexAIEmbeddings()
#text = "This is a test document."
#query_result = embeddings.embed_query(text)
#doc_result = embeddings.embed_documents([text])
#print(query_result)
