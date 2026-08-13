// `env` must be non-optional. If it is optional, TypeScript forces callers to
// write `process.env?.EXPO_PUBLIC_API_URL`, and babel-preset-expo's
// inline-env-vars plugin only visits MemberExpression nodes -- it never sees
// the resulting OptionalMemberExpression, so the value is silently left
// un-inlined and reads as undefined in release bundles.
declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string;
  };
};
