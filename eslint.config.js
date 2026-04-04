const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-constant-condition": ["error", { checkLoops: false }],
      eqeqeq: ["error", "always"],
      "no-var": "warn",
      "prefer-const": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
    },
  },
  {
    files: ["scripts/helper.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["node_modules/", ".worktrees/", ".pm/", "1.0.*/", "templates/"],
  },
];
