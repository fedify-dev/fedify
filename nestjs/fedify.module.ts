import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import {
  createFederation,
  type FederationOptions,
  MemoryKvStore,
} from "@fedify/fedify";

import { FEDIFY_FEDERATION } from "./fedify.constants.ts";

@Module({})
export class FedifyModule {
  static forRoot(options: FederationOptions<unknown>): DynamicModule {
    const providers: Provider[] = [
      {
        provide: FEDIFY_FEDERATION,
        useFactory: () => {
          const federationOptions = {
            ...options,
          };

          federationOptions.kv = options.kv || new MemoryKvStore();

          const federation = createFederation(federationOptions);

          return federation;
        },
      },
    ];

    return {
      module: FedifyModule,
      providers,
      exports: [FEDIFY_FEDERATION],
      global: true,
    };
  }
}
