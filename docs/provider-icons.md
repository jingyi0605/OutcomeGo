# Provider icons

Each model provider row shows a mark. The server decides which one, so the three clients render the same thing.

| Provider | Mark |
| --- | --- |
| ChatGPT, Claude, OpenAI, Anthropic, OpenRouter | `BUILTIN_PROVIDER_ICONS` |
| Added from a preset | the preset's `icon` |
| Custom endpoint | the generic mark of its protocol: `generic-openai-chat`, `generic-openai-responses` or `generic-anthropic-messages` |

The rule is `providerRowIcon` in `packages/contracts/src/inference-presets.ts`. The registry sends the result as `icon` on each provider view.

## Assets

Marks come from [lobehub/icons](https://github.com/lobehub/lobe-icons) (MIT), as bundled by [yetone/magpie](https://github.com/yetone/magpie) (MIT). The `generic-*` marks are ours (`scripts/icons/generic`). Product names and logos belong to their owners.

```sh
git clone --depth 1 https://github.com/yetone/magpie.git /tmp/magpie
bun scripts/icons/export-provider-icons.ts /tmp/magpie   # write the assets for all three clients
bun scripts/icons/export-provider-icons.ts --check       # every wanted icon exists
```

| Client | Where | Format |
| --- | --- | --- |
| Desktop | `apps/desktop/src/renderer/assets/provider-icons/<name>.svg` | SVG |
| iOS | `Assets.xcassets/ProviderIcon-<name>.imageset` | vector SVG, template image for one-colour marks |
| Android | `res/drawable-nodpi/provider_<name>.png` | 192 px PNG (Android has no SVG decoder) |

A name ending in `-color` keeps its own colours. Every other mark is one colour and follows the text colour: a CSS mask on desktop, a template image on iOS, a tint on Android. The generator refuses an icon that breaks this rule.

Android looks icons up by name at run time (`getIdentifier`). A release build that shrinks resources must keep `provider_*`.

Add a preset: give it an `icon`, run the generator, commit the assets.
