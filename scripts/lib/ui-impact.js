"use strict";

const UI_PATH_RE =
  /(^|\/)(components?|screens?|pages?|routes?|views?|layouts?|design-system|styles?|theme|copy|locales?|i18n)(\/|$)|\.(tsx|jsx|css|scss|sass|less|vue|svelte)$/i;
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
const UI_SINGLE_APP_STATE_RE =
  /(^|\/)src\/(features?|hooks?|stores?|state|contexts?|providers?|redux|reducers?|slices?|zustand)\//i;
const UI_CONFIG_RE =
  /(^|\/)(tailwind\.config|postcss\.config|uno\.config|unocss\.config|theme\.config|tokens\.config)\.(js|mjs|cjs|ts)$/i;
const UI_TOKEN_DATA_RE =
  /(^|\/)(design-tokens?|tokens?|themes?)(\/|[-.])|(^|\/)(design-tokens?|tokens?|themes?|style-dictionary\.config)\.(json|ya?ml|toml)$/i;
const UI_TEMPLATE_MARKUP_RE =
  /\.(html?|astro|erb|ejs|hbs|handlebars|liquid|twig|njk|j2|pug|jade|slim|haml|mustache|cshtml|razor|blade\.php)$/i;
const SWIFT_UI_RE = /(^|\/)[^/]*(View|Screen|App)\.swift$/i;
const COMPOSE_UI_RE = /(^|\/)[^/]*(Screen|View|Activity|Fragment)\.kts?$/i;
const FLUTTER_UI_RE =
  /(^|\/)lib\/(screens?|widgets?|pages?|views?|ui|themes?)(\/|$)|(^|\/)(main|[^/]+_(screen|page|widget|view))\.dart$/i;
const KB_ARTIFACT_PATH_RE = /^\.?pm\//;

function isUiImpactPath(file) {
  if (typeof file !== "string" || KB_ARTIFACT_PATH_RE.test(file)) return false;
  if (UI_PATH_RE.test(file)) return true;
  if (UI_TOKEN_DATA_RE.test(file)) return true;
  if (UI_TEMPLATE_MARKUP_RE.test(file)) return true;
  if (NEXT_APP_ROUTER_MARKUP_RE.test(file)) return true;
  if (SWIFT_UI_RE.test(file) || COMPOSE_UI_RE.test(file) || FLUTTER_UI_RE.test(file)) return true;
  if (!JS_TS_PATH_RE.test(file)) return false;
  return (
    UI_JS_TS_PATH_RE.test(file) ||
    UI_JS_TS_ENTRY_RE.test(file) ||
    UI_APP_ROOT_RE.test(file) ||
    NEXT_APP_ROUTER_UI_RE.test(file) ||
    ANGULAR_UI_TS_RE.test(file) ||
    UI_ROUTER_JS_TS_RE.test(file) ||
    UI_SINGLE_APP_STATE_RE.test(file) ||
    UI_CONFIG_RE.test(file)
  );
}

module.exports = { isUiImpactPath };
