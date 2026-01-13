<!-- hongdown-disable-next-line -->

actor-lookup-cli
================

This example is a simple CLI program that looks up an actor by their fediverse
handle (e.g. *@user@host*) and prints out their name, bio, stats, etc.  It uses
Fedify as a client library of ActivityPub, not as a server framework here.


Usage
-----

~~~~ sh
deno task codegen  # At very first time only
deno run -A ./main.ts @fedify@hollo.social
~~~~
