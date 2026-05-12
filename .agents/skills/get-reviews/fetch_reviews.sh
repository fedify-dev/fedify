mkdir -p 'plans/$PR_NUMBER/fetched'
gh api graphql -f query='query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: $NUMBER_OF_THREADS) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: $NUMBER_OF_COMMENTS_PER_THREAD) {
            nodes {
              id
              databaseId
              author { login }
              body
              url
              createdAt
            }
          }
        }
      }
    }
  }
}' -F owner=fedify-dev -F repo=fedify -F number=$PR_NUMBER \
> 'plans/$PR_NUMBER/fetched/$CURRENT_TIMESTAMP_MMDDHHMM.json'

# cspell: ignore MMDDHHMM
