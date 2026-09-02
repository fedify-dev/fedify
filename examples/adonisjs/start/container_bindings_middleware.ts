import { HttpContext } from "@adonisjs/core/http";
import { Logger } from "@adonisjs/core/logger";
import { type NextFn } from "@adonisjs/core/types/http";

/**
 * The container bindings middleware binds classes to their request
 * specific value using the container resolver, so that controllers and
 * services can have the current HttpContext and Logger injected.  It is the
 * stock AdonisJS starter middleware; Fedify does not depend on it.
 */
export default class ContainerBindingsMiddleware {
  handle(ctx: HttpContext, next: NextFn) {
    ctx.containerResolver.bindValue(HttpContext, ctx);
    ctx.containerResolver.bindValue(Logger, ctx.logger);

    return next();
  }
}
