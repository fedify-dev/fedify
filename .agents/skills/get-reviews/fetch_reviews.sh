#!/usr/bin/env bash
PR_PATH="plans/$PR_NUMBER"
FETCHED_PATH="$PR_PATH/fetched"
mkdir -p "$FETCHED_PATH"
TIMESTAMP=$(date +"%m%d%H%M")
FETCHED_FILE="$FETCHED_PATH/$TIMESTAMP.json"
gh api graphql -f query='query(
  $owner: String!,
  $repo: String!,
  $number: Int!,
  $prComments: Int!,
  $reviews: Int!,
  $threads: Int!,
  $comments: Int!
) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      comments(first: $prComments) {
        nodes {
          id
          databaseId
          author { login }
          body
          url
          createdAt
        }
      }
      reviews(first: $reviews) {
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
      reviewThreads(first: $threads) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: $comments) {
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
}' \
  -F owner=fedify-dev \
  -F repo=fedify \
  -F number="$PR_NUMBER" \
  -F prComments="$NUMBER_OF_PR_COMMENTS" \
  -F reviews="$NUMBER_OF_REVIEWS" \
  -F threads="$NUMBER_OF_THREADS" \
  -F comments="$NUMBER_OF_COMMENTS_PER_THREAD" \
  | jq . > "$FETCHED_FILE"

# cspell: ignore MMDDHHMM
