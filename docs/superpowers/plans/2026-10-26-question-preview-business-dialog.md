# Question Preview Business Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `Z6QOE` question-preview experience as one inner-page business dialog that switches between a lightweight preview and the existing editor without changing the editor's current create/edit appearance.

**Architecture:** `Questions.vue` owns one dialog shell and its `preview | create | edit` state. `QuestionPreview.vue` keeps all rich-content/media safety and adds an opt-in library-preview presentation; `ManualQuestionEditor.vue` remains the existing editable body. The dialog teleports only into `MainLayout`'s content-area host so navigation and page chrome stay outside the mask.

**Tech Stack:** Vue 3, TypeScript, Element Plus 2.8, Vitest, Vue Test Utils

**Spec:** `docs/ui/pen-gemini.pen` node `Z6QOE`, plus the approved chat decisions from 2026-10-26.

## Global Constraints

- Use a single business-dialog shell with preview and editable states.
- Preserve the existing new-question editor layout, notices, footer summary, save actions, and unsaved-change guard.
- Multiple-choice correct answers render one correct option per line as `letter + option content`.
- The mask and scroll lock are limited to the inner content region; do not use a body-level dialog.
- Do not change other `QuestionPreview` consumers unless they opt into the new presentation.
- Do not commit; the user did not request a commit and the worktree already contains related uncommitted changes.

## Review Focus

- Long rich text and media scroll inside the body while header/footer remain usable.
- Preview-to-edit conversion failure leaves the preview open and reports the existing warning.
- Read-only users never receive the edit action.
- Multi-select answers retain stable option identity while displaying human letters.
- Existing paper, import, and exam-record previews keep their current default style.

---

### Task 1: Lightweight Question Preview

**Files:**
- Modify: `web/src/components/QuestionPreview.vue`
- Test: `web/src/components/__tests__/question-preview.spec.ts`

**Interfaces:**
- Consumes: existing `question`, `revealAnswer`, and `showScore` props.
- Produces: `variant="library"` presentation with `correctOptions` displayed one per line.

- [x] Write and run failing component tests for hidden metadata, borderless option rows, separate correct-option rows, analysis fallback, and unchanged default presentation.
- [x] Add the minimal `library` variant and correct-option derivation while preserving rich-content/media hydration.
- [x] Run the focused component tests to green.

### Task 2: Shared Preview/Edit Business Dialog

**Files:**
- Create: `web/src/components/QuestionBusinessDialog.vue`
- Modify: `web/src/views/admin/Questions.vue`
- Reuse: `web/src/layouts/MainLayout.vue`
- Reuse: `web/src/style.css`
- Test: `web/src/components/__tests__/question-list-actions.spec.ts`
- Test: `web/src/components/__tests__/modal-scroll-lock.spec.ts`

**Interfaces:**
- Consumes: Task 1's `QuestionPreview variant="library"`; existing `ManualQuestionEditor`; provided `contentDialogTarget`.
- Produces: one `QuestionBusinessDialog` shell with `questionDialogVisible` and `preview | create | edit` content modes.

- [x] Write and run failing tests for one dialog shell, content-host mounting, preview footer permissions, same-shell edit transition, and removal of preview history/identity UI.
- [x] Merge the two current dialogs without changing the editor body/footer markup or unsaved-change behavior.
- [x] Add fixed header/footer and scrollable-body styling scoped to this business dialog.
- [x] Run the focused dialog and scroll-lock tests to green.

### Task 3: Verification

**Files:**
- Verify only; no additional product files expected.

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: automated and browser acceptance evidence.

- [x] Run all Web unit tests.
- [x] Run `npx vue-tsc --noEmit` from `web/`.
- [x] Run the Web production build.
- [x] Browser-check inner-page mask boundary, locked background wheel, long-body scrolling, preview-to-edit continuity, and preserved editor appearance.

### Task 4: Dual Correct-Answer Controls

**Files:**
- Modify: `web/src/components/ManualQuestionEditor.vue`
- Modify: `web/src/components/Tiptap/widget/QuestionOptionView.vue`
- Test: `web/src/components/__tests__/manual-question-editor.spec.ts`

**Interfaces:**
- Consumes: the existing manual editor's `show-answer-labels` presentation.
- Produces: answer-setting option letters plus equivalent right-side set/unset actions; other Tiptap presentations retain their existing controls.

- [x] Cover single, multiple and judgment answers through both the option-letter control and the right-side action.
- [x] Keep A/B/C explicitly centered and update the hint to describe both valid interaction paths.
- [x] Run focused and full verification, then repeat browser acceptance against the corrected interaction.

### Task 5: Preserve Exceptional Editor State

**Files:**
- Modify: `web/src/components/QuestionBusinessDialog.vue`
- Modify: `web/src/views/admin/Questions.vue`
- Test: `web/src/components/__tests__/question-bank-without-scores.spec.ts`

**Interfaces:**
- Consumes: the shared dialog's preview/editor slots and the editor's canonical compatibility converter.
- Produces: lossless unknown-save inspection and preview retention for unsupported legacy content.

- [x] Keep the real editor mounted but hidden while inspecting an unknown save, preserving internal content and undo history.
- [x] Run the editor's full compatibility conversion before leaving preview mode.
- [x] Add real-editor regressions for both paths and rerun the static question-bank harness.
