function buildInlinePackage({ profile, prompt, schemaPath }) {
  return {
    provider: "inline",
    profile,
    prompt,
    resultSchema: schemaPath,
    authority: {
      externalEffects: false,
      allowed: ["inspect", "edit", "test", "commit"],
      denied: ["push", "open-pr", "merge", "tracker-update"],
    },
  };
}

module.exports = { buildInlinePackage };
