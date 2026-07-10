import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Split tooling: stub templates reference paths that only resolve once
    // derived into packages/payments-kit/ (see tooling/split/SPLIT.md).
    "tooling/split/stub/**",
  ]),
  // React Compiler experimental rules — eslint-config-next ships these at
  // `error` severity but we treat them as `warn` for now. Reasons:
  //   1. Local and CI versions of the plugin detect different subsets of
  //      the same file, so a commit that passes local blocks CI (happened
  //      repeatedly during Sprint 4-6).
  //   2. Many of the flagged cases are legitimate external-state syncs
  //      (cascade-reset in geo pickers, setState in config-missing
  //      effects, Date.now() in render when a per-render timestamp is
  //      actually what we want).
  // Warnings still surface in the lint output so regressions are
  // visible; they just don't block the CI gate until we've cleaned up
  // the entire set of call-sites. Revisit the `error` severity when
  // the list is small enough to fix exhaustively.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity":              "warn",
      "react-hooks/immutability":        "warn",
      // "Cannot access variable before it is declared" is emitted under
      // react-hooks/rules-of-hooks by newer plugin versions — downgrade
      // there too so the Compiler's hoisting check doesn't block CI on
      // call-sites the older local plugin never flagged.
      "react-hooks/rules-of-hooks":      "warn",
    },
  },
]);

export default eslintConfig;
