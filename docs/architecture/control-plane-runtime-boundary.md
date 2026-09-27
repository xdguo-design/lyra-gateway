# Control Plane / Runtime Boundary

FreeLLM Gateway is being refactored from an in-process model proxy into an AI gateway control plane.

## Ownership

FreeLLM keeps:

- model catalog and model intelligence
- tenant, application, API key, quota and billing policy
- model policy decisions and fallback policy
- normalized usage/cost events and analytics
- admin console and governance APIs

External gateway runtimes own:

- HTTP proxying and streaming
- provider protocol translation
- transport retry and circuit breaking
- upstream connection management
- runtime health checks

## Runtime contract

`freellm_gateway.backends.base.GatewayBackend` is the anti-corruption boundary. Planned implementations are LiteLLM first, Higress second, and APISIX when enterprise gateway requirements justify it.

The control plane emits desired routes and policies; runtime adapters translate that desired state into runtime-specific configuration. Runtime-specific objects must not leak into model catalog, tenant, policy, usage, or billing domains.

## Migration
T\ÙH[›ÙXÙ\ÈH›Ý[™\žHÚ]Ý][][™ÈHYØXÞH[[YHÛÈ^\Ý[™ÈÛY[ÈÙY\ÛÜšÚ[™Ë‚‚”\ÙHH[Ý™\È[Ù[Ù[XÝ[ÛˆÈ[Ù[ÛXÞQ[™Ú[™X[™YÈ[˜[Ø\XØ][Ûˆ\È\ØYÙHÛXZ[œË‚‚”\ÙHˆYÈ]SH[™YÜ™\ÜÈ˜XÚÙ[™[\[Y[][ÛœËˆ™]È[[YH™X]\™\È]\Ý™H[\[Y[Y[ˆÜÙHY\\œÈÜˆ\Ý™X[H›Ú™XÝË›Ý[ˆHYØXÞH›ÞK‚‚”\ÙHÈ™[[Ý™\ÈHYØXÞH[‹\›ØÙ\ÜÈ›ÝšY\ˆY\\‹˜Z[Ý™\‹˜[œÜÜX[[™›ÞH]ÈY\ˆÛÛ\]Xš[]H\ÝÈ\ÜË‚