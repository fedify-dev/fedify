---
links:
  '#1055': https://github.com/fedify-dev/fedify/issues/1055
---
 -  DNS failures during initial inbox validation now record failed delivery
    metrics, matching DNS failures during redirect validation.  Both paths
    count toward the outbox circuit breaker, including DNS lookups that
    return no usable IP addresses.  Private-address rejections retain their
    existing behavior. [[#1055]]
