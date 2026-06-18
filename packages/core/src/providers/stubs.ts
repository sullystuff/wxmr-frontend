import { UnsupportedRouteProvider } from "../routes.js";

export class MayanProvider extends UnsupportedRouteProvider {
  constructor() {
    super("mayan", "Mayan routing is handled by the orchestrator");
  }
}

export class ThorchainProvider extends UnsupportedRouteProvider {
  constructor() {
    super("thorchain", "THORChain routing is scaffolded but not active in v1");
  }
}

export class ChainflipProvider extends UnsupportedRouteProvider {
  constructor() {
    super("chainflip", "Chainflip routing is handled by the orchestrator");
  }
}
