---
links:
  '#1064': https://github.com/fedify-dev/fedify/issues/1064
---
 -  Fixed `fedify lookup` suggesting authorized fetch when a DNS URL validation
    error reaches its error handler.  The hint now suggests checking the
    hostname and network connectivity, and distinguishes DNS failures from
    private-address rejections. [[#1064]]
