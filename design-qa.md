# Design QA

## Source and state

- Source visual truth: `/private/var/folders/6h/2fzc9hfx7l97qsk5hp3mtgqc0000gn/T/TemporaryItems/NSIRD_screencaptureui_wcbGwd/Screenshot 2026-08-13 at 1.39.54 PM.png`
- Browser implementation: `/private/tmp/scout-jobs-cleanup-final.jpg`
- Full comparison: `/private/tmp/scout-jobs-cleanup-comparison.jpg`
- Focused table comparison: `/private/tmp/scout-jobs-cleanup-table-comparison.jpg`
- Source image: 2880 by 1636 pixels
- Implementation image: 1873 by 1164 pixels
- Requested browser viewport: 2048 by 1164 CSS pixels
- Density normalization: both images were scaled proportionally into equal comparison columns. The focused comparison uses matching table regions.
- State: Jobs page, Eligible only, Active only, All sources, three opportunities.

## Findings

No actionable P0, P1, or P2 findings remain.

- Typography: existing Scout type scale, weights, line heights, and table hierarchy remain unchanged.
- Spacing: removing secondary source text and three inline links reduces row height and keeps the decision column easier to scan.
- Colors: source badges and semantic match and signal colors remain unchanged.
- Images and assets: this table contains no image assets.
- Copy: only the source badge remains in Source. Posting, Apply, Details, and redundant source descriptions are removed.
- Interaction: Prepare application and the state-aware continuation buttons remain the primary path into the central job workspace. Reject remains available as the secondary decision.
- Accessibility: the remaining decisions retain semantic button and link behavior, accessible names, and visible focus styles.

## Comparison history

1. The source showed a source badge followed by a redundant source description and three links.
2. The Source cell was reduced to the source badge only.
3. Posting, Apply, and Details were removed because those actions now live in the central workspace.
4. The revised browser capture confirms that all three rows use the same simplified hierarchy.

## Verification

- The Jobs table rendered with only the source badges in the Source column.
- The browser DOM contains no Posting, Apply, or Details actions in these job rows.
- Prepare application and Reject remain present for each eligible opportunity.
- `pnpm run verify` passed.
- 10 test files and 83 tests passed.
- TypeScript, ESLint, production build, and the no em dash check passed.
- No state-changing controls were submitted during QA.

final result: passed
