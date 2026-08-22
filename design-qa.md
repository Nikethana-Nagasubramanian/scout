# Scout shell, Jobs search, and results QA

Reference: Paper components 9ZP-2, A0W-2, A0V-2, and A1L-2 supplied by the user.

## Verified

- Search, status selection, and the segmented profile filters match the supplied 36px control height.
- Every authenticated page uses the shared #515B41 shell with an exact 8px frame.
- The white content surface fills the available viewport height, including pages with short content.
- The document remains fixed while the white content surface owns vertical scrolling.
- Scroll bounce reveals a white underlay, so the olive shell never flashes inside the content surface.
- The sidebar remains fixed during desktop page scrolling.
- Geist, Geist Mono, Archivo, and Young Serif are bundled and loaded by the root layout.
- Every main page heading uses Young Serif at 32px, a 40px line height, and weight 400.
- Shared separators use the supplied 2, 6, 8, 10 dash sequence with rounded caps.
- Search and filter text uses Geist at exactly 14px with an 18px line height.
- The Needs review, Eligible, and Filtered segmented controls submit real filters.
- Each job uses the supplied three-column content, explanation, and action layout.
- Job titles use Young Serif at 18px with a 24px line height.
- Job metadata and explanations use Geist at 14px with an 18px line height.
- Profile match values use Young Serif at 24px with a 30px line height.
- Action controls use Archivo at 14px with a 24px line height.
- Job actions reflow below the row at narrower desktop widths, and the loading label stays within the result container.
- The supplied dashed separator asset appears between job rows.
- Existing application, resume preparation, and rejection actions remain functional.
- Fetch summaries start collapsed while preserving the key run metrics in the summary row.
- Manual job import opens from the Jobs header in a centered, accessible dialog.
- The former inline manual-import card is removed from the Jobs content flow.
- Manual-import fields, text, spacing, separators, and actions use Scout's shared typography and control styling.
- The manual-import dialog closes through its X control, Cancel, Escape, or a pointer press outside the dialog.
- Company, job title, and job URL are the only required manual-import inputs.
- The manual-import header separator reaches both dialog edges, and the redundant separator below the description is removed.
- Native select elements retain keyboard and screen-reader behavior while using one caret with a consistent 14px right inset.
- Forced-colors mode restores the platform-native select appearance.
- The manual fetch overlay holds each of its four truthful workflow states for approximately 2.6 seconds.
- The review state says "Reviewing roles" because collection does not currently stream a trustworthy live role count.

No actionable P0, P1, or P2 differences remain for this scoped pass.

final result: passed
