---
id: REVIEW_ID
description: summary of the review
link: the link to the review on GitHub
links:
 -  If there are multiple links related to the review,
 -  list all the links.
 -  Include links to related PR comments (issue comments) and review thread
 -  replies that provide additional context for this review. Use the `url`
 -  field of each comment from the fetched JSON.
 - `link`–`links` are mutually exclusive.
commit: the hash of commit after applying the review to add the comment
commits:
 -  If the review applies to multiple commits, list the hashes of the commits
 -  after applying the review, update the list to include the new commit hash
 - `commit`–`commits` are mutually exclusive. `commit` and `commits` are
 - optional, and only used when the review is applied.
---

<!-- deno-fmt-ignore-file -->

Title
=====

<!-- One line summary of the review -->


Summary
-------

<!--
  The summary of the review, but in little more detail
  If the review is too short even enough with the title, omit this section.
-->


Judgement
---------

<!--
  The judgement about the review.

  The first line should be one of the following:
  - **CORRECT**: If the review is correct and should be applied.
  - **WRONG**: If the review is wrong and should be dismissed.
  - **PARTIAL**: If the review is partially correct and should be applied with
    some modifications.
  - **NEEDS EVALUATION**: If the review requires testing or evaluation,
    such as a review pointing out efficiency issues.
  - **NEEDS DISCUSSION**: If the review needs further discussion,
    such as about direction of the project or design choices.
  Try to use these words to indicate judgement status whenever possible,
  but if you feel they are truly insufficient,use an appropriate word
  and then update this part of *SKILL.md*.

  After the first line, explain the judgement in more detail.
  - The reasons for the judgement.
  - The key factors that influence the judgement.
-->


Plans
-----

<!--
  If the review is judged as **WRONG**, omit this section or write the plans
  to add comments explaining the code to prevent similar misunderstandings.

  If the review is judged as **CORRECT** or **PARTIAL**,
  write the plans to apply the review.
  - How to apply the review?
  - If the review is judged as **PARTIAL**, what are the modifications to apply?
  - Why the plans can apply the review correctly?

  If the review is judged as **NEEDS EVALUATION**,
  write the plans to evaluate the review, such as testing plans.
  - How to test or evaluate?
  - What are the criteria for success or failure?
  - Why the tests or evaluation can determine the correctness of the review?
  And after the evaluation, write the plans to apply or dismiss the review
  based on the evaluation results.

  If the review is judged as **NEEDS DISCUSSION**,
  write the plans to discuss the review, such as topics to discuss and
  potential options.
  - What are the topics to discuss?
  - What are the potential options and their pros and cons?
  - What is the most reasonable option and why?
-->


Comments
--------

<!--
  Prepare the response comments in advance after applying the review or
  judging the review as wrong. The comments should be polite and constructive.

  If the contributor don't use English, separate this section into two parts,
  - the language of the contributor using
  - English, ready to be posted as a response

  If the review is judged as **CORRECT**, write comments to apply the review
  to explain how to apply the review and why it is correct. The comments to
  applied reviews should be started with "Addressed in {COMMIT_HASH}.".

  If the review is judged as **WRONG**, write comments to dismiss the review
  to explain why the review is wrong and should be dismissed.

  If the review is judged as **PARTIAL**, write comments to partially apply the
  review to explain how to apply the review with modifications and why it is
  partially correct. Referring to the above, write the incorrect parts based
  on the **WRONG** part, and the correct parts based on the **CORRECT** part.

  If the review is judged as **NEEDS EVALUATION**, write the comments to
  evaluate the review explain how to evaluate the review, the test results,
  and the resulting application/rejection details.
  - If the results of the evaluation are the review is correct,
    write comments referring to the **CORRECT** part.
  - If the results of the evaluation are the review is wrong,
    write comments referring to the **WRONG** part.

  If the review is judged as **NEEDS DISCUSSION**,
  write the comments to discuss the review.
  - The comments should explain what to discuss
    about the review and why it needs discussion.
  - The comments should be polite and constructive.
-->
