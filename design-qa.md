# Design QA

## Evidence

- Source visual truth: `/var/folders/6h/2fzc9hfx7l97qsk5hp3mtgqc0000gn/T/TemporaryItems/NSIRD_screencaptureui_YUQhoG/Screenshot 2026-07-23 at 7.27.33 PM.png`
- Browser-rendered implementation: `/Users/kashyabmurali/Documents/Nike/Scout/design-qa-implementation.png`
- Responsive implementation: `/Users/kashyabmurali/Documents/Nike/Scout/design-qa-mobile.png`
- Combined comparison: `/Users/kashyabmurali/Documents/Nike/Scout/design-qa-comparison.png`
- Desktop viewport: 1280 x 720 CSS pixels
- Narrow viewport: 720 x 900 CSS pixels
- Source pixels: 772 x 314
- Desktop implementation pixels: 1280 x 720
- Comparison pixels: 1544 x 720
- Density normalization: browser capture used the normal 1x CSS viewport. The source crop remained at native size. The implementation queue region was cropped and scaled to the same 772 pixel comparison width.
- State: Resume queue with the latest draft expanded, an earlier version collapsed, and rejected resumes in a separate collapsed section.

## Full-view comparison evidence

The source showed the AI summary and resume before any decision controls. The implementation places Regenerate, Approve, Reject, and Mark applied directly below the expanded resume header. Open application and Edit resume remain visible in a smaller file toolbar, while PDF and DOCX downloads are grouped under Files. Rejected resumes appear below the active queue and remain collapsed.

The updated navigation and overview use the same four names: Job sources, Jobs, Resume queue, and Applications.

## Focused region comparison evidence

The combined comparison isolates the source card header and the updated implementation card. The action hierarchy, resume header, evidence text, secondary file actions, and resume document are readable at the chosen scale. No additional close crop was needed.

## Required fidelity surfaces

- Fonts and typography: Existing Inter and Arial treatments remain consistent. The decision label, action buttons, evidence summary, and resume content have distinct and readable hierarchy.
- Spacing and layout rhythm: The new action bar separates decisions from file actions without adding another large card. The resume begins immediately below the compact toolbar.
- Colors and tokens: Existing green, neutral, and danger tokens are reused. Approve is primary, Reject uses the danger treatment, and the action bar uses a restrained green background.
- Image quality and assets: This screen contains no imagery or custom icons that require comparison.
- Copy and content: Queue labels describe the actual state and match the navigation. "Files" accurately groups PDF and DOCX downloads.
- Accessibility: Actions remain semantic buttons, file downloads remain links, the Files control is keyboard reachable, and the narrow layout preserves readable controls.

## Interaction checks

- Files opens and exposes Download PDF and Download DOCX.
- The latest resume opens by default.
- Earlier resume versions remain collapsed.
- Rejected resume groups remain collapsed below active work.
- Browser console errors checked: none.
- State-changing actions were not submitted during QA because they would modify the candidate's local data.

## Comparison history

### Iteration 1

- [P2] Narrow navigation consumed most of the first viewport because grouped links became tall columns.
- Fix: Flattened navigation groups into one horizontally scrollable row below 720 pixels and hid group labels at that breakpoint.
- Post-fix evidence: `/Users/kashyabmurali/Documents/Nike/Scout/design-qa-mobile.png` shows the compact navigation, page title, pending card, and all four decision actions within the first viewport.

## Remaining findings

No actionable P0, P1, or P2 findings remain.

## Follow-up polish

- [P3] A future icon set could replace the Files label with a compact document menu once Scout has a shared icon library. The text label is more accessible and consistent for this version.

final result: passed
