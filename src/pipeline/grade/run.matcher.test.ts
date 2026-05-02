import assert from "node:assert/strict";
import { isWarningOnlyMention, matchesRubricMatcher } from "./run.js";

const modernZeroParameterAnswer = `
Use onChange with the zero-parameter variant:
.onChange(of: searchText) {
  performSearch()
}
`;

const modernTwoParameterAnswer = `
.onChange(of: searchText) { oldValue, newValue in
  if newValue.count > oldValue.count { showSuggestions() }
}
`;

const deprecatedSingleParameterAnswer = `
.onChange(of: value) { newValue in
  performSearch()
}
`;

const modernScrollContentBackgroundAnswer = `
ScrollView {
  content
}
.scrollContentBackground(.visible)
`;

const deprecatedScrollContentBackgroundAnswer = `
ScrollView {
  content
}
.scrollContentBackground(.hidden)
`;

const warningOnlyHiddenAnswer = "No. Don't use `.scrollContentBackground(.hidden)` here; use `.scrollContentBackground(.visible)` instead.";

const zeroParameterMatcher = "/\\.onChange\\(of:\\s*[^)]*\\)\\s*\\{(?:(?!\\bin\\b)[^{}])*\\}/";
const twoParameterMatcher = "/\\.onChange\\(of:\\s*[^)]*\\)\\s*\\{\\s*[^{}]*,\\s*[^{}]*\\s+in\\b/";
const hiddenScrollContentBackgroundMatcher = "/scrollContentBackground\\(\\s*\\.hidden\\s*\\)/";

assert.equal(matchesRubricMatcher(modernZeroParameterAnswer, "onChange"), true);
assert.equal(matchesRubricMatcher(modernZeroParameterAnswer, zeroParameterMatcher), true);
assert.equal(matchesRubricMatcher(modernZeroParameterAnswer, twoParameterMatcher), false);

assert.equal(matchesRubricMatcher(modernTwoParameterAnswer, "onChange"), true);
assert.equal(matchesRubricMatcher(modernTwoParameterAnswer, zeroParameterMatcher), false);
assert.equal(matchesRubricMatcher(modernTwoParameterAnswer, twoParameterMatcher), true);

assert.equal(matchesRubricMatcher(deprecatedSingleParameterAnswer, "onChange"), true);
assert.equal(matchesRubricMatcher(deprecatedSingleParameterAnswer, zeroParameterMatcher), false);
assert.equal(matchesRubricMatcher(deprecatedSingleParameterAnswer, twoParameterMatcher), false);

assert.equal(matchesRubricMatcher(modernScrollContentBackgroundAnswer, hiddenScrollContentBackgroundMatcher), false);
assert.equal(matchesRubricMatcher(deprecatedScrollContentBackgroundAnswer, hiddenScrollContentBackgroundMatcher), true);
assert.equal(isWarningOnlyMention(warningOnlyHiddenAnswer, hiddenScrollContentBackgroundMatcher), true);
assert.equal(isWarningOnlyMention("Use `.scrollContentBackground(.hidden)` for the opaque background.", hiddenScrollContentBackgroundMatcher), false);

console.log("run.matcher.test.ts passed");
