# QL reference (distilled from epi-logos.org)

Crawl date: 2026-10-10. Every formulation below is the QL framework's own, quoted from the site. No pages were read, so this file contains no quoted formulations.

## Sources

No pages were read. Every fetch attempt failed:

- WebFetch, `https://epi-logos.org`: `getaddrinfo ENOTFOUND epi-logos.org` (DNS resolution failed in the WebFetch tool).
- `curl -sSL https://epi-logos.org` through the configured HTTPS proxy: `curl: (56) CONNECT tunnel failed, response 403`, HTTP status 000.
- Proxy status endpoint (`/__agentproxy/status`) recorded `connect_rejected` for host `epi-logos.org:443` with detail "gateway answered 403 to CONNECT (policy denial or upstream failure)".

Per the proxy README (`/root/.ccr/README.md`), a 403 from the proxy is an organization egress-policy denial. It was reported, not retried or routed around.

## Gaps

What was looked for and not found:

- The home page (`https://epi-logos.org`) and any of its subpages.
- Any page on Quaternal Logic (QL), the matheme, or the axioms.
- Descriptions of positions #0, #1, #2, #3, #4, #5, with their names as the site gives them. None were retrieved.
- Notation (how the site writes positions, operators, and nesting such as "#2.3").
- Any passage connecting QL to Jung, archetypal number, the psychoid, synchronicity, or time.
- Pages mentioning "bimba" or "mod6".

Blocking cause: the egress policy of this session denies `epi-logos.org:443`. Lifting that block, for example by allowing the host in the session's network policy, would let the crawl run. Retrying through a different hostname or scheme was not attempted, because the README says not to route around policy denials.
