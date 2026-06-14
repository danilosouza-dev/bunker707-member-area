module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [1, "always", 120],
    "footer-max-line-length": [1, "always", 120],
    "scope-case": [2, "always", "kebab-case"],
  },
};
