mkdir -p 'plans/$PR_NUMBER/fetched'
gh api graphql -f query='query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      comments(first: $NUMBER_OF_PR_COMMENTS) {
        nodes {
          id
          databaseId
          author { login }
          body
          url
          createdAt
        }
      }
      reviews(first: $NUMBER_OF_REVIEWS) {
        nodes {
          id
          databaseId
          author { login }
          body
          state
          url
          createdAt
        }
      }
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
              pullRequestReview {
                id
                databaseId
              }
            }
          }
        }
      }
    }
  }
}' -F owner=fedify-dev -F repo=fedify -F number=$PR_NUMBER \
> 'plans/$PR_NUMBER/fetched/$CURRENT_TIMESTAMP_MMDDHHMM.json'

# cspell: ignore MMDDHHMM
