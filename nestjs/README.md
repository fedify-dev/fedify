<!-- deno-fmt-ignore-file -->

@fedify/nestjs: Integrate Fedify with NestJS
============================================

[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [NestJS].

The integration code looks like this:

~~~~ typescript
// --- modules/federation/federation.service ---

import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import {
  FEDIFY_FEDERATION,
} from '@fedify/nestjs';
import { Federation, parseSemver } from '@fedify/fedify';

@Injectable()
export class FederationService implements OnModuleInit {
  private initialized = false;

  constructor(
    @Inject(FEDIFY_FEDERATION) private federation: Federation<unknown>,
  ) { }

  async onModuleInit() {
    if (!this.initialized) {
      await this.initialize();
      this.initialized = true;
    }
  }

  async initialize() {
    this.federation.setNodeInfoDispatcher(async (context) => {
      return {
        software: {
          name: "Fedify NestJS sample",
          version: parseSemVer("0.0.1")
        }
      }
    });
  }
}


// --- modules/federation/federation.module.ts ---

import { Module } from '@nestjs/common';
import { FederationService } from './federation.service';

@Module({
  providers: [FederationService],
  exports: [FederationService],
})
export class FederationModule {}


// --- main.module.ts ---
import {
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { FederationModule } from './modules/federation/federation.module';
import { InProcessMessageQueue, MemoryKvStore, Federation } from '@fedify/fedify';

import {
  FEDIFY_FEDERATION,
  FedifyModule,
  integrateFederation,
} from '@fedify/nestjs';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    FedifyModule.forRoot({
      kv: new MemoryKvStore(),
      queue: new InProcessMessageQueue(),
      origin: process.env.FEDERATION_ORIGIN || 'http://localhost:3000',
    }),
    FederationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})

export class AppModule implements NestModule {
  constructor(
    @Inject(FEDIFY_FEDERATION) private federation: Federation<unknown>,
  ) { }

  configure(consumer: MiddlewareConsumer) {
    const fedifyMiddleware = integrateFederation(
      this.federation,
      async (req, res) => {
        return {
          request: req,
          response: res,
          url: new URL(req.url, `${req.protocol}://${req.get('host')}`),
        };
      },
    );

    // Apply middleware to all routes except auth endpoints
    consumer.apply(fedifyMiddleware)
  }
}

~~~~

[npm]: https://www.npmjs.com/package/@fedify/nestjs
[npm badge]: https://img.shields.io/npm/v/@fedify/express?logo=npm
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[NestJS]: https://nestjs.com/
