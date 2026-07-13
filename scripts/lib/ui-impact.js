"use strict";

const UI_PATH_RE =
  /(^|\/)(components?|screens?|pages?|views?|layouts?|design-system|styles?|theme|copy|locales?|i18n)(\/|$)|\.(tsx|jsx|css|scss|sass|less|vue|svelte)$/i;
const JS_TS_PATH_RE = /\.(js|mjs|cjs|ts)$/i;
const UI_JS_TS_PATH_RE =
  /(^|\/)(app\/javascript|assets\/javascripts?|public\/javascripts?|frontend|client|web|mobile|ui|browser)(\/|$)/i;
const UI_JS_TS_ENTRY_RE =
  /(^|\/)src\/(App|app|main|index|bootstrap|entry-client|entry-server)\.(js|mjs|cjs|ts)$/i;
const UI_APP_ROOT_RE =
  /(^|\/)(apps?|packages)\/[^/]*(web|frontend|client|mobile|ui|browser)[^/]*\/(src|app)\//i;
const NEXT_APP_ROUTER_UI_RE =
  /(^|\/)(src\/)?app\/([^/]+\/)*(page|layout|template|loading|error|not-found|global-error|default)\.(js|mjs|cjs|ts)$/i;
const NEXT_APP_ROUTER_MARKUP_RE =
  /(^|\/)(src\/)?app\/([^/]+\/)*(page|layout|template|loading|error|not-found|global-error|default)\.(mdx|md)$/i;
const ANGULAR_UI_TS_RE = /(^|\/)(src\/)?app\/([^/]+\/)*[^/]+\.(component|directive|pipe)\.ts$/i;
const UI_ROUTER_JS_TS_RE =
  /(^|\/)(src\/)?((routes|routing|router)\.(js|mjs|cjs|ts)|router\/(index|routes|router)\.(js|mjs|cjs|ts)|app\/([^/]+\/)*[^/]+(\.routes|-routing\.module)\.ts)$/i;
const BACKEND_ROUTE_CONTEXT_RE = /(^|\/)(server|backend|api|services?)(\/|$)/i;
const FRONTEND_ROUTE_MODULE_RE =
  /(^|\/)(src|frontend|client|web|mobile|ui|browser)\/routes\/[^/]+(?:\/[^/]+)*\.(js|mjs|cjs|ts)$/i;
const UI_SINGLE_APP_STATE_RE =
  /(^|\/)src\/(features?|hooks?|stores?|state|contexts?|providers?|redux|reducers?|slices?|zustand)\//i;
const UI_CONFIG_RE =
  /(^|\/)(tailwind\.config|postcss\.config|uno\.config|unocss\.config|theme\.config|tokens\.config)\.(js|mjs|cjs|ts)$/i;
const UI_TOKEN_DATA_RE =
  /(^|\/)(design-tokens?|tokens?|themes?)(\/|[-.])|(^|\/)(design-tokens?|tokens?|themes?|style-dictionary\.config)\.(json|ya?ml|toml)$/i;
const UI_TEMPLATE_MARKUP_RE =
  /\.(html?|astro|erb|ejs|hbs|handlebars|liquid|twig|njk|j2|pug|jade|slim|haml|mustache|cshtml|razor|blade\.php)$/i;
const APPLE_UI_RE =
  /(^|\/)(ios|macos|watchos|tvos|swiftui|uikit)(\/|$).*(^|\/)(views?|screens?|ui|presentation)(\/|$).*\.(swift|m|mm|h)$|(^|\/)(ios|macos|watchos|tvos)(\/|$).*\.(storyboard|xib|strings|stringsdict)$|\.(storyboard|xib)$|(^|\/)[^/]+\.xcassets\//i;
const APPLE_UI_NAMED_FILE_RE =
  /(^|\/)(?:[A-Z][A-Za-z0-9_]*(?:ViewController|View|Screen)|AppDelegate|SceneDelegate)\.(?:swift|m|mm|h)$/;
const ANDROID_UI_RE =
  /(^|\/)(?:android\/[^/]+\/)?(?:app\/)?src\/[^/]+\/res\/(layout|drawable|mipmap|values|anim|animator|menu|navigation|xml)(\/|$)|(^|\/)[^/]+\/src\/[^/]+\/res\/(layout|drawable|mipmap|values|anim|animator|menu|navigation|xml)(\/|$)/i;
const ANDROID_NAMED_KOTLIN_UI_RE =
  /(^|\/)[^/]*(?:Activity|Fragment|Screen|Dialog|Composable|Ui|UI)\.(kt|kts)$/i;
const ANDROID_SOURCE_SET_RE = /(^|\/)[^/]+\/src\/[^/]+\/(?:java|kotlin)\//i;
const ANDROID_ROOT_RE = /(^|\/)android\//i;
const ANDROID_BACKEND_CONTEXT_RE = /(^|\/)(?:server|services?|backend|build-logic|tools?)(\/|$)/i;
const ANDROID_UI_PACKAGE_KOTLIN_RE =
  /(^|\/)[^/]+\/src\/[^/]+\/(java|kotlin)\/.*\/(ui|views?|screens?|presentation|adapters?)\/.*(?:View|Adapter)\.(kt|kts)$/i;
const FLUTTER_UI_RE =
  /(^|\/)lib\/(widgets?|screens?|pages?|views?|ui|presentation)\/.*\.dart$|(^|\/)(main|[^/]+_(screen|page|widget|view))\.dart$/i;
const UI_ASSET_RE = /(^|\/)(assets?|public)\/.*\.(svg|png|jpe?g|gif|webp|avif)$/i;
const KB_ARTIFACT_PATH_RE = /^\.?pm\//;

function isFrontendRouteModule(file) {
  const match = FRONTEND_ROUTE_MODULE_RE.exec(file);
  if (!match) return false;
  // Backend ownership only disqualifies the path before the recognized
  // frontend route root. Route namespaces beneath `src/routes/` (for example
  // `src/routes/api/users.ts`) remain user-interface modules.
  return !BACKEND_ROUTE_CONTEXT_RE.test(file.slice(0, match.index));
}

function isUiImpactPath(file) {
  if (typeof file !== "string" || KB_ARTIFACT_PATH_RE.test(file)) return false;
  if (UI_PATH_RE.test(file)) return true;
  if (UI_TOKEN_DATA_RE.test(file)) return true;
  if (UI_TEMPLATE_MARKUP_RE.test(file)) return true;
  if (UI_ASSET_RE.test(file)) return true;
  if (NEXT_APP_ROUTER_MARKUP_RE.test(file)) return true;
  if (
    APPLE_UI_RE.test(file) ||
    APPLE_UI_NAMED_FILE_RE.test(file) ||
    ANDROID_UI_RE.test(file) ||
    ((ANDROID_SOURCE_SET_RE.test(file) ||
      (ANDROID_ROOT_RE.test(file) && !ANDROID_BACKEND_CONTEXT_RE.test(file))) &&
      ANDROID_NAMED_KOTLIN_UI_RE.test(file)) ||
    ANDROID_UI_PACKAGE_KOTLIN_RE.test(file) ||
    FLUTTER_UI_RE.test(file)
  )
    return true;
  if (!JS_TS_PATH_RE.test(file)) return false;
  return (
    UI_JS_TS_PATH_RE.test(file) ||
    UI_JS_TS_ENTRY_RE.test(file) ||
    UI_APP_ROOT_RE.test(file) ||
    NEXT_APP_ROUTER_UI_RE.test(file) ||
    ANGULAR_UI_TS_RE.test(file) ||
    (UI_ROUTER_JS_TS_RE.test(file) && !BACKEND_ROUTE_CONTEXT_RE.test(file)) ||
    isFrontendRouteModule(file) ||
    UI_SINGLE_APP_STATE_RE.test(file) ||
    UI_CONFIG_RE.test(file)
  );
}

module.exports = { isUiImpactPath };
