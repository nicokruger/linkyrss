# imports
import numpy as np
import pandas as pd

# load data
datafile_path = "./embeddings.csv"

df = pd.read_csv(datafile_path)
df["embedding"] = df.embedding.apply(eval).apply(np.array)  # convert string to numpy array
matrix = np.vstack(df.embedding.values)
matrix.shape

from sklearn.cluster import KMeans

n_clusters = 9

kmeans = KMeans(n_clusters=n_clusters, init="k-means++", random_state=42)
kmeans.fit(matrix)
labels = kmeans.labels_
df["Cluster"] = labels

#df.groupby("Cluster").Score.mean().sort_values()

from sklearn.manifold import TSNE
import matplotlib
import matplotlib.pyplot as plt

tsne = TSNE(n_components=2, perplexity=15, init="random", learning_rate=200)
vis_dims2 = tsne.fit_transform(matrix)

x = [x for x, y in vis_dims2]
y = [y for x, y in vis_dims2]

for category, color in enumerate(["purple", "green", "red", "blue"]):
    xs = np.array(x)[df.Cluster == category]
    ys = np.array(y)[df.Cluster == category]
    plt.scatter(xs, ys, color=color, alpha=0.3)

    avg_x = xs.mean()
    avg_y = ys.mean()

    plt.scatter(avg_x, avg_y, marker="x", color=color, s=100)
plt.title("Clusters identified visualized in language 2d using t-SNE")

#plt.show()

import openai

# Reading a review which belong to each group.
rev_per_cluster = 5

for i in range(n_clusters):
    print(f"Cluster {i} Theme:", end=" ")

    posts = "\n".join(
        df[df.Cluster == i]
        .combined.str.replace("Title: ", "")
        .str.replace("\n\nContent: ", ":  ")
        #.sample(rev_per_cluster, random_state=42)
        .values
    )
    response = openai.Completion.create(
        engine="text-davinci-003",
        prompt=f'What do the following posts have in common?\n\nPosts:\n"""\n{posts}\n"""\n\nTheme:',
        temperature=0,
        max_tokens=64,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
    )
    print(response["choices"][0]["text"].replace("\n", ""))

    #sample_cluster_rows = df[df.Cluster == i].sample(rev_per_cluster, random_state=42)
    sample_cluster_rows = df[df.Cluster == i]
    num_rows = sample_cluster_rows.shape[0]
    for j in range(num_rows):
        #print(sample_cluster_rows.Score.values[j], end=", ")
        print(sample_cluster_rows.title.values[j], end=":   ")
        #print(sample_cluster_rows.summary.links[j], end=",  ")
        #print(sample_cluster_rows.summary.str[:1000000000].values[j])
        print("\n")

    print("-" * 100)
