# imports
import pandas as pd
import tiktoken
import redis
import json
client = redis.StrictRedis(host='localhost', port=6379, db=0)

article_keys = client.keys("article:*")
summary_keys = client.keys("summary:*")

titles = []
summaries = []
links = []

for key in article_keys:
    articlestr = client.get(key)
    article = json.loads(articlestr.decode('utf-8'))
    print(article['link'])
    summary_key = "summary:" + article['link']
    summarystr = client.get(summary_key)
    if summarystr is None:
        continue
    summary = json.loads(summarystr.decode('utf-8'))

    titles.append(article['title'])
    links.append(article['link'])
    summaries.append(summary['summary'])

print(f"Found {len(titles)} articles")
print(f"Found {len(summaries)} summaries")
print(f"Found {len(article_keys)} article keys")
from openai.embeddings_utils import get_embedding

# embedding model parameters
embedding_model = "text-embedding-ada-002"
embedding_encoding = "cl100k_base"  # this the encoding for text-embedding-ada-002
max_tokens = 8000  # the maximum for text-embedding-ada-002 is 8191

# load & inspect dataset
df = pd.DataFrame({'title': titles, 'link':links, 'summary': summaries})
df = df[["title", "summary", "link"]]
df = df.dropna()
df["combined"] = (
    "Title: " + df.title + "; Content: " + df.summary
)
print(df.head(2))

# subsample to 1k most recent reviews and remove samples that are too long
encoding = tiktoken.get_encoding(embedding_encoding)

print(len(df))
# omit reviews that are too long to embed
df["n_tokens"] = df.combined.apply(lambda x: len(encoding.encode(x)))
df = df[df.n_tokens <= max_tokens]
print(len(df))

# Ensure you have your API key set in your environment per the README: https://github.com/openai/openai-python#usage

# This may take a few minutes
df["embedding"] = df.combined.apply(lambda x: get_embedding(x, engine=embedding_model))
df.to_csv("embeddings.csv")
