---
name: get-reviews
description: >-
  This skill is utilized when requesting reviews from GitHub pull requests.
  Get the reviews, organize, and resolve them by applying or dismissing.
argument-hint: "Provide the number of the pull request to get the reviews."
---

<!-- deno-fmt-ignore-file -->

Get reviews from GitHub pull requests
=====================================

This skill is utilized when requesting reviews from GitHub pull requests.

1.  Get the reviews.
2.  Organize the reviews.
3.  Resolve the reviews by applying or dismissing them.


Get the reviews
---------------

To get the reviews from a GitHub pull request, you can use the GitHub API.
Check the [`gh` CLI tool][gh] is installed and authenticated.
`gh auth status` can be used to check the authentication status.
If `gh` isn't installed, try installing it by `apt install gh`.
If authentication is not set up, tell the contributor to run `gh auth login`
to authenticate with GitHub.

Use the GraphQL API to fetch the reviews for a specific pull request.
Check [fetch\_reviews.sh](./fetch_reviews.sh) to fetch the reviews
and save them in a JSON file:

 -  Replace `$VARIABLES` with the actual values or variables in the command.
 -  For incremental fetches, save `pageInfo.endCursor` from the previous
    fetch and pass it as `after: $LAST_CURSOR` (a base64 cursor, not a
    review thread node ID) so the query returns only new review threads.
 -  Use `jq` to filter the reviews and information if necessary.

The fetched JSON files in *plans/{PR\_NUMBER}/fetched/* contain the raw data
of PR comments, reviews, and review threads (with `pullRequestReview`
back-references on thread comments). When more context is needed later
(e.g., to resolve which review a thread belongs to, or to check the original
body of a comment), refer back to these files instead of re-fetching.

[gh]: https://cli.github.com/


Organize the reviews
--------------------

After fetching the PR and its reviews, organize the reviews.
[*plans* directory in the root](../../../plans/) is a good place to store them.

 -  *plans/{PR\_NUMBER}/index.md*: The main file for the PR.
     -  The body of the PR
 -  *plans/{PR\_NUMBER}/reviews/{REVIEW\_ID}.md*: The file for each review
    which is not resolved.
     -  After applying or dismissing the review, move the file to
        *plans/{PR\_NUMBER}/reviews/resolved/{REVIEW\_ID}.md*.
     -  If the review file is too long, move the content to
        *plans/{PR\_NUMBER}/reviews/{REVIEW\_ID}/index.md*, and separate the
        content into multiple files in the same directory. In this case, after
        resolving the review, move the whole directory to
        *plans/{PR\_NUMBER}/reviews/resolved/{REVIEW\_ID}/*.
 -  *plans/{PR\_NUMBER}/reviews/resolved/{REVIEW\_ID}.md*: The file for each
    review which is resolved.

**Don't use the first comment of the review thread as the review ID.**
The ID of the review thread starts with “PRRT\_”.
Use the first comment ID of the review thread only on the link.

Review threads aren't the only place that asks for changes. A PR-level
comment (in `comments` of the fetched JSON, whose ID starts with “IC\_”)
or the body of a review (in `reviews` of the fetched JSON, whose ID starts
with “PRR\_”) can also point out things to fix. When such a comment or
review body requests modifications, organize it as its own review file
alongside the review-thread files, using the same directory layout and
naming rules:

 -  Use the node ID of the PR comment (“IC\_…”) or the review (“PRR\_…”)
    as the `{REVIEW\_ID}` in the file path.
 -  If a PR comment or review body only contains approval, general
    impressions, questions without a modification request, or other content
    with nothing to fix, skip it and do not create a file for it.
 -  If only a part of a longer PR comment or review body requests changes,
    create a file only for that request and quote the relevant excerpt in
    the file so the context is preserved.

The format of review files should be as [review.md](./review.md).
Read the reviews and fill the format as a draft with the related information.
The files should be written in the contributor's language. But the title of
the item in the file (e.g., “Summary”, “Judgement”, “Plans”) should be in
English for consistency.

Empty the space between the “Title” and the “Summary” sections.

All related information with the review should be stored in
*plans/{PR\_NUMBER}/reviews/{REVIEW\_ID}.md* or the files in
*plans/{PR\_NUMBER}/reviews/{REVIEW\_ID}/*.

After organizing the reviews, show the links to the files to the contributor.


Resolve the reviews
-------------------

Let the contributor read the review files, decide the judgement and the plans
for each review, and let them update the review files if necessary.
After the contributor decides the judgement and the plans, apply or dismiss the
reviews based on the files.

Categorize the reviews and the plans, and apply them at once by category.
After applying the review, use [`/commit` skill](../commit/SKILL.md) to commit
the changes. The commit message should include the related review links.
`https://github.com/fedify-dev/fedify/pull/{PR_NUMBER}#discussion_r{REVIEW_THREAD.COMMENTS[0].DATABASE_ID}`

After committing the changes, update the review file to include the commit hash
and the comment section. If the review is dismissed, update the review file to
include the reason for dismissing and the comment section.

If the `Comments` are written only in the contributor's language, provide an
English translation and have the contributor review it. If they are written in
both languages, check for any discrepancies between the two. If differences
exist between the two versions, review them based on the facts and revise
the English version to match the content in the contributor's language.

Post all review comments in English, even if the file written in the
contributor's native language. The comments should be polite and constructive.

After resolving the reviews, pushing commits, posting comments, and updating
the reviews as resolved, move the review files to
*plans/{PR\_NUMBER}/reviews/resolved*. Before moving the files, check status and
comments of the PR from GitHub. Use [fetch\_reviews.sh](./fetch_reviews.sh),
but instead of fetching all reviews and attributes, fetch only the necessary
attributes to check the review status and comments.
