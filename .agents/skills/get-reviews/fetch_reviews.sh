#!/usr/bin/env bash
set -euo pipefail

: "${PR_NUMBER:?PR_NUMBER is required}"
: "${NUMBER_OF_PR_COMMENTS:?NUMBER_OF_PR_COMMENTS is required}"
: "${NUMBER_OF_REVIEWS:?NUMBER_OF_REVIEWS is required}"
: "${NUMBER_OF_THREADS:?NUMBER_OF_THREADS is required}"
: "${NUMBER_OF_COMMENTS_PER_THREAD:?NUMBER_OF_COMMENTS_PER_THREAD is required}"

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
  $comments: Int!,
  $after: String
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
      reviewThreads(first: $threads, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
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
  ${LAST_CURSOR:+-F after="$LAST_CURSOR"} \
  | jq . > "$FETCHED_FILE"

echo "Fetched reviews and comments are saved to $FETCHED_FILE"
