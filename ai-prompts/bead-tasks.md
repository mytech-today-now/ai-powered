bd-1isz	P1	Scaffold core config files
bd-lcgw	Scaffold project boilerplate and CI	bd-1isz
bd-o93z	Define AiConfig Zod schema and layered config loader	bd-1isz
bd-d1i0	Implement getAiClient factory and AiClient class	bd-1isz
bd-graf	Set up Pino logger and maskApiKey utility	bd-1isz
bd-hbt7	Implement token estimation and cost calculator	bd-d1i0
bd-t3p1	Implement budget enforcement and model list cache	bd-d1i0
bd-wlza	Implement BaseProvider abstract class and providers registry	bd-d1i0
bd-744e	Implement OpenAI and Anthropic providers	bd-wlza
bd-zr19	Implement xAI/Grok and Venice.ai providers	bd-wlza
bd-1ie9	Implement Custom/Ollama and Mock providers	bd-wlza
bd-6sd0	Implement exponential-backoff retry wrapper	bd-wlza
bd-ka3e	Implement per-provider circuit breaker	bd-wlza
bd-qix4	Implement provider fallback/failover loop	bd-wlza
bd-wdod	Implement root Commander.js program and global flags	bd-d1i0, bd-744e
bd-rf4x	Implement modality commands: text, image, audio, video, structured	bd-wdod
bd-3jke	Implement wizard, list-models, list-templates, config, health-check	bd-wdod
bd-mkkh	Implement batch, serve, and session commands	bd-wdod
bd-rrel	Implement stdin, --dry-run, --quiet, --no-color, --log, --session	bd-wdod, bd-6tz7
bd-x1jl	Enforce maskApiKey everywhere and git-tracked credential warning	bd-graf
bd-4wgx	Implement .gitignore auto-management and lifecycle --init	bd-graf, bd-lcgw
bd-r34a	Implement pre-commit and Vite browser bundle secret scanning	bd-graf, bd-lcgw
bd-1yz3	Implement template schema, renderTemplate, resolver, and listTemplates	bd-o93z
bd-y90b	Implement AiPlugin interface, plugin loader, and pipeline	bd-d1i0
bd-6tz7	Create built-in templates: summarize, translate, qa	bd-1yz3
bd-z9ty	Implement plugin sandboxing and PluginError handling	bd-y90b
bd-i46t	Implement built-in plugins: audit-log, rate-limiter, prompt-shield	bd-y90b
bd-yt9t	Implement CLI wizard (cli/wizard.ts)	bd-wdod
bd-kms8	Implement createWebClient factory and WebAiClient methods	bd-d1i0, bd-6tz7
bd-iy85	Implement browser fetch client and sessionStorage sessions	bd-kms8
bd-soh8	Vite dual ESM/UMD build, secret scan, and package exports map	bd-kms8
bd-jwqv	Implement Express proxy server with all API routes and SSE	bd-kms8, bd-mkkh
bd-nld9	Integrate core features into proxy server	bd-jwqv
bd-x19e	Unit tests: AiConfig, maskApiKey, renderTemplate, ConversationSession	bd-o93z, bd-graf, bd-1yz3, bd-rrel
bd-zab3	Unit tests: retry, circuit breaker, budget, plugin pipeline, config layering	bd-6sd0, bd-ka3e, bd-t3p1, bd-y90b, bd-o93z
bd-gsaj	Integration tests: MockProvider and VeniceProvider with mock HTTP	bd-1ie9, bd-zr19
bd-hprz	CLI integration tests: spawn ai-powered binary with AI_MOCK=true	bd-rf4x, bd-3jke, bd-mkkh, bd-rrel
bd-4eyn	Create shell and multi-language integration examples	bd-rf4x
bd-brw0	Create web-example demo (integrations/web-example/)	bd-soh8
bd-hozn	Write README.md with full structure	bd-x19e, bd-zab3, bd-4eyn
bd-99d5	Write Plugin authoring guide in README	bd-hozn