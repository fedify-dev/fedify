<!-- deno-fmt-ignore-file -->

@fedify/amqp: AMQP/RabbitMQ driver for Fedify
=============================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

> [!NOTE]
>
> Although it's theoretically possible to be used with any AMQP 0-9-1 broker,
> this package is primarily designed for and tested with [RabbitMQ].

This package provides [Fedify]'s [`MessageQueue`] implementation for AMQP, which
is supported by RabbitMQ:

 -  [`AmqpMessageQueue`]

Here is an example of how to use it:

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { AmqpMessageQueue } from "@fedify/amqp";
import { connect } from "amqplib";

const federation = createFederation({
  queue: new AmqpMessageQueue(await connect("amqp://localhost")),
  // ... other configurations
});
~~~~

The `AmqpMessageQueue` constructor accepts options as the second
parameter, which can be used to configure the message queue:

~~~~ typescript
new AmqpMessageQueue(await connect("amqp://localhost"), {
  queue: "my_queue",
})
~~~~

For more details, please refer to the docs of [`AmqpMessageQueueOptions`].

[JSR badge]: https://jsr.io/badges/@fedify/amqp
[JSR]: https://jsr.io/@fedify/amqp
[npm badge]: https://img.shields.io/npm/v/@fedify/amqp?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/amqp
[RabbitMQ]: https://www.rabbitmq.com/
[Fedify]: https://fedify.dev/
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[`AmqpMessageQueue`]: https://jsr.io/@fedify/amqp/doc/mq/~/AmqpMessageQueue
[`AmqpMessageQueueOptions`]: https://jsr.io/@fedify/amqp/doc/mq/~/AmqpMessageQueueOptions


Installation
------------

~~~~ sh
deno add jsr:@fedify/amqp  # Deno
npm  add     @fedify/amqp  # npm
pnpm add     @fedify/amqp  # pnpm
yarn add     @fedify/amqp  # Yarn
bun  add     @fedify/amqp  # Bun
~~~~
