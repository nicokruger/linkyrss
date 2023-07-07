# imports
import pprint
import pandas as pd
import tiktoken
import redis
import json
import os
import sys

redis_host = os.environ.get('REDIS_URL', 'redis://localhost:6379')
client = redis.from_url(redis_host)

articles_file = sys.argv[1]
if articles_file is None:
    print("Usage: python embeddings.py <articles_file> <out_file>")
    sys.exit(1)
article_ids = open(articles_file).readlines()
article_ids = [x.strip() for x in article_ids]

out_file = sys.argv[2]
if out_file is None:
    print("Usage: python embeddings.py <articles_file> <out_file>")
    sys.exit(1)

article_keys = ["article:" + x for x in article_ids]
summary_keys = ["summary:" + x for x in article_ids]

titles = []
summaries = []
links = []
tags = []

for key in article_keys:
    articlestr = client.get(key)
    article = json.loads(articlestr.decode('utf-8'))
    print(article['link'])
    summary_key = "summary:" + article['link']
    summarystr = client.get(summary_key)
    if summarystr is None:
        continue
    summary = json.loads(summarystr.decode('utf-8'))
    #pprint.pprint(summary)

    titles.append(article['title'])
    links.append(article['link'])
    summaries.append(summary['summary'])
    tags_str = ' '.join(['#' + tag['tag'] for tag in summary['tags']])
    tags.append(tags_str)

print(f"Found {len(titles)} articles")
print(f"Found {len(summaries)} summaries")
print(f"Found {len(article_keys)} article keys")
from openai.embeddings_utils import get_embedding

# embedding model parameters
embedding_model = "text-embedding-ada-002"
embedding_encoding = "cl100k_base"  # this the encoding for text-embedding-ada-002
max_tokens = 8000  # the maximum for text-embedding-ada-002 is 8191

# load & inspect dataset
df = pd.DataFrame({'title': titles, 'link':links, 'summary': summaries, 'tags':tags})
df = df[["title", "summary", "link", "tags"]]
df = df.dropna()
df["combined"] = (
        "## " + df.title + "\nTags: " + df.tags + "\n\n" + df.summary
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
df.to_csv(out_file)
