---
id: REVIEW_ID
description: summary of the review
link: The link to the review on GitHub
# If more than one URL is relevant — related PR comments or review-thread
# replies that provide additional context — use `links` instead of `link`.
# Use the `url` field of each comment from the fetched JSON.
# links:
#  -  https://github.com/.../pull/123#discussion_r4567
#  -  https://github.com/.../pull/123#discussion_r4568
commit: The hash of commit after applying the review to add the comment
# If the review was applied across multiple commits, use `commits` instead
# of `commit`. Both fields are optional and only set after the review is
# applied.
# commits:
#  -  abc1234
#  -  def5678
---

<!-- deno-fmt-ignore-file -->

<!--
  From this point forward, there are instructions within comments as well as
  instructions outside of comments.
  Instructions outside of comments are intended for contributors. Please copy
  them verbatim or translate them into the user's language.
  (Don't translate `Judgement` section keywords: **CORRECT**, **WRONG**, etc.)
  Instructions within comments are intended for the agent, not the
  contributors.
  Adhere strictly to these directives, ensuring all comments are purged so
  they remain concealed from the user.
-->

Title
=====


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
-->

Choose your judgement(remain only one item also, delete this line):
  - **CORRECT**
      If the review is correct and should be applied.
  - **WRONG**
      If the review is wrong and should be dismissed.
  - **PARTIAL**
      If the review is partially correct and should be applied with some
      modifications.
  - **NEEDS EVALUATION**
      If the review can be settled by empirical, mechanical verification of a
      factual claim rather than human judgement—for example, whether the code
      really cannot handle a certain error or whether some package is actually more efficient than the previously used package.
  - **NEEDS DISCUSSION**
      If the review needs further discussion, such as about direction of the
      project or design choices.

<!--
 The AI agent's mission is to help the contributor extract context to decide
 whether or not to apply a review. Include relative links to the code file or
 documentation pointed out by the review, along with information to aid in the
 decision-making process. While agent can make simple suggestions for reviews
 where the facts are clear, the final judgment must be made by the user.
-->

Plans
-----

If the review is judged as **WRONG**, omit this section or write the plans
to add comments explaining the code to prevent similar misunderstandings.

If the review is judged as **CORRECT** or **PARTIAL**,
write the plans to apply the review.
  - How to apply the review?
  - If the review is judged as **PARTIAL**, what are the modifications to
    apply?
  - Why the plans can apply the review correctly?

If the review is judged as **WRONG**, write plans to why the reviewer
misunderstood the code and how to prevent similar misunderstandings
in the future.
  - What are the reasons for the misunderstanding?
  - How to prevent similar misunderstandings in the future?
  - Consider adding comments to the code, improving documentation,
    renaming variables or functions for clarity,
    or refactoring the code to make it more understandable.

If the review is judged as **NEEDS EVALUATION**,
write the plans to evaluate the review, such as testing plans.
  - How to test or evaluate?
  - What are the criteria for success or failure?
  - Why the tests or evaluation can determine the correctness of the review?
  - After the evaluation, write the plans to apply or dismiss the review
    based on the evaluation results.
  - Record the verification method, the pass/fail criteria, and the measured
    result as evidence.

If the review is judged as **NEEDS DISCUSSION**,
write the plans to discuss the review, such as topics to discuss and
potential options.
  - What are the topics to discuss?
  - What are the potential options and their pros and cons?
  - What is the most reasonable option and why?


Comments
--------

Prepare the response comments in advance after applying the review or
judging the review as wrong. The comments should be polite and constructive.
Do not use conversational fillers (e.g. "You're right.") Avoid using personal
pronouns such as "I," "we," or "you." Focus on describing how the code has
changed rather than stating "I did something."

If your comfortable language is not English, consider to separate this section into two parts,
  - the language you use
  - English, ready to be posted as a response
This will be help when posting comments all at once using the `gh` CLI tool.

If you want to notify about modifications, add the commit hash at the first.
Consider to start with: "Addressed in {COMMIT_HASH}."

If the review is judged as **CORRECT**, write comments to apply the review
to explain how to apply the review.

If the review is judged as **WRONG**, write comments to dismiss the review
to explain why the review is wrong and should be dismissed.

If the review is judged as **PARTIAL**, write comments to partially apply the
review to explain how to apply the review with modifications and why it is
partially correct. Referring to the above, write the incorrect parts based
on the **WRONG** part, and the correct parts based on the **CORRECT** part.

If the review is judged as **NEEDS EVALUATION**, write the comments to
evaluate the review to explain how to evaluate the review, the test results,
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
