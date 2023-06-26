from langchain.embeddings import OpenAIEmbeddings
from langchain.text_splitter import CharacterTextSplitter
from langchain.vectorstores.redis import Redis
from langchain.document_loaders import TextLoader

redis_url = "redis://localhost:6379"

langchain.llm_cache = RedisSemanticCache(
    embedding=FakeEmbeddings(),
    redis_url=redis_url
)
