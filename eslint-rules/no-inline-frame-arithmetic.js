/**
 * @file eslint-rules/no-inline-frame-arithmetic.js
 *
 * ESLint custom rule: no-inline-frame-arithmetic (TASK-10)
 *
 * Disallows inline `* frameRate`, `* fps`, or `* fr` arithmetic outside of
 * `durationToFrames.ts`. All frame-count derivation MUST go through the
 * canonical `durationToFrames(duration, frameRate)` utility.
 *
 * Spec: openspec/changes/correct-batch-programmatic-video/specs/frame-count-utility/spec.md
 * Requirement: Exclusivity via ESLint Rule
 *
 * Valid (inside durationToFrames.ts):
 *   const exact = durationSeconds * frameRate;   // ← utility file exempt
 *
 * Invalid (anywhere else):
 *   const frames = duration * fps;               // ← no-inline-frame-arithmetic
 *   const count  = seconds * frameRate;          // ← no-inline-frame-arithmetic
 *   const n      = dur * fr;                     // ← no-inline-frame-arithmetic
 *
 * Fix suggestion: Use `durationToFrames(duration, frameRate)` instead.
 */

/** @type {import("eslint").Rule.RuleModule} */
const noInlineFrameArithmetic = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow inline * frameRate / * fps / * fr arithmetic outside durationToFrames.ts. " +
        "Use durationToFrames(duration, frameRate) from src/ai-powered/utils/durationToFrames.ts instead.",
      category: "Best Practices",
      recommended: false,
      url: "openspec/changes/correct-batch-programmatic-video/specs/frame-count-utility/spec.md",
    },
    messages: {
      noInlineFrameArithmetic:
        "Do not compute frame counts with inline arithmetic (`* {{identifier}}`). " +
        "Use `durationToFrames(duration, frameRate)` from utils/durationToFrames.ts instead.",
    },
    schema: [], // no options
    fixable: null, // no auto-fix (requires semantic understanding)
  },

  create(context) {
    // The utility file itself is exempt from this rule.
    const filename = context.filename ?? context.getFilename?.() ?? "";
    if (filename.endsWith("durationToFrames.ts") || filename.endsWith("durationToFrames.js")) {
      return {};
    }

    return {
      BinaryExpression(node) {
        if (node.operator !== "*") return;

        // Check the right-hand operand: frameRate | fps | fr
        const rhs = node.right;
        if (rhs.type === "Identifier" && /^(frameRate|fps|fr)$/.test(rhs.name)) {
          context.report({
            node,
            messageId: "noInlineFrameArithmetic",
            data: { identifier: rhs.name },
          });
        }
      },
    };
  },
};

export default noInlineFrameArithmetic;
