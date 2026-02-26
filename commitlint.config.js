module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "refactor", "perf", "docs", "build", "chore", "style", "test"],
    ],
    "scope-enum": [0],
    "header-max-length": [2, "always", 100],
    "subject-case": [0],
  },
};
